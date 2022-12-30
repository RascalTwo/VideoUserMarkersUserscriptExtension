// create <script> tag with content of userscript.js and add it to the DOM
var script = document.createElement('script');
script.src = chrome.extension.getURL('dist/userscript.js');
(document.head || document.documentElement).appendChild(script);
