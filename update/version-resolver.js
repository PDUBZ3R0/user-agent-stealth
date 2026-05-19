/**
 * Version Resolver
 *
 * Fills in version data for browsers that StatCounter reports without versions:
 *   - "Chrome for Android"  → Android Chrome versions (from chromiumdash)
 *   - "Chrome for iPhone"   → iOS Chrome versions (from chromiumdash)
 *   - "Safari iPhone"       → iOS Safari versions (from curated defaults)
 *   - "Brave 0"             → Brave versions (curated)
 *   - "Android 0"           → Android WebView versions (tracks Chrome Android)
 *
 * Live sources:
 *   - chromiumdash.appspot.com/fetch_releases (Chrome per-platform majors)
 *
 * Offline fallback: hardcoded distributions in DEFAULTS. Update these during
 * monthly maintenance if live fetch is unavailable in your environment.
 */

import https from 'https';
import { DEFAULTS } from './consts.js'
import { update } from './update-consts.js'


function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Get recent Chrome stable major versions for a platform.
 * platform: 'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS'
 * Returns an array of major version numbers in descending order, or null on failure.
 */
async function fetchChromeRecent(platform, n = 5) {
  try {
    const url = `https://chromiumdash.appspot.com/fetch_releases?platform=${platform}&channel=Stable&num=12`;
    const data = await fetchJSON(url);
    if (!Array.isArray(data)) return null;

    const majors = [];
    const seen = new Set();
    for (const release of data) {
      const major = release.milestone;
      if (!isNaN(major) && !seen.has(major)) {
        seen.add(major);
        majors.push(major);
        if (majors.length >= n) break;
      }
    }
    return majors.length ? majors : null;
  } catch {
    return null;
  }
}

/**
 * Get recent Chrome stable major versions. Platform ignored releases go to all platforms.
 * Returns an array of major version numbers in descending order, or null on failure.
 */
async function fetchBraveRecent(platform, n = 5) {
  try {
    const url = "https://versions.brave.com/latest/brave-versions.json";
    const data = await fetchJSON(url);
    if (!data) return null;

    const majors = [];
    const seen = new Set();
    for (const tag in data) {
      const release = data[tag];
      if (release.channel === "release") {
        const match = tag.match(/^v(\d+\.\d+)/);
        if (match) {
          const major = match[1];
          if (!isNaN(major) && !seen.has(major)) {
            seen.add(major);
            majors.push(major);
            if (majors.length >= n) break;
          }
        }
      }
    }
    return majors.length ? majors : null;
  } catch {
    return null;
  }
}

/**
 * Get latest Safari from browsers.fyi
 */
async function fetchSafari(platform) {
  try {
    const url = "https://www.browsers.fyi/api/";
    const data = await fetchJSON(url);
    if (data) {
      if (platform === "iOS") {
        return [data.safari_ios.version, data.safari_ios.version - 0.1]
      } else {
        return [data.safari.version, data.safari.version - 0.1]
      }
    } else {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Generate random set of weights for list size of *number, total sums to 100.
 */
function genWeights(number) {
  let out = [];
  let remains = 100;
  while (out.length < (number - 1)){
    let perc = Math.round(Math.random()*remains);
    if (remains - perc > number - out.length) {
      remains -= perc;
      out.push(perc)
    }
  }
  out.push(remains);
  return out;
}

/**
 * Build a distribution { "version": pct } from an ordered list of versions,
 * weighted toward the newest.
 */
function buildDistribution(versions, weights) {
  if (!versions || versions.length === 0) return {};
  const result = {};
  const w = weights ? weights.slice(0, versions.length) : genWeights(versions.length);
  const total = w.reduce((a, b) => a + b, 0);
  versions.forEach((v, i) => {
    result[String(v)] = +((w[i] / total) * 100).toFixed(2);
  });
  return result;
}

/**
 * Resolve current versions for the version-gap browsers.
 * Tries live fetch first; falls back to DEFAULTS on failure.
 */
export async function resolveVersions({ live = true } = {}) {
  const result = {
    chromeDesktop:  { versions: { ...DEFAULTS.chromeDesktop.distribution } },
    chromeAndroid:  { versions: { ...DEFAULTS.chromeAndroid.distribution } },
    chromeIOS:      { versions: { ...DEFAULTS.chromeIOS.distribution } },
    safariMacOS:    { versions: { ...DEFAULTS.safariMacOS.distribution } },
    safariIOS:      { versions: { ...DEFAULTS.safariIOS.distribution } },
    brave:          { versions: { ...DEFAULTS.brave.distribution } },
    androidWebView: { versions: { ...DEFAULTS.androidWebView.distribution } }
  };

  if (!live) return result;
  let changedAny = false;

  console.log('  Fetching live versions ...');
  for (const [key, platform, f] of [
    ['chromeDesktop', 'Windows',  fetchChromeRecent],
    ['chromeAndroid', 'Android',  fetchChromeRecent],
    ['chromeIOS',     'iOS',      fetchChromeRecent],
    ['safariMacOS',   'Mac',      fetchSafari],
    ['safariIOS',     'iOS',      fetchSafari],
    ['brave',         null,       fetchBraveRecent],
    ['androidWebView', 'Webview', fetchChromeRecent],
  ]) {
    const majors = await f(platform, 3);
    if (majors) {
      result[key].versions = buildDistribution(majors);
      console.log(`    ✓ ${key}: ${majors.join(', ')}`);
      changedAny = true;
    } else {
      console.log(`    ✗ ${key}: using defaults (${Object.keys(result[key].versions).join(', ')})`);
    }
  }

  if (changedAny) update(result);
  return result;
}

/**
 * Apply resolved versions to a market-data platforms object.
 *
 * Only fills in versions where the existing entry has empty versions ({}).
 * Specifically:
 *   - Chrome on android (no versions)        → chromeAndroid
 *   - Chrome on ios (no versions)            → chromeIOS
 *   - Chrome on any desktop OS (no versions) → chromeDesktop
 *   - Safari on ios (no versions)            → safariIOS
 *   - Safari on macos (no versions)          → safariMacOS
 *   - Brave anywhere (no versions)           → brave
 *   - Android (WebView) on android           → androidWebView
 *
 * Mutates `platforms` in place.
 */
export function applyVersions(platforms, resolved) {
  for (const [os, browsers] of Object.entries(platforms)) {
    for (const [browser, data] of Object.entries(browsers)) {
      const noVersions = !data.versions || Object.keys(data.versions).length === 0;
      if (!noVersions) continue;

      if (browser === 'Chrome') {
        if (os === 'android') data.versions = { ...resolved.chromeAndroid.versions };
        else if (os === 'ios') data.versions = { ...resolved.chromeIOS.versions };
        else data.versions = { ...resolved.chromeDesktop.versions };
      } else if (browser === 'Safari') {
        if (os === 'ios') data.versions = { ...resolved.safariIOS.versions };
        else data.versions = { ...resolved.safariMacOS.versions };
      } else if (browser === 'Brave') {
        data.versions = { ...resolved.brave.versions };
      } else if (browser === 'Android') {
        data.versions = { ...resolved.androidWebView.versions };
      }
    }
  }
}

export default { resolveVersions, applyVersions };
