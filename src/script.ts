// ==UserScript==
// @name     R2 Twitch User-Markers
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
import { dialog, generateMarkerList as generateMarkerList } from './ui';
import type { Marker } from './types';

declare global {
	interface Window {
		r2_twitch_user_markers?: {
			uninstall: () => Promise<void>;
		};
	}
}

log('Script Started');

const TOP_BAR_SELECTOR = '[class="channel-info-content"] [class*="metadata-layout__"]';

(async function main() {
	// Run uninstall if previously loaded, development only
	await window.r2_twitch_user_markers?.uninstall();

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
		log(`Not Activating - VOD: ${isVOD()}; Live: ${isLive()}`);
		return;
	}

	// Get last segment of URL, which is the video ID
	const markers = await (async () => {
		const { formatter, content } = await loadFromLocalStorage();
		if (!(formatter in FORMATTERS)) {
			dialog('alert', `Formatter for saved content does not exist: ${formatter}`);
			return null;
		}
		return FORMATTERS[formatter].deserializeAll(content) as Marker[];
	})();

	if (markers === null) {
		log('Error loading markers, abandoning');
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
			summary.textContent = 'R2 Markers';
			ui.appendChild(summary);

			const wrapper = document.createElement('div');
			wrapper.style.display = 'flex';
			wrapper.style.gap = '0.5em';
			ui.appendChild(wrapper);

			const markersButton = document.createElement('button');
			markersButton.textContent = 'Menu';
			markersButton.className = getButtonClass();
			markersButton.style.flex = '1';
			markersButton.addEventListener('click', () => menu());
			wrapper.appendChild(markersButton);

			const addMarker = document.createElement('button');
			addMarker.textContent = 'Add';
			addMarker.className = getButtonClass();
			addMarker.style.flex = '1';
			addMarker.addEventListener('click', () => addMarkerHere());
			wrapper.appendChild(addMarker);

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

	function seekToMarker(marker: Marker, e: Event) {
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();
		return setTime(marker.seconds);
	}

	function startEditingMarker(marker: Marker, seconds: boolean, name: boolean, e: Event) {
		// Disable context menu
		e?.preventDefault();
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();

		if (seconds && name) return editMarker(marker);
		else if (seconds) return editMarkerSeconds(marker);
		return editMarkerName(marker);
	}

	async function editMarkerSeconds(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Time:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeSeconds(marker.seconds),
		]);
		if (response === null) return;

		const seconds = formatter.deserializeSeconds(response);
		if (!seconds) return;

		marker.seconds = seconds;
		return handleMarkerUpdate();
	}

	async function editMarkerName(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Name:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeName(marker.name),
		]);
		if (response === null) return;

		const name = formatter.deserializeName(response);
		if (!name) return;

		marker.name = name;
		return handleMarkerUpdate();
	}

	async function editMarker(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Marker:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeAll([marker])[0],
		]);
		if (response === null) return;

		const edited = formatter.deserializeAll(response)[0];
		if (!edited) return;

		Object.assign(marker, edited);
		return handleMarkerUpdate();
	}

	async function editAllMarkers() {
		const formatter = getUIFormatter();
		const response = await dialog('prompt', 'Edit Serialized Markers', () => [
			'textarea',
			formatter.serializeAll(markers!),
		]);
		if (response === null) return;
		markers!.splice(0, markers!.length, ...formatter.deserializeAll(response));
		return handleMarkerUpdate();
	}

	/**
	 * Get the current time in seconds of the player
	 *
	 * @returns {number}
	 */
	let getCurrentTimeLive = async () => 0;
	let markerChangeHandlers: (() => any)[] = [
		() => loadFromLocalStorage().then(({ formatter }) => saveToLocalStorage(formatter, markers)),
	];

	addUninstallationStep(
		(() => {
			const markerName = document.createElement('anchor') as HTMLAnchorElement;
			markerName.href = '#';
			markerName.style.cursor = 'hover';
			markerName.style.paddingLeft = '1em';
			markerName.className = 'r2_current_marker';
			markerName.dataset.controlled = '';
			if (isVOD()) {
				markerName.style.cursor = 'pointer';
				markerName.addEventListener('click', e => {
					// Prevent anchor behavior
					e.preventDefault();

					setTime(Number(markerName.dataset.seconds));
				});
			}
			markerName.addEventListener('contextmenu', e => {
				// Stop context menu
				e.preventDefault();
				markerList.setMarkerList(true);
			});

			document
				.querySelector<HTMLElement>('[data-a-target="player-volume-slider"]')!
				.parentNode!.parentNode!.parentNode!.parentNode!.appendChild(markerName);

			const markerTitleInterval = setInterval(async () => {
				if (markerName.dataset.controlled) return;

				let marker;
				if (isVOD()) {
					const now = await getCurrentTimeLive();
					marker = markers.filter(m => Math.floor(m.seconds) <= now).slice(-1)[0];
				} else {
					marker = markers[markers.length - 1];
				}
				if (!marker)
					marker = {
						name: '',
						seconds: -1,
					};

				markerName.textContent = marker.name;
				markerName.dataset.seconds = marker.seconds.toString();
			}, 1000);

			return () => {
				clearInterval(markerTitleInterval);
				markerName.remove();
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
					const markerName = document.querySelector<HTMLElement>('.r2_current_marker')!;
					markerName.dataset.controlled = 'true';

					// @ts-ignore
					const seconds = xToSeconds(e.layerX);

					const marker = markers.filter(m => Math.floor(m.seconds) <= seconds).slice(-1)[0] ?? null;

					if (!marker || markerName.dataset.seconds === marker.seconds.toString()) return;
					markerName.textContent = marker.name;
					markerName.dataset.seconds = marker.seconds.toString();
				};

				const handleMouseLeave = () => {
					document.querySelector<HTMLElement>('.r2_current_marker')!.dataset.controlled = '';
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
		 * Remove marker DOM elements, done before rendering and uninstall
		 */
		const removeDOMMarkers = () => {
			document.querySelectorAll('.r2_marker').forEach(e => e.remove());
		};

		markerChangeHandlers.push(function renderMarkers() {
			removeDOMMarkers();
			const bar = document.querySelector<HTMLElement>('.seekbar-bar')!;
			for (const marker of markers) {
				const node = document.createElement('button');
				node.className = 'r2_marker';
				node.title = marker.name;
				node.style.position = 'absolute';
				node.style.width = '1.75px';
				node.style.height = '10px';
				node.style.backgroundColor = 'black';

				node.style.left = getTimeXY(marker.seconds).x + 'px';

				node.addEventListener('click', seekToMarker.bind(null, marker));
				node.addEventListener('contextmenu', startEditingMarker.bind(null, marker, true, true));
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
		addUninstallationStep(removeDOMMarkers);
	} else if (isLive()) {
		let cachedDelay = [0, 0];

		/**
		 * Return the number of seconds of delay as reported by Twitch
		 *
		 * @returns {number}
		 */
		async function getLiveDelay(): Promise<number> {
			const now = Date.now();
			if (now - cachedDelay[0] < 60000) return Promise.resolve(cachedDelay[1]);
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
			const delay = [latency, bufferSize]
				.map(e => Number(e.textContent!.split(' ')[0]))
				.reduce((sum, s) => sum + s);

			cachedDelay = [now, delay];
			return delay;
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

	const markerList = generateMarkerList(
		markers,
		getCurrentTimeLive,
		handleMarkerUpdate,
		setTime,
		startEditingMarker,
		seekToMarker
	);
	addUninstallationStep(markerList.uninstallMarkerList);
	markerChangeHandlers.push(markerList.renderMarkerList);

	async function handleMarkerUpdate() {
		for (const func of markerChangeHandlers) await func();
	}

	/**
	 * Add marker to current time
	 */
	const addMarkerHere = async () => {
		let seconds = await getCurrentTimeLive();
		let name = await dialog('prompt', 'Marker Name');
		if (!name) return;

		if (['t+', 't-'].some(cmd => name.toLowerCase().startsWith(cmd))) {
			const direction = name[1] === '+' ? 1 : -1;
			const offset = parseInt(name.substring(2));
			if (!isNaN(offset)) seconds += offset * direction;
			name = name.substring(2 + offset.toString().length).trim();
		}

		markers.push({ seconds, name });
		if (isLive())
			navigator.clipboard.writeText(
				`https://twitch.tv/videos/${await getVideoID(false)}?t=${generateTwitchTimestamp(seconds)}`
			);
		return handleMarkerUpdate();
	};

	/**
	 * Export markers objects into serialized format
	 */
	const exportSerialized = async () => {
		await navigator.clipboard.writeText(getUIFormatter().serializeAll(markers));
		return dialog('alert', 'Exported to Clipboard!');
	};

	/**
	 * Menu for importing or exporting
	 */
	const menu = async () => {
		const choice = await dialog('choose', 'R2 Twitch User-Markers', () => ({
			Export: 'x',
			Edit: 'e',
			List: 'l',
		}));
		if (!choice) return;
		else if (choice === 'x') return exportSerialized();
		else if (choice === 'e') return editAllMarkers();
		else if (choice === 'l') return markerList.setMarkerList(true);
	};

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keydownHandler = (e: KeyboardEvent) => {
		if (['INPUT', 'TEXTAREA'].includes((e.target! as HTMLElement).tagName)) return;
		if (e.key === 'u') menu();
		if (e.key === 'b') addMarkerHere();
	};
	window.addEventListener('keydown', keydownHandler);
	addUninstallationStep(() => window.removeEventListener('keydown', keydownHandler));

	const resizeObserver = new ResizeObserver(handleMarkerUpdate);
	resizeObserver.observe(document.querySelector<HTMLVideoElement>('video')!);
	addUninstallationStep(() =>
		resizeObserver.unobserve(document.querySelector<HTMLVideoElement>('video')!)
	);

	if (markers.length) await handleMarkerUpdate();

	log('Setup Ended');
})();

log('Script Ended');

export {};
