git checkout main
git branch -D dist
git branch dist
git checkout dist

node webext/scripts/build-manifest.js firefox
NODE_ENV=production npm run build
git add dist/userscript.js -f
git add dist/firefox-unsigned.zip -f

rm -f dist/*.xpi
npx web-ext sign --source-dir=webext --artifacts-dir=dist
git add dist/*.xpi -f

node webext/scripts/build-manifest.js chrome
google-chrome --pack-extension=webext --pack-extension-key=webext.pem && mv webext.crx dist/chrome.crx
git add dist/chrome.crx -f

node webext/scripts/build-manifest.js firefox

git commit -m 'Build' --no-verify
git push -u origin dist -f

git checkout main
git branch -D dist
