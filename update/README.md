# ua-generator

Generates realistic browser headers (User-Agent, Sec-CH-UA, Sec-Fetch-*, Accept-*) using real StatCounter market share data, weighted by what people actually use.

## Files

- **`fetch-data.js`** — Run monthly. Downloads StatCounter CSVs, derives `market-data.json`.
- **`version-resolver.js`** — Fills version gaps for browsers StatCounter reports without versions (Chrome on mobile, Safari on iOS, Brave).

## Setup

```bash
yarn run update
```

If StatCounter blocks the request, download the CSVs manually from the URLs printed in the error output and drop them into `./data/` — re-run and it parses the local files. Chromiumdash API for live Chrome versions also needs network; without it, the resolver uses curated defaults from `version-resolver.js`.

## StatCounter endpoint choice

We use **`/browser-version-market-share/`** (non-combined), which gives clean labels like:

```
"Chrome 147.0",18.75
"Edge 147",5.43
"Safari 26.3",2.32
```

Not the partially-combined endpoint, which aggregates everything important into `"Chrome (all)" 71%` and is useless for version weighting.

## Version-gap handling

StatCounter still reports some major browsers without versions, even on the non-combined endpoint:

| StatCounter label    | Browser     | Real share | Why no version |
|----------------------|-------------|------------|----------------|
| `Chrome for Android` | Chrome      | ~60% mobile | Aggregated by StatCounter |
| `Safari iPhone`      | Safari iOS  | ~26% mobile | Aggregated by StatCounter |
| `Chrome for iPhone`  | Chrome iOS  | ~5% mobile  | Aggregated by StatCounter |
| `Brave 0`            | Brave       | ~1.5% all   | Brave masks its version in UA |
| `Android 0`          | WebView     | ~0.5% mobile | Android WebView aggregate |

`version-resolver.js` fills these in:
- **Chrome variants (desktop/Android/iOS)** — pulled live from `chromiumdash.appspot.com/fetch_releases` for current stable majors
- **Safari iOS/macOS, Brave** — curated defaults that you update in `DEFAULTS` during monthly maintenance

Also note: StatCounter sometimes shows `"Chrome for Android"` in the **desktop** CSV (their classification quirk). `fetch-data.js` excludes contextualized labels from the wrong device class — `"Chrome for Android"` in the desktop CSV is dropped entirely.

## CSV format

StatCounter's single-month CSV (when `fromInt=toInt`):

```
"Browser Version","Market Share Perc. (Apr 2026)"
"Chrome 147.0",18.75
"Chrome 146.0",15.6
...
```

Row-per-entity, quoted fields. (Multi-month gives wide Date,Col1,Col2 — we don't use that.)

## Data shape

`market-data.json`:

```json
{
  "fetched": "2026-05-11T12:00:00Z",
  "forMonth": "2026-04",
  "deviceSplit": { "mobile": 62.15, "desktop": 37.85 },
  "osShare": {
    "desktop": { "windows": 76.94, "macos": 16.63, "linux": 4.47, "chromeos": 1.96 },
    "mobile":  { "android": 71.11, "ios": 28.89 }
  },
  "platforms": {
    "windows": {
      "Chrome": { "share": 71.71, "versions": { "147.0": 40.72, "146.0": 33.88, ... } },
      "Edge":   { "share": 19.64, "versions": { "147": 43.06, "146": 40.29 } },
      ...
    },
    "android": {
      "Chrome": { "share": 94.22, "versions": { "147": 40, "146": 30, ... } },
      ...
    },
    "ios": {
      "Safari": { "share": 82.88, "versions": { "26.4": 32, "26.3": 24, ... } },
      "Chrome": { "share": 17.12, "versions": { "147": 42, "146": 30, ... } }
    }
  }
}
```

Tablet share is folded into mobile in `deviceSplit`. Browser shares within each OS are derived from the device-wide version data restricted to browsers that ship on that OS, then renormalized. Long tail dropped via `MIN_BROWSER_SHARE` (0.5%) and `MIN_VERSION_SHARE` (1.0%) — but if filtering would drop all versions for a browser, the top 3 raw entries are kept renormalized instead of falling back to resolver defaults.



## Monthly cron

```cron
0 2 1 * * cd /path/to/project && node fetch-data.js && git add market-data.json && git commit -m "update market data" && git push
```

Live Chrome versions come from chromiumdash automatically. Safari latest from browsers.fyi and Brave releases from versions.brave.com.

## Tuning

In `consts.js`:
- `MIN_BROWSER_SHARE` (default 0.5) — drop browsers below this % within a platform after renormalization
- `MIN_VERSION_SHARE` (default 1.0) — drop versions below this % within a browser (falls back to top-3 if all are below)

- `DESKTOP_AVAILABILITY` / `MOBILE_AVAILABILITY` — which browsers ship on which OS

- `DEFAULTS` — curated fallback versions for Chrome/Safari/Brave/etc.
