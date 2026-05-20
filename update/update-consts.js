
import { MIN_BROWSER_SHARE, MIN_VERSION_SHARE, DESKTOP_AVAILABILITY, MOBILE_AVAILABILITY } from './consts.js'

import { fileURLToPath } from 'url';

import JSON5 from 'json5'
import fs from 'node:fs'
import path from 'node:path'

const PACKAGE_JSON = path.join(import.meta.dirname, "../package.json");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const package_json = JSON.parse(fs.readFileSync(PACKAGE_JSON));
const today = new Date();
const year = today.getFullYear().toString();
const month = (today.getMonth()+1).toString();
const version = `${year.substr(0,2)}.${year.substr(2)}.${month.length < 2 ? "0":""}${month}`
package_json.version = version;
fs.writeFileSync(PACKAGE_JSON, JSON.stringify(package_json, null, 2));

export function update(DEFAULTS) {
	const conf = `export const MIN_BROWSER_SHARE = ${MIN_BROWSER_SHARE};\n`+
		`export const MIN_VERSION_SHARE = ${MIN_VERSION_SHARE};\n\n`+
		`export const DEFAULTS = ${JSON5.stringify(DEFAULTS, null, 2).replaceAll("versions", "distribution")};\n\n`+
		`export const DESKTOP_AVAILABILITY = ${JSON.stringify(DESKTOP_AVAILABILITY)};\n\n`+
		`export const MOBILE_AVAILABILITY = ${JSON.stringify(MOBILE_AVAILABILITY)};`

	const THE_FILE = path.join(__dirname, 'consts.js');
	fs.writeFileSync(THE_FILE, conf, 'utf-8');
}