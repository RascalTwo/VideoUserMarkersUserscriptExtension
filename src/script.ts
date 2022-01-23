// ==UserScript==
// @name     Twitch Chapters
// @version  1
// @grant    none
// @match    https://www.twitch.tv/*
// @require  https://requirejs.org/docs/release/2.3.6/comments/require.js
// ==/UserScript==

import { log } from './helpers';

declare global {
	interface Window {
		ids: any;
		chapterFormatters: any;
		r2: Promise<{
			uninstall: () => Promise<void>;
		}>;
	}
}

log('Script Started');

/**
 * Do nothing
 */
function NOOP() {}

/**
 * Get the Pixel width of the `ch` unit
 *
 * @returns {number}
 */
function getCHWidth() {
	const node = document.createElement('div');
	node.style.position = 'absolute';
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
function delay(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}

let openDialogs = 0;

/**
 * Show customizable dialog
 *
 * @param {'alert' | 'prompt' | 'choose'} type
 * @param {string} message
 * @param {(form: HTMLFormElement) => any} sideEffect
 */
async function dialog(
	type: 'alert' | 'prompt' | 'choose',
	message: string,
	sideEffect?: (form: HTMLFormElement) => any
): Promise<any> {
	return new Promise(resolve => {
		openDialogs++;

		let canceled = false;

		const form = document.createElement('form');
		form.style.position = 'absolute';
		form.style.zIndex = (9000 + openDialogs).toString();
		form.style.top = '50%';
		form.style.left = '50%';
		form.style.transform = 'translate(-50%, -50%)';
		form.style.backgroundColor = '#18181b';
		form.style.padding = '1em';
		form.style.borderRadius = '1em';
		form.style.color = 'white';
		form.style.display = 'flex';
		form.style.flexDirection = 'column';
		form.textContent = message;
		const handleSubmit = (e?: Event) => {
			e?.preventDefault();
			const response = canceled ? null : generateResponse(form);
			form.remove();
			openDialogs--;
			removeEscapeHandler();
			return resolve(response);
		};
		form.addEventListener('submit', handleSubmit);

		const [generateResponse, pre, post, afterCreated]: Function[] = {
			alert: () => [
				() => true,
				() => (form.querySelector('button[type="submit"]')! as HTMLElement).focus(),
				NOOP,
				sideEffect!,
			],
			prompt: () => {
				const [type, value] = sideEffect?.(form) ?? ['input', ''];
				const input = document.createElement(type);
				input.value = value;
				if (type === 'textarea') input.setAttribute('rows', 10);

				// TODO - trim this down to just the required handlers/preventions
				const overwriteAlternateHandlers = (e: KeyboardEvent) => {
					e.stopImmediatePropagation();
					e.stopPropagation();
					if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
				};
				input.addEventListener('keydown', overwriteAlternateHandlers);
				input.addEventListener('keypress', overwriteAlternateHandlers);
				input.addEventListener('keyup', overwriteAlternateHandlers);

				form.appendChild(input);
				return [
					() => input.value.trim(),
					() => input.focus(),
					() => {
						const lines: string[] = input.value.split('\n');
						const longestLine = Math.max(...lines.map(line => line.length));
						if (!longestLine) return;
						input.style.width = Math.max(input.offsetWidth, longestLine * getCHWidth()) + 'px';
					},
					NOOP,
				];
			},
			choose: () => {
				form.appendChild(
					Object.entries(sideEffect!(form)).reduce((fragment, [key, value]) => {
						const button = document.createElement('button');
						button.className = getButtonClass();
						button.textContent = key;
						button.value = JSON.stringify(value);
						button.addEventListener('click', () => (form.dataset.value = button.value));

						fragment.appendChild(button);
						return fragment;
					}, document.createDocumentFragment())
				);
				return [
					() => JSON.parse(form.dataset.value!),
					() => {
						form.querySelector('button[type="submit"]')!.remove();
						form.querySelector('button')!.focus();
					},
					NOOP,
					NOOP,
				];
			},
		}[type]();

		const actions = document.createElement('div');
		actions.style.flex = '1';
		actions.style.display = 'flex';
		const submit = document.createElement('button');
		submit.className = getButtonClass();
		submit.style.flex = '1';
		submit.textContent = 'OK';
		submit.type = 'submit';
		actions.appendChild(submit);

		const cancel = document.createElement('button');
		cancel.className = getButtonClass();
		cancel.style.flex = '1';
		cancel.textContent = 'Cancel';
		cancel.addEventListener('click', () => (canceled = true));
		actions.appendChild(cancel);
		form.appendChild(actions);

		document.body.appendChild(form);
		const removeEscapeHandler = attachEscapeHandler(
			handleSubmit,
			() => form.style.zIndex === (9000 + openDialogs).toString()
		);

		setTimeout(() => {
			pre(form);
			afterCreated?.(form);
			post(form);
		}, 250);
	});
}

/**
 * Click nodes one by one in {@link queries}, waiting until they are in the DOM one by one
 *
 *
 * @param  {...any} queries queries of nodes to click
 */
async function clickNodes(...queries: string[]) {
	for (const query of queries) {
		while (true) {
			const node = document.querySelector(query);
			if (node) {
				(node as HTMLElement).click();
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
	return window.location.pathname.startsWith('/videos');
}

/**
 * If the page is Live
 *
 * @returns {boolean}
 */
function isLive() {
	if (isAlternatePlayer()) return true;
	const parts = window.location.pathname.split('/').slice(1);
	// @ts-ignore
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
		? // `channel=loginName` is in the URL
		  new URLSearchParams(window.location.search).get('channel')
		: isLive()
		? // URL ends with loginName
		  window.location.pathname.split('/')[1]
		: // URL channel=loginName exists in `og:video` metadata
		  new URLSearchParams(
				document
					.querySelector('meta[property="og:video"]')!
					.getAttribute('content')!
					.split('?')
					.slice(1)
					.join('?')
		  ).get('channel');
}

/**
 * Convert DHMS to seconds, each part is optional except seconds
 *
 * @param {number[]} parts DHMS numberic parts
 * @returns {number} seconds
 */
function DHMStoSeconds(parts: number[]) {
	// seconds
	if (parts.length === 1) return parts[0];
	// minutes:seconds
	else if (parts.length === 2) return parts[0] * 60 + parts[1];
	// hours:minutes:seconds
	else if (parts.length === 3) return parts[0] * 60 * 60 + parts[1] * 60 + parts[2];
	// days:hours:minute:seconds
	return parts[0] * 60 * 60 * 24 + parts[1] * 60 * 60 + parts[2] * 60 + parts[3];
}

/**
 * Convert seconds to DHMS
 *
 * @param {number} seconds
 * @returns {string}
 */
function secondsToDHMS(seconds: number, minimalPlaces = 1) {
	// TODO - fix this rushed math
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds - days * 86400) / 3600);
	const minutes = Math.floor((seconds % (60 * 60)) / 60);
	const parts = [days, hours, minutes, Math.floor(seconds % 60)];
	while (!parts[0] && parts.length > minimalPlaces) parts.shift();
	return parts.map(num => num.toString().padStart(2, '0')).join(':');
}

function generateTwitchTimestamp(seconds: number) {
	const symbols = ['d', 'h', 'm'];
	const dhms = Array.from(secondsToDHMS(seconds));

	// 0:1:2:3 -> 0:1:2m3 -> 0:1h2m3 -> 0d1h2m3
	while (true) {
		const index = dhms.lastIndexOf(':');
		if (index === -1) break;
		dhms[index] = symbols.pop()!;
	}

	return dhms.join('') + 's';
}

window.ids = (() => {
	let userID: string | undefined = undefined;
	let vid: string | undefined | null = undefined;

	/**
	 * Get the ID of the page user
	 *
	 * @returns {number}
	 */
	async function getUserID() {
		if (userID) return userID;

		// TODO - optimize GQL query
		return fetch('https://gql.twitch.tv/gql', {
			headers: {
				'client-id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
			},
			body: `{"query":"query($login: String!, $skip: Boolean!) {\\n\\t\\t\\t\\tuser(login: $login) {\\n\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\tlanguage\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\tdescription\\n\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\tfollowers {\\n\\t\\t\\t\\t\\t\\ttotalCount\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\tlastBroadcast {\\n\\t\\t\\t\\t\\t\\tstartedAt\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprimaryTeam {\\n\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprofileImageURL(width: 70)\\n\\t\\t\\t\\t\\tprofileViewCount\\n\\t\\t\\t\\t\\tself @skip(if: $skip) {\\n\\t\\t\\t\\t\\t\\tcanFollow\\n\\t\\t\\t\\t\\t\\tfollower {\\n\\t\\t\\t\\t\\t\\t\\tdisableNotifications\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}\\n\\t\\t\\t}","variables":{"login":"${getLoginName()}","skip":false}}`,
			method: 'POST',
		})
			.then(r => r.json())
			.then(json => {
				userID = json.data.user.id;
				log('GQL User ID:', userID);
				return userID;
			});
	}

	/**
	 * Get ID of video, may not exist if on live page and archive stream does not exist
	 *
	 * @param {boolean} promptUser If to prompt the user for the ID if it could not be found
	 * @returns {string}
	 */
	async function getVideoID(promptUser: boolean): Promise<typeof vid> {
		// Get VID from URL if VOD
		if (isVOD()) {
			vid = window.location.href.split('/').slice(-1)[0].split('?')[0];
			return vid;
		}
		if (promptUser && vid === null) {
			const response = await dialog('prompt', 'Video ID could not be detected, please provide it:');
			if (!response) return vid;
			vid = response;
		}
		if (vid !== undefined) return vid;
		// TODO - optimize GQL query
		return getUserID()
			.then(uid =>
				fetch('https://gql.twitch.tv/gql', {
					headers: {
						'client-id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
					},
					body: `{"query":"query($id: ID!, $all: Boolean!) {\\n\\t\\t\\t\\t\\tuser(id: $id) {\\n\\t\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\t\\tgame {\\n\\t\\t\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\ttitle\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\tlogin\\n\\t\\t\\t\\t\\t\\tstream {\\n\\t\\t\\t\\t\\t\\t\\tarchiveVideo @include(if: $all) {\\n\\t\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\ttype\\n\\t\\t\\t\\t\\t\\t\\tviewersCount\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}","variables":{"id":"${uid}","all":true}}`,
					method: 'POST',
				})
			)
			.then(r => r.json())
			.then(json => {
				vid = json.data.user.stream.archiveVideo?.id ?? null;
				log('GQL VOD ID:', vid);
				return getVideoID(promptUser);
			});
	}

	function clearCache() {
		userID = undefined;
		vid = undefined;
	}

	return { getUserID, getVideoID, clearCache };
})();

/**
 * Track the delay of a promise
 *
 * @param {Promise<T>} promise promise to track delay of
 * @returns {{ delay: number, response: T }}
 */
async function trackDelay<T>(promise: () => Promise<T>): Promise<{ delay: number; response: T }> {
	const requested = Date.now();
	const response = await promise();
	return { delay: Date.now() - requested, response };
}

function attachEscapeHandler(action: () => void, check = () => true) {
	const handler = (e: KeyboardEvent) => {
		if (e.key !== 'Escape' || ['INPUT', 'TEXTAREA'].includes((e.target! as HTMLElement).tagName))
			return;
		if (!check()) return;

		// Stop other escape handlers from being triggered
		e.preventDefault();
		e.stopImmediatePropagation();
		e.stopPropagation();

		window.removeEventListener('keydown', handler);
		return action();
	};
	window.addEventListener('keydown', handler);
	return () => window.removeEventListener('keydown', handler);
}

interface Chapter {
	name: string;
	seconds: number;
}

class ChapterFormatter {
	static delim: string = '\n';

	static *serialize(_: Chapter[]): Generator<string> {
		return [];
	}
	static *deserialize(_: string): Generator<Chapter> {
		return [];
	}
	static serializeAll(chapters: Chapter[]) {
		return Array.from(this.serialize(chapters)).join(this.delim);
	}
	static deserializeAll(content: string) {
		return Array.from(this.deserialize(content));
	}
	static serializeSeconds(seconds: number): any {
		return seconds;
	}
	static deserializeSeconds(serializedSeconds: string): number {
		return Number(serializedSeconds);
	}
	static serializeName(name: string) {
		return name;
	}
	static deserializeName(serializedName: string) {
		return serializedName;
	}
}

window.chapterFormatters = {
	json: class JSONFormatter extends ChapterFormatter {
		multiline = false;
		static serializeAll(chapters: Chapter[]) {
			return JSON.stringify(chapters);
		}
		static deserializeAll(content: string) {
			return JSON.parse(content);
		}
	},
	minimal: class MinimalFormatter extends ChapterFormatter {
		static delim = '\n';
		static *serialize(chapters: Chapter[]) {
			const places = secondsToDHMS(chapters[chapters.length - 1]?.seconds ?? 0).split(':').length;
			for (const chapter of chapters) {
				const dhms = secondsToDHMS(chapter.seconds, places);
				yield [dhms, chapter.name].join('\t');
			}
		}
		static *deserialize(content: string) {
			for (const line of content
				.trim()
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean)) {
				const [dhms, ...otherWords] = line.split(/\s/);
				const seconds = DHMStoSeconds(dhms.split(':').map(Number));
				const name = otherWords.join(' ');
				yield { name, seconds };
			}
		}
		static deserializeAll(content: string) {
			return Array.from(this.deserialize(content));
		}
		static serializeSeconds(seconds: number) {
			return secondsToDHMS(seconds);
		}
		static deserializeSeconds(serializedSeconds: string) {
			return DHMStoSeconds(serializedSeconds.split(':').map(Number));
		}
	},
};

function getUIFormatter() {
	return window.chapterFormatters[
		localStorage.getItem('r2_twitch_chapters_ui_formatter') ?? 'minimal'
	];
}

async function loadFromLocalstorage() {
	return JSON.parse(
		localStorage.getItem('r2_twitch_chapters_' + (await window.ids.getVideoID())) ??
			'{"formatter": "json", "content": "[]"}'
	);
}

async function saveToLocalstorage(formatter: string, chapters: Chapter[]) {
	localStorage.setItem(
		'r2_twitch_chapters_' + (await window.ids.getVideoID()),
		JSON.stringify({
			formatter,
			content: window.chapterFormatters[formatter].serializeAll(chapters),
		})
	);
}

// Run uninstall if previously loaded, development only
window.r2?.then(ret => ret.uninstall());
window.r2 = (async function main() {
	log('Setup Started');

	while (document.readyState !== 'complete') {
		await delay(1000);
		log('Waiting for complete document...');
	}

	const uninstallFuncs = [window.ids.clearCache];
	async function uninstall() {
		log('Uninstalling...');
		for (const func of uninstallFuncs) await func();
		log('Uninstalled');
	}

	function reinstallOnChange(reinstall = () => false) {
		const url = window.location.href;
		const interval = setInterval(() => {
			if (reinstall() || window.location.href !== url) {
				clearInterval(interval);
				uninstall().then(main);
			}
		}, 1000);
		return () => clearInterval(interval);
	}

	if (!isVOD() && !isLive()) {
		log(`[R2 Twitch Chapters] Not Activating - VOD: ${isVOD()}; Live: ${isLive()}`);
		uninstallFuncs.push(reinstallOnChange(() => isVOD() || isLive()));
		return { uninstall };
	}

	uninstallFuncs.push(reinstallOnChange());

	// Get last segment of URL, which is the video ID
	const chapters = await (async () => {
		const { formatter, content } = await loadFromLocalstorage();
		if (!(formatter in window.chapterFormatters)) {
			dialog('alert', `Formatter for saved content does not exist: ${formatter}`);
			return null;
		}
		return window.chapterFormatters[formatter].deserializeAll(content) as Chapter[];
	})();

	if (chapters === null) {
		log('Error loading chapters, abandoning');
		return { uninstall };
	}

	while (true) {
		await delay(1000);
		if (!document.querySelector('[data-a-target="player-volume-slider"]')) continue;
		if (isLive()) break;
		if (isVOD() && document.querySelector('.seekbar-bar')) break;

		log('Waiting for player...');
	}

	function findChapter(seconds: number) {
		return chapters!.find(chapter => chapter.seconds === seconds);
	}

	/**
	 * Get X and Y of the seconds provided
	 *
	 * @param {number} seconds
	 * @returns {{ x: number, y: number, minX: number, maxX: number }}
	 */
	function getTimeXY(seconds: number) {
		const bar = document.querySelector('.seekbar-bar')!;

		const rect = bar.getBoundingClientRect();
		const minX = rect.left;
		const maxX = rect.right;

		const duration = Number(
			document.querySelector<HTMLElement>('[data-a-target="player-seekbar-duration"]')!.dataset
				.aValue
		);
		const percentage = seconds / duration;
		const x = (maxX - minX) * percentage;
		const y = (rect.bottom + rect.top) / 2;
		return { x, y, minX, maxX };
	}

	/**
	 * Set time to the seconds provided
	 *
	 * @param {number} seconds
	 */
	async function setTime(seconds: number) {
		const bar = document.querySelector<HTMLElement>('[data-a-target="player-seekbar"]')!;
		Object.entries(bar.parentNode!)
			.find(([key]) => key.startsWith('__reactEventHandlers'))![1]
			.children[2].props.onThumbLocationChange(seconds);
	}

	function seekToChapter(chapter: Chapter, e: Event) {
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();
		return setTime(chapter.seconds);
	}

	function startEditingChapter(chapter: Chapter, seconds: boolean, name: boolean, e: Event) {
		// Disable context menu
		e?.preventDefault();
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();

		if (seconds && name) return editChapter(chapter);
		else if (seconds) return editChapterSeconds(chapter);
		return editChapterName(chapter);
	}

	function deleteChapter(chapter: Chapter) {
		const index = chapters!.findIndex(c => c.seconds === chapter.seconds);
		chapters!.splice(index, 1);
		return handleChapterUpdate();
	}

	function adjustChapterSeconds(chapter: Chapter, change: number) {
		chapter.seconds += change;
		return handleChapterUpdate().then(() => chapter);
	}

	const { removeChapterList, renderChapterList, setChapterList, uninstallChapterList } = (() => {
		let rendering = false;
		let last = { x: 0, y: 0 };

		const getCurrentChapterLI = (list: HTMLUListElement) =>
			getCurrentTimeLive().then(
				now =>
					list.querySelectorAll('li')[
						(chapters!
							.map((c, i) => [c, i] as [Chapter, number])
							.filter(([c]) => c.seconds <= now)
							.slice(-1)[0] ?? [null, -1])[1]
					]
			);

		function renderChapterList() {
			if (!rendering) return removeChapterList();

			const existingList = document.querySelector<HTMLUListElement>('.r2_chapter_list');
			const list = existingList || (document.createElement('ul') as HTMLUListElement);
			if (!existingList) {
				list.className = 'r2_chapter_list';
				list.style.position = 'absolute';
				list.style.zIndex = (9000 + openDialogs).toString();
				list.style.backgroundColor = '#18181b';
				list.style.padding = '1em';
				list.style.borderRadius = '1em';
				list.style.color = 'white';
				list.style.display = 'flex';
				list.style.flexDirection = 'column';
				list.style.maxHeight = '75vh';
				list.style.maxWidth = '50vw';
				list.style.overflow = 'scroll';
				list.style.resize = 'both';

				list.style.top = last.y + 'px';
				list.style.left = last.x + 'px';

				const header = document.createElement('h4');
				header.textContent = 'Chapter List';
				header.style.backgroundColor = '#08080b';
				header.style.userSelect = 'none';
				header.style.padding = '0';
				header.style.margin = '0';

				let dragging = false;
				header.addEventListener('mousedown', e => {
					dragging = true;
					last = { x: e.clientX, y: e.clientY };
				});
				const handleMouseUp = () => {
					dragging = false;
				};
				document.body.addEventListener('mouseup', handleMouseUp);

				const handleMouseMove = (e: MouseEvent) => {
					if (!dragging) return;

					list.style.top = list.offsetTop - (last.y - e.clientY) + 'px';
					list.style.left = list.offsetLeft - (last.x - e.clientX) + 'px';
					last = { x: e.clientX, y: e.clientY };
				};
				document.body.addEventListener('mousemove', handleMouseMove);
				list.appendChild(header);

				uninstallFuncs.push(() => {
					document.body.removeEventListener('mousemove', handleMouseMove);
					document.body.removeEventListener('mouseup', handleMouseUp);
				});

				const closeButton = document.createElement('button');
				closeButton.className = getButtonClass();
				closeButton.style.float = 'right';
				closeButton.textContent = 'Close';
				closeButton.addEventListener('click', () => setChapterList(false));

				header.appendChild(closeButton);

				uninstallFuncs.push(
					attachEscapeHandler(
						() => setChapterList(false),
						() => list.style.zIndex === (9000 + openDialogs).toString()
					)
				);
			}

			chapters!.sort((a, b) => a.seconds - b.seconds);
			const places = secondsToDHMS(chapters![chapters!.length - 1]?.seconds ?? 0).split(':').length;

			function getElementChapter(e: Event) {
				return findChapter(
					Number((e.target! as HTMLElement).closest<HTMLElement>('[data-seconds]')!.dataset.seconds)
				);
			}

			for (const [i, chapter] of chapters!.entries()) {
				const existingLi = list.querySelectorAll('li')[i];
				const li = existingLi || document.createElement('li');
				li.dataset.seconds = chapter.seconds.toString();
				if (!existingLi) {
					li.style.display = 'flex';
					li.style.alignItems = 'center';
				}

				const timeContent = secondsToDHMS(chapter.seconds, places);

				const time = li.querySelector('span') || document.createElement('span');
				if (!existingLi) {
					time.style.fontFamily = 'monospace';
					time.addEventListener('wheel', e => {
						// Stop native scrolling
						e.preventDefault();

						return adjustChapterSeconds(
							getElementChapter(e)!,
							Math.min(Math.max(e.deltaY, -1), 1)
						).then(chapter => (isVOD() ? setTime(chapter.seconds) : undefined));
					});

					const decrease = document.createElement('button');
					decrease.className = getButtonClass();
					decrease.textContent = '-';
					decrease.title = 'Subtract 1 second';
					decrease.addEventListener('click', e =>
						adjustChapterSeconds(getElementChapter(e)!, -1).then(chapter =>
							isVOD() ? setTime(chapter.seconds) : undefined
						)
					);
					time.appendChild(decrease);

					const timeText = document.createElement('span');
					timeText.textContent = timeContent;
					if (isVOD()) {
						timeText.style.cursor = 'pointer';
						timeText.addEventListener('click', e => seekToChapter(getElementChapter(e)!, e));
					}
					timeText.addEventListener('contextmenu', e =>
						startEditingChapter(getElementChapter(e)!, true, false, e)
					);
					time.appendChild(timeText);

					const increase = document.createElement('button');
					increase.className = getButtonClass();
					increase.textContent = '+';
					increase.title = 'Add 1 second';
					increase.addEventListener('click', e =>
						adjustChapterSeconds(getElementChapter(e)!, 1).then(chapter =>
							isVOD() ? setTime(chapter.seconds) : undefined
						)
					);
					time.appendChild(increase);
					li.appendChild(time);
				} else {
					time.childNodes[1].textContent = timeContent;
				}

				const title =
					li.querySelector<HTMLElement>('span.r2_chapter_title') || document.createElement('span');
				if (!existingLi) {
					title.className = 'r2_chapter_title';
					title.style.flex = '1';
					title.style.textAlign = 'center';
					if (isVOD()) {
						title.style.cursor = 'pointer';
						title.addEventListener('click', e => seekToChapter(getElementChapter(e)!, e));
					}
					title.addEventListener('contextmenu', e =>
						startEditingChapter(getElementChapter(e)!, false, true, e)
					);
					li.appendChild(title);
				}
				title.textContent = chapter.name;

				const share =
					document.querySelector<HTMLButtonElement>('button.r2_chapter_share') ||
					document.createElement('button');
				if (!existingLi) {
					share.className = getButtonClass();
					share.classList.add('r2_chapter_share');
					share.style.float = 'right';
					share.textContent = 'Share';
					share.addEventListener('click', async e => {
						navigator.clipboard.writeText(
							`https://twitch.tv/videos/${await window.ids.getVideoID()}?t=${generateTwitchTimestamp(
								getElementChapter(e)!.seconds
							)}`
						);
					});
					li.appendChild(share);
				}

				const deleteBtn =
					document.querySelector<HTMLButtonElement>('button.r2_chapter_delete') ||
					document.createElement('button');
				if (!existingLi) {
					deleteBtn.className = getButtonClass();
					deleteBtn.classList.add('r2_chapter_delete');
					deleteBtn.style.float = 'right';
					deleteBtn.textContent = 'Delete';
					deleteBtn.addEventListener('click', e => deleteChapter(getElementChapter(e)!));
					li.appendChild(deleteBtn);
				}

				if (!existingLi) list.appendChild(li);
			}

			if (!existingList) {
				const closeButton = document.createElement('button');
				closeButton.className = getButtonClass();
				closeButton.style.float = 'right';
				closeButton.textContent = 'Close';
				closeButton.addEventListener('click', () => setChapterList(false));
				list.appendChild(closeButton);

				document.body.appendChild(list);

				delay(1000)
					.then(() => getCurrentChapterLI(list))
					.then(li => li?.scrollIntoView());
			}
		}

		function removeChapterList() {
			document.querySelector('.r2_chapter_list')?.remove();
		}

		const setChapterList = (render: boolean) => {
			rendering = render;

			if (render) openDialogs++;
			else openDialogs--;

			renderChapterList();
		};

		const uninstallChapterList = (() => {
			let lastLi: HTMLLIElement | null = null;
			const interval = setInterval(() => {
				const list = document.querySelector<HTMLUListElement>('.r2_chapter_list')!;
				return !list
					? null
					: getCurrentChapterLI(list).then(li => {
							if (!li) return;

							li.style.backgroundColor = 'black';
							if (li === lastLi) return;
							if (lastLi) lastLi.style.backgroundColor = '';
							lastLi = li;
					  });
			}, 1000);

			return () => clearInterval(interval);
		})();

		return {
			removeChapterList,
			renderChapterList,
			setChapterList,
			uninstallChapterList,
		};
	})();

	uninstallFuncs.push(uninstallChapterList);

	async function editChapterSeconds(chapter: Chapter) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Time:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeSeconds(chapter.seconds),
		]);
		if (response === null) return;

		const seconds = formatter.deserializeSeconds(response);
		if (!seconds) return;

		chapter.seconds = seconds;
		return handleChapterUpdate();
	}

	async function editChapterName(chapter: Chapter) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Name:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeName(chapter.name),
		]);
		if (response === null) return;

		const name = formatter.deserializeName(response);
		if (!name) return;

		chapter.name = name;
		return handleChapterUpdate();
	}

	async function editChapter(chapter: Chapter) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Chapter:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeAll(chapter.name)[0],
		]);
		if (response === null) return;

		const edited = formatter.deserializeAll(response)[0];
		if (!edited) return;

		Object.assign(chapter, edited);
		return handleChapterUpdate();
	}

	async function editAllChapters() {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Serialized Chapters', () => [
			'textarea',
			formatter.serializeAll(chapters),
		]);
		if (response === null) return;
		chapters!.splice(0, chapters!.length, ...formatter.deserializeAll(response));
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
		() => loadFromLocalstorage().then(({ formatter }) => saveToLocalstorage(formatter, chapters)),
		renderChapterList,
	];

	if (isVOD()) {
		uninstallFuncs.push(
			(() => {
				const chapterName = document.createElement('anchor') as HTMLAnchorElement;
				chapterName.href = '#';
				chapterName.style.cursor = 'hover';
				chapterName.style.paddingLeft = '1em';
				chapterName.className = 'r2_current_chapter';
				chapterName.dataset.controled = '';
				chapterName.addEventListener('click', e => {
					// Prevent anchor behavior
					e.preventDefault();

					setTime(Number(chapterName.dataset.seconds));
				});
				chapterName.addEventListener('contextmenu', e => {
					// Stop context menu
					e.preventDefault();
					setChapterList(true);
				});

				document
					.querySelector<HTMLElement>('[data-a-target="player-volume-slider"]')!
					.parentNode!.parentNode!.parentNode!.parentNode!.appendChild(chapterName);

				const chapterTitleInterval = setInterval(async () => {
					if (chapterName.dataset.controled) return;

					const now = await getCurrentTimeLive();
					const chapter = chapters.filter(c => c.seconds <= now).slice(-1)[0] ?? null;

					if (!chapter || chapterName.dataset.seconds === chapter.seconds.toString()) return;
					chapterName.textContent = chapter.name;
					chapterName.dataset.seconds = chapter.seconds.toString();
				}, 1000);

				return () => {
					clearInterval(chapterTitleInterval);
					chapterName.remove();
				};
			})()
		);

		uninstallFuncs.push(
			(() => {
				const xToSeconds = (x: number) => {
					const rect = bar.getBoundingClientRect();
					const percentage = x / rect.width;
					const duration = Number(
						document.querySelector<HTMLElement>('[data-a-target="player-seekbar-duration"]')!
							.dataset.aValue
					);
					const seconds = duration * percentage;
					return seconds;
				};
				const handleMouseOver = (e: MouseEvent) => {
					if (e.target === bar) return;
					const chapterName = document.querySelector<HTMLElement>('.r2_current_chapter')!;
					chapterName.dataset.controled = 'true';

					// @ts-ignore
					const seconds = xToSeconds(e.layerX);

					const chapter = chapters.filter(c => c.seconds <= seconds).slice(-1)[0] ?? null;

					if (!chapter || chapterName.dataset.seconds === chapter.seconds.toString()) return;
					chapterName.textContent = chapter.name;
					chapterName.dataset.seconds = chapter.seconds.toString();
				};

				const handleMouseLeave = () => {
					document.querySelector<HTMLElement>('.r2_current_chapter')!.dataset.controled = '';
				};

				const bar = document.querySelector('.seekbar-bar')!.parentNode! as HTMLElement;
				bar.addEventListener('mouseover', handleMouseOver);
				bar.addEventListener('mouseleave', handleMouseLeave);
				return () => {
					bar.removeEventListener('mouseover', handleMouseOver);
					bar.removeEventListener('mouseleave', handleMouseLeave);
				};
			})()
		);

		uninstallFuncs.push(
			(() => {
				const handleWheel = async (e: WheelEvent) => {
					e.preventDefault();
					const change = Math.min(Math.max(e.deltaY, -1), 1);
					await setTime((await getCurrentTimeLive()) + change);
				};
				const bar = document.querySelector('.seekbar-bar')!.parentNode as HTMLElement;
				bar.addEventListener('wheel', handleWheel);
				return () => {
					bar.removeEventListener('wheel', handleWheel);
				};
			})()
		);
		/**
		 * Remove chapter DOM elements, done before rendering and uninstall
		 */
		const removeDOMChapters = () => {
			document.querySelectorAll('.r2_chapter').forEach(e => e.remove());
		};

		chapterChangeHandlers.push(function renderChapters() {
			removeDOMChapters();
			const bar = document.querySelector<HTMLElement>('.seekbar-bar')!;
			for (const chapter of chapters) {
				const node = document.createElement('button');
				node.className = 'r2_chapter';
				node.title = chapter.name;
				node.style.position = 'absolute';
				node.style.width = '1.75px';
				node.style.height = '10px';
				node.style.backgroundColor = 'black';

				node.style.left = getTimeXY(chapter.seconds).x + 'px';

				node.addEventListener('click', seekToChapter.bind(null, chapter));
				node.addEventListener('contextmenu', startEditingChapter.bind(null, chapter, true, true));
				bar.appendChild(node);
			}
		});

		// Pull current time from DHMS display, it's always accurate in VODs
		getCurrentTimeLive = async () =>
			DHMStoSeconds(
				document
					.querySelector<HTMLElement>('[data-a-target="player-seekbar-current-time"]')!
					.textContent!.split(':')
					.map(Number)
			);
		uninstallFuncs.push(removeDOMChapters);
	} else if (isLive()) {
		if (isAlternatePlayer()) {
			// m_Player.getPlaybackPositionBroadcast() on AlternatePlayer
			// @ts-ignore
			getCurrentTimeLive = async () => м_Проигрыватель.ПолучитьПозициюВоспроизведенияТрансляции();
		} else {
			/**
			 * Return the number of seconds of delay as reported by Twitch
			 *
			 * @returns {number}
			 */
			async function getLiveDelay(): Promise<number> {
				const latency = document.querySelector('[aria-label="Latency To Broadcaster"]');
				const bufferSize = document.querySelector('[aria-label="Buffer Size"]');
				if (!latency || !bufferSize) {
					// Settings Gear -> Advanced -> Video Stats Toggle
					await clickNodes(
						'[data-a-target="player-settings-button"]',
						'[data-a-target="player-settings-menu-item-advanced"]',
						'[data-a-target="player-settings-submenu-advanced-video-stats"] input'
					);
					return getLiveDelay();
				}

				// Video Stats Toggle -> Settings Gear
				clickNodes(
					'[data-a-target="player-settings-submenu-advanced-video-stats"] input',
					'[data-a-target="player-settings-button"]'
				);
				return [latency, bufferSize]
					.map(e => Number(e.textContent!.split(' ')[0]))
					.reduce((sum, s) => sum + s);
			}

			getCurrentTimeLive = async () => {
				const { delay, response: secondsDelay } = await trackDelay(async () => getLiveDelay());
				const currentTime = DHMStoSeconds(
					document.querySelector<HTMLElement>('.live-time')!.textContent!.split(':').map(Number)
				);
				const actualTime = currentTime - secondsDelay - delay / 1000;
				return actualTime;
			};
		}
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
			const offset = parseInt(name.substring(2));
			if (!isNaN(offset)) seconds += offset * direction;
			name = name.substring(2 + offset.toString().length).trim();
		}

		chapters.push({ seconds, name });
		if (isLive())
			navigator.clipboard.writeText(
				`https://twitch.tv/videos/${await window.ids.getVideoID()}?t=${generateTwitchTimestamp(
					seconds
				)}`
			);
		return handleChapterUpdate();
	};

	/**
	 * Export chapter objects into serailized format
	 */
	const exportSerialized = async () => {
		await navigator.clipboard.writeText(getUIFormatter().serializeAll(chapters));
		return dialog('alert', 'Exported to Clipboard!');
	};

	/**
	 * Menu for importing or exporting
	 */
	const menu = async () => {
		const choice = await dialog('choose', 'Twitch Chapters Menu', () => ({
			Export: 'x',
			Edit: 'e',
			List: 'l',
		}));
		if (!choice) return;
		else if (choice === 'x') return exportSerialized();
		else if (choice === 'e') return editAllChapters();
		else if (choice === 'l') return setChapterList(true);
	};

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keydownHandler = (e: KeyboardEvent) => {
		if (['INPUT', 'TEXTAREA'].includes((e.target! as HTMLElement).tagName)) return;
		if (e.key === 'u') menu();
		if (e.key === 'b') addChapterHere();
	};
	window.addEventListener('keydown', keydownHandler);
	uninstallFuncs.push(() => window.removeEventListener('keydown', keydownHandler));

	const resizeObserver = new ResizeObserver(handleChapterUpdate);
	resizeObserver.observe(document.querySelector<HTMLVideoElement>('video')!);
	uninstallFuncs.push(() =>
		resizeObserver.unobserve(document.querySelector<HTMLVideoElement>('video')!)
	);

	if (chapters.length) await handleChapterUpdate();

	log('Setup Ended');
	return { uninstall };
})();
log('Script Ended');

export {};
