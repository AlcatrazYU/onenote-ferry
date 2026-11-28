// Signing in to a Microsoft account (§11.5 item 61): the authorization code flow with PKCE, for a
// public client (no secret) registered as "Ferry for Obsidian". The system browser shows
// Microsoft's sign-in page; the answer comes back to a one-shot receiver on this computer
// (src/node/loopback.ts); the tokens are asked for here. Nothing here touches the network itself:
// the caller hands in how to post a form (Obsidian's requestUrl in the plugin).
//
// Only reading is asked for: Files.Read, plus offline_access (to stay signed in) and openid and
// profile (the sign-in itself). The application ID is public by design: a public client cannot keep
// a secret, so what protects users is PKCE, the state check and the registered loopback address.

/** The app registration's application (client) ID (Microsoft Entra, Default Directory). */
export const CLIENT_ID = 'f67270c7-303a-4ce4-9f29-7b268ee5cab9';

/** Personal accounts and any work or school directory (§11.5 item 61.2). */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';

/** What the app asks for. */
export const SCOPES = ['openid', 'profile', 'offline_access', 'https://graph.microsoft.com/Files.Read'];

/** The directory every personal Microsoft account signs in through. */
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** Encodes bytes as base64url without padding (RFC 4648 §5), as PKCE and state use. */
export function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomText(bytes: number): string {
	return base64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The S256 code challenge of a code verifier (RFC 7636 §4.2). */
export async function codeChallenge(verifier: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}

/** One sign-in under way: what goes to Microsoft, and what must come back. */
export interface SignInRequest {
	/** The page to open in the system browser. */
	url: string;
	/** Must come back unchanged with the answer; anything else is not our answer. */
	state: string;
	/** Proves, when the code is redeemed, that this program started the sign-in. Never leaves this computer before that. */
	verifier: string;
	redirectUri: string;
}

/**
 * The sign-in page's address for a receiver at `redirectUri` (`http://localhost:<port>`, which
 * Microsoft matches to the registered `http://localhost` whatever the port). The answer comes as a
 * form posted to the receiver, so the code never shows in the browser's address bar or history.
 */
export async function signInRequest(redirectUri: string): Promise<SignInRequest> {
	const verifier = randomText(32);
	const state = randomText(16);
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		response_type: 'code',
		redirect_uri: redirectUri,
		response_mode: 'form_post',
		scope: SCOPES.join(' '),
		state,
		code_challenge: await codeChallenge(verifier),
		code_challenge_method: 'S256',
		// The account picker even when the browser is signed in already: a person may have several.
		prompt: 'select_account',
	});
	return { url: `${AUTHORITY}/authorize?${params}`, state, verifier, redirectUri };
}

/** Posts a form, answering the status and the body (a server that answers HTML gives `json` undefined). */
export type PostForm = (url: string, form: Record<string, string>) => Promise<{ status: number, json: unknown }>;

/** Why signing in or staying signed in did not work. */
export type SignInProblem =
	/** The person closed the page or said no. */
	| 'cancelled'
	/** A work or school directory lets only its administrators allow this app. */
	| 'needs-admin'
	/** Signed out: the sign-in expired, was revoked, or the account's rules ask for it again. */
	| 'signed-out'
	/** Microsoft does not know the app (the registration is gone or disabled). */
	| 'app-unavailable'
	/** No network, a timeout, or Microsoft busy: nothing changed, try again later. */
	| 'unreachable'
	/** Nothing came back from the browser in time. */
	| 'timed-out'
	/** Anything else, with Microsoft's own words in the detail. */
	| 'failed';

export class SignInError extends Error {
	readonly problem: SignInProblem;
	readonly detail: string;
	constructor(problem: SignInProblem, detail = '') {
		super(detail ? `${problem}: ${detail}` : problem);
		this.name = 'SignInError';
		this.problem = problem;
		this.detail = detail;
	}
}

/** What the browser posted back to the receiver: a code, or why there is none. */
export interface SignInAnswer {
	code?: string;
	error?: string;
	description?: string;
}

/** The AADSTS numbers in an error description (Microsoft's codes for what went wrong). */
function codesIn(description: string): string[] {
	return [...description.matchAll(/AADSTS(\d+)/g)].map(match => match[1]);
}

/**
 * Sorts one of Microsoft's errors into what the plugin can say and do. A sign-in that cannot go
 * on any more is 'signed-out' (sign in again); only a network or service hiccup keeps it.
 */
export function classifyError(error: string, description = '', status = 400): SignInProblem {
	const codes = codesIn(description);
	// The person declined to allow the app.
	if (codes.includes('65004')) return 'cancelled';
	// Only an administrator may allow it (the directory's consent policy, risk-based step-up).
	if (codes.includes('90094') || codes.includes('90095')) return 'needs-admin';
	if (error === 'access_denied') return 'cancelled';
	// The app is not known in Microsoft's directory, or is disabled there.
	if (error === 'unauthorized_client' || error === 'invalid_client' || codes.includes('700016') || codes.includes('7000112')) return 'app-unavailable';
	if (error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required' || error === 'login_required') return 'signed-out';
	if (error === 'temporarily_unavailable' || error === 'server_error' || status === 429 || status >= 500) return 'unreachable';
	return 'failed';
}

/** What signing in tells about the account, without its e-mail address. */
export interface AccountInfo {
	/** A personal Microsoft account, or one of a work or school directory. */
	kind: 'personal' | 'organization';
	/** The name to show while signed in (kept in memory only). */
	name?: string;
	/** The sign-in name, usually an e-mail address (kept in memory only). */
	username?: string;
}

/** Tokens from Microsoft. The refresh token replaces the one before it. */
export interface Tokens {
	accessToken: string;
	/** When the access token stops working (milliseconds since 1970). */
	expiresAt: number;
	refreshToken: string;
	account?: AccountInfo;
}

/** The claims of an ID token, read without checking its signature: only for showing who is signed in. */
function idTokenClaims(idToken: unknown): Record<string, unknown> | undefined {
	if (typeof idToken !== 'string') return undefined;
	const payload = idToken.split('.')[1];
	if (!payload) return undefined;
	try {
		const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
		const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
		return claims && typeof claims === 'object' ? claims as Record<string, unknown> : undefined;
	}
	catch {
		return undefined;
	}
}

export function accountOf(idToken: unknown): AccountInfo | undefined {
	const claims = idTokenClaims(idToken);
	if (!claims || typeof claims.tid !== 'string') return undefined;
	const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
	return { kind: claims.tid === PERSONAL_TENANT ? 'personal' : 'organization', name: text(claims.name), username: text(claims.preferred_username) };
}

/** Reads the token endpoint's answer, or throws why there are no tokens. */
function tokensFrom(status: number, json: unknown, now: number): Tokens {
	const body = json && typeof json === 'object' ? json as Record<string, unknown> : {};
	if (status !== 200 || typeof body.access_token !== 'string') {
		const error = typeof body.error === 'string' ? body.error : '';
		const description = typeof body.error_description === 'string' ? body.error_description : '';
		throw new SignInError(error ? classifyError(error, description, status) : status === 429 || status >= 500 ? 'unreachable' : 'failed', `${status} ${error} ${description}`.trim().slice(0, 500));
	}
	if (typeof body.refresh_token !== 'string') throw new SignInError('failed', 'no refresh token in the answer');
	const scope = typeof body.scope === 'string' ? body.scope.toLowerCase().split(/\s+/) : [];
	if (!scope.some(item => item === 'files.read' || item.endsWith('/files.read'))) throw new SignInError('failed', `reading files was not allowed (${body.scope ?? 'no scope'})`);
	const seconds = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in);
	return {
		accessToken: body.access_token,
		expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
		refreshToken: body.refresh_token,
		account: accountOf(body.id_token),
	};
}

async function postToken(post: PostForm, form: Record<string, string>, now: () => number): Promise<Tokens> {
	let answer: { status: number, json: unknown };
	try {
		answer = await post(`${AUTHORITY}/token`, { client_id: CLIENT_ID, scope: SCOPES.join(' '), ...form });
	}
	catch (error) {
		throw error instanceof SignInError ? error : new SignInError('unreachable', String((error as Error)?.message ?? error).slice(0, 500));
	}
	return tokensFrom(answer.status, answer.json, now());
}

/** Turns the browser's answer into tokens (or throws why not). */
export async function redeem(request: SignInRequest, answer: SignInAnswer, post: PostForm, now = Date.now): Promise<Tokens> {
	if (answer.error || !answer.code) {
		const error = answer.error ?? '';
		const description = answer.description ?? '';
		throw new SignInError(error ? classifyError(error, description) : 'failed', `${error} ${description}`.trim().slice(0, 500) || 'no code in the answer');
	}
	return postToken(post, { grant_type: 'authorization_code', code: answer.code, redirect_uri: request.redirectUri, code_verifier: request.verifier }, now);
}

/** New tokens from a refresh token. A 'signed-out' error means the refresh token is no good any more. */
export function refresh(refreshToken: string, post: PostForm, now = Date.now): Promise<Tokens> {
	return postToken(post, { grant_type: 'refresh_token', refresh_token: refreshToken }, now);
}
