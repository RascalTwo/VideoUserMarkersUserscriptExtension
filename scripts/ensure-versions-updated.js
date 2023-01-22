const simpleGit = require('simple-git');

(async function main(...filepaths){
	const versions = []
	for (const filepath of filepaths){
		const version = await simpleGit('.').diff(['--cached', filepath]).then(diff => {
			const [oldM, newM] = [...diff.matchAll(/.*("version":)([ ])?"([\d]*)\.([\d]*)\.([\d]*)".*/g)];
			if (!oldM || !newM) {
				console.error(`${filepath} version was not updated`);
				process.exit(1);
			}

			let shouldBeZero = false;
			for (let i = 2; i <= 5; i++){
				if (shouldBeZero){
					if (newM[i] !== '0'){
						console.error(`remainder of ${filepath} version should be 0s`);
						process.exit(1);
					}
				} else {
					if (oldM[i] === newM[i]) continue;
					if (+newM[i] - +oldM[i] !== 1) {
						console.error(`${filepath} version should be incremented by one`);
						process.exit(1);
					}
					shouldBeZero = true;
				}
			}
			return newM.slice(3).join('.');
		});
		versions.push(version);
	}
	if (!versions.every(v => v === versions[0])) {
		console.error(`${filepaths.join(' and' )} versions should match`);
		process.exit(1);
	}
})('package.json', 'webext/manifest.json');