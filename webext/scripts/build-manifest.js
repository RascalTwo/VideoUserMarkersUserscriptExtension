const fs = require('fs');
const path = require('path');

function mergeObjects(target, source) {
	for (const key of Object.keys(source)) {
		if (source[key] instanceof Object) {
			Object.assign(source[key], mergeObjects(target[key], source[key]));
		} else {
			target[key] = source[key];
		}
	}

	Object.assign(target, source);
	return target;
}


(async function buildManifest(browser){
	if (browser !== 'chrome' && browser !== 'firefox') {
		console.error('Invalid browser argument');
		process.exit(1);
	}

	const rootPath = path.join(__dirname, '..');
	const manifestPath = path.join(rootPath, 'manifest.json');

	const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));
	const browserManifest = JSON.parse(await fs.promises.readFile(path.join(rootPath, `${browser}-manifest.json`), 'utf-8'));

	const result = mergeObjects(manifest, browserManifest);

	await fs.promises.writeFile(manifestPath, JSON.stringify(result, undefined, 2));
	if (!process.argv.includes('--silent')) console.log(`Manifest built for ${browser}`);
})(process.argv.at(-1));
