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
