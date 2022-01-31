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
	clickNodes,
	delay,
	DHMStoSeconds,
	trackDelay,
	loadFromLocalStorage,
	saveToLocalStorage,
	createUninstaller,
} from './helpers';
import {
	clearIDsCache,
	generateTwitchTimestamp,
	getButtonClass,
	getVideoID,
	isLive,
	isVOD,
} from './twitch';
import { dialog, generateChapterList } from './ui';
import type { Chapter } from './types';

declare global {
	interface Window {
		r2_twitch_chapters?: {
			uninstall: () => Promise<void>;
		};
	}
}

log('Script Started');

const TOP_BAR_SELECTOR = '[class="channel-info-content"] [class*="metadata-layout__"]';

(async function main() {
	// Run uninstall if previously loaded, development only
	await window.r2_twitch_chapters?.uninstall();

	log('Setup Started');

	while (document.readyState !== 'complete') {
		await delay(1000);
		log('Waiting for complete document...');
	}

	const shouldActivate = isVOD() || isLive();
	const addUninstallationStep = createUninstaller(
		main,
		shouldActivate ? undefined : () => isVOD() || isLive()
	);
	addUninstallationStep(clearIDsCache);
	if (!shouldActivate) {
		log(`[R2 Twitch Chapters] Not Activating - VOD: ${isVOD()}; Live: ${isLive()}`);
		return;
	}

	// Get last segment of URL, which is the video ID
	const chapters = await (async () => {
		const { formatter, content } = await loadFromLocalStorage();
		if (!(formatter in FORMATTERS)) {
			dialog('alert', `Formatter for saved content does not exist: ${formatter}`);
			return null;
		}
		return FORMATTERS[formatter].deserializeAll(content) as Chapter[];
	})();

	if (chapters === null) {
		log('Error loading chapters, abandoning');
		return;
	}

	while (true) {
		await delay(1000);
		if (!document.querySelector('[data-a-target="player-volume-slider"]')) continue;
		if (!document.querySelector(TOP_BAR_SELECTOR)) continue;
		if (isLive()) break;
		if (isVOD() && document.querySelector('.seekbar-bar')) break;

		log('Waiting for player...');
	}

	addUninstallationStep(
		(() => {
			const ui = document.createElement('details');
			ui.style.margin = '0.5em';
			ui.style.padding = '0.5em';
			ui.style.border = '1px solid white';

			const summary = document.createElement('summary');
			summary.textContent = 'R2 Twitch Chapters';
			ui.appendChild(summary);

			const wrapper = document.createElement('div');
			wrapper.style.display = 'flex';
			wrapper.style.gap = '0.5em';
			ui.appendChild(wrapper);

			const chaptersButton = document.createElement('button');
			chaptersButton.textContent = 'Menu';
			chaptersButton.className = getButtonClass();
			chaptersButton.style.flex = '1';
			chaptersButton.addEventListener('click', () => menu());
			wrapper.appendChild(chaptersButton);

			const addChapter = document.createElement('button');
			addChapter.textContent = 'Add';
			addChapter.className = getButtonClass();
			addChapter.style.flex = '1';
			addChapter.addEventListener('click', () => addChapterHere());
			wrapper.appendChild(addChapter);

			document.querySelector(TOP_BAR_SELECTOR + ' > div:last-of-type')!.appendChild(ui);
			return () => ui.remove();
		})()
	);

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

	/**
	 * Get the current time in seconds of the player
	 *
	 * @returns {number}
	 */
	let getCurrentTimeLive = async () => 0;
	let chapterChangeHandlers: (() => any)[] = [
		() => loadFromLocalStorage().then(({ formatter }) => saveToLocalStorage(formatter, chapters)),
	];

	addUninstallationStep(
		(() => {
			const chapterName = document.createElement('anchor') as HTMLAnchorElement;
			chapterName.href = '#';
			chapterName.style.cursor = 'hover';
			chapterName.style.paddingLeft = '1em';
			chapterName.className = 'r2_current_chapter';
			chapterName.dataset.controlled = '';
			if (isVOD()) {
				chapterName.style.cursor = 'pointer';
				chapterName.addEventListener('click', e => {
					// Prevent anchor behavior
					e.preventDefault();

					setTime(Number(chapterName.dataset.seconds));
				});
			}
			chapterName.addEventListener('contextmenu', e => {
				// Stop context menu
				e.preventDefault();
				chapterList.setChapterList(true);
			});

			document
				.querySelector<HTMLElement>('[data-a-target="player-volume-slider"]')!
				.parentNode!.parentNode!.parentNode!.parentNode!.appendChild(chapterName);

			const chapterTitleInterval = setInterval(async () => {
				if (chapterName.dataset.controlled) return;

				const now = await getCurrentTimeLive();
				const chapter = chapters.filter(c => c.seconds <= now).slice(-1)[0] ?? {
					name: '',
					seconds: -1,
				};

				chapterName.textContent = chapter.name;
				chapterName.dataset.seconds = chapter.seconds.toString();
			}, 1000);

			return () => {
				clearInterval(chapterTitleInterval);
				chapterName.remove();
			};
		})()
	);

	if (isVOD()) {
		addUninstallationStep(
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
					chapterName.dataset.controlled = 'true';

					// @ts-ignore
					const seconds = xToSeconds(e.layerX);

					const chapter = chapters.filter(c => c.seconds <= seconds).slice(-1)[0] ?? null;

					if (!chapter || chapterName.dataset.seconds === chapter.seconds.toString()) return;
					chapterName.textContent = chapter.name;
					chapterName.dataset.seconds = chapter.seconds.toString();
				};

				const handleMouseLeave = () => {
					document.querySelector<HTMLElement>('.r2_current_chapter')!.dataset.controlled = '';
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

		addUninstallationStep(
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
		addUninstallationStep(removeDOMChapters);
	} else if (isLive()) {
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

	const chapterList = generateChapterList(
		chapters,
		getCurrentTimeLive,
		handleChapterUpdate,
		setTime,
		startEditingChapter,
		seekToChapter
	);
	addUninstallationStep(chapterList.uninstallChapterList);
	chapterChangeHandlers.push(chapterList.renderChapterList);

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
	 * Export chapter objects into serialized format
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
		else if (choice === 'l') return chapterList.setChapterList(true);
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
	addUninstallationStep(() => window.removeEventListener('keydown', keydownHandler));

	const resizeObserver = new ResizeObserver(handleChapterUpdate);
	resizeObserver.observe(document.querySelector<HTMLVideoElement>('video')!);
	addUninstallationStep(() =>
		resizeObserver.unobserve(document.querySelector<HTMLVideoElement>('video')!)
	);

	if (chapters.length) await handleChapterUpdate();

	log('Setup Ended');
})();

log('Script Ended');

export {};
