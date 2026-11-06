import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const runtimeRoot = process.env.PLAYWRIGHT_RUNTIME_PATH;
const require = createRequire(runtimeRoot ? `${runtimeRoot}/package.json` : import.meta.url);
const playwright = require('playwright');
const executable = playwright.chromium.executablePath();

assert.ok(fs.existsSync(executable), 'Playwright Chromium executable must be installed');
assert.equal(typeof playwright.chromium.launch, 'function');
console.log('Isolated Playwright runtime and Chromium executable are available.');
