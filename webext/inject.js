// create <script> tag with content of userscript.js and add it to the DOM
console.log('[R2 Video User Markers] Injecting dist/userscript.js...')
var script = document.createElement('script');
script.src = chrome.extension.getURL('dist/userscript.js');
(document.head || document.documentElement).appendChild(script);
