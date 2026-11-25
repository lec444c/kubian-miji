import { chromium } from '@playwright/test';

const file = 'D:/game race/release/库边秘技-试玩版.html';
const url = `file:///${encodeURI(file.replace(/\\/g, '/'))}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('console', message => logs.push(`[console.${message.type()}] ${message.text()}`));
page.on('pageerror', error => logs.push(`[pageerror] ${String(error)}`));
page.on('requestfailed', request => logs.push(`[requestfailed] ${request.url().slice(0, 120)} ${request.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(15000);
const info = await page.evaluate(() => ({
  hasApi: Boolean(window.__creativeEight),
  scripts: [...document.scripts].map(script => ({ type: script.type, len: script.textContent.length })),
  appHtml: document.getElementById('app')?.innerHTML.slice(0, 200) ?? null,
  resources: performance.getEntriesByType('resource').map(entry => entry.name.slice(0, 80)),
}));
console.log(JSON.stringify(info, null, 2));
console.log(logs.slice(0, 40).join('\n'));
await browser.close();