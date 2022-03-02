git checkout main
git branch -D dist
git branch dist
git checkout dist
npm run build
git add dist/userscript.js -f
git commit -m 'Build'
git push -u origin dist -f
git checkout main
git branch -D dist