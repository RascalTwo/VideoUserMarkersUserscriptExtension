document.querySelector('#reload').addEventListener('click', () =>
	browser.tabs.query({ active: true, currentWindow: true }).then(([currentTab]) => {
		browser.tabs.executeScript(currentTab.id, {
			allFrames: true,
			file: '../inject.js',
		});
		window.close();
	})
);

document.querySelector('#open-on-vum').addEventListener('click', () =>
	browser.tabs.query({ active: true, currentWindow: true }).then(([currentTab]) =>{
		let videoID;
		if (currentTab.url.includes('youtube.com')) {
			videoID = new URLSearchParams(currentTab.url.split('?')[1]).get('v');
		} else if (currentTab.url.includes('twitch.tv')) {
			videoID = currentTab.url.split('videos/')[1].split('?')[0];
		} else return alert('Unable to determine video from the current tab URL');

		browser.tabs.create({
			url: `https://video-user-markers.cyclic.app/v/${videoID}`,
			active: true,
		}).then(window.close);
	})
);
