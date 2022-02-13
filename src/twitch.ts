import {
	clickNodes,
	delay,
	DHMStoSeconds,
	log,
	ObjectId,
	secondsToDHMS,
	trackDelay,
} from './helpers';
import { Collection, Marker, IPlatform, Cacheable, User } from './types';
import { dialog, generateMarkerList } from './ui';

const GQL_HEADERS = {
	// cspell:disable-next-line
	'client-id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
};

/**
 * If the page is a VOD
 *
 * @returns {boolean}
 */
export function isVOD() {
	return window.location.pathname.startsWith('/videos');
}

export function generateTwitchTimestamp(seconds: number) {
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

export class Twitch extends Cacheable implements IPlatform {
	static TOP_BAR_SELECTOR = '[class="channel-info-content"] [class*="metadata-layout__"]';
	cachedDelay: number[];
	name: 'Twitch' | 'YouTube';
	constructor() {
		super();
		this.cachedDelay = [0, 0];
		this.name = 'Twitch';
	}
	async createInitialCollection(
		foundMarkers: Marker[],
		currentUser: User | null
	): Promise<Collection> {
		const now = new Date().toISOString();

		return {
			_id: ObjectId(),
			videoId: await this.getEntityID(),
			type: this.name,
			author: currentUser,
			// TODO - get title of stream/video
			title: document.title,
			description: '',
			markers: foundMarkers,
			createdAt: now,
			updatedAt: now,
		} as Collection;
	}
	dialog(
		type: 'alert' | 'prompt' | 'choose',
		message: string,
		sideEffect?: ((form: HTMLFormElement) => any) | undefined
	): Promise<any> {
		return dialog(this.getButtonClass(), type, message, sideEffect);
	}

	/**
	 * Get CSS class of twitch buttons
	 *
	 * @returns {string}
	 */
	getButtonClass(): string {
		return (
			document.querySelector('[data-a-target="top-nav-get-bits-button"]')?.className ??
			document.querySelector('[data-a-target="login-button"]')?.className ??
			''
		);
	}
	isLive(): boolean {
		const parts = window.location.pathname.split('/').slice(1);
		// @ts-ignore
		if (!parts.length === 1 && !!parts[0]) return false;
		return !!document.querySelector('.user-avatar-card__live');
	}

	/**
	 * Get the username/loginName of the current page
	 *
	 * @returns {string}
	 */
	getLoginName() {
		return this.isLive()
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
	 * Get the ID of the page user
	 *
	 * @returns {number}
	 */
	async getUserID() {
		if (this.cache.has('userID')) return this.cache.get('userID');

		// TODO - optimize GQL query
		return fetch('https://gql.twitch.tv/gql', {
			headers: GQL_HEADERS,
			body: `{"query":"query($login: String!, $skip: Boolean!) {\\n\\t\\t\\t\\tuser(login: $login) {\\n\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\tlanguage\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\tdescription\\n\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\tfollowers {\\n\\t\\t\\t\\t\\t\\ttotalCount\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\tlastBroadcast {\\n\\t\\t\\t\\t\\t\\tstartedAt\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprimaryTeam {\\n\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprofileImageURL(width: 70)\\n\\t\\t\\t\\t\\tprofileViewCount\\n\\t\\t\\t\\t\\tself @skip(if: $skip) {\\n\\t\\t\\t\\t\\t\\tcanFollow\\n\\t\\t\\t\\t\\t\\tfollower {\\n\\t\\t\\t\\t\\t\\t\\tdisableNotifications\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}\\n\\t\\t\\t}","variables":{"login":"${this.getLoginName()}","skip":false}}`,
			method: 'POST',
		})
			.then(r => r.json())
			.then(json => {
				const userID = json.data.user.id;
				this.cache.set('userID', userID);
				log('GQL User ID:', userID);
				return userID;
			});
	}
	shouldActivate(): boolean {
		return isVOD() || this.isLive();
	}
	async getEntityID(): Promise<string> {
		// Get VID from URL if VOD
		if (isVOD()) {
			return window.location.href.split('/').slice(-1)[0].split('?')[0];
		}
		if (this.cache.has('vid')) return this.cache.get('vid');

		// TODO - optimize GQL query
		return this.getUserID()
			.then(uid =>
				fetch('https://gql.twitch.tv/gql', {
					headers: GQL_HEADERS,
					body: `{"query":"query($id: ID!, $all: Boolean!) {\\n\\t\\t\\t\\t\\tuser(id: $id) {\\n\\t\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\t\\tgame {\\n\\t\\t\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\ttitle\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\tlogin\\n\\t\\t\\t\\t\\t\\tstream {\\n\\t\\t\\t\\t\\t\\t\\tarchiveVideo @include(if: $all) {\\n\\t\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\ttype\\n\\t\\t\\t\\t\\t\\t\\tviewersCount\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}","variables":{"id":"${uid}","all":true}}`,
					method: 'POST',
				})
			)
			.then(r => r.json())
			.then(json => {
				log('TODO: get stream ID and use that if there is no VOD ID', json.data.user.stream);
				const vid = json.data.user.stream.archiveVideo?.id ?? null;
				this.cache.set('vid', vid);
				log('GQL VOD ID:', vid);
				return vid;
			});
	}

	async isReady() {
		if (!document.querySelector('.video-ref [data-a-target="player-volume-slider"]')) {
			log('Waiting for Volume...');
			return false;
		}
		if (!document.querySelector(Twitch.TOP_BAR_SELECTOR)) {
			log('Waiting for Video Info Bar...');
			return false;
		}
		if (document.querySelector('.video-ref [data-a-target="video-ad-countdown"]')) {
			log('Waiting for Advertisement...');
			await delay(5000);
			return false;
		}
		if (this.isLive()) return true;
		if (isVOD() && document.querySelector('.video-ref .seekbar-bar')) return true;

		log('Waiting for player...');
		return false;
	}

	async attachMenu(details: HTMLDetailsElement) {
		document.querySelector(Twitch.TOP_BAR_SELECTOR + ' > div:last-of-type')!.appendChild(details);
	}

	/**
	 * Get X and Y of the seconds provided
	 *
	 * @param {number} seconds
	 * @returns {{ x: number, y: number, minX: number, maxX: number }}
	 */
	getTimeXY(seconds: number) {
		const bar = document.querySelector('.video-ref .seekbar-bar')!;

		const rect = bar.getBoundingClientRect();
		const minX = rect.left;
		const maxX = rect.right;

		const duration = Number(
			document.querySelector<HTMLElement>('.video-ref [data-a-target="player-seekbar-duration"]')!
				.dataset.aValue
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
	async seekTo(seconds: number) {
		const bar = document.querySelector<HTMLElement>('.video-ref [data-a-target="player-seekbar"]')!;
		Object.entries(bar.parentNode!)
			.find(([key]) => key.startsWith('__reactEventHandlers'))![1]
			.children[2].props.onThumbLocationChange(seconds);
	}

	/**
	 * Remove marker DOM elements, done before rendering and uninstall
	 */
	removeDOMMarkers() {
		document.querySelectorAll('.video-ref .r2_marker').forEach(e => e.remove());
	}

	async *generateMarkerChangeHandlers(
		collection: Collection,
		seekToMarker: (marker: Marker, e: Event) => Promise<void>,
		startEditingMarker: (marker: Marker, seconds: boolean, name: boolean, e: Event) => Promise<void>
	) {
		yield () => {
			this.removeDOMMarkers();
			const bar = document.querySelector<HTMLElement>('.video-ref .seekbar-bar')!;
			for (const marker of collection!.markers) {
				const node = document.createElement('button');
				node.className = 'r2_marker';
				node.title = marker.title;
				node.style.position = 'absolute';
				node.style.width = '1.75px';
				node.style.height = '10px';
				node.style.backgroundColor = 'black';

				node.style.left = this.getTimeXY(marker.when).x + 'px';

				node.addEventListener('click', seekToMarker.bind(null, marker));
				node.addEventListener('contextmenu', startEditingMarker.bind(null, marker, true, true));
				bar.appendChild(node);
			}
		};
	}

	async *generateUniqueAttachments(
		collection: Collection,
		markerList: ReturnType<typeof generateMarkerList>
	) {
		yield (() => {
			const markerName = document.createElement('a') as HTMLAnchorElement;
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

					this.seekTo(Number(markerName.dataset.seconds));
				});
			}
			markerName.addEventListener('contextmenu', e => {
				// Stop context menu
				e.preventDefault();
				markerList.setMarkerList(true);
			});

			document
				.querySelector<HTMLElement>('.video-ref [data-a-target="player-volume-slider"]')!
				.parentNode!.parentNode!.parentNode!.parentNode!.appendChild(markerName);

			const markerTitleInterval = setInterval(async () => {
				if (markerName.dataset.controlled) return;

				let marker;
				if (isVOD()) {
					const now = await this.getCurrentTimeLive();
					marker = collection!.markers.filter(m => Math.floor(m.when) <= now).slice(-1)[0];
				} else {
					marker = collection!.markers[collection!.markers.length - 1];
				}
				if (!marker)
					marker = {
						title: '',
						when: -1,
					};

				markerName.textContent = marker.title;
				markerName.dataset.seconds = marker.when.toString();
			}, 1000);

			return () => {
				clearInterval(markerTitleInterval);
				markerName.remove();
			};
		})();

		if (isVOD()) {
			yield (() => {
				const xToSeconds = (x: number) => {
					const rect = bar.getBoundingClientRect();
					const percentage = x / rect.width;
					const duration = Number(
						document.querySelector<HTMLElement>(
							'.video-ref [data-a-target="player-seekbar-duration"]'
						)!.dataset.aValue
					);
					const seconds = duration * percentage;
					return seconds;
				};
				const handleMouseOver = (e: MouseEvent) => {
					if (e.target === bar) return;
					const markerName = document.querySelector<HTMLElement>('.video-ref .r2_current_marker')!;
					markerName.dataset.controlled = 'true';

					// @ts-ignore
					const seconds = xToSeconds(e.layerX);

					const marker =
						collection!.markers.filter(m => Math.floor(m.when) <= seconds).slice(-1)[0] ?? null;

					if (!marker || markerName.dataset.seconds === marker.when.toString()) return;
					markerName.textContent = marker.title;
					markerName.dataset.seconds = marker.when.toString();
				};

				const handleMouseLeave = () => {
					document.querySelector<HTMLElement>('.video-ref .r2_current_marker')!.dataset.controlled =
						'';
				};

				const bar = document.querySelector('.video-ref .seekbar-bar')!.parentNode! as HTMLElement;
				bar.addEventListener('mouseover', handleMouseOver);
				bar.addEventListener('mouseleave', handleMouseLeave);
				return () => {
					bar.removeEventListener('mouseover', handleMouseOver);
					bar.removeEventListener('mouseleave', handleMouseLeave);
				};
			})();
			yield (() => {
				const handleWheel = async (e: WheelEvent) => {
					e.preventDefault();
					const change = Math.min(Math.max(e.deltaY, -1), 1);
					await this.seekTo((await this.getCurrentTimeLive()) + change);
				};
				const bar = document.querySelector('.video-ref .seekbar-bar')!.parentNode as HTMLElement;
				bar.addEventListener('wheel', handleWheel);
				return () => {
					bar.removeEventListener('wheel', handleWheel);
				};
			})();

			yield this.removeDOMMarkers;
		}
	}

	/**
	 * Return the number of seconds of delay as reported by Twitch
	 *
	 * @returns {number}
	 */
	async getLiveDelay(): Promise<number> {
		const now = Date.now();
		if (now - this.cachedDelay[0] < 60000) return Promise.resolve(this.cachedDelay[1]);
		const latency = document.querySelector('.video-ref [aria-label="Latency To Broadcaster"]');
		const bufferSize = document.querySelector('.video-ref [aria-label="Buffer Size"]');
		if (!latency || !bufferSize) {
			// Settings Gear -> Advanced -> Video Stats Toggle
			await clickNodes(
				'[data-a-target="player-settings-button"]',
				'[data-a-target="player-settings-menu-item-advanced"]',
				'[data-a-target="player-settings-submenu-advanced-video-stats"] input'
			);
			return this.getLiveDelay();
		}

		// Video Stats Toggle -> Settings Gear
		clickNodes(
			'[data-a-target="player-settings-submenu-advanced-video-stats"] input',
			'[data-a-target="player-settings-button"]'
		);
		const delay = [latency, bufferSize]
			.map(e => Number(e.textContent!.split(' ')[0]))
			.reduce((sum, s) => sum + s);

		this.cachedDelay = [now, delay];
		return delay;
	}

	// Pull current time from DHMS display, it's always accurate in VODs
	async getCurrentTimeLive() {
		if (isVOD())
			return DHMStoSeconds(
				document
					.querySelector<HTMLElement>('.video-ref [data-a-target="player-seekbar-current-time"]')!
					.textContent!.split(':')
					.map(Number)
			);

		const { delay, response: secondsDelay } = await trackDelay(async () => this.getLiveDelay());
		const currentTime = DHMStoSeconds(
			document.querySelector<HTMLElement>('.live-time')!.textContent!.split(':').map(Number)
		);
		const actualTime = currentTime - secondsDelay - delay / 1000;
		return actualTime;
	}

	async generateMarkerURL(seconds: number): Promise<string> {
		return `https://twitch.tv/videos/${await this.getEntityID()}?t=${generateTwitchTimestamp(
			seconds
		)}`;
	}
}
