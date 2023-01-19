import { getCollections } from './backend';
import { ObjectId } from './helpers';
import { IPlatform, Cacheable, Collection, Marker, User, MarkerlessCollection } from './types';
import { dialog } from './ui';

interface PolymerElement extends HTMLElement {
	get: (key: string) => any;
	set: (key: string, value: any) => void;
}

interface YTDPlayerElement extends PolymerElement {
	getPlayer(): {
		seekTo: (seconds: number) => void;
		getCurrentTime: () => number;
		getVideoData: () => {
			video_id: string;
			isLive: boolean;
			title: string;
		};
		getPlayerState: () => number;
		playVideo: () => void;
		pauseVideo: () => void;
	}
}

export class YouTube extends Cacheable implements IPlatform, Cacheable {
	name: 'Twitch' | 'YouTube';
	private initialCollection: Collection | null;
	constructor() {
		super();
		this.name = 'YouTube';
		this.initialCollection = null;
	}
	async createInitialCollection(foundMarkers: Marker[], currentUser: User | null): Promise<Collection> {
		const now = new Date().toISOString();

		const collectionId = ObjectId();

		let createdAt;
		try {
			createdAt = new Date((document.querySelector('#info-container yt-formatted-string') as PolymerElement)!.get('__data').text.runs[2].text).toISOString()
		} catch (_) {}

		const foundInitialCollection = {
			_id: collectionId,
			entity: {
				_id: await this.getEntityID(),
				type: this.name,
				thumbnail: `https://img.youtube.com/vi/${await this.getEntityID()}/maxresdefault.jpg`,
				rawThumbnail: `https://img.youtube.com/vi/${await this.getEntityID()}/maxresdefault.jpg`,
				createdAt,
			},
			author: { _id: 'WEBSITE', username: 'YouTube Video Author' },
			title: this.getYTPlayerElement()!.getPlayer().getVideoData().title,
			description: '',
			markers: this.getDescriptionChaptersMarkerMap(this.getYTPlayerElement()!.get('watchNextData'))?.chapters.map((chapter: any) => ({
				_id: ObjectId(),
				collectionId,
				when: chapter.chapterRenderer.timeRangeStartMillis / 1000,
				title: chapter.chapterRenderer.title.simpleText,
				description: ''
			})) ?? [],
			createdAt: now,
			updatedAt: now,
		} as Collection;

		if (foundInitialCollection.markers.length) {
			this.initialCollection = foundInitialCollection;
		}

		return foundMarkers.length ? {
			_id: collectionId,
			entity: {
				_id: await this.getEntityID(),
				type: this.name,
				thumbnail: `https://img.youtube.com/vi/${await this.getEntityID()}/maxresdefault.jpg`,
				createdAt: new Date((document.querySelector('#info-container yt-formatted-string') as PolymerElement)!.get('__data').text.runs[2].text).toISOString(),
			},
			author: currentUser,
			title: this.getYTPlayerElement()!.getPlayer().getVideoData().title,
			description: '',
			markers: foundMarkers,
			createdAt: now,
			updatedAt: now,
		} as Collection : foundInitialCollection;
	}
	dialog(
		type: 'alert' | 'prompt' | 'choose',
		message: string,
		sideEffect?: ((form: HTMLFormElement) => any) | undefined
	): Promise<any> {
		return dialog(this.getButtonClass(), type, message, sideEffect);
	}
	getButtonClass(): string {
		return document.querySelector('#flexible-item-buttons button')!.className;
	}
	isLive(): boolean {
		return !!this.getYTPlayerElement()?.getPlayer().getVideoData().isLive;
	}
	shouldActivate(): boolean {
		return window.location.pathname.startsWith('/watch');
	}

	getYTPlayerElement() {
		return document.querySelector('#ytd-player') as YTDPlayerElement | null;
	}

	getDescriptionChaptersMarkerMap(watchNextData: any) {
		return watchNextData?.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap?.find((map: any) => map.key === 'DESCRIPTION_CHAPTERS')?.value;
	}

	async isReady(): Promise<boolean> {
		return !!this.getYTPlayerElement()?.getPlayer();
	}
	async attachMenu(details: HTMLDetailsElement): Promise<void> {
		const subscribeButton = document.querySelector('#subscribe-button')!;
		subscribeButton.parentElement?.insertBefore(details, subscribeButton.nextSibling);
	}
	async seekTo(seconds: number): Promise<void> {
		this.getYTPlayerElement()?.getPlayer().seekTo(seconds);
	}
	async *generateUniqueAttachments(): AsyncGenerator<() => void | Promise<void>, any, unknown> { }
	async *generateMarkerChangeHandlers(
		collection: Collection,
	): AsyncGenerator<() => void, any, unknown> {
		yield () => {
			const watchNextData = JSON.parse(JSON.stringify(this.getYTPlayerElement()!.get('watchNextData')));
			let markersMap = this.getDescriptionChaptersMarkerMap(watchNextData);
			if (!markersMap) {
				const otherMarkersMap = watchNextData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap?.filter((map: any) => map.key !== 'DESCRIPTION_CHAPTERS') || [];
				const dpbr = {
					decoratedPlayerBarRenderer: {
						playerBar: {
							multiMarkersPlayerBarRenderer: {
								markersMap: [
									{
										key: 'DESCRIPTION_CHAPTERS',
										value: {
											chapters: [],
											trackingParams: '',
										}
									},
									...otherMarkersMap
								],
								visibleOnLoad: {
									key: 'DESCRIPTION_CHAPTERS',
								},
							}
						}
					}
				};
				watchNextData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer = dpbr;
				markersMap = this.getDescriptionChaptersMarkerMap(watchNextData);
			}
			const chapters = markersMap.chapters;
			const clickTrackingParams = markersMap.trackingParams;
			chapters.splice(0, chapters.length);
			const chapterMarkers = collection.markers.map((marker, i) => ({
				chapterRenderer: {
					onActiveCommand: {
						clickTrackingParams,
						setActivePanelItemAction: {
							itemIndex: i,
							panelTargetId: 'engagement-panel-macro-markers-description-chapters',
						}
					},
					timeRangeStartMillis: Math.floor(marker.when * 1000),
					title: {
						simpleText: marker.title
					}
				}
			}))
			chapters.push(...chapterMarkers.slice(0, -1))
			if (chapterMarkers.length === 0) {
				chapters.push({
					chapterRenderer: {
						onActiveCommand: {
							clickTrackingParams,
							setActivePanelItemAction: {
								itemIndex: 0,
								panelTargetId: 'engagement-panel-macro-markers-description-chapters',
							}
						},
						timeRangeStartMillis: 0,
						title: {
							simpleText: ' '
						}
					}
				})
			}
			if (chapterMarkers.length === 1) {
				chapters.push({
					chapterRenderer: {
						onActiveCommand: {
							clickTrackingParams,
							setActivePanelItemAction: {
								itemIndex: 1,
								panelTargetId: 'engagement-panel-macro-markers-description-chapters',
							}
						},
						timeRangeStartMillis: 1000,
						title: {
							simpleText: ' '
						}
					}
				})
			}
			this.getYTPlayerElement()!.set('watchNextData', watchNextData);
			if (chapterMarkers.length) setTimeout(() => {
				const watchNextData = JSON.parse(JSON.stringify(this.getYTPlayerElement()!.get('watchNextData')));
				const markersMap = this.getDescriptionChaptersMarkerMap(watchNextData);
				const chapters = markersMap.chapters;
				chapters.push(chapterMarkers.at(-1));
				this.getYTPlayerElement()!.set('watchNextData', watchNextData);
			}, 100);
		};
	}
	async getCurrentTimeLive(): Promise<number> {
		return this.getYTPlayerElement()!.getPlayer().getCurrentTime();
	}
	async generateMarkerURL(seconds: number): Promise<string> {
		return `https://youtu.be/${await this.getEntityID()}?t=${seconds}`;
	}
	async getEntityID() {
		if (this.cache.has('entityID')) return this.cache.get('entityID')!;
		const eid = this.getYTPlayerElement()!.getPlayer().getVideoData().video_id;
		this.cache.set('entityID', eid);
		return eid;
	}

	async getCollections(): Promise<MarkerlessCollection[]> {
		return [
			...(this.initialCollection ? [this.initialCollection] : []),
			...await getCollections(this.name, await this.getEntityID())
		];
	}

	async play() {
		return this.getYTPlayerElement()!.getPlayer().playVideo();
	}

	async pause() {
		return this.getYTPlayerElement()!.getPlayer().pauseVideo();
	}

	async isPlaying() {
		return this.getYTPlayerElement()!.getPlayer().getPlayerState() !== 1;
	}
}
