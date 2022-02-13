require('dotenv').config({ path: './.env.' + (process.env.NODE_ENV?.toLowerCase() || 'development') });
const fs = require('fs');


let constants = ``
for (const key of ['BACKEND_API']) {
	const value = process.env[key];
	const jsValue = value === undefined ? 'undefined' : JSON.stringify(value);
	constants += `export const ${key} = ${jsValue};\n`
}
fs.writeFileSync('./src/constants.ts', constants);