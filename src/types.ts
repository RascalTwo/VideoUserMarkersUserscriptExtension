import { dialog, generateMarkerList } from './ui';

export interface Marker {
	_id: string;
	collectionId: string;
	when: number;
	title: string;
	description: string;
}

export interface User {
	_id: string;
	username: string;
	password: string;
	token: string;
}

export interface Collection {
	_id: string;
	videoId: string;
	type: 'YouTube' | 'Twitch';
	author: User;
	title: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	public?: boolean;
	markers: Marker[];
}

export interface IPlatform {
	name: 'Twitch' | 'YouTube';
	isReady(): Promise<boolean>;
	attachMenu(details: HTMLDetailsElement): Promise<void>;
	seekTo(seconds: number): Promise<void>;
	generateUniqueAttachments(
		collection: Collection,
		markerList: ReturnType<typeof generateMarkerList>,
		handleMarkerUpdate: (dataChanged: boolean) => Promise<void>
	): AsyncGenerator<() => void | Promise<void>>;
	generateMarkerChangeHandlers(
		collection: Collection,
		seekToMarker: (marker: Marker, e: Event) => Promise<void>,
		startEditingMarker: (marker: Marker, seconds: boolean, name: boolean, e: Event) => Promise<void>
	): AsyncGenerator<() => void>;
	getCurrentTimeLive(): Promise<number>;
	generateMarkerURL(seconds: number): Promise<string>;
	getEntityID(): Promise<string>;
	shouldActivate(): boolean;
	getButtonClass(): string;
	isLive(): boolean;
	dialog(...args: ParametersExceptFirst<typeof dialog>): ReturnType<typeof dialog>;
	createInitialCollection(foundMarkers: Marker[], currentUser: User | null): Promise<Collection>;
}

export type ParametersExceptFirst<F> = F extends (arg0: any, ...rest: infer R) => any ? R : never;

export class Cacheable {
	cache: Map<string, any>;
	constructor() {
		this.cache = new Map();
	}

	clear() {
		this.cache.clear();
	}
}
