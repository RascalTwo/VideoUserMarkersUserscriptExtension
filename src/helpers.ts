import { FORMATTERS } from './formatters';
import { Twitch } from './twitch';
import { Cacheable, Collection, IPlatform } from './types';
import { YouTube } from './youtube';

export function log(...args: any) {
	console.log('[R2 Twitch User-Markers]', ...args);
}

/**
 * Do nothing
 */
export function NOOP() {}

export function isDarkMode(){
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemedStyles(styles: CSSStyleDeclaration, isDark = isDarkMode()){
	Object.assign(styles, isDark ? {
		backgroundColor: '#18181b',
		color: 'white',
	} : {
		backgroundColor: 'white',
		color: '#18181b',
	});
}

/**
 * Get the Pixel width of the `ch` unit
 *
 * @returns {number}
 */
export function chToPx() {
	const node = document.createElement('div');
	node.style.position = 'absolute';
	node.textContent = 'M';

	document.body.appendChild(node);
	const width = node.offsetWidth;
	node.remove();
	return width;
}

/**
 * Delay execution by {@link ms milliseconds}
 *
 * @param {number} ms
 */
export function delay(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}

/**
 * Click nodes one by one in {@link queries}, waiting until they are in the DOM one by one
 *
 *
 * @param  {...any} queries queries of nodes to click
 */
export async function clickNodes(...queries: string[]) {
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
 * Convert DHMS to seconds, each part is optional except seconds
 *
 * @param {number[]} parts DHMS numeric parts
 * @returns {number} seconds
 */
export function DHMStoSeconds(parts: number[]) {
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
export function secondsToDHMS(seconds: number, minimalPlaces = 1) {
	// TODO - fix this rushed math
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds - days * 86400) / 3600);
	const minutes = Math.floor((seconds % (60 * 60)) / 60);
	const parts = [days, hours, minutes, Math.floor(seconds % 60)];
	while (!parts[0] && parts.length > minimalPlaces) parts.shift();
	return parts.map(num => num.toString().padStart(2, '0')).join(':');
}

/**
 * Track the delay of a promise
 *
 * @param {Promise<T>} promise promise to track delay of
 * @returns {{ delay: number, response: T }}
 */
export async function trackDelay<T>(
	promise: () => Promise<T>
): Promise<{ delay: number; response: T }> {
	const requested = Date.now();
	const response = await promise();
	return { delay: Date.now() - requested, response };
}

export function attachEscapeHandler(action: () => void, check = () => true) {
	const handler = (e: KeyboardEvent) => {
		if (e.key !== 'Escape' || !check()) return;

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

export async function loadFromLocalStorage(entityID: string): Promise<{
	formatter: keyof typeof FORMATTERS;
	rawMarkers: string;
	collection?: Collection;
	updatedAt: string;
}> {
	return JSON.parse(
		localStorage.getItem('r2_twitch_user_markers_v2_' + entityID) ??
			JSON.stringify({ formatter: 'json', rawMarkers: '[]', updatedAt: new Date().toISOString() })
	);
}

export async function saveToLocalStorage(
	entityID: string,
	formatter: keyof typeof FORMATTERS,
	{ markers, ...collection }: Collection,
	updatedAt: string
) {
	localStorage.setItem(
		'r2_twitch_user_markers_v2_' + entityID,
		JSON.stringify({
			formatter,
			rawMarkers: FORMATTERS[formatter].serializeAll(markers),
			collection,
			updatedAt,
		})
	);
}

const urlsHaveChanged = (oldURL: string, newURL: string, ...ignoredSearchParams: string[]) => {
	const oldURLSearchParams = new URLSearchParams(oldURL.split('?')[1]);
	const newURLSearchParams = new URLSearchParams(newURL.split('?')[1]);
	for (const ignoredParam of ignoredSearchParams) {
		oldURLSearchParams.delete(ignoredParam);
		newURLSearchParams.delete(ignoredParam);
	}
	return oldURL.split('?')[0] !== newURL.split('?')[0] || oldURLSearchParams.toString() !== newURLSearchParams.toString();
}

export function createUninstaller(reinstall: () => void, shouldReinstall?: () => boolean) {
	const uninstallFuncs: (() => Promise<void> | void)[] = [
		(function reinstallOnChange(shouldReinstall = () => false) {
			const url = window.location.href;
			const interval = setInterval(() => {
				if (shouldReinstall() || urlsHaveChanged(window.location.href, url, 'index', 'list')) {
					clearInterval(interval);
					uninstall().then(reinstall);
				}
			}, 1000);
			return () => clearInterval(interval);
		})(shouldReinstall),
	];

	async function uninstall() {
		log('Uninstalling...');
		for (const func of uninstallFuncs) await func();
		log('Uninstalled');
	}
	window.r2_twitch_user_markers = { uninstall };

	function addUninstallationStep(step: () => Promise<void> | void) {
		uninstallFuncs.push(step);
	}

	return addUninstallationStep;
}

const timestampToHex = (timestamp: number) => Math.floor(timestamp).toString(16);

export const ObjectId = (when: number = Date.now()) => {
	return (
		timestampToHex(when / 1000) +
		' '.repeat(16).replace(/./g, () => timestampToHex(Math.random() * 16))
	);
};



export function getPlatform(): (IPlatform & Cacheable) | null {
	if (window.location.hostname === 'www.twitch.tv') return new Twitch();
	if (window.location.hostname === 'www.youtube.com') return new YouTube();
	return null;
}
