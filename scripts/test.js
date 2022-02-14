const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const entryPoint = path.resolve('./dist/userscript.js');

const [liveChannel, vod, executablePath] = process.argv.slice(2);
if (!liveChannel) {
	console.error('Missing live channel');
	process.exit(1);
}
if (!vod) {
	console.error('Missing vod');
	process.exit(1);
}
if (!executablePath) {
	console.error('Missing executable path');
	process.exit(1);
}


(async () => {
	const browser = await chromium.launchPersistentContext("./browser-data", { headless: false, executablePath, permissions: ['clipboard-read', 'clipboard-write'], slowMo: 1000 });
	const page = await browser.newPage();
	await page.addInitScript({ path: entryPoint });

	await page.coverage.startJSCoverage();
	await page.goto('https://twitch.tv/' + liveChannel);

	let videoID;
	page.on('console', async (msg) => {
		const text = msg.text();
		if (text.includes('GQL VOD ID:')) {
			videoID = text.split('GQL VOD ID:')[1].trim();
		}
	});

	await page.evaluate(() => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith('r2')) localStorage.removeItem(key);
		}
	});

	await page.reload();

	try {
		await page.locator('[data-a-target="player-overlay-mature-accept"]').click({ timeout: 5000 });
	} catch (e) { }

	await page.waitForSelector('.r2_markers_ui', { timeout: 60000 });

	await page.locator('.r2_markers_ui summary').click();
	await page.locator('.r2_markers_ui button').nth(1).click();
	await page.locator('#r2_dialog input').fill('Marker');
	await page.locator('#r2_dialog button[type="submit"]').click();
	await page.locator('.r2_current_marker:has-text("Marker")').isVisible()

	await page.locator('.r2_current_marker').click({ button: 'right' });

	let li = page.locator('.r2_marker_list li')
	await li.locator('.r2_marker_title:has-text("Marker")').isVisible()
	let whenSpan = li.locator('span > span')
	const getCurrentSeconds = async () => +(await whenSpan.textContent()).split(':').at(-1)

	let when = await getCurrentSeconds()
	// 1/30 chance it's 0 or 59, which we're not handling
	assert.notDeepStrictEqual(when, 0);
	assert.notDeepStrictEqual(when, 59);
	await li.locator('span > button').nth(0).click();

	assert.deepStrictEqual(await getCurrentSeconds(), when - 1)
	await page.locator('span > button').nth(1).click();
	assert.deepStrictEqual(await getCurrentSeconds(), when)

	await whenSpan.hover()
	await page.mouse.wheel(0, -100)
	await page.waitForTimeout(1000)
	assert.deepStrictEqual(await getCurrentSeconds(), when - 1)
	await page.mouse.wheel(0, 100)
	await page.waitForTimeout(1000)
	assert.deepStrictEqual(await getCurrentSeconds(), when)

	await whenSpan.click({ button: 'right' })
	await page.locator('#r2_dialog input').fill('123');
	await page.locator('#r2_dialog button[type="submit"]').click();
	assert.deepStrictEqual(await getCurrentSeconds(), 3);

	await page.locator('.r2_marker_title').click({ button: 'right' })
	await page.locator('#r2_dialog input').fill('Updated Marker');
	await page.locator('#r2_dialog button[type="submit"]').click();
	await page.locator('.r2_marker_title:has-text("Updated Marker")').isVisible();

	await page.locator('.r2_marker_list li button:has-text("Share")').click();
	const text = await page.evaluate(() => navigator.clipboard.readText())
	assert.deepStrictEqual(text, `https://twitch.tv/videos/${videoID}?t=02m03s`);

	await page.keyboard.press('Escape');
	await page.locator('.r2_marker_list').isHidden();

	await page.keyboard.press('KeyB');
	await page.locator('#r2_dialog').isVisible();
	await page.keyboard.press('Escape');
	await page.locator('#r2_dialog').isHidden();

	await page.keyboard.press('KeyU');
	await page.locator('#r2_dialog').isVisible();
	await page.locator('#r2_dialog button:has-text("Cancel")').click();
	await page.locator('#r2_dialog').isHidden();

	await page.reload();

	await page.waitForSelector('.r2_markers_ui', { timeout: 60000 });
	await li.locator('.r2_marker_title:has-text("Updated Marker")').isVisible()

	await page.keyboard.press('KeyU');
	await page.locator('#r2_dialog button:has-text("List")').click();

	await page.locator('.r2_marker_list li button:has-text("Delete")').click();
	await page.locator('.r2_marker_list li span:has-text("Updated Marker")').isHidden();
	await li.locator('.r2_marker_title:has-text("Updated Marker")').isHidden()
	await page.keyboard.press('Escape');

	await page.keyboard.press('KeyB');
	await page.locator('#r2_dialog input').fill('Alpha');
	await page.locator('#r2_dialog button[type="submit"]').click();
	await page.waitForTimeout(1000);
	await page.keyboard.press('KeyB');
	await page.locator('#r2_dialog input').fill('Bravo');
	await page.locator('#r2_dialog button[type="submit"]').click();
	await page.waitForTimeout(1000);
	await page.keyboard.press('KeyB');
	await page.locator('#r2_dialog input').fill('Charlie');
	await page.locator('#r2_dialog button[type="submit"]').click();

	await page.keyboard.press('KeyU');
	await page.locator('#r2_dialog button:has-text("List")').click();

	li = page.locator('.r2_marker_list li[data-r2_active_marker="true"]')
	await li.isVisible();
	await li.locator('.r2_marker_title:has-text("Charlie")').isVisible()
	whenSpan = li.locator('span > span')

	when = await getCurrentSeconds()
	// 1/30 chance it's 0 or 59, which we're not handling
	assert.notDeepStrictEqual(when, 0);
	assert.notDeepStrictEqual(when, 59);

	await page.keyboard.press('KeyA');
	assert.deepStrictEqual(await getCurrentSeconds(), when - 1)
	await page.keyboard.press('KeyD');
	assert.deepStrictEqual(await getCurrentSeconds(), when)

	await page.keyboard.press('KeyS');
	await page.locator('.r2_marker_list li[data-r2_active_marker="true"]:has-text("Charlie")').isVisible();

	await page.keyboard.down('KeyW');
	await page.locator('.r2_marker_list li[data-r2_active_marker="true"]:has-text("Bravo")').isVisible();

	await page.keyboard.press('KeyS');
	await page.locator('.r2_marker_list li[data-r2_active_marker="true"]:has-text("Charlie")').isVisible();

	await page.keyboard.press('KeyN');
	await page.locator('#r2_dialog button:has-text("Cancel")').click();

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
