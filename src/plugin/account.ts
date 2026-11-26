// The Microsoft account the plugin downloads with (§11.5 item 61): signing in through the system
// browser, staying signed in, signing out. The refresh token is kept in Obsidian's secret storage
// (encrypted from 1.11.5, per vault, not in data.json, so it does not travel with sync or git); the
// access token lives in memory only. What kind of account it is (personal, or work or school) is
// kept per vault and device; the name and e-mail address are not kept anywhere.

import { requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import { redeem, refresh, signInRequest, SignInError } from '../core/microsoft-auth.ts';
import type { AccountInfo, PostForm, Tokens } from '../core/microsoft-auth.ts';
import { ReceiverClosed, startReceiver } from '../node/loopback.ts';
import type { Receiver, ReceiverPages } from '../node/loopback.ts';

/** The secret's ID in Obsidian's secret storage (lowercase letters, digits and dashes). */
const SECRET_ID = 'onenote-ferry-microsoft';
/** The account's kind, per vault and device. */
const KIND_KEY = 'onenote-ferry-microsoft-kind';
/** The signed-in account's drive (its ID names the local copy's folder), per vault and device; forgotten when the account may change. */
export const DRIVE_KEY = 'onenote-ferry-onedrive-drive';
/** An access token this close to running out is renewed first. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;
/** requestUrl has no time-out of its own. */
const REQUEST_TIMEOUT_MS = 30 * 1000;

/** Waits for `promise` at most `ms` (the request itself cannot be called off and may still end later). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new SignInError('unreachable', `no answer within ${ms / 1000} seconds`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Posts a form through Obsidian (no browser origin, the system's proxy settings). */
export const postForm: PostForm = async (url, form) => {
	const response = await withTimeout(requestUrl({
		url,
		method: 'POST',
		contentType: 'application/x-www-form-urlencoded',
		body: new URLSearchParams(form).toString(),
		throw: false,
	}), REQUEST_TIMEOUT_MS);
	let json: unknown;
	try {
		json = response.json;
	}
	catch {
		json = undefined;
	}
	return { status: response.status, json };
};

export class MicrosoftAccount {
	private tokens?: Tokens;
	private renewing?: Promise<Tokens>;
	private receiver?: Receiver;
	/** Microsoft's sign-in page of the sign-in waited for (to open it again when its tab was lost). */
	private pendingUrl?: string;
	/** Goes up at every sign-in and sign-out: an answer for an earlier one is dropped. */
	private generation = 0;
	/** Who is signed in, once Microsoft has said so in this session. */
	account?: AccountInfo;

	private readonly app: App;
	private readonly pages: () => ReceiverPages;
	/** Whether the sign-in is kept for the next time Obsidian starts. */
	private readonly remember: () => boolean;

	constructor(app: App, pages: () => ReceiverPages, remember: () => boolean = () => true) {
		this.app = app;
		this.pages = pages;
		this.remember = remember;
	}

	/** Signed in: there is a refresh token, in memory or kept. */
	get signedIn(): boolean {
		return !!(this.tokens?.refreshToken ?? this.storedToken());
	}

	/** The account's kind as last seen on this device, before Microsoft has been asked in this session. */
	get kind(): AccountInfo['kind'] | undefined {
		if (this.account) return this.account.kind;
		const kind = this.app.loadLocalStorage(KIND_KEY) as unknown;
		return kind === 'personal' || kind === 'organization' ? kind : undefined;
	}

	/**
	 * Signs in: Microsoft's page opens in the system browser, and this waits for the answer (ten
	 * minutes at most). A second call calls off the first. Throws a SignInError saying why not.
	 */
	async signIn(): Promise<AccountInfo | undefined> {
		this.cancelSignIn();
		const generation = ++this.generation;
		const receiver = await startReceiver(this.pages());
		this.receiver = receiver;
		try {
			const request = await signInRequest(receiver.redirectUri);
			const answer = receiver.answer(request.state);
			this.pendingUrl = request.url;
			window.open(request.url, '_external');
			let reply;
			try {
				reply = await answer;
			}
			catch (error) {
				throw error instanceof ReceiverClosed ? new SignInError(error.timedOut ? 'timed-out' : 'cancelled') : error;
			}
			const tokens = await redeem(request, reply, postForm);
			if (generation !== this.generation) throw new SignInError('cancelled');
			// Signed in anew, perhaps as someone else: the drive remembered may not be this account's.
			this.app.saveLocalStorage(DRIVE_KEY, null);
			this.keep(tokens);
			return tokens.account;
		}
		finally {
			receiver.close();
			if (this.receiver === receiver) {
				this.receiver = undefined;
				this.pendingUrl = undefined;
			}
		}
	}

	/** Opens the sign-in page waited for once more (the same sign-in: its answer still comes back here). */
	reopenSignIn(): void {
		if (this.pendingUrl) window.open(this.pendingUrl, '_external');
	}

	/** Stops waiting for a sign-in in the browser. */
	cancelSignIn(): void {
		this.receiver?.close();
		this.receiver = undefined;
	}

	/**
	 * An access token for Microsoft Graph, renewed when it is about to run out. Throws a SignInError:
	 * 'signed-out' (and forgets the sign-in) when Microsoft no longer takes it, 'unreachable' when
	 * Microsoft cannot be reached (the sign-in is kept).
	 */
	async accessToken(): Promise<string> {
		if (this.tokens && this.tokens.expiresAt - RENEW_BEFORE_MS > Date.now()) return this.tokens.accessToken;
		const refreshToken = this.tokens?.refreshToken ?? this.storedToken();
		if (!refreshToken) throw new SignInError('signed-out');
		const generation = this.generation;
		this.renewing ??= refresh(refreshToken, postForm).finally(() => this.renewing = undefined);
		try {
			const tokens = await this.renewing;
			if (generation !== this.generation) throw new SignInError('signed-out');
			this.keep(tokens);
			return tokens.accessToken;
		}
		catch (error) {
			if (error instanceof SignInError && (error.problem === 'signed-out' || error.problem === 'app-unavailable') && generation === this.generation) this.forget();
			throw error;
		}
	}

	/** Drops the access token (Graph refused it before it ran out): the next one is renewed. */
	renewAccessToken(): void {
		if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 };
	}

	/** Signs out on this device: forgets the tokens. Allowing the app is undone at Microsoft's site. */
	signOut(): void {
		this.cancelSignIn();
		this.generation++;
		this.forget();
	}

	private keep(tokens: Tokens): void {
		this.tokens = tokens;
		if (tokens.account) {
			this.account = tokens.account;
			this.app.saveLocalStorage(KIND_KEY, tokens.account.kind);
		}
		this.storeToken(this.remember() ? tokens.refreshToken : '');
	}

	private forget(): void {
		this.tokens = undefined;
		this.account = undefined;
		this.app.saveLocalStorage(KIND_KEY, null);
		this.app.saveLocalStorage(DRIVE_KEY, null);
		this.storeToken('');
	}

	private storedToken(): string | undefined {
		try {
			return this.app.secretStorage.getSecret(SECRET_ID) || undefined;
		}
		catch {
			return undefined;
		}
	}

	/** Secret storage has no way to remove a secret: an empty one stands for none. */
	private storeToken(token: string): void {
		try {
			if (token || this.app.secretStorage.getSecret(SECRET_ID)) this.app.secretStorage.setSecret(SECRET_ID, token);
		}
		catch {
			// Not kept: the sign-in lasts until Obsidian quits.
		}
	}
}
