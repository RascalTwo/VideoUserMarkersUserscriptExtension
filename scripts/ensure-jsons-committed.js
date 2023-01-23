const simpleGit = require('simple-git');

(async function main(...filepaths){
	for (const filepath of filepaths){
		if (!await simpleGit('.').diff(['--cached', filepath])) {
			console.error(`${filepath} is not committed`);
			process.exit(1);
		}
	}
	for (const filepath of filepaths){
		if (await simpleGit('.').diff([filepath])) {
			console.error(`${filepath} has uncommitted changes`);
			process.exit(1);
		}
	}
})('package.json', 'webext/manifest.json');