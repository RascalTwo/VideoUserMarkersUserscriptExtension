import { log, secondsToDHMS } from './helpers';
import { dialog } from './ui';

const GQL_HEADERS = {
	// cspell:disable-next-line
	'client-id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
}

let userID: string | undefined = undefined;
let vid: string | undefined | null = undefined;

/**
 * Get the ID of the page user
 *
 * @returns {number}
 */
export async function getUserID() {
	if (userID) return userID;

	// TODO - optimize GQL query
	return fetch('https://gql.twitch.tv/gql', {
		headers: GQL_HEADERS,
		body: `{"query":"query($login: String!, $skip: Boolean!) {\\n\\t\\t\\t\\tuser(login: $login) {\\n\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\tlanguage\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\tdescription\\n\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\tfollowers {\\n\\t\\t\\t\\t\\t\\ttotalCount\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\tlastBroadcast {\\n\\t\\t\\t\\t\\t\\tstartedAt\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprimaryTeam {\\n\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\tprofileImageURL(width: 70)\\n\\t\\t\\t\\t\\tprofileViewCount\\n\\t\\t\\t\\t\\tself @skip(if: $skip) {\\n\\t\\t\\t\\t\\t\\tcanFollow\\n\\t\\t\\t\\t\\t\\tfollower {\\n\\t\\t\\t\\t\\t\\t\\tdisableNotifications\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}\\n\\t\\t\\t}","variables":{"login":"${getLoginName()}","skip":false}}`,
		method: 'POST',
	})
		.then(r => r.json())
		.then(json => {
			userID = json.data.user.id;
			log('GQL User ID:', userID);
			return userID;
		});
}

/**
 * Get ID of video, may not exist if on live page and archive stream does not exist
 *
 * @param {boolean} promptUser If to prompt the user for the ID if it could not be found
 * @returns {string}
 */
export async function getVideoID(promptUser: boolean): Promise<typeof vid> {
	// Get VID from URL if VOD
	if (isVOD()) {
		vid = window.location.href.split('/').slice(-1)[0].split('?')[0];
		return vid;
	}
	if (promptUser && vid === null) {
		const response = await dialog('prompt', 'Video ID could not be detected, please provide it:');
		if (!response) return vid;
		vid = response;
	}
	if (vid !== undefined) return vid;
	// TODO - optimize GQL query
	return getUserID()
		.then(uid =>
			fetch('https://gql.twitch.tv/gql', {
				headers: GQL_HEADERS,
				body: `{"query":"query($id: ID!, $all: Boolean!) {\\n\\t\\t\\t\\t\\tuser(id: $id) {\\n\\t\\t\\t\\t\\t\\tbroadcastSettings {\\n\\t\\t\\t\\t\\t\\t\\tgame {\\n\\t\\t\\t\\t\\t\\t\\t\\tdisplayName\\n\\t\\t\\t\\t\\t\\t\\t\\tname\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\ttitle\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\tlogin\\n\\t\\t\\t\\t\\t\\tstream {\\n\\t\\t\\t\\t\\t\\t\\tarchiveVideo @include(if: $all) {\\n\\t\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t\\t\\tcreatedAt\\n\\t\\t\\t\\t\\t\\t\\tid\\n\\t\\t\\t\\t\\t\\t\\ttype\\n\\t\\t\\t\\t\\t\\t\\tviewersCount\\n\\t\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t\\t}\\n\\t\\t\\t\\t}","variables":{"id":"${uid}","all":true}}`,
				method: 'POST',
			})
		)
		.then(r => r.json())
		.then(json => {
			vid = json.data.user.stream.archiveVideo?.id ?? null;
			log('GQL VOD ID:', vid);
			return getVideoID(promptUser);
		});
}

export function clearIDsCache() {
	userID = undefined;
	vid = undefined;
}

/**
 * Get CSS class of twitch buttons
 *
 * @returns {string}
 */
export function getButtonClass() {
	return document.querySelector('[data-a-target="top-nav-get-bits-button"]')?.className ?? '';
}

/**
 * If the page is a VOD
 *
 * @returns {boolean}
 */
export function isVOD() {
	return window.location.pathname.startsWith('/videos');
}

/**
 * If the page is Live
 *
 * @returns {boolean}
 */
export function isLive() {
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
export function getLoginName() {
	return isLive()
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
