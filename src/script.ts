// ==UserScript==
// @name     Twitch Chapters
// @version  1
// @grant    none
// @match    https://www.twitch.tv/*
// @require  https://requirejs.org/docs/release/2.3.6/comments/require.js
// ==/UserScript==

import { FORMATTERS, getUIFormatter } from './formatters';
import {
	log,
	attachEscapeHandler,
	clickNodes,
	delay,
	DHMStoSeconds,
	secondsToDHMS,
	trackDelay,
	loadFromLocalstorage,
	saveToLocalstorage,
} from './helpers';
import {
	clearIDsCache,
	generateTwitchTimestamp,
	getButtonClass,
	getVideoID,
	isAlternatePlayer,
	isLive,
	isVOD,
} from './twitch';
import { changeDialogCount, dialog, getDialogCount } from './ui';
import type { Chapter } from './types';

declare global {
	interface Window {
		r2_twitch_chapters?: {
			uninstall: () => Promise<void>;
		};
	}
}

log('Script Started');

(async function main() {
	// Run uninstall if previously loaded, development only
	await window.r2_twitch_chapters?.uninstall();

	log('Setup Started');

	while (document.readyState !== 'complete') {
		await delay(1000);
		log('Waiting for complete document...');
	}

	const uninstallFuncs = [clearIDsCache];
	async function uninstall() {
		log('Uninstalling...');
		for (const func of uninstallFuncs) await func();
		log('Uninstalled');
	}
	window.r2_twitch_chapters = { uninstall };

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
		return;
	}

	uninstallFuncs.push(reinstallOnChange());

	// Get last segment of URL, which is the video ID
	const chapters = await (async () => {
		const { formatter, content } = await loadFromLocalstorage();
		if (!(formatter in FORMATTERS)) {
			dialog('alert', `Formatter for saved content does not exist: ${formatter}`);
			return null;
		}
		return FORMATTERS[formatter].deserializeAll(content) as Chapter[];
	})();

	if (chapters === null) {
		log('Error loading chapters, abandoning');
		return
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
				list.style.zIndex = (9000 + getDialogCount()).toString();
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
						() => list.style.zIndex === (9000 + getDialogCount()).toString()
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
							`https://twitch.tv/videos/${await getVideoID(false)}?t=${generateTwitchTimestamp(
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

			changeDialogCount(Number(render));

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
			formatter.serializeAll([chapter])[0],
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
			formatter.serializeAll(chapters!),
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
				`https://twitch.tv/videos/${await getVideoID(false)}?t=${generateTwitchTimestamp(seconds)}`
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
})();

log('Script Ended');

export {};
