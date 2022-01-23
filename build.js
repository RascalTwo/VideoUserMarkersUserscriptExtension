const fs = require('fs');
const path = require('path')

const BOOTSTRAP = `
require(['script']);
`;

const entry = path.join('dist', 'userscript.js');

fs.promises.readFile(entry)
	.then(b => b.toString())
	.then(code => code + '\n' + BOOTSTRAP)
	.then(code => fs.promises.writeFile(entry, code))
	.catch(console.error);