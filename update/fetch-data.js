#!/usr/bin/env node

/**
 * Market Share Data Fetcher
 *
 * Pulls per-month CSVs from StatCounter, parses the non-combined version data,
 * and resolves version gaps using version-resolver.js.
 *
 * StatCounter's non-combined endpoint produces clean labels:
 *   - Standard versioned:   "Chrome 147.0", "Edge 146", "Firefox 125", "Safari 18.3"
 *   - Mobile aggregates:    "Chrome for Android" (versionless, Android-only)
 *                           "Safari iPhone"      (versionless, iOS-only)
 *                           "Chrome for iPhone"  (versionless, iOS-only)
 *   - Desktop anomaly:      "Chrome for Android" sometimes appears in DESKTOP CSV
 *                           (StatCounter classification quirk) — we exclude these
 *                           from desktop entirely
 *   - Open-ended ranges:    "Edge 79+", "Firefox 5+" — skip
 *   - Other junk:           "Unknown 0", "Mozilla 0", "Instabridge 0" — skip
 *
 * Aggregate labels become a browser entry with `share` but empty `versions`.
 * The resolver then fills versions from chromiumdash + curated defaults.
 *
 * Output: market-data.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { resolveVersions, applyVersions } from './version-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

import { DEFAULTS, MIN_BROWSER_SHARE, MIN_VERSION_SHARE, DESKTOP_AVAILABILITY, MOBILE_AVAILABILITY } from './consts.js'

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function previousMonth() {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  if (m === 0) { y -= 1; m = 12; }
  return { int: `${y}${String(m).padStart(2, '0')}`, fmt: `${y}-${String(m).padStart(2, '0')}` };
}

function downloadCSV(url, filename) {
  return new Promise((resolve, reject) => {
    const filepath = path.join(DATA_DIR, filename);
    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(filepath); } catch {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filepath); });
    }).on('error', reject);
  });
}

function parseCSVRow(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function parseSingleMonthCSV(filepath) {
  if (!fs.existsSync(filepath)) throw new Error(`Missing CSV: ${filepath}`);
  const content = fs.readFileSync(filepath, 'utf-8').trim();
  const lines = content.split('\n');
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < 2) continue;
    const name = row[0].trim();
    if (!name || name.toLowerCase() === 'other') continue;
    const pct = parseFloat(row[1]);
    if (isNaN(pct) || pct <= 0) continue;
    result[name] = pct;
  }
  return result;
}

function filterAndNormalize(data, minPct) {
  const filtered = {};
  for (const [k, v] of Object.entries(data)) if (v >= minPct) filtered[k] = v;
  const sum = Object.values(filtered).reduce((a, b) => a + b, 0);
  if (sum === 0) return filtered;
  const out = {};
  for (const [k, v] of Object.entries(filtered)) out[k] = +((v / sum) * 100).toFixed(2);
  return out;
}

/**
 * Parse a version label. Returns one of:
 *   { browser, version, context? }   — proper version (e.g. "Chrome 147.0")
 *   { browser, version: null, context? } — aggregate without version (resolver fills)
 *   null                             — skip entirely
 *
 * `context` constrains the browser to a specific OS (e.g. 'android', 'ios').
 */
function parseVersionLabel(label) {
  const t = label.trim();

  // Open-ended ranges: "Edge 79+", "Firefox 5+", "Opera 15+"
  if (/\s\d+\+$/.test(t)) return null;

  // Specific mobile-aggregate labels (no version)
  if (t === 'Chrome for Android') return { browser: 'Chrome', context: 'android', version: null };
  if (t === 'Safari iPhone')      return { browser: 'Safari', context: 'ios', version: null };
  if (t === 'Chrome for iPhone')  return { browser: 'Chrome', context: 'ios', version: null };

  // "Chrome (all)" — historical / partially-combined endpoint, generic Chrome aggregate
  const allMatch = t.match(/^(.+?)\s+\(all\)$/i);
  if (allMatch) return { browser: allMatch[1].trim(), version: null };

  // Version "0" aggregates: "Brave 0", "Mozilla 0", "iPhone 0", "Android 0", "Unknown 0"
  // (iPhone 0 / Android 0 come from the partially-combined endpoint — still handle them
  //  in case someone mixes endpoints)
  const zeroMatch = t.match(/^(.+?)\s+0$/);
  if (zeroMatch) {
    const name = zeroMatch[1].trim();
    if (name === 'Brave')   return { browser: 'Brave', version: null };
    if (name === 'iPhone')  return { browser: 'Safari', context: 'ios', version: null };
    if (name === 'Android') return { browser: 'Android', version: null };
    // Mozilla 0, Unknown 0, Sogou Explorer 0, 360 Safe Browser 0 etc — skip
    return null;
  }

  // Standard "Browser Name VERSION" — version is digits with optional dots
  const m = t.match(/^(.+?)\s+([\d]+(?:\.[\d]+)*)$/);
  if (!m) return null;

  return { browser: m[1].trim(), version: m[2].trim() };
}

/**
 * Group version rows by browser. Aggregate entries (version: null) contribute
 * share but no versions — those get resolved later.
 *
 * `deviceClass` is 'desktop' or 'mobile'. We use it to drop labels whose
 * `context` doesn't belong on this device (e.g. "Chrome for Android" in the
 * desktop CSV is an anomaly).
 */
function groupVersionsByBrowser(versionRow, deviceClass) {
  const groups = {};

  for (const [label, pct] of Object.entries(versionRow)) {
    const parsed = parseVersionLabel(label);
    if (!parsed) continue;

    // If this label is contextualized to a specific OS, ensure it's compatible
    // with the current device class. Drop "Chrome for Android" from desktop, etc.
    if (parsed.context) {
      const isMobileContext = parsed.context === 'android' || parsed.context === 'ios';
      if (deviceClass === 'desktop' && isMobileContext) continue;
      if (deviceClass === 'mobile' && !isMobileContext) continue;
    }

    const browser = parsed.browser;
    // Use a composite key when context is set so e.g. "Chrome on android" and
    // "Chrome on ios" stay separate within the mobile breakdown
    const key = parsed.context ? `${browser}::${parsed.context}` : browser;

    if (!groups[key]) groups[key] = { browser, share: 0, _versions: {}, context: parsed.context };
    groups[key].share += pct;

    if (parsed.version !== null) {
      groups[key]._versions[parsed.version] = pct;
    }
  }

  const result = {};
  for (const [, data] of Object.entries(groups)) {
    let versions = {};
    if (Object.keys(data._versions).length) {
      versions = filterAndNormalize(data._versions, MIN_VERSION_SHARE);
      // If the filter dropped everything (all versions below threshold),
      // keep the top 3 raw entries renormalized — better than empty + resolver fallback
      if (Object.keys(versions).length === 0) {
        const top = Object.entries(data._versions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const sum = top.reduce((a, [, v]) => a + v, 0);
        for (const [v, p] of top) versions[v] = +((p / sum) * 100).toFixed(2);
      }
    }
    result[data.context ? `${data.browser}::${data.context}` : data.browser] = {
      browser: data.browser,
      share: +data.share.toFixed(2),
      versions,
      context: data.context
    };
  }
  return result;
}

/**
 * Build per-OS browser table. Picks entries from `versionByBrowser` whose:
 *   - `browser` name is allowed for this OS in availability map
 *   - `context` matches the OS (if context is set) OR is unset
 *
 * On mobile, "Chrome::android" goes only to android, "Chrome::ios" only to ios.
 * On desktop, contextless "Chrome" goes to all allowed desktop OSes.
 */
function buildPlatformBrowsers(versionByBrowser, availability) {
  const result = {};
  for (const [os, allowed] of Object.entries(availability)) {
    const shares = {};
    const versionsRef = {};

    for (const [key, entry] of Object.entries(versionByBrowser)) {
      if (!allowed.includes(entry.browser)) continue;

      // Match context: if entry is contextualized, OS must match exactly
      if (entry.context && entry.context !== os) continue;

      // For desktop browsers (no context), accept on any desktop OS allowed
      // For uncontextualized entries on mobile, this can lead to Chrome
      // (no context) being assigned to both android AND ios. This is fine
      // because on mobile the contextualized "Chrome for Android" and
      // "Chrome for iPhone" carry the real share — non-contextualized Chrome
      // on mobile should be near-zero with the non-combined endpoint.

      shares[entry.browser] = (shares[entry.browser] || 0) + entry.share;
      versionsRef[entry.browser] = entry.versions;
    }

    const normalized = filterAndNormalize(shares, MIN_BROWSER_SHARE);
    const out = {};
    for (const [browser, share] of Object.entries(normalized)) {
      out[browser] = { share, versions: versionsRef[browser] || {} };
    }
    result[os] = out;
  }
  return result;
}

async function main() {
  const prev = previousMonth();
  console.log(`Fetching StatCounter data for ${prev.fmt}...\n`);

  const base = `region_hidden=ww&granularity=monthly&region=Worldwide&fromInt=${prev.int}&toInt=${prev.int}&fromMonthYear=${prev.fmt}&toMonthYear=${prev.fmt}&csv=1`;

  const urls = {
    'platform.csv':
      `https://gs.statcounter.com/platform-market-share/chart.php?device=Desktop%20%26%20Mobile%20%26%20Tablet&device_hidden=desktop%2Bmobile%2Btablet&multi-device=true&statType_hidden=comparison&statType=Platform%20Comparison&${base}`,
    'os-desktop.csv':
      `https://gs.statcounter.com/os-market-share/desktop/chart.php?device=Desktop&device_hidden=desktop&statType_hidden=os_combined&statType=Operating%20System&${base}`,
    'os-mobile.csv':
      `https://gs.statcounter.com/os-market-share/mobile/chart.php?device=Mobile&device_hidden=mobile&statType_hidden=os_combined&statType=Operating%20System&${base}`,
    'version-desktop.csv':
      `https://gs.statcounter.com/browser-version-market-share/desktop/chart.php?device=Desktop&device_hidden=desktop&statType_hidden=browser_version&statType=Browser%20Version&${base}`,
    'version-mobile.csv':
      `https://gs.statcounter.com/browser-version-market-share/mobile/chart.php?device=Mobile&device_hidden=mobile&statType_hidden=browser_version&statType=Browser%20Version&${base}`
  };

  for (const [name, url] of Object.entries(urls)) {
    try {
      await downloadCSV(url, name);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      console.error(`    Download manually → ./data/${name}`);
      console.error(`    URL: ${url}`);
    }
  }

  console.log('\nParsing...\n');

  // Device split (tablet → mobile)
  const platformRow = parseSingleMonthCSV(path.join(DATA_DIR, 'platform.csv'));
  const tabletShare = platformRow['Tablet'] || 0;
  const mobileShare = (platformRow['Mobile'] || 0) + tabletShare;
  const desktopShare = platformRow['Desktop'] || 0;
  const totalDev = mobileShare + desktopShare;
  const deviceSplit = {
    mobile:  +((mobileShare / totalDev) * 100).toFixed(2),
    desktop: +((desktopShare / totalDev) * 100).toFixed(2)
  };
  console.log(`Device split: ${deviceSplit.desktop}% desktop, ${deviceSplit.mobile}% mobile (tablet ${(tabletShare/totalDev*100).toFixed(2)}% folded in)`);

  // OS share within each device class
  function normalizeDesktopOS(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const low = k.toLowerCase();
      if (low === 'windows') out.windows = (out.windows || 0) + v;
      else if (low === 'os x' || low === 'macos' || low === 'osx') out.macos = (out.macos || 0) + v;
      else if (low === 'linux') out.linux = (out.linux || 0) + v;
      else if (low === 'chrome os' || low === 'chromeos') out.chromeos = (out.chromeos || 0) + v;
    }
    return out;
  }
  function normalizeMobileOS(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const low = k.toLowerCase();
      if (low === 'android') out.android = (out.android || 0) + v;
      else if (low === 'ios') out.ios = (out.ios || 0) + v;
    }
    return out;
  }
  const osShare = {
    desktop: filterAndNormalize(normalizeDesktopOS(parseSingleMonthCSV(path.join(DATA_DIR, 'os-desktop.csv'))), 0.1),
    mobile:  filterAndNormalize(normalizeMobileOS(parseSingleMonthCSV(path.join(DATA_DIR, 'os-mobile.csv'))), 0.1)
  };
  console.log(`Desktop OS:  ${JSON.stringify(osShare.desktop)}`);
  console.log(`Mobile OS:   ${JSON.stringify(osShare.mobile)}`);

  // Group browser+versions, respecting device class
  const versionDesktopRow = parseSingleMonthCSV(path.join(DATA_DIR, 'version-desktop.csv'));
  const versionMobileRow = parseSingleMonthCSV(path.join(DATA_DIR, 'version-mobile.csv'));
  const desktopBrowsers = groupVersionsByBrowser(versionDesktopRow, 'desktop');
  const mobileBrowsers = groupVersionsByBrowser(versionMobileRow, 'mobile');

  const summarize = (obj) => Object.values(obj).map(e => {
    const tag = e.context ? `${e.browser}[${e.context}]` : e.browser;
    return `${tag}=${e.share}`;
  }).join(', ');
  console.log(`\nDesktop entries: ${summarize(desktopBrowsers)}`);
  console.log(`Mobile entries:  ${summarize(mobileBrowsers)}`);

  // Build per-OS browser breakdown
  const platforms = {
    ...buildPlatformBrowsers(desktopBrowsers, DESKTOP_AVAILABILITY),
    ...buildPlatformBrowsers(mobileBrowsers, MOBILE_AVAILABILITY)
  };

  // Fill version gaps
  console.log('\nResolving version gaps...');
  const resolved = await resolveVersions({ live: true });
  applyVersions(platforms, resolved);

  // Output
  const output = {
    fetched: new Date().toISOString(),
    forMonth: prev.fmt,
    deviceSplit,
    osShare,
    platforms
  };

  console.log('\n=== Browser breakdown per OS ===');
  for (const [platform, browsers] of Object.entries(platforms)) {
    console.log(`\n${platform}:`);
    const sorted = Object.entries(browsers).sort((a, b) => b[1].share - a[1].share);
    for (const [browser, data] of sorted) {
      const topVersions = Object.entries(data.versions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([v, p]) => `${v}(${p}%)`)
        .join(', ') || '(no versions)';
      console.log(`  ${browser.padEnd(20)} ${String(data.share).padStart(6)}%  → ${topVersions}`);
    }
  }

  const outPath = path.join(__dirname, 'market-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Wrote ${outPath}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
