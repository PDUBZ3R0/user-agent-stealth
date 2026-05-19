
import { MIN_BROWSER_SHARE, MIN_VERSION_SHARE, DESKTOP_AVAILABILITY, MOBILE_AVAILABILITY } from './consts.js'

import { fileURLToPath } from 'url';

import JSON5 from 'json5'
import fs from 'node:fs'
import path from 'node:path'

export function update(DEFAULTS) {
	const conf = `export const MIN_BROWSER_SHARE = ${MIN_BROWSER_SHARE};\n`+
		`export const MIN_VERSION_SHARE = ${MIN_VERSION_SHARE};\n\n`+
		`export const DEFAULTS = ${JSON5.stringify(DEFAULTS, null, 2).replaceAll("versions", "distribution")};\n\n`+
		`export const DESKTOP_AVAILABILITY = ${JSON.stringify(DESKTOP_AVAILABILITY)};\n\n`+
		`export const MOBILE_AVAILABILITY = ${JSON.stringify(MOBILE_AVAILABILITY)};`

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const THE_FILE = path.join(__dirname, 'consts.js');
	fs.writeFileSync(THE_FILE, conf, 'utf-8');
}