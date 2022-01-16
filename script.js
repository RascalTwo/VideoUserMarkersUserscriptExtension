// ==UserScript==
// @name     Twitch Chapters
// @version  1
// @grant    none
// @match    https://www.twitch.tv/*
// ==/UserScript==
console.log('[R2 Twitch Chapters] Script Started')

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
	return document.querySelector('[data-a-target="top-nav-get-bits-button"]')?.className ?? '';
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
	if (isAlternatePlayer()) return true;
	const parts = window.location.pathname.split('/').slice(1)
	if (!parts.length === 1 && !!parts[0]) return false;
	return !!document.querySelector('.user-avatar-card__live');
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


// Run uninstall if previously loaded, development only
window?.r2?.then(ret => ret.uninstall());
r2 = (async function main() {
	console.log('[R2 Twitch Chapters] Setup Started');

	while (document.readyState !== 'complete') {
		await delay(1000);
		console.log('[R2 Twitch Chapters] Waiting for complete document...');
	}

	const uninstallFuncs = [];
	async function uninstall() {
		for (const func of uninstallFuncs) await func()
	}

	function reinstallOnChange(reinstall = () => false) {
		const url = window.location.href;
		const interval = setInterval(() => {
			if (!reinstall() && window.location.href === url) return;
			clearInterval(interval);
			uninstall().then(main);
		}, 1000);
		return () => clearInterval(interval);
	}

	if (!isVOD() && !isLive()) {
		console.log(`[R2 Twitch Chapters] Not Activating - VOD: ${isVOD()}; Live: ${isLive()}`);
		uninstallFuncs.push(reinstallOnChange(() => {
			console.log('Chapters:', isVOD(), isLive());
			return isVOD() || isLive();
		}));
		return { chapters: [], uninstall }
	}

	uninstallFuncs.push(reinstallOnChange());

	// Get last segment of URL, which is the video ID
	const chapters = JSON.parse(localStorage.getItem('r2_chapters_' + await ids.getVideoID()) ?? '[]');

	while (true) {
		await delay(1000);
		if (!document.querySelector('[data-a-target="player-volume-slider"]')) continue;
		if (isLive()) break;
		if (isVOD() && document.querySelector('.seekbar-bar')) break;

		console.log('[R2 Twitch Chapters] Waiting for player...');
	}

	/**
	 * Get X and Y of the seconds provided
	 *
	 * @param {number} seconds
	 * @returns {{ x: number, y: number, minX: number, maxX: number }}
	 */
	function getTimeXY(seconds) {
		const bar = document.querySelector('.seekbar-bar');

		const rect = bar.getBoundingClientRect();
		const minX = rect.left;
		const maxX = rect.right;

		const duration = Number(document.querySelector('[data-a-target="player-seekbar-duration"]').dataset.aValue);
		const percentage = seconds / duration;
		const x = ((maxX - minX) * percentage);
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

	function seekToChapter(chapter, e) {
		e?.preventDefault();
		e?.stopImmediatePropagation()
		e?.stopPropagation()
		return setTime(chapter.seconds);
	}

	function startEditingChapter(chapter, e) {
		e?.preventDefault();
		e?.stopImmediatePropagation()
		e?.stopPropagation()
		return editChapter(chapter);
	}

	function deleteChapter(chapter, e) {
		e?.preventDefault();
		e.stopImmediatePropagation();
		e.stopPropagation();

		const index = chapters.findIndex(c => c.seconds === chapter.seconds)
		chapters.splice(index, 1);
		return handleChapterUpdate();
	}

	function adjustChapterSeconds(chapter, change) {
		chapter.seconds += change;
		return handleChapterUpdate();
	}

	const { removeChapterList, renderChapterList, setChapterList } = (() => {
		let rendering = false;
		let last = { x: 0, y: 0 };

		function renderChapterList() {
			removeChapterList();
			if (!rendering) return;

			const list = document.createElement('ul')
			list.className = 'r2_chapter_list'
			list.style.position = 'absolute'
			list.style.zIndex = 9001;
			list.style.backgroundColor = '#18181b'
			list.style.padding = '1em';
			list.style.borderRadius = '1em';
			list.style.color = 'white'
			list.style.display = 'flex'
			list.style.flexDirection = 'column'
			list.style.maxHeight = '75vh'
			list.style.maxWidth = '50vw'
			list.style.overflow = 'scroll';
			list.style.resize = 'both';

			list.style.top = last.y + 'px'
			list.style.left = last.x + 'px'

			const header = document.createElement('h4');
			header.textContent = 'Chapter List'
			header.backgroundColor = '#08080b'
			header.style.userSelect = 'none';
			header.style.padding = '0'
			header.style.margin = '0'

			let dragging = false;
			header.addEventListener('mousedown', (e) => {
				e.preventDefault()
				dragging = true
				last = { x: e.clientX, y: e.clientY }
			})
			const handleMouseUp = (e) => {
				e.preventDefault()
				dragging = false;
			}
			document.body.addEventListener('mouseup', handleMouseUp);

			const handleMouseMove = (e) => {
				if (!dragging) return;

				e.preventDefault();
				list.style.top = (list.offsetTop - (last.y - e.clientY)) + 'px'
				list.style.left = (list.offsetLeft - (last.x - e.clientX)) + 'px'
				last = { x: e.clientX, y: e.clientY }
			}
			document.body.addEventListener('mousemove', handleMouseMove);
			list.appendChild(header);

			const closeButton = document.createElement('button')
			closeButton.className = getButtonClass();
			closeButton.style.float = 'right';
			closeButton.textContent = 'Close';
			closeButton.addEventListener('click', () => setChapterList(false));

			header.appendChild(closeButton);


			chapters.sort((a, b) => a.seconds - b.seconds);
			const places = secondsToDHMS(chapters[chapters.length - 1]?.seconds ?? 0).split(':').length;

			for (const chapter of chapters) {
				const li = document.createElement('li')
				li.style.display = 'flex';
				li.style.alignItems = 'center';

				const time = document.createElement('span');
				time.style.fontFamily = 'monospace'
				const decrease = document.createElement('button');
				decrease.className = getButtonClass();
				decrease.textContent = '-';
				decrease.title = 'Subtract 1 second';
				decrease.addEventListener('click', adjustChapterSeconds.bind(null, chapter, -1));
				time.appendChild(decrease);

				time.appendChild(document.createTextNode(secondsToDHMS(chapter.seconds, places)));

				const increase = document.createElement('button');
				increase.className = getButtonClass();
				increase.textContent = '+';
				increase.title = 'Add 1 second';
				increase.addEventListener('click', adjustChapterSeconds.bind(null, chapter, 1));
				time.appendChild(increase);
				li.appendChild(time);

				const title = document.createElement('span');
				title.textContent = chapter.name;
				title.style.cursor = 'pointer';
				title.style.flex = 1;
				title.style.textAlign = 'center';
				if (isVOD()) title.addEventListener('click', seekToChapter.bind(null, chapter))
				title.addEventListener('contextmenu', startEditingChapter.bind(null, chapter))
				li.appendChild(title);

				const share = document.createElement('button')
				share.className = getButtonClass();
				share.style.float = 'right';
				share.textContent = 'Share'
				share.addEventListener('click', async function (chapter) {
					navigator.clipboard.writeText(`https://twitch.tv/videos/${await ids.getVideoID()}?t=${generateTwitchTimestamp(chapter.seconds)}`);
				}.bind(null, chapter))
				li.appendChild(share);

				const deleteBtn = document.createElement('button')
				deleteBtn.className = getButtonClass();
				deleteBtn.style.float = 'right';
				deleteBtn.textContent = 'Delete'
				deleteBtn.addEventListener('click', deleteChapter.bind(null, chapter))
				li.appendChild(deleteBtn);

				list.appendChild(li);
			}

			const bottomClose = closeButton.cloneNode(true);
			bottomClose.addEventListener('click', () => setChapterList(false));
			list.appendChild(bottomClose);

			document.body.appendChild(list);

			uninstallFuncs.push(() => {
				document.body.removeEventListener('mousemove', handleMouseMove);
				document.body.removeEventListener('mouseup', handleMouseUp);
			});
		}

		function removeChapterList() {
			document.querySelector('.r2_chapter_list')?.remove()
		}

		const setChapterList = (render) => {
			rendering = render
			renderChapterList();
		}

		return { removeChapterList, renderChapterList, setChapterList }
	})();

	async function editChapter(chapter) {
		const minimal = await dialog('prompt', 'Edit Chapter:', () => ['input', Array.from(chaptersToMinimal([chapter]))[0]]);
		if (minimal === null) return;
		const edited = Array.from(parseMinimalChapters(minimal))[0]
		if (!edited) return deleteChapter(chapter);
		else Object.assign(chapter, edited);
		return handleChapterUpdate();
	}

	async function editAllChapters() {
		const minimal = await dialog('prompt', 'Edit Chapters', () => ['textarea', Array.from(chaptersToMinimal(chapters)).join('\n')]);
		if (minimal === null) return;
		chapters.splice(0, chapters.length, ...Array.from(parseMinimalChapters(minimal)));
		return handleChapterUpdate();
	}

	// Functions to call to remove script from site
	uninstallFuncs.push(removeChapterList);
	/**
	 * Get the current time in seconds of the player
	 *
	 * @returns {number}
	 */
	let getCurrentTimeLive = async () => 0;
	let chapterChangeHandlers = [
		async () => localStorage.setItem('r2_chapters_' + await ids.getVideoID(), JSON.stringify(chapters)),
		renderChapterList
	]

	if (isVOD()) {
		uninstallFuncs.push((() => {
			const chapterName = document.createElement('span');
			chapterName.style.paddingLeft = '1em';
			chapterName.className = 'r2_current_chapter';
			chapterName.dataset.controled = ''

			document.querySelector('[data-a-target="player-volume-slider"]').parentNode.parentNode.parentNode.parentNode.appendChild(chapterName);

			const chapterTitleInterval = setInterval(async () => {
				if (chapterName.dataset.controled) return;

				const now = await getCurrentTimeLive()
				const name = chapters.filter(c => c.seconds <= now).slice(-1)[0]?.name

				if (name && chapterName.textContent !== name) chapterName.textContent = name;
			}, 1000);

			return () => {
				clearInterval(chapterTitleInterval)
				chapterName.remove();
			}
		})());

		uninstallFuncs.push((() => {
			const xToSeconds = x => {
				const rect = bar.getBoundingClientRect();
				const percentage = x / rect.width
				const duration = Number(document.querySelector('[data-a-target="player-seekbar-duration"]').dataset.aValue)
				const seconds = duration * percentage;
				return seconds;
			}
			const handleMouseOver = e => {
				if (e.target === bar) return;
				const chapterName = document.querySelector('.r2_current_chapter')
				chapterName.dataset.controled = 'true'

				const seconds = xToSeconds(e.layerX);
				const name = chapters.filter(c => c.seconds <= seconds).slice(-1)[0]?.name
				if (name && chapterName.textContent !== name) chapterName.textContent = name;
			}

			const handleMouseLeave = () => {
				document.querySelector('.r2_current_chapter').dataset.controled = ''
			}

			const bar = document.querySelector('.seekbar-bar').parentNode;
			bar.addEventListener('mouseover', handleMouseOver);
			bar.addEventListener('mouseleave', handleMouseLeave)
			return () => {
				bar.removeEventListener('mouseover', handleMouseOver);
				bar.removeEventListener('mouseleave', handleMouseLeave);
			}
		})());
		/**
		 * Remove chapter DOM elements, done before rendering and uninstall
		 */
		const removeDOMChapters = () => {
			document.querySelectorAll('.r2_chapter').forEach(e => e.remove());
		}

		chapterChangeHandlers.push(function renderChapters() {
			removeDOMChapters();
			const bar = document.querySelector('.seekbar-bar');
			for (const chapter of chapters) {
				const node = document.createElement('button')
				node.className = 'r2_chapter'
				node.title = chapter.name;
				node.style.position = 'absolute';
				node.style.width = '1.75px'
				node.style.height = '10px';
				node.style.backgroundColor = 'black';

				node.style.left = getTimeXY(chapter.seconds).x + 'px';

				node.addEventListener('click', seekToChapter.bind(null, chapter))
				node.addEventListener('contextmenu', startEditingChapter.bind(null, chapter))
				bar.appendChild(node);
			}
		})

		// Pull current time from DHMS display, it's always accurate in VODs
		getCurrentTimeLive = async () => DHMStoSeconds(document.querySelector('[data-a-target="player-seekbar-current-time"]').textContent.split(':').map(Number))
		uninstallFuncs.push(removeDOMChapters)
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
			Edit: 'e',
			List: 'l'
		}))
		if (!choice) return;
		if (choice === 'i') return importMinimal()
		else if (choice === 'x') return exportMarkdown();
		else if (choice === 'e') return editAllChapters();
		else if (choice === 'l') return setChapterList(true);
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
	uninstallFuncs.push(() => window.removeEventListener('keydown', keydownHandler));

	let renderTimeout = 0;
	/**
	 * Handle window resizing
	 */
	const resizeHandler = () => {
		clearTimeout(renderTimeout);
		renderTimeout = setTimeout(handleChapterUpdate, 1000);
	};
	window.addEventListener('resize', resizeHandler);
	uninstallFuncs.push(() => window.removeEventListener('resize', resizeHandler));


	if (chapters.length) await handleChapterUpdate();

	console.log('[R2 Twitch Chapters] Setup Ended');
	return { chapters, uninstall };
})();
console.log('[R2 Twitch Chapters] Script Ended');