// Microsoft Graph through Obsidian (§11.5 items 61 to 63): requests with the signed-in account's
// token, through requestUrl (no browser origin, the system's proxy). Listings are small JSON
// answers; file contents are downloaded with fetch instead (src/node/fetch-download.ts).

import { requestUrl } from 'obsidian';
import { GraphError } from '../core/onedrive.ts';
import type { GraphGet } from '../core/onedrive.ts';
import { SignInError } from '../core/microsoft-auth.ts';
import type { FileLink } from '../node/fetch-download.ts';
import type { MicrosoftAccount } from './account.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** requestUrl has no time-out of its own. */
const REQUEST_TIMEOUT_MS = 60 * 1000;
/** Times to wait when Graph is busy (429, 503) before giving up. */
const BUSY_TRIES = 5;

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: number | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = window.setTimeout(() => reject(new SignInError('unreachable', `no answer from Microsoft within ${ms / 1000} seconds`)), ms);
		}),
	]).finally(() => window.clearTimeout(timer));
}

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/**
 * Graph requests as the signed-in account. Throws SignInError when signed out or Microsoft cannot
 * be reached, GraphError for Graph's own error answers.
 */
export function graphFor(account: MicrosoftAccount, version: string): GraphGet {
	return async pathOrUrl => {
		const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
		let renewed = false;
		for (let busy = 0; ; ) {
			const token = await account.accessToken();
			let response;
			try {
				response = await timeout(requestUrl({
					url,
					headers: {
						Authorization: `Bearer ${token}`,
						// As Microsoft asks of programs calling it (no personal data).
						'User-Agent': `NONISV|OneNote Ferry|OneNoteFerry/${version}`,
						// Listings name the user's notebooks: not to be kept in Obsidian's web cache.
						'Cache-Control': 'no-store',
					},
					throw: false,
				}), REQUEST_TIMEOUT_MS);
			}
			catch (error) {
				throw error instanceof SignInError ? error : new SignInError('unreachable', String((error as Error)?.message ?? error).slice(0, 300));
			}
			if (response.status === 401 && !renewed) {
				renewed = true;
				account.renewAccessToken();
				continue;
			}
			if ((response.status === 429 || response.status === 503) && busy++ < BUSY_TRIES) {
				const after = Number(response.headers['retry-after'] ?? response.headers['Retry-After']);
				await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 600) * 1000 : 30_000);
				continue;
			}
			let json: any;
			try {
				json = response.json;
			}
			catch {
				json = undefined;
			}
			if (response.status >= 200 && response.status < 300) return json;
			throw new GraphError(response.status, json?.error?.code ?? '', String(json?.error?.message ?? '').slice(0, 300));
		}
	};
}

/** The signed-in account's drive: its ID names the local copy's folder. */
export async function driveOf(graph: GraphGet): Promise<{ id: string, driveType: string }> {
	const drive = await graph('/me/drive?$select=id,driveType');
	return { id: String(drive.id), driveType: String(drive.driveType) };
}

/** A fresh download link for a file, and its current version (`$select` must name content.downloadUrl). */
export function linkFor(graph: GraphGet): (fileId: string) => Promise<FileLink> {
	return async id => {
		const item = await graph(`/me/drive/items/${encodeURIComponent(id)}?$select=id,size,eTag,content.downloadUrl`);
		const url = item['@microsoft.graph.downloadUrl'];
		if (typeof url !== 'string' || typeof item.eTag !== 'string') throw new GraphError(404, 'noDownloadLink', 'OneDrive gave no download link for this file');
		return { url, size: Number(item.size), eTag: item.eTag };
	};
}

/**
 * The window's own fetch, for file contents only: requestUrl hands over a whole answer at once and
 * cannot be stopped, and files here reach 2 GB, so they are streamed to disk and can be cancelled.
 * Sign-in and Graph requests use requestUrl. The plugin is desktop only.
 */
export const streamingFetch: typeof globalThis.fetch = (input, init) => fetch(input, init);
