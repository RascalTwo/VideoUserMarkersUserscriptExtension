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
} from './helpers';
import { generateMarkerList as generateMarkerList } from './ui';
import type { Marker } from './types';
import {
	generateToken,
	getCollection,
	getCurrentUser,
	upsertCollection,
} from './backend';

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

	platform.shouldActivate();
	const addUninstallationStep = createUninstaller(
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
		const initialCollection = await platform.createInitialCollection(foundMarkers, user)
		const collection = foundCollection ?? initialCollection;
		if (foundMarkers.length) collection.markers = foundMarkers;
		if (!collection.markers?.length) collection.markers = foundMarkers
		return { collection, updatedAt };
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
			summary.textContent = 'R2 Markers';
			ui.appendChild(summary);

			const wrapper = document.createElement('div');
			wrapper.style.display = 'flex';
			wrapper.style.gap = '0.5em';
			ui.appendChild(wrapper);

			const markersButton = document.createElement('button');
			markersButton.textContent = 'Menu';
			markersButton.className = platform.getButtonClass();
			markersButton.style.flex = '1';
			markersButton.addEventListener('click', () => menu());
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

	function seekToMarker(marker: Marker, e: Event) {
		// Stop native seekbar behavior
		e?.stopImmediatePropagation();
		e?.stopPropagation();
		return platform!.seekTo(marker.when);
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
		const response = await platform!.dialog('prompt', 'Edit Time:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeSeconds(marker.when),
		]);
		if (response === null) return;

		const seconds = formatter.deserializeSeconds(response);
		if (!seconds) return;

		marker.when = seconds;
		return handleMarkerUpdate(true);
	}

	async function editMarkerName(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Name:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeName(marker.title),
		]);
		if (response === null) return;

		const name = formatter.deserializeName(response);
		if (!name) return;

		marker.title = name;
		return handleMarkerUpdate(true);
	}

	async function editMarker(marker: Marker) {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Marker:', () => [
			formatter.multiline ? 'textarea' : 'input',
			formatter.serializeAll([marker])[0],
		]);
		if (response === null) return;

		const edited = formatter.deserializeAll(response)[0];
		if (!edited) return;

		Object.assign(marker, edited, { _id: marker._id, collectionId: marker.collectionId });
		return handleMarkerUpdate(true);
	}

	async function editAllMarkers() {
		const formatter = getUIFormatter();
		const response = await platform!.dialog('prompt', 'Edit Serialized Markers', () => [
			'textarea',
			formatter.serializeAll(collection!.markers!),
		]);
		if (response === null) return;
		collection!.markers!.splice(
			0,
			collection!.markers!.length,
			...(formatter.deserializeAll(response) as Marker[]).map((newMarker, i) => ({
				...newMarker,
				_id: collection!.markers![i]?._id || ObjectId(),
				collectionId: collection!.markers![i]?.collectionId || collection!._id,
			}))
		);
		return handleMarkerUpdate(true);
	}

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

			if (collection!.updatedAt !== updatedAt) summary.textContent = `Video User Markers *`;
			else summary.textContent = `Video User Markers`;
		},
	];

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

	const writeToClipboard = (text: string) => {
		return navigator.clipboard.writeText(text).then(() => {
			window.r2_clipboard = text;
		});
	};

	/**
	 * Add marker to current time
	 */
	const addMarkerHere = async () => {
		let seconds = await platform.getCurrentTimeLive();
		let name = await platform.dialog('prompt', 'Marker Name');
		if (!name) return;

		if (['t+', 't-'].some(cmd => name.toLowerCase().startsWith(cmd))) {
			const direction = name[1] === '+' ? 1 : -1;
			const offset = parseInt(name.substring(2));
			if (!isNaN(offset)) seconds += offset * direction;
			name = name.substring(2 + offset.toString().length).trim();
		}

		collection!.markers.push({
			_id: ObjectId(),
			collectionId: collection!._id,
			when: seconds,
			title: name,
			description: '',
		});
		if (platform.isLive()) writeToClipboard(await platform.generateMarkerURL(seconds));
		return handleMarkerUpdate(true);
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

		const newDescription = await platform.dialog('prompt', 'Collection Description', () => [
			'textarea',
			collection!.description,
		]);
		if (!newDescription) return;
		collection!.description = newDescription;

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
		}));
		if (!choice) return;
		if (choice === 'i') return importMenu();
		if (choice === 'e') return exportMenu();
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

	/**
	 * Menu for importing or exporting
	 */
	const menu = async () => {
		const choice = await platform.dialog('choose', 'R2 Twitch User-Markers', () => ({
			'Import/Export': 'x',
			Edit: 'e',
			List: 'l',
			[user ? `Logout (${user.username})` : 'Login']: 'a',
		}));
		if (!choice) return;
		else if (choice === 'x') return importExportMenu();
		else if (choice === 'e') return editAllMarkers();
		else if (choice === 'l') return markerList.setMarkerList(true);
		else if (choice === 'a') return user ? (user = null) : login();
	};

	/**
	 * Handle keyboard shortcuts
	 *
	 * @param {KeyboardEvent} e
	 */
	const keypressHandler = (e: KeyboardEvent) => {
		const target = e.target! as HTMLElement;
		if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.getAttribute('role') === 'textbox')
			return;
		if (e.key === 'u') menu();
		if (e.key === 'b') addMarkerHere();
	};
	window.addEventListener('keypress', keypressHandler);
	addUninstallationStep(() => window.removeEventListener('keypress', keypressHandler));

	if (collection!.markers.length) await handleMarkerUpdate(false);

	log('Setup Ended');
})().catch(err => log('Error during main', err));

log('Script Ended');

export {};
