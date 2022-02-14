const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const entryPoint = path.resolve('./dist/userscript.js');

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.addInitScript({ path: entryPoint });

	await page.coverage.startJSCoverage();
	await page.goto('https://example.com/', { waitUntil: 'networkidle' });

	const entry = (await page.coverage.stopJSCoverage()).find(entry => entry.url === entryPoint);
	if (!entry) throw new Error('Entry point not found');

	await fs.promises.mkdir('./coverage/tmp/', { recursive: true });
	await fs.promises.writeFile(`./coverage/tmp/coverage-userscript.json`, JSON.stringify({
		result: [{
			...entry,
			url: 'file://' + entryPoint
		}],
		timestamp: Date.now()
	}, undefined, '  '));

	await browser.close();
})().catch(err => console.error(err));