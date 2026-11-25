// The one-shot receiver for a sign-in's answer: it takes only the answer with the right state,
// addressed to it by its own name, shows a page, and frees the port.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { ReceiverClosed, startReceiver } from '../src/node/loopback.ts';

const PAGES = { title: 'Ferry test', done: 'All done here.', failed: 'Did not work.' };

/** Sends one request to the receiver's port, answering the status and the body. */
function send(port: number, options: { method?: string, path?: string, host?: string, type?: string, body?: string } = {}): Promise<{ status: number, body: string }> {
	return new Promise((resolve, reject) => {
		const req = request({
			host: '127.0.0.1',
			port,
			method: options.method ?? 'POST',
			path: options.path ?? '/',
			headers: {
				Host: options.host ?? `localhost:${port}`,
				...(options.body !== undefined ? { 'Content-Type': options.type ?? 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(options.body) } : {}),
			},
		}, res => {
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
		});
		req.on('error', reject);
		req.end(options.body);
	});
}

const portOf = (uri: string) => Number(new URL(uri).port);

test('the answer with the right state is taken, with a page saying the browser can be closed', async () => {
	const receiver = await startReceiver(PAGES);
	assert.match(receiver.redirectUri, /^http:\/\/localhost:\d+$/);
	const port = portOf(receiver.redirectUri);
	const answer = receiver.answer('state-1');
	const reply = await send(port, { body: 'code=the-code&state=state-1&session_state=x' });
	assert.equal(reply.status, 200);
	assert.match(reply.body, /All done here\./);
	assert.deepEqual(await answer, { code: 'the-code', error: undefined, description: undefined });
	// Then the port is free: nothing answers any more.
	await assert.rejects(send(port, { body: 'code=again&state=state-1' }));
});

test('anything else is turned away and the receiver keeps waiting', async () => {
	const receiver = await startReceiver(PAGES);
	const port = portOf(receiver.redirectUri);
	const answer = receiver.answer('right');
	assert.equal((await send(port, { body: 'code=x&state=wrong' })).status, 400);
	assert.equal((await send(port, { body: 'code=x' })).status, 400);
	assert.equal((await send(port, { body: 'code=x&state=right', host: 'evil.example' })).status, 421);
	assert.equal((await send(port, { body: 'code=x&state=right', host: `evil.example:${port}` })).status, 421);
	assert.equal((await send(port, { body: 'code=x&state=right', path: '/elsewhere' })).status, 404);
	assert.equal((await send(port, { body: 'code=x&state=right', type: 'text/plain' })).status, 415);
	assert.equal((await send(port, { method: 'PUT', body: 'code=x&state=right' })).status, 405);
	assert.equal((await send(port, { body: `state=right&code=${'x'.repeat(300 * 1024)}` }).catch(() => ({ status: 413, body: '' }))).status, 413);
	assert.equal((await send(port, { method: 'GET', path: '/favicon.ico' })).status, 404);
	// The right one, by the other name of this computer.
	assert.equal((await send(port, { body: 'code=good&state=right', host: `127.0.0.1:${port}` })).status, 200);
	assert.equal((await answer).code, 'good');
});

test('an error comes back as an answer, and Microsoft\'s words are shown as text, not markup', async () => {
	const receiver = await startReceiver(PAGES);
	const port = portOf(receiver.redirectUri);
	const answer = receiver.answer('s');
	const reply = await send(port, { body: new URLSearchParams({ error: 'access_denied', error_description: '<script>alert(1)</script> AADSTS65004', state: 's' }).toString() });
	assert.equal(reply.status, 200);
	assert.match(reply.body, /Did not work\./);
	assert.ok(!reply.body.includes('<script>'));
	assert.match(reply.body, /&lt;script&gt;/);
	assert.match(reply.body, /Content-Security-Policy|<!doctype html>/);
	assert.deepEqual(await answer, { code: undefined, error: 'access_denied', description: '<script>alert(1)</script> AADSTS65004' });
});

test('a sign-in left unfinished frees the port when the time runs out, or when called off', async () => {
	const slow = await startReceiver(PAGES, 50);
	await assert.rejects(slow.answer('s'), (error: unknown) => error instanceof ReceiverClosed && error.timedOut);
	await assert.rejects(send(portOf(slow.redirectUri), { body: 'code=x&state=s' }));

	const stopped = await startReceiver(PAGES);
	const answer = stopped.answer('s');
	stopped.close();
	await assert.rejects(answer, (error: unknown) => error instanceof ReceiverClosed && !error.timedOut);
	await assert.rejects(send(portOf(stopped.redirectUri), { body: 'code=x&state=s' }));
});

test('closed before it is asked to wait, the receiver says so when asked', async () => {
	const receiver = await startReceiver(PAGES);
	receiver.close();
	await assert.rejects(receiver.answer('s'), ReceiverClosed);
});
