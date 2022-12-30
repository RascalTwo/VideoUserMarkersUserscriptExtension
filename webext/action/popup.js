browser.tabs.query({ active: true, currentWindow: true }).then(([currentTab]) =>
	browser.tabs.executeScript(currentTab.id, {
		allFrames: true,
		file: '../inject.js',
	})
);
