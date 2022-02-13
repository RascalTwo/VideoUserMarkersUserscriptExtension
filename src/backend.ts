import { BACKEND_API } from "./constants";
import { Collection, User } from "./types";

function getUserToken() {
	return localStorage.getItem('r2_twitch_user_markers_v2_token');
}

const makeBackendRequest = <T>(path: string, init?: RequestInit) => {
	return fetch(BACKEND_API + path, {
		...(init || {}),
		headers: {
			Authorization: `Bearer ${getUserToken()}`,
			...(init?.headers || {})
		}
	}).then(r => r.json() as Promise<T>).catch(err => {
		console.error(err);
		throw err;
	})
}

export async function getCurrentUser() {
	return getUserToken() ? makeBackendRequest<User>('/user').catch(() => null) : null;
}
export async function generateToken(username: string, password: string) {
	return makeBackendRequest<{ token?: string; message?: string}>('/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ username, password })
	}).catch(err => ({ token: null, message: err })).then(({ token, message }) => {
		if (message) throw new Error(message)

		localStorage.setItem('r2_twitch_user_markers_v2_token', token!);
		return token!;
	});
}

type MarkerlessCollection = Omit<Collection, 'markers'>;

export async function getCollections(type: 'YouTube' | 'Twitch', videoId: string) {
	return makeBackendRequest<MarkerlessCollection[]>('/collections/' + type + '/' + videoId).catch(() => [] as MarkerlessCollection[]);
}

export async function getCollection(collectionId: string) {
	return makeBackendRequest<Collection | undefined>('/collection/' + collectionId).catch(() => undefined);
}

export async function upsertCollection(collection: Collection) {
	return makeBackendRequest<Collection>('/collection/' + collection._id, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(collection)
	}).catch(() => undefined);
}