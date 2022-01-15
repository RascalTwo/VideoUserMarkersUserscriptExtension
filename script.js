// ==UserScript==
// @name     Twitch Chapters
// @version  1
// @grant    none
// @match    https://www.twitch.tv/*
// ==/UserScript==
console.log('R2 Twitch Chapters Started')

/**
 * Do nothing
 */
function NOOP() { }

/**
 * Get the Pixel width of the `ch` unit
 *
 * @returns {number}
 */
function getCHWidth() {
	const node = document.createElement('div')
	node.style.position = 'absolute'
	node.textContent = 'M';

	document.body.appendChild(node);
	const width = node.offsetWidth;
	node.remove();
	return width;
}

/**
 * Get CSS class of twitch buttons
 *
 * @returns {string}
 */
function getButtonClass() {
	return document.querySelector('[data-a-target="subscribe-button"]')?.className ?? '';
}

/**
 * Delay execution by {@link ms milliseconds}
 *
 * @param {number} ms
 */
function delay(ms) {
	return new Promise(r => setTimeout(r, ms))
};

/**
 * Show customizable dialog
 *
 * @param {'alert' | 'prompt' | 'choose'} type
 * @param {string} message
 * @param {(form: HTMLFormElement) => any} sideEffect
 */
async function dialog(type, message, sideEffect) {
	return new Promise(resolve => {

		let canceled = false;

		const form = document.createElement('form');
		form.style.position = 'absolute';
		form.style.zIndex = 9000;
		form.style.top = '50%';
		form.style.left = '50%';
		form.style.transform = 'translate(-50%, -50%)';
		form.style.backgroundColor = '#18181b'
		form.style.padding = '1em';
		form.style.borderRadius = '1em';
		form.style.color = 'white'
		form.style.display = 'flex'
		form.style.flexDirection = 'column'
		form.textContent = message;
		const handleSubmit = e => {
			e?.preventDefault();
			const response = canceled ? null : generateResponse();
			form.remove();
			window.removeEventListener('keydown', handleDialogEscape);
			return resolve(response);
		}
		form.addEventListener('submit', handleSubmit)

		const [generateResponse, pre, post, afterCreated] = {
			'alert': () => [
				() => true,
				() => form.querySelector('button[type="submit"]').focus(),
				NOOP,
				sideEffect
			],
			'prompt': () => {
				const [type, value] = sideEffect?.(form) ?? ['input', ''];
				const input = document.createElement(type);
				input.value = value
				if (type === 'textarea') input.setAttribute('rows', 10);

				// TODO - trim this down to just the required handlers/preventions
				const overwriteAlternateHandlers = e => {
					e.stopImmediatePropagation();
					e.stopPropagation();
					if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
				}
				input.addEventListener('keydown', overwriteAlternateHandlers);
				input.addEventListener('keypress', overwriteAlternateHandlers);
				input.addEventListener('keyup', overwriteAlternateHandlers);

				form.appendChild(input);
				return [
					() => input.value.trim(),
					() => input.focus(),
					() => {
						if (type === 'input') return;
						const lines = input.value.split('\n')
						const longestLine = Math.max(...lines.map(line => line.length))
						input.style.width = Math.max(input.offsetWidth, longestLine * getCHWidth()) + 'px';
					},
					NOOP
				]
			},
			'choose': () => {
				form.appendChild(Object.entries(sideEffect(form)).reduce((fragment, [key, value]) => {
					const button = document.createElement('button');
					button.className = getButtonClass();
					button.textContent = key;
					button.value = JSON.stringify(value);
					button.addEventListener('click', () => form.dataset.value = button.value);

					fragment.appendChild(button);
					return fragment;
				}, document.createDocumentFragment()));
				return [
					() => JSON.parse(form.dataset.value),
					() => {
						form.querySelector('button[type="submit"]').remove()
						form.querySelector('button').focus()
					},
					NOOP,
					NOOP
				]
			}
		}[type]();

		const actions = document.createElement('div');
		actions.style.flex = 1
		actions.style.display = 'flex';
		const submit = document.createElement('button');
		submit.className = getButtonClass();
		submit.style.flex = 1
		submit.textContent = 'OK'
		submit.type = 'submit';
		actions.appendChild(submit);

		const cancel = document.createElement('button');
		cancel.className = getButtonClass();
		cancel.style.flex = 1
		cancel.textContent = 'Cancel'
		cancel.addEventListener('click', () => canceled = true)
		actions.appendChild(cancel);
		form.appendChild(actions)

		document.body.appendChild(form);
		const handleDialogEscape = e => {
			if (e.key !== 'Escape' || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
			canceled = true;
			return handleSubmit();
		}
		window.addEventListener('keydown', handleDialogEscape)
		setTimeout(() => {
			pre();
			afterCreated?.(form)
			post();
		}, 250);
	});
};

/**
 * Click nodes one by one in {@link queries}, waiting until they are in the DOM one by one
 *
 *
 * @param  {...any} queries queries of nodes to click
 */
async function clickNodes(...queries) {
	for (const query of queries) {
		while (true) {
			const node = document.querySelector(query)
			if (node) {
				node.click();
				break;
			} else {
				await delay(100);
			}
		}
	}
}

/**
 * If the page is a VOD
 *
 * @returns {boolean}
 */
function isVOD() {
	return window.location.pathname.startsWith('/videos')
}

/**
 * If the page is Live
 *
 * @returns {boolean}
 */
function isLive() {
	return isAlternatePlayer() || window.location.pathname.split('/').slice(1).length === 1
}

/**
 * If the page is the Alternate Player
 *
 * @returns {boolean}
 */
function isAlternatePlayer() {
	return window.location.href.startsWith('chrome-extension://');
}

/**
 * Get the username/loginName of the current page
 *
 * @returns {string}
 */
function getLoginName() {
	return isAlternatePlayer()
		// `channel=loginName` is in the URL
		? new URLSearchParams(window.location.search).get('channel')
		: isLive()
			// URL ends with loginName
			? window.location.pathname.split('/')[1]
			// URL channel=loginName exists in `og:video` metadata
			: new URLSearchParams(document.querySelector('meta[property="og:video"]').getAttribute('content').split('?').slice(1).join('?')).get('channel')
};

/**
 * Parse from Minimal to Chapter objects
 *
 * @param {string} text
 * @yields {{ name: string, seconds: number }}
 */
function* parseMinimalChapters(text) {
	for (const line of text.trim().split('\n').map(line => line.trim()).filter(Boolean)) {
		const [dhms, ...otherWords] = line.split(/\s/);
		const seconds = DHMStoSeconds(dhms.split(':').map(Number));
		const name = otherWords.join(' ');
		yield { name, seconds }
	}
}

/**
 * Convert chapters to Minimal text
 *
 * @param {{ name: string, seconds: number }[]} chapters
 */
function* chaptersToMinimal(chapters) {
	chapters.sort((a, b) => a.seconds - b.seconds);
	const places = secondsToDHMS(chapters[chapters.length - 1]?.seconds ?? 0).split(':').length;
	for (const chapter of chapters) {
		const dhms = secondsToDHMS(chapter.seconds, places)
		yield [dhms, chapter.name].join('\t');
	}
}

/**
 * Convert DHMS to seconds, each part is optional except seconds
 *
 * @param {number[]} parts DHMS numberic parts
 * @returns {number} seconds
 */
function DHMStoSeconds(parts) {
	// seconds
	if (parts.length === 1) return parts[0];
	// minutes:seconds
	else if (parts.length === 2) return (parts[0] * 60) + parts[1]
	// hours:minutes:seconds
	else if (parts.length === 3) return (parts[0] * 60 * 60) + (parts[1] * 60) + parts[2]
	// days:hours:minute:seconds
	return (parts[0] * 60 * 60 * 24) + (parts[1] * 60 * 60) + (parts[2] * 60) + parts[3]
}

/**
 * Convert seconds to DHMS
 *
 * @param {number} seconds
 * @returns {string}
 */
function secondsToDHMS(seconds, minimalPlaces = 1) {
	// TODO - fix this rushed math
	const days = parseInt(seconds / 86400)
	const hours = parseInt((seconds - (days * 86400)) / 3600)
	const minutes = parseInt((seconds % (60 * 60)) / 60)
	const parts = [days, hours, minutes, parseInt(seconds % 60)]
	while (!parts[0] && parts.length > minimalPlaces) parts.shift()
	return parts.map(num => num.toString().padStart(2, '0')).join(':')
}

function generateTwitchTimestamp(seconds) {
	const symbols = ['d', 'h', 'm']
	const dhms = Array.from(secondsToDHMS(seconds));

	// 0:1:2:3 -> 0:1:2m3 -> 0:1h2m3 -> 0d1h2m3
	while (true) {
		const index = dhms.lastIndexOf(':');
		if (index === -1) break;
		dhms[index] = symbols.pop();
	}

	return dhms.join('') + 's';
}

ids = (() => {
	let userID = undefined;
	let vid = undefined;
	// Get VID from URL if VOD
	if (isVOD()) vid = window.location.href.split('/').slice(-1)[0].split('?')[0];

	/**
	 * Get the ID of the page user
	 *
	 * @returns {number}
	 */
	async function getUserID() {
		if (userID) return userID;

		// TODO - optimize GQL query
		return fetch("https://gql.twitch.tv/gql", {
			"headers": {
				"client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
			},
			"body": `{"query":"query($login: String!, $skip: Boolean!) {\\n\\t\\t\\t\\tuser(login: $login) {\\n\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\tlanguage\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\tdescription\\n\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\tfollowers {\\n\\t\\t\\t\\t\\t\\ttotalCount\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\tlastBroadcast {\\n\\t\\t\\t\\t\\t\\tstartedAt\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprimaryTeam {\\n\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprofileImageURL(width: 70)\\n\\t\\t\\t\\t\\tprofileViewCount\\n\\t\\t\\t\\t\\tself @skip(if: $skip) {\\n\\t\\t\\t\\t\\t\\tcanFollow\\n\\t\\t\\t\\t\\t\\tfollower {\\n\\t\\t\\t\\t\\t\\t\\tdisableNotifications\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}\\n\\t\\t\\t}","variables":{"login":"${getLoginName()}","skip":false}}`,
			"method": "POST",
		}).then(r => r.json()).then(json => {
			userID = json.data.user.id;
			return userID;
		});
	}

	/**
	 * Get ID of video, may not exist if on live page and archive stream does not exist
	 *
	 * @param {boolean} promptUser If to prompt the user for the ID if it could not be found
	 * @returns {string}
	 */
	async function getVideoID(promptUser) {
		if (promptUser && vid === null) {
			const response = await dialog('prompt', 'Video ID could not be detected, please provide it:');
			if (!response) return;
			vid = response;
		}
		if (vid !== undefined) return vid;
		// TODO - optimize GQL query
		return getUserID().then(uid => fetch("https://gql.twitch.tv/gql", {
			"headers": {
				"client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
			},
			"body": `{"query":"query($id: ID!, $all: Boolean!) {\\n\\t\\t\\t\\t\\tuser(id: $id) {\\n\\t\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\t\\tgame {\\n\\t\\t\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\ttitle\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\tlogin\\n\\t\\t\\t\\t\\t\\tstream {\\n\\t\\t\\t\\t\\t\\t\\tarchiveVideo @include(if: $all) {\\n\\t\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\ttype\\n\\t\\t\\t\\t\\t\\t\\tviewersCount\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}","variables":{"id":"${uid}","all":true}}`,
			"method": "POST",
		})).then(r => r.json()).then(json => {
			vid = json.data.user.stream.archiveVideo?.id ?? null
			return getVideoID(promptUser);
		});
	}

	return { getUserID, getVideoID }
})();

/**
 * Track the delay of a promise
 *
 * @param {Promise<T>} promise promise to track delay of
 * @returns {{ delay: number, response: T }}
 */
async function trackDelay(promise) {
	const requested = Date.now();
	const response = await promise();
	return { delay: Date.now() - requested, response };
}


// Run cleanup if previously loaded, development only
window?.r2?.then(ret => ret.cleanup());
r2 = (async () => {
	// Get last segment of URL, which is the video ID
	const chapters = JSON.parse(localStorage.getItem('r2_chapters_' + await ids.getVideoID()) ?? '[]');

	if (!isVOD() && !isLive()) return { chapters: [], cleanup: () => undefined };

	await delay(5000);

	async function editChapter(chapter) {
		const minimal = await dialog('prompt', 'Edit Chapter:', () => ['input', Array.from(chaptersToMinimal([chapter]))[0]]);
		if (minimal === null) return;
		const edited = Array.from(parseMinimalChapters(minimal))[0]
		if (!edited) {
			const index = chapters.findIndex(c => c.seconds === chapter.seconds)
			chapters.splice(index, 1);
		}
		else {
			Object.assign(chapter, edited)
		}
		return handleChapterUpdate();
	}

	async function editAllChapters() {
		const minimal = await dialog('prompt', 'Edit Chapters', () => ['textarea', Array.from(chaptersToMinimal(chapters)).join('\n')]);
		if (minimal === null) return;
		chapters.splice(0, chapters.length, ...Array.from(parseMinimalChapters(minimal)));
		return handleChapterUpdate();
	}

	// Functions to call to remove script from site
	let cleanupFuncs = []
	/**
	 * Get the current time in seconds of the player
	 *
	 * @returns {number}
	 */
	let getCurrentTimeLive = async () => 0;
	let chapterChangeHandlers = [
		async () => localStorage.setItem('r2_chapters_' + await ids.getVideoID(), JSON.stringify(chapters))
	]
	if (isVOD()) {

		/**
		 * Get X and Y of the seconds provided
		 *
		 * @param {number} seconds
		 * @returns {{ x: number, y: number, minX: number, maxX: number }}
		 */
		function getTimeXY(seconds) {
			const bar = document.querySelector('[data-a-target="player-seekbar"]');

			const rect = bar.getBoundingClientRect();
			const minX = rect.left;
			const maxX = rect.right;

			const duration = Number(document.querySelector('[data-a-target="player-seekbar-duration"]').dataset.aValue);
			const percentage = seconds / duration;
			const x = ((maxX - minX) * percentage) + minX;
			const y = (rect.bottom + rect.top) / 2
			return { x, y, minX, maxX }
		}

		/**
		 * Set time to the seconds provided
		 *
		 * @param {number} seconds
		 */
		async function setTime(seconds) {
			const bar = document.querySelector('[data-a-target="player-seekbar"]');

			let { minX, x, maxX } = getTimeXY(seconds)
			// Binary search elimination to find exact X to get to desired seconds
			while (true) {
				const event = new MouseEvent('click', { clientX: x });
				// Directly hook into onClick of react element, bar.dispatchEvent(event) did NOT work
				Object.entries(bar).find(([key]) => key.startsWith('__reactEventHandlers'))[1].onClick(event);
				await delay(50);
				const current = await getCurrentTimeLive();
				if (current === seconds) break;
				if (current > seconds) maxX = x;
				if (current < seconds) minX = x;
				x = (maxX + minX) / 2
				// Escape hatches: if min becomes greater then max or the difference between the min and max is less then a 10th of a pixel
				if (minX >= maxX || Math.abs(minX - maxX) <= 0.1) break;
			}
		}

		/**
		 * Remove chapter DOM elements, done before rendering and cleanup
		 */
		const removeDOMChapters = () => {
			document.querySelectorAll('.r2_chapter').forEach(e => e.remove());
		}

		/**
		 * Handle when marker is directly clicked
		 *
		 * @param {{ name: string, seconds: number}} chapter
		 * @param {MouseEvent} e
		 */
		const handleMarkerClick = (chapter, e) => {
			e.preventDefault()
			if (e.button === 0) return setTime(chapter.seconds);
			return editChapter(chapter);
		}

		chapterChangeHandlers.push(function renderChapters() {
			removeDOMChapters();
			for (const [i, chapter] of chapters.entries()) {
				const node = document.createElement('button')
				node.className = 'r2_chapter'
				node.title = chapter.name;
				node.style.position = 'absolute';
				const { x, y } = getTimeXY(chapter.seconds)
				node.style.top = y + 'px';
				// TODO - properly position element in center of where it should be
				node.style.left = (x - 2.5) + 'px';
				node.style.zIndex = 9000;
				node.textContent = i
				node.addEventListener('click', handleMarkerClick.bind(null, chapter))
				node.addEventListener('contextmenu', handleMarkerClick.bind(null, chapter))
				document.body.appendChild(node);
			}
		})

		// Pull current time from DHMS display, it's always accurate in VODs
		getCurrentTimeLive = async () => DHMStoSeconds(document.querySelector('[data-a-target="player-seekbar-current-time"]').textContent.split(':').map(Number))
		cleanupFuncs.push(removeDOMChapters)
	}
	else if (isLive()) {
		if (isAlternatePlayer()) {
			// m_Player.getPlaybackPositionBroadcast() on AlternatePlayer
			getCurrentTimeLive = async () => м_Проигрыватель.ПолучитьПозициюВоспроизведенияТрансляции()

		} else {
			/**
			 * Return the number of seconds of delay as reported by Twitch
			 *
			 * @returns {number}
			 */
			async function getLiveDelay() {
				const latency = document.querySelector('[aria-label="Latency To Broadcaster"]');
				const bufferSize = document.querySelector('[aria-label="Buffer Size"]');
				if (!latency || !bufferSize) {
					// Settings Gear -> Advanced -> Video Stats Toggle
					await clickNodes('[data-a-target="player-settings-button"]', '[data-a-target="player-settings-menu-item-advanced"]', '[data-a-target="player-settings-submenu-advanced-video-stats"] input');
					return getLiveDelay();
				}

				// Video Stats Toggle -> Settings Gear
				clickNodes('[data-a-target="player-settings-submenu-advanced-video-stats"] input', '[data-a-target="player-settings-button"]');
				return [latency, bufferSize].map(e => Number(e.textContent.split(' ')[0])).reduce((sum, s) => sum + s);
			}

			getCurrentTimeLive = async () => {
				const { delay, response: secondsDelay } = await trackDelay(async () => getLiveDelay());
				const currentTime = DHMStoSeconds(document.querySelector('.live-time').textContent.split(':').map(Number))
				const actualTime = currentTime - secondsDelay - (delay / 1000);
				return actualTime;
			}
		}
		/*
		async function generateCurrentURLTime() {
			const { delay, response: { vid, actualTime } } = await trackDelay(async () => ({
				vid: await ids.getVideoID(true),
				actualTime: await getCurrentTimeLive()
			}));
			return {
				delayAdjusted: `https://twitch.tv/videos/${vid}?t=${generateTwitchTimestamp(parseInt(actualTime - (delay / 1000)))}`,
				returned: `https://twitch.tv/videos/${vid}?t=${generateTwitchTimestamp(parseInt(actualTime))}`
			};
		}
		*/
	}

	async function handleChapterUpdate() {
		for (const func of chapterChangeHandlers) await func();
	}

	/**
	 * Add chapter to current time
	 */
	const addChapterHere = async () => {
		let seconds = await getCurrentTimeLive();
		let name = await dialog('prompt', 'Chapter Name');
		if (!name) return;

		if (['t+', 't-'].some(cmd => name.toLowerCase().startsWith(cmd))) {
			const direction = name[1] === '+' ? 1 : -1;
			const offset = parseInt(name.substring(2))
			if (!isNaN(offset)) seconds += offset * direction;
			name = name.substring(2 + offset.toString().length).trim();
		}

		chapters.push({ seconds, name });
		if (isLive()) navigator.clipboard.writeText(`https://twitch.tv/videos/${await ids.getVideoID()}?t=${generateTwitchTimestamp(seconds)}`);
		return handleChapterUpdate();
	}


	/**
	 * Import minimal chapter text
	 */
	async function importMinimal() {
		const markdown = await dialog('prompt', 'Minimal Text:', () => ['textarea', ''])
		if (markdown === null) return;
		chapters.splice(0, chapters.length, ...Array.from(parseMinimalChapters(markdown)));
		return handleChapterUpdate();
	}


	/**
	 * Export chapter objects into minimal chapters
	 */
	const exportMarkdown = () => {
		navigator.clipboard.writeText(Array.from(chaptersToMinimal(chapters)).join('\n'));
		return dialog('alert', 'Exported to Clipboard!');
	}

	/**
	 * Menu for importing or exporting
	 */
	const menu = async () => {
		const choice = await dialog('choose', 'Twitch Chapters Menu', () => ({
			Import: 'i',
			Export: 'x',
			Edit: 'e'
		}))
		if (!choice) return;
		if (choice === 'i') return importMinimal()
		else if (choice === 'x') return exportMarkdown();
		else if (choice === 'e') return editAllChapters();
	}

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keydownHandler = e => {
		if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
		if (e.key === 'u') menu();
		if (e.key === 'b') addChapterHere()
	};
	window.addEventListener('keydown', keydownHandler);

	let renderTimeout = 0;
	/**
	 * Handle window resizing
	 */
	const resizeHandler = () => {
		clearTimeout(renderTimeout);
		renderTimeout = setTimeout(handleChapterUpdate, 1000);
	};
	window.addEventListener('resize', resizeHandler);

	function cleanup() {
		window.removeEventListener('keydown', keydownHandler);
		window.removeEventListener('resize', resizeHandler);
		cleanupFuncs.forEach(func => func())
	}

	if (chapters.length) await handleChapterUpdate();

	console.log('R2 Twitch Chapters Finished')
	return { chapters, cleanup };
})();