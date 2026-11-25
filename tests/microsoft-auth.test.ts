// Signing in to Microsoft (§11.5 item 61): the PKCE request, redeeming the answer, renewing, and
// sorting Microsoft's errors into what the plugin does. Microsoft's endpoint is a stand-in here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Url, classifyError, CLIENT_ID, codeChallenge, redeem, refresh, SCOPES, signInRequest, SignInError } from '../src/core/microsoft-auth.ts';
import type { PostForm, SignInProblem } from '../src/core/microsoft-auth.ts';

const PERSONAL = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** An ID token as Microsoft sends it (only the claims are read; the signature is not checked). */
function idToken(claims: Record<string, unknown>): string {
	const part = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
	return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

/** A token endpoint that answers `answer` and records what was posted. */
function endpoint(answer: { status: number, json: unknown } | Error) {
	const posted: { url: string, form: Record<string, string> }[] = [];
	const post: PostForm = async (url, form) => {
		posted.push({ url, form });
		if (answer instanceof Error) throw answer;
		return answer;
	};
	return { post, posted };
}

const GOOD = {
	status: 200,
	json: {
		token_type: 'Bearer',
		scope: 'https://graph.microsoft.com/Files.Read openid profile',
		expires_in: 3599,
		access_token: 'access-1',
		refresh_token: 'refresh-2',
		id_token: idToken({ tid: PERSONAL, name: 'Sample Person', preferred_username: 'sample@example.com' }),
	},
};

async function problemOf(promise: Promise<unknown>): Promise<SignInProblem> {
	try {
		await promise;
	}
	catch (error) {
		assert.ok(error instanceof SignInError, String(error));
		return error.problem;
	}
	assert.fail('expected a SignInError');
}

test('the code challenge is S256 of the verifier (RFC 7636 appendix B)', async () => {
	assert.equal(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('the sign-in page asks for reading files only, with PKCE, a fresh state and a posted answer', async () => {
	const request = await signInRequest('http://localhost:54321');
	const url = new URL(request.url);
	assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
	const params = Object.fromEntries(url.searchParams);
	assert.deepEqual(params, {
		client_id: CLIENT_ID,
		response_type: 'code',
		redirect_uri: 'http://localhost:54321',
		response_mode: 'form_post',
		scope: 'openid profile offline_access https://graph.microsoft.com/Files.Read',
		state: request.state,
		code_challenge: await codeChallenge(request.verifier),
		code_challenge_method: 'S256',
		prompt: 'select_account',
	});
	assert.match(request.verifier, /^[A-Za-z0-9_-]{43}$/);
	assert.match(request.state, /^[A-Za-z0-9_-]{22}$/);
	assert.ok(!SCOPES.some(scope => /write|\.all/i.test(scope)));
	const other = await signInRequest('http://localhost:54321');
	assert.notEqual(other.state, request.state);
	assert.notEqual(other.verifier, request.verifier);
});

test('a code is redeemed with the verifier, and the tokens come back with the kind of account', async () => {
	const request = await signInRequest('http://localhost:4000');
	const { post, posted } = endpoint(GOOD);
	const tokens = await redeem(request, { code: 'the-code' }, post, () => 1_000_000);
	assert.deepEqual(posted, [{
		url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
		form: { client_id: CLIENT_ID, scope: SCOPES.join(' '), grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'http://localhost:4000', code_verifier: request.verifier },
	}]);
	assert.deepEqual(tokens, { accessToken: 'access-1', expiresAt: 1_000_000 + 3599 * 1000, refreshToken: 'refresh-2', account: { kind: 'personal', name: 'Sample Person', username: 'sample@example.com' } });
	const work = await redeem(request, { code: 'c' }, endpoint({ status: 200, json: { ...GOOD.json, id_token: idToken({ tid: '11111111-2222-3333-4444-555555555555' }) } }).post);
	assert.deepEqual(work.account, { kind: 'organization', name: undefined, username: undefined });
});

test('a refresh posts the refresh token and takes the new one that replaces it', async () => {
	const { post, posted } = endpoint(GOOD);
	const tokens = await refresh('refresh-1', post);
	assert.equal(posted[0]!.form.grant_type, 'refresh_token');
	assert.equal(posted[0]!.form.refresh_token, 'refresh-1');
	assert.equal(tokens.refreshToken, 'refresh-2');
});

test('an answer without a code says why', async () => {
	const request = await signInRequest('http://localhost:4000');
	const never: PostForm = async () => assert.fail('nothing is posted without a code');
	assert.equal(await problemOf(redeem(request, { error: 'access_denied', description: 'AADSTS65004: User declined to consent.' }, never)), 'cancelled');
	assert.equal(await problemOf(redeem(request, { error: 'access_denied', description: 'the user canceled' }, never)), 'cancelled');
	assert.equal(await problemOf(redeem(request, { error: 'consent_required', description: 'AADSTS90094: Admin approval required.' }, never)), 'needs-admin');
	assert.equal(await problemOf(redeem(request, { error: 'invalid_request', description: 'AADSTS700016: Application not found in the directory.' }, never)), 'app-unavailable');
	assert.equal(await problemOf(redeem(request, {}, never)), 'failed');
});

test('a sign-in Microsoft no longer takes is signed out; a network or service hiccup is not', async () => {
	const cases: [{ status: number, json: unknown } | Error, SignInProblem][] = [
		[{ status: 400, json: { error: 'invalid_grant', error_description: 'AADSTS70008: The refresh token has expired.' } }, 'signed-out'],
		[{ status: 400, json: { error: 'interaction_required', error_description: 'AADSTS50076: multi-factor authentication required.' } }, 'signed-out'],
		[{ status: 401, json: { error: 'invalid_client', error_description: 'AADSTS7000112: Application is disabled.' } }, 'app-unavailable'],
		[{ status: 503, json: { error: 'temporarily_unavailable' } }, 'unreachable'],
		[{ status: 502, json: undefined }, 'unreachable'],
		[{ status: 429, json: undefined }, 'unreachable'],
		[new Error('getaddrinfo ENOTFOUND login.microsoftonline.com'), 'unreachable'],
		[{ status: 400, json: { error: 'invalid_scope' } }, 'failed'],
		[{ status: 200, json: { ...GOOD.json, refresh_token: undefined } }, 'failed'],
		[{ status: 200, json: { ...GOOD.json, scope: 'openid profile' } }, 'failed'],
	];
	for (const [answer, problem] of cases) assert.equal(await problemOf(refresh('r', endpoint(answer).post)), problem, JSON.stringify(answer instanceof Error ? answer.message : answer));
});

test('error codes are read from the description, not guessed from the error name alone', () => {
	assert.equal(classifyError('invalid_grant', 'AADSTS90094: admin consent'), 'needs-admin');
	assert.equal(classifyError('invalid_request', 'AADSTS50011: redirect URI mismatch'), 'failed');
	assert.equal(classifyError('server_error', ''), 'unreachable');
});
