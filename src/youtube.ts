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
	};
}

export class YouTube extends Cacheable implements IPlatform, Cacheable {
	name: 'Twitch' | 'YouTube';
	constructor() {
		super();
		this.name = 'YouTube';
	}
	async createInitialCollection(foundMarkers: Marker[], currentUser: User): Promise<Collection> {
		const now = new Date().toISOString();

		return {
			_id: ObjectId(),
			videoId: await this.getEntityID(),
			type: this.name,
			author: currentUser,
			title: this.getYTPlayerElement()!.getPlayer().getVideoData().title,
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
	getButtonClass(): string {
		return document.querySelector('#subscribe-button button')!.className;
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
		return !!this.getYTPlayerElement();
	}
	async attachMenu(details: HTMLDetailsElement): Promise<void> {
		const subscribeButton = document.querySelector('#subscribe-button')!;
		subscribeButton.parentElement?.insertBefore(details, subscribeButton.nextSibling);
	}
	async seekTo(seconds: number): Promise<void> {
		this.getYTPlayerElement()?.getPlayer().seekTo(seconds);
	}
	async *generateUniqueAttachments(): AsyncGenerator<() => void | Promise<void>, any, unknown> {}
	async *generateMarkerChangeHandlers(): AsyncGenerator<() => void, any, unknown> {}
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
