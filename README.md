# user-agent-stealth

Generates not just a random `User-Agent`, but a full set of realistic browser headers using real market share data, weighted by what people actually use.
This project will be setup with a monthly build to keep these headers current and relevant.

## Usage

```js

import { generate } from 'user-agent-stealth';

generate();                                          // everything random, weighted by data
generate({ type: 'mobile' });                        // pick OS+browser+version from mobile
generate({ os: 'windows' });                         // pick browser+version on Windows
generate({ os: 'macos', browser: 'Safari' });        // pick version
generate({ browser: 'Edge' });                       // pick OS (weighted by where Edge runs)
generate({ method: 'POST' });                        // Sec-Fetch-Mode: cors

```

Returns `headers` includes `Accept, Accept-Language, Accept-Encoding, Upgrade-Insecure-Requests`, the `Sec-Fetch` family and (for Chromium browsers) the `Sec-CH-UA` family (Firefox and Safari correctly omit Sec-CH-UA).

## CLI

You can also call from the command line, installs a `useragent` command:

**EXAMPLE**

```bash
pdubz3r0@B3T4M4X:~/Development/user-agent-stealth$ useragent
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  Priority: 'u=0, i',
  'Sec-CH-UA': '"Google Chrome";v="147.0", "Chromium";v="147.0", "Not?A_Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-CH-UA-Arch': '"x86"',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-User': '?1'
}

```