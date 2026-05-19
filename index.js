#!/usr/bin/env node

import path from 'node:path'
import fs from 'node:fs'

/**
 * User-Agent Generator
 * 
 * Uses real market share data from market-data.json:
 *   - device split (mobile vs desktop)
 *   - OS share within each device class
 *   - browser share within each OS  
 *   - version share within each browser
 * 
 * Every selection is weighted-random from the real data unless constrained.
 * 
 * Usage:
 *   const data = JSON.parse(fs.readFileSync('market-data.json'));
 *   const gen = new UAGenerator(data);
 *   
 *   gen.generate()                                    // fully random
 *   gen.generate({ type: 'mobile' })                  // pick OS+browser
 *   gen.generate({ os: 'windows' })                   // pick browser+version
 *   gen.generate({ os: 'windows', browser: 'Edge' })  // pick version only
 *   gen.generate({ browser: 'Safari' })               // pick OS (constrained to ones with Safari)
 *   gen.generate({ method: 'POST' })                  // adjust Sec-Fetch headers
 */

const MOBILE_OS = new Set(['android', 'ios']);
const DESKTOP_OS = new Set(['windows', 'macos', 'linux', 'chromeos']);

const PLATFORM_HEADER = {
  windows:  'Windows',
  macos:    'macOS',
  linux:    'Linux',
  chromeos: 'Chrome OS',
  android:  'Android',
  ios:      'iOS'
};

const ARCH_BY_OS = {
  windows:  'x86',
  macos:    'arm',   // Apple Silicon dominant now; Intel rare
  linux:    'x86',
  chromeos: 'x86',
  android:  'arm',
  ios:      'arm'
};

const OS_VERSIONS = {
  windows:  ['10.0', '10.0', '10.0', '11.0'], // weighted toward 10
  macos:    ['14_6_1', '15_0', '15_1', '14_5'],
  linux:    ['x86_64'],
  chromeos: ['x86_64'],
  android:  ['13', '14', '14', '15'],
  ios:      ['17_6_1', '18_0', '18_1', '18_2']
};

// Browsers that send Sec-CH-UA (Chromium-based, plus Edge)
const CHROMIUM_BROWSERS = new Set([
  'Chrome', 'Edge', 'Opera', 'Brave', 'Vivaldi',
  'Samsung Internet', 'Chrome for Android', 'Chromium'
]);

// Browsers that DON'T send Sec-CH-UA at all
const NO_CLIENT_HINTS = new Set(['Firefox', 'Safari', 'IE', 'UC Browser']);

/**
 * Weighted random selection from { key: percent }
 */
function weightedPick(weights) {
  const entries = Object.entries(weights);
  if (entries.length === 0) return null;
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    r -= v;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class UAGenerator {
  constructor(marketData) {
    if (!marketData || !marketData.platforms) {
      throw new Error('Invalid market-data.json. Run fetch-data.js first.');
    }
    this.data = marketData;
  }

  /**
   * Pick a device type (mobile|desktop) using device split.
   */
  _pickType() {
    return weightedPick(this.data.deviceSplit);
  }

  /**
   * Pick OS within a type.
   */
  _pickOS(type) {
    const share = this.data.osShare?.[type];
    if (share && Object.keys(share).length) {
      return weightedPick(share);
    }
    // Fallback if osShare missing
    return type === 'mobile' ? (Math.random() < 0.72 ? 'android' : 'ios') :
      weightedPick({ windows: 72, macos: 16, linux: 7, chromeos: 5 });
  }

  /**
   * Pick browser for an OS using the per-platform breakdown.
   */
  _pickBrowser(os) {
    const platform = this.data.platforms[os];
    if (!platform || Object.keys(platform).length === 0) {
      throw new Error(`No browser data for OS: ${os}`);
    }
    const shares = {};
    for (const [browser, data] of Object.entries(platform)) {
      shares[browser] = data.share;
    }
    return weightedPick(shares);
  }

  /**
   * Pick a version for a browser on an OS using version breakdown.
   */
  _pickVersion(os, browser) {
    const versions = this.data.platforms[os]?.[browser]?.versions;
    if (!versions || Object.keys(versions).length === 0) return null;
    return weightedPick(versions);
  }

  /**
   * Find which OSes a given browser is available on (with real share).
   */
  _osesForBrowser(browser) {
    const result = {};
    for (const [os, browsers] of Object.entries(this.data.platforms)) {
      if (browsers[browser]) {
        result[os] = browsers[browser].share;
      }
    }
    return result;
  }

  /**
   * Resolve all unknowns based on the constraints provided.
   */
  resolveConfig(opts = {}) {
    let { type, os, browser, version } = opts;

    // If browser is specified, OS may need to be one that ships it
    if (browser && !os) {
      const oses = this._osesForBrowser(browser);
      if (Object.keys(oses).length === 0) {
        throw new Error(`Unknown browser: ${browser}`);
      }
      os = weightedPick(oses);
      type = MOBILE_OS.has(os) ? 'mobile' : 'desktop';
    }

    // If OS is specified, type is implied
    if (os && !type) {
      type = MOBILE_OS.has(os) ? 'mobile' : 'desktop';
    }

    // Pick type if still missing
    if (!type) type = this._pickType();

    // Pick OS if still missing
    if (!os) os = this._pickOS(type);

    // Validate type/os consistency
    if (type === 'mobile' && !MOBILE_OS.has(os)) {
      throw new Error(`OS "${os}" is not mobile`);
    }
    if (type === 'desktop' && !DESKTOP_OS.has(os)) {
      throw new Error(`OS "${os}" is not desktop`);
    }

    // Pick browser if missing
    if (!browser) browser = this._pickBrowser(os);

    // Pick version if missing
    if (!version) version = this._pickVersion(os, browser);

    return { type, os, browser, version };
  }

  /**
   * Build the User-Agent string from config.
   */
  buildUserAgent({ os, browser, version }) {
    const osv = randomFrom(OS_VERSIONS[os]);

    // Each browser has its own UA template
    switch (browser) {
      case 'Chrome':
      case 'Chrome for Android':
        return this._chromeUA(os, osv, version);
      case 'Edge':
        return this._edgeUA(os, osv, version);
      case 'Firefox':
        return this._firefoxUA(os, osv, version);
      case 'Safari':
        return this._safariUA(os, osv, version);
      case 'Opera':
        return this._operaUA(os, osv, version);
      case 'Brave':
        return this._braveUA(os, osv, version);
      case 'Samsung Internet':
        return this._samsungUA(osv, version);
      case 'Vivaldi':
        return this._vivaldiUA(os, osv, version);
      case 'UC Browser':
        return this._ucUA(os, osv, version);
      case 'Android':
        return this._androidWebViewUA(osv, version);
      default:
        return this._chromeUA(os, osv, version); // fallback
    }
  }

  _chromeUA(os, osv, version) {
    const v = `${version}.0.0.0`;
    if (os === 'windows')  return `Mozilla/5.0 (Windows NT ${osv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
    if (os === 'macos')    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
    if (os === 'linux')    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
    if (os === 'chromeos') return `Mozilla/5.0 (X11; CrOS x86_64 15633.69.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
    if (os === 'android')  return `Mozilla/5.0 (Linux; Android ${osv}; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`;
    if (os === 'ios')      return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${v} Mobile/15E148 Safari/604.1`;
  }

  _edgeUA(os, osv, version) {
    const v = `${version}.0.0.0`;
    if (os === 'windows') return `Mozilla/5.0 (Windows NT ${osv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`;
    if (os === 'macos')   return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`;
    if (os === 'linux')   return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36 Edg/${v}`;
    if (os === 'android') return `Mozilla/5.0 (Linux; Android ${osv}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36 EdgA/${v}`;
    if (os === 'ios')     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/${v} Mobile/15E148 Safari/605.1.15`;
  }

  _firefoxUA(os, osv, version) {
    if (os === 'windows') return `Mozilla/5.0 (Windows NT ${osv}; Win64; x64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
    if (os === 'macos')   return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
    if (os === 'linux')   return `Mozilla/5.0 (X11; Linux x86_64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
    if (os === 'android') return `Mozilla/5.0 (Android ${osv}; Mobile; rv:${version}.0) Gecko/${version}.0 Firefox/${version}.0`;
    if (os === 'ios')     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/${version}.0 Mobile/15E148 Safari/605.1.15`;
  }

  _safariUA(os, osv, version) {
    // version is like "18.3"
    if (os === 'macos') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
    if (os === 'ios')   return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
  }

  _operaUA(os, osv, version) {
    const v = `${version}.0.0.0`;
    const chromeBase = '130.0.0.0'; // Opera embeds a Chromium version
    if (os === 'windows') return `Mozilla/5.0 (Windows NT ${osv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBase} Safari/537.36 OPR/${v}`;
    if (os === 'macos')   return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBase} Safari/537.36 OPR/${v}`;
    if (os === 'linux')   return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBase} Safari/537.36 OPR/${v}`;
    if (os === 'android') return `Mozilla/5.0 (Linux; Android ${osv}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBase} Mobile Safari/537.36 OPR/${v}`;
    if (os === 'ios')     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1 OPT/${v}`;
  }

  _braveUA(os, osv, version) {
    // Brave UA is identical to Chrome - intentional (brave hides itself)
    return this._chromeUA(os, osv, version);
  }

  _samsungUA(osv, version) {
    return `Mozilla/5.0 (Linux; Android ${osv}; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/${version} Chrome/115.0.0.0 Mobile Safari/537.36`;
  }

  _vivaldiUA(os, osv, version) {
    const v = `${version}.0.0.0`;
    if (os === 'windows') return `Mozilla/5.0 (Windows NT ${osv}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/${v}`;
    if (os === 'macos')   return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/${v}`;
    if (os === 'linux')   return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/${v}`;
  }

  _ucUA(os, osv, version) {
    if (os === 'android') return `Mozilla/5.0 (Linux; U; Android ${osv}; en-US) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.0.0 UCBrowser/${version} Mobile Safari/537.36`;
    if (os === 'ios')     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${osv} like Mac OS X; en) AppleWebKit/605.1.15 (KHTML, like Gecko) UCBrowser/${version} Mobile/15E148`;
  }

  _androidWebViewUA(osv, version) {
    return `Mozilla/5.0 (Linux; Android ${osv}; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${version}.0.0.0 Mobile Safari/537.36`;
  }

  /**
   * Build Sec-CH-UA and related Client Hints headers for Chromium browsers.
   */
  buildClientHints({ browser, version, os }) {
    if (NO_CLIENT_HINTS.has(browser)) return {};

    const isChromium = CHROMIUM_BROWSERS.has(browser);
    if (!isChromium) return {};

    // The "Not...Brand" entry varies. Current pattern (2025-2026): "Not.A/Brand";v="8"
    // Older: "Not?A_Brand";v="99". We use the current variant.
    const notBrand = { name: 'Not?A_Brand', v: '24' };

    let secChUA;
    if (browser === 'Chrome' || browser === 'Chrome for Android') {
      secChUA = `"Google Chrome";v="${version}", "Chromium";v="${version}", "${notBrand.name}";v="${notBrand.v}"`;
    } else if (browser === 'Edge') {
      secChUA = `"Microsoft Edge";v="${version}", "Chromium";v="${version}", "${notBrand.name}";v="${notBrand.v}"`;
    } else if (browser === 'Opera') {
      // Opera ships behind a recent Chromium
      secChUA = `"Opera";v="${version}", "Chromium";v="130", "${notBrand.name}";v="${notBrand.v}"`;
    } else if (browser === 'Brave') {
      // Brave hides itself; sends Chrome UA + Chrome client hints
      secChUA = `"Chromium";v="${version}", "Google Chrome";v="${version}", "${notBrand.name}";v="${notBrand.v}"`;
    } else if (browser === 'Vivaldi') {
      secChUA = `"Chromium";v="130", "${notBrand.name}";v="${notBrand.v}", "Vivaldi";v="${version}"`;
    } else if (browser === 'Samsung Internet') {
      secChUA = `"Samsung Internet";v="${version}", "Chromium";v="115", "${notBrand.name}";v="${notBrand.v}"`;
    } else {
      return {};
    }

    return {
      'Sec-CH-UA': secChUA,
      'Sec-CH-UA-Mobile': MOBILE_OS.has(os) ? '?1' : '?0',
      'Sec-CH-UA-Platform': `"${PLATFORM_HEADER[os]}"`,
      'Sec-CH-UA-Arch': `"${ARCH_BY_OS[os]}"`
    };
  }

  /**
   * Build Sec-Fetch-* headers based on HTTP method.
   */
  buildFetchHeaders(method = 'GET') {
    const m = method.toUpperCase();
    // Top-level navigation defaults
    const headers = {
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-User': '?1'
    };
    if (m === 'POST') {
      // POSTs are typically form submits or fetch API calls
      headers['Sec-Fetch-Site'] = 'same-origin';
      headers['Sec-Fetch-Mode'] = 'cors';
      headers['Sec-Fetch-Dest'] = 'empty';
      delete headers['Sec-Fetch-User'];
    } else if (m === 'HEAD') {
      // HEAD is rarely browser-initiated; treat as cors
      headers['Sec-Fetch-Site'] = 'same-origin';
      headers['Sec-Fetch-Mode'] = 'cors';
      headers['Sec-Fetch-Dest'] = 'empty';
      delete headers['Sec-Fetch-User'];
    }
    return headers;
  }

  /**
   * Build Accept-* headers (always present in real browsers).
   */
  buildAcceptHeaders({ browser, os }) {
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  /**
   * Main entry point. Returns { userAgent, headers, config }.
   */
  generate(opts = {}) {
    const config = this.resolveConfig(opts);
    const userAgent = this.buildUserAgent(config);
    const headers = {
      'User-Agent': userAgent,
      ...this.buildAcceptHeaders(config),
      ...this.buildClientHints(config),
      ...this.buildFetchHeaders(opts.method)
    };
    return headers;
  }
}

const __dirname = import.meta.dirname;
const marketData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'update', 'market-data.json'), 'utf-8')
);
const ua = new UAGenerator(marketData);
export const generate = ua.generate;
export default generate;

function _main_() {
  let opts = {}
  let argv = process.argv.slice(2);
  while (argv.length > 0) {
    let item = argv.pop();
    if (item === "--type") {
      opts.type = argv.pop()
    } else if (item === "--os") {
      opts.os = argv.pop()
    } else if (item === "--browser") {
      opts.browser = argv.pop()
    }
  }
  console.log(ua.generate({opts}));
}

function main (url) { 
  if (typeof import.meta.main === "undefined") {
    const __filename = fileURLToPath(url);
    return (process.argv[1] === __filename)
  } else {
    return import.meta.main;
  }
}

if (main(import.meta.url)){
  _main_();
}