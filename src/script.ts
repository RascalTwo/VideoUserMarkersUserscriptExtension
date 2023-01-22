//
// ==UserScript==
// @name     R2 Video User Markers
// @version  1
// @grant    none
// @match    https://www.twitch.tv/*
// @match    https://www.youtube.com/*
// @run-at   document-start
// @require  https://requirejs.org/docs/release/2.3.6/comments/require.js
// ==/UserScript==
//

import { FORMATTERS, getUIFormatter } from './formatters';
import {
	log,
	delay,
	loadFromLocalStorage,
	saveToLocalStorage,
	createUninstaller,
	ObjectId,
	NOOP,
	getPlatform,
	isDarkMode,
	writeToClipboard,
	deleteFromLocalStorage,
} from './helpers';
import { generateMarkerList as generateMarkerList } from './ui';
import type { Marker } from './types';
import {
	generateToken,
	getCollection,
	getCurrentUser,
	upsertCollection,
} from './backend';
import { createMarkerEditors } from './marker-editors';

declare global {
	interface Window {
		r2_clipboard?: string;
		r2_twitch_user_markers?: {
			uninstall: () => Promise<void>;
		};
	}
}

log('Script Started');

(async function main() {
	// Run uninstall if previously loaded, development only
	await window.r2_twitch_user_markers?.uninstall();

	log('Setup Started');

	const platform = getPlatform();
	if (!platform) {
		log('Unsupported platform');
		return NOOP;
	}

	log('Platform:', platform.name);

	while (document.readyState !== 'complete') {
		await delay(1000);
		log('Waiting for complete document...');
	}

	const { addUninstallationStep, uninstall } = createUninstaller(
		main,
		platform.shouldActivate() ? undefined : platform.shouldActivate.bind(platform)
	);
	addUninstallationStep(platform.clear.bind(platform));
	if (!platform.shouldActivate()) {
		log(`Not Activating`);
		return;
	}

	while (true) {
		await delay(1000);
		if (await platform.isReady()) break;
	}

	// Get last segment of URL, which is the video ID
	let user = await getCurrentUser();
	let otherCollections = await platform.getCollections();
	let { collection: _collection, updatedAt } = await (async () => {
		const {
			formatter,
			rawMarkers,
			collection: foundCollection,
			updatedAt,
		} = await loadFromLocalStorage(await platform.getEntityID());
		if (!(formatter in FORMATTERS)) {
			platform.dialog('alert', `Formatter for saved content does not exist: ${formatter}`);
			return { collection: null, updatedAt: '' };
		}
		const foundMarkers = FORMATTERS[formatter].deserializeAll(rawMarkers || '[]') as Marker[];
		if (foundCollection) {
			if (foundMarkers.length) foundCollection.markers = foundMarkers;
			return { collection: foundCollection, updatedAt };
		}

		const firstOther = otherCollections.find(c => c.author._id !== 'AUTHOR');
		if (firstOther) {
			return { collection: (await getCollection(firstOther._id))!, updatedAt };
		}

		return { collection: await platform.createInitialCollection(foundMarkers, user), updatedAt };
	})();
	const collection = _collection;

	if (collection === null) {
		log('Error loading markers, abandoning');
		return;
	}

	addUninstallationStep(
		await (async () => {
			const ui = document.createElement('details');
			ui.className = 'r2_markers_ui';
			ui.style.margin = '0.5em';
			ui.style.padding = '0.5em';
			ui.style.border = '1px solid ' + (isDarkMode() ? 'white' : 'black');

			const summary = document.createElement('summary');
			const otherCollectionCount = otherCollections.filter(c => c.author._id !== 'AUTHOR' && c.author._id !== user?._id).length
			summary.textContent = `Video User Markers (${otherCollectionCount})`;
			ui.appendChild(summary);

			const wrapper = document.createElement('div');
			wrapper.style.display = 'flex';
			wrapper.style.gap = '0.5em';
			ui.appendChild(wrapper);

			const markersButton = document.createElement('button');
			markersButton.textContent = 'Menu';
			markersButton.className = platform.getButtonClass();
			markersButton.style.flex = '1';
			markersButton.addEventListener('click', () => mainMenu());
			wrapper.appendChild(markersButton);

			const addMarker = document.createElement('button');
			addMarker.textContent = 'Add';
			addMarker.className = platform.getButtonClass();
			addMarker.style.flex = '1';
			addMarker.addEventListener('click', () => addMarkerHere());
			wrapper.appendChild(addMarker);

			await platform.attachMenu(ui);
			return () => ui.remove();
		})()
	);

	const { startEditingMarker, editAllMarkers } = createMarkerEditors(platform, collection, handleMarkerUpdate);

	/**
	 * Get the current time in seconds of the player
	 *
	 * @returns {number}
	 */
	let markerChangeHandlers: ((dataChanged: boolean) => any)[] = [
		dataChanged => {
			if (dataChanged) updatedAt = new Date().toISOString();
		},
		async () => {
			const eid = await platform.getEntityID();
			return loadFromLocalStorage(eid).then(({ formatter }) =>
				saveToLocalStorage(eid, formatter, collection!, updatedAt)
			);
		},
		() => {
			const summary = document.querySelector('.r2_markers_ui')?.querySelector('summary');
			if (!summary) return;

			const otherCollectionCount = otherCollections.filter(c => c.author._id !== 'AUTHOR' && c.author._id !== user?._id).length
			if (collection!.updatedAt !== updatedAt) summary.textContent = `Video User Markers (${otherCollectionCount})*`;
			else summary.textContent = `Video User Markers (${otherCollectionCount})`;
		},
	];

	function seekToMarker(marker: Marker, e: Event) {
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();
		return platform!.seekTo(marker.when);
	}

	const markerList = generateMarkerList(
		collection,
		platform,
		platform.getCurrentTimeLive.bind(platform),
		handleMarkerUpdate,
		platform!.seekTo.bind(platform!),
		startEditingMarker,
		seekToMarker
	);
	addUninstallationStep(markerList.uninstallMarkerList);
	markerChangeHandlers.push(markerList.renderMarkerList);


	async function handleMarkerUpdate(dataChanged: boolean) {
		for (const func of markerChangeHandlers) await func(dataChanged);
	}

	for await (const uninstaller of platform.generateUniqueAttachments(collection!, markerList, handleMarkerUpdate)) {
		addUninstallationStep(uninstaller);
	}

	for await (const markerChangeHandler of platform.generateMarkerChangeHandlers(
		collection!,
		seekToMarker,
		startEditingMarker
	)) {
		markerChangeHandlers.push(markerChangeHandler);
	}

	function clearCollection() {
		deleteFromLocalStorage(collection!.entity._id);
		uninstall().then(main);
	}

	async function seekRelative(change: number, moveCurrentMarker: boolean) {
		let seconds = await platform!.getCurrentTimeLive();
		seconds += change;
		if (moveCurrentMarker) {
			const marker = collection!.markers.filter(m => Math.floor(m.when) <= seconds).slice(-1)[0]
			if (marker) {
				marker.when = seconds;
				await handleMarkerUpdate(true);
			}
		}
		return platform!.seekTo(seconds);
	}

	async function seekRelativeMarker(change: number) {
		const seconds = await platform!.getCurrentTimeLive();
		const marker = collection!.markers.filter(m => Math.floor(m.when) <= seconds).slice(-1)[0]
		if (!marker) return;

		let index = collection!.markers.indexOf(marker);
		index += change;
		if (index < 0) index = 0;
		if (index >= collection!.markers.length) index = collection!.markers.length - 1;
		return platform!.seekTo(collection!.markers[index].when);
	}

	async function updateCurrentMarker(what: 'title' | 'when') {
		const seconds = await platform!.getCurrentTimeLive()
		const marker = collection!.markers.filter(m => Math.floor(m.when) <= seconds).slice(-1)[0]
		return startEditingMarker(marker, what === 'when', what === 'title');
	}

	async function togglePlayState() {
		if (await platform!.isPlaying()) return platform!.pause();
		return platform!.play();
	}

	const { addMarkerHere, mainMenu, showKeyboardShortcuts } = (function createMenus() {
		/**
		 * Add marker to current time
		 */
		const addMarkerHere = async () => {
			const pauseAndResume = !platform.isLive() && await platform.isPlaying();
			if (pauseAndResume) await platform.pause();
			let seconds = await platform.getCurrentTimeLive();
			let name = await platform.dialog('prompt', 'Marker Name');
			if (!name) return pauseAndResume && platform.play();

			if (['t+', 't-'].some(cmd => name.toLowerCase().startsWith(cmd))) {
				const direction = name[1] === '+' ? 1 : -1;
				const offset = parseInt(name.substring(2));
				if (!isNaN(offset)) seconds += offset * direction;
				name = name.substring(2 + offset.toString().length).trim();
			}

			collection!.markers.push({
				_id: ObjectId(),
				collectionRef: collection!._id,
				when: seconds,
				title: name,
				description: '',
			});
			if (platform.isLive()) writeToClipboard(await platform.generateMarkerURL(seconds));
			await handleMarkerUpdate(true);
			return pauseAndResume && platform.play();
		};

		/**
		 * Export markers objects into serialized format
		 */
		const exportToClipboard = async () => {
			await writeToClipboard(getUIFormatter().serializeAll(collection!.markers));
			return platform.dialog('alert', 'Exported to Clipboard!');
		};

		const exportToCloud = async () => {
			if (!collection!.author) collection!.author = user!;
			if (collection!.author?._id !== user!._id) {
				await platform.dialog(
					'choose',
					`Export your own copy of ${collection!.author.username}s collection?`,
					() => ({
						Yes: 'y',
						No: 'n',
					})
				);
				collection!.author = user!;
			}
			const newTitle = await platform.dialog('prompt', 'Collection Title', () => [
				'input',
				collection!.title,
			]);
			if (!newTitle) return;
			collection!.title = newTitle;

			collection!.description = await platform.dialog('prompt', 'Collection Description', () => [
				'textarea',
				collection!.description,
			]);

			const newPublicity = await platform.dialog('choose', 'Collection Publicity', () => ({
				Public: 'public',
				Private: 'private',
			}));
			if (newPublicity === 'public') collection!.public = true;
			else if (newPublicity === 'private' && collection!.public) delete collection!.public;

			const updatedCollection = await upsertCollection(collection!);
			if (!updatedCollection) return;

			Object.assign(collection, updatedCollection);
			updatedAt = collection.updatedAt;

			await handleMarkerUpdate(false);

			return platform.dialog('alert', 'Exported to Cloud!');
		};

		const importMenu = async () => {
			const collectionId = await platform.dialog('choose', 'Import from...', () =>
				otherCollections.reduce((acc, collection) => {
					acc[`${collection.author ? `[${collection.author.username}] ` : ''}${collection.title}`] = collection._id;
					return acc;
				}, {} as Record<string, string>)
			);
			if (!collectionId) return;
			const otherCollection = otherCollections.find(c => c._id === collectionId)!;
			Object.assign(collection, otherCollection.author._id === 'WEBSITE' ? otherCollection : (await getCollection(collectionId))!);
			handleMarkerUpdate(true);
		};

		const importExportMenu = async () => {
			otherCollections = await platform.getCollections();

			if (!otherCollections.length) return exportMenu();

			const choice = await platform.dialog('choose', 'Import/Export', () => ({
				[`Import (${otherCollections.length})`]: 'i',
				Export: 'e',
				Clear: 'c'
			}));
			if (!choice) return;
			if (choice === 'i') return importMenu();
			if (choice === 'e') return exportMenu();
			if (choice === 'c') return clearCollection();
		};

		const exportMenu = async () => {
			if (!user) return exportToClipboard();
			const choice = await platform.dialog('choose', 'Destination', () => ({
				Clipboard: 'b',
				Cloud: 'c',
			}));
			if (!choice) return;
			if (choice === 'b') return exportToClipboard();
			if (choice === 'c') return exportToCloud();
		};

		const login = async () => {
			const username = await platform.dialog('prompt', 'Username');
			if (!username) return;

			const password = await platform.dialog('prompt', 'Password');
			if (!password) return;

			try {
				await generateToken(username, password);
				user = await getCurrentUser();
			} catch (e: any) {
				return platform.dialog('alert', e.toString());
			}
		};

		const showKeyboardShortcuts = async () => {
			await platform.dialog('alert', 'Keyboard Shortcuts:<br/>' + Object.entries({
				'K / Space': 'Pause/Play',
				'S / Ctrl + Left Arrow': 'Seek to next marker',
				'W / Ctrl + Right Arrow': 'Seek to previous marker',
				'J': 'Seek back 10 seconds',
				'L': 'Seek forward 10 seconds',
				'Left Arrow': 'Seek back 5 seconds',
				'Right Arrow': 'Seek forward 5 seconds',
				',': 'Seek back 1 frame',
				'.': 'Seek forward 1 frame',
				'Q': 'Seek back 1 second',
				'E': 'Seek forward 1 second',
				'B': 'Add marker at current time',
				'N': 'Edit marker title',
				'T': 'Edit marker time',
				'U': 'Open menu',
				'Shift + ?': 'Show this dialog',
				'': '',
				'Holding Shift + Any seek key': 'Seek & update current marker',
			}).map(([key, action]) => `${key} -> ${action}`).join('<br/>'));
		}

		/**
		 * Menu for importing or exporting
		 */
		const mainMenu = async () => {
			const choice = await platform.dialog('choose', 'Video User Markers', () => ({
				'Import/Export': 'x',
				Edit: 'e',
				List: 'l',
				[user ? `Logout (${user.username})` : 'Login']: 'a',
				'Keyboard Shortcuts': '?'
			}));
			if (!choice) return;
			else if (choice === 'x') return importExportMenu();
			else if (choice === 'e') return editAllMarkers();
			else if (choice === 'l') return markerList.setMarkerList(true);
			else if (choice === 'a') return user ? (user = null) : login();
			else if (choice === '?') return showKeyboardShortcuts();
		};
		return { addMarkerHere, mainMenu, showKeyboardShortcuts }
	})();

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keypressHandler = async (e: KeyboardEvent) => {
		const target = e.target! as HTMLElement;
		if (e.repeat || ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.getAttribute('role') === 'textbox')
			return;

		const key = e.key.toUpperCase()
		if (key === 'K' || key === ' ') await togglePlayState();
		else if (key === 'W' || (e.ctrlKey && key === 'ARROWLEFT')) await seekRelativeMarker(-1);
		else if (key === 'S' || (e.ctrlKey && key === 'ARROWRIGHT')) await seekRelativeMarker(1);
		else if (key === 'J') await seekRelative(-10, e.shiftKey);
		else if (key === 'L') await seekRelative(10, e.shiftKey);
		else if (key === 'ARROWLEFT') await seekRelative(-5, e.shiftKey);
		else if (key === 'ARROWRIGHT') await seekRelative(5, e.shiftKey);
		else if (key === ',') await seekRelative(-(1 / 30), e.shiftKey);
		else if (key === '.') await seekRelative((1 / 30), e.shiftKey);
		else if (key === 'Q') await seekRelative(-1, e.shiftKey);
		else if (key === 'E') await seekRelative(1, e.shiftKey);
		else if (key === 'B') await addMarkerHere();
		else if (key === 'N') await updateCurrentMarker('title');
		else if (key === 'T') await updateCurrentMarker('when');
		else if (key === 'U') await mainMenu();
		// M key is mute by default
		else if (e.shiftKey && key === '?') await showKeyboardShortcuts();
		else return; // Not a key we care about
		e.preventDefault();
		e.stopImmediatePropagation();
		e.stopPropagation();
	};
	window.addEventListener('keypress', keypressHandler);
	addUninstallationStep(() => window.removeEventListener('keypress', keypressHandler));

	if (collection!.markers.length) await handleMarkerUpdate(false);

	log('Setup Ended');
})().catch(err => log('Error during main', err));

log('Script Ended');

export { };
