import { ObjectId } from './helpers';
import { IPlatform, Cacheable, Collection, Marker, User } from './types';
import { dialog } from './ui';

interface YTDPlayerElement extends HTMLElement {
	getPlayer(): {
		seekTo: (seconds: number) => void;
		getCurrentTime: () => number;
		getVideoData: () => {
			video_id: string;
			isLive: boolean;
			title: string;
		};
	},
	get: (key: string) => any;
	set: (key: string, value: any) => void;
}

export class YouTube extends Cacheable implements IPlatform, Cacheable {
	name: 'Twitch' | 'YouTube';
	constructor() {
		super();
		this.name = 'YouTube';
	}
	async createInitialCollection(foundMarkers: Marker[], currentUser: User): Promise<Collection> {
		const now = new Date().toISOString();

		const collectionId = ObjectId();

		const markers = foundMarkers.length ? foundMarkers : this.getYTPlayerElement()!.get('watchNextData').playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value.chapters.map((chapter: any) => ({
			_id: ObjectId(),
			collectionId,
			when: chapter.chapterRenderer.timeRangeStartMillis / 1000,
			title: chapter.chapterRenderer.title.simpleText,
			description: ''
		})) ?? [];

		return {
			_id: collectionId,
			videoId: await this.getEntityID(),
			type: this.name,
			author: currentUser,
			title: this.getYTPlayerElement()!.getPlayer().getVideoData().title,
			description: '',
			markers,
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
			let markersMap = watchNextData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value;
			if (!markersMap) {
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
									}
								],
								visibleOnLoad: {
									key: 'DESCRIPTION_CHAPTERS',
								},
							}
						}
					}
				};
				watchNextData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer = dpbr;
				markersMap = dpbr.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value;
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
				const markersMap = watchNextData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value;
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
}
