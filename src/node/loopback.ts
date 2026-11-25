// The one-shot receiver for a sign-in's answer (§11.5 item 61.4): a small web server on this
// computer only (127.0.0.1, a port the system picks), registered with Microsoft as
// `http://localhost`. Microsoft's page posts the answer to it as a form; it takes the one answer
// whose state matches, shows a page saying the browser can be closed, and stops. Anything else
// (another state, another path, a page from elsewhere) is turned away and it keeps waiting, until
// the time runs out or the sign-in is called off.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SignInAnswer } from '../core/microsoft-auth.ts';

/** The text of the page the browser shows once the answer is in. */
export interface ReceiverPages {
	title: string;
	/** Signed in: the page can be closed. */
	done: string;
	/** Not signed in, with Microsoft's words (or the reason) after it. */
	failed: string;
}

export interface Receiver {
	/** Where Microsoft sends the answer: `http://localhost:<port>`. */
	readonly redirectUri: string;
	/** The answer carrying `state`. Rejects on time-out or when closed first. */
	answer(state: string): Promise<SignInAnswer>;
	/** Stops waiting and frees the port. */
	close(): void;
}

export class ReceiverClosed extends Error {
	readonly timedOut: boolean;
	constructor(timedOut: boolean) {
		super(timedOut ? 'no answer came back in time' : 'the sign-in was called off');
		this.name = 'ReceiverClosed';
		this.timedOut = timedOut;
	}
}

/** A form body larger than this is not an answer from Microsoft. */
const MAX_BODY = 256 * 1024;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ESCAPES[char]!);

function page(pages: ReceiverPages, ok: boolean, detail = ''): string {
	const message = ok ? pages.done : pages.failed;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pages.title)}</title>`
		+ '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:36em;margin:15vh auto;padding:0 1.5em;color:#222;background:#fff}'
		+ '@media (prefers-color-scheme: dark){body{color:#ddd;background:#1e1e1e}}p.detail{font-size:13px;opacity:.7;word-break:break-word}</style>'
		+ `</head><body><h1>${escapeHtml(pages.title)}</h1><p>${escapeHtml(message)}</p>${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ''}</body></html>`;
}

function send(res: ServerResponse, status: number, body: string, html = true): void {
	res.writeHead(status, {
		'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
		'Referrer-Policy': 'no-referrer',
		Connection: 'close',
	});
	res.end(body);
}

/** The request body, or undefined when it is too large. */
function readBody(req: IncomingMessage): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				resolve(undefined);
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/**
 * Starts a receiver. `timeoutMs` counts from now: a sign-in left unfinished in the browser frees
 * the port again by itself.
 */
export async function startReceiver(pages: ReceiverPages, timeoutMs = 10 * 60 * 1000): Promise<Receiver> {
	let expected: string | undefined;
	let settle: { resolve(answer: SignInAnswer): void, reject(error: Error): void } | undefined;
	let finished = false;
	let early: ReceiverClosed | undefined;

	const server = createServer((req, res) => {
		void handle(req, res).catch(() => {
			if (!res.headersSent) send(res, 500, 'Error', false);
		});
	});

	const finish = (outcome: { answer: SignInAnswer } | { error: ReceiverClosed }) => {
		if (finished) return;
		finished = true;
		clearTimeout(timer);
		server.close();
		// Browsers keep connections open: closing them lets the port go now, not minutes later.
		server.closeAllConnections?.();
		if ('answer' in outcome) settle?.resolve(outcome.answer);
		else if (settle) settle.reject(outcome.error);
		else early = outcome.error;
	};

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// Only pages addressed to this receiver by its own name (a page elsewhere cannot rename itself to it).
		const port = (server.address() as AddressInfo | null)?.port;
		const host = (req.headers.host ?? '').toLowerCase();
		if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return send(res, 421, 'Misdirected request', false);
		const url = new URL(req.url ?? '/', `http://localhost:${port}`);
		if (url.pathname !== '/') return send(res, 404, 'Not found', false);

		let params: URLSearchParams;
		if (req.method === 'POST') {
			const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
			if (type !== 'application/x-www-form-urlencoded') return send(res, 415, 'Unsupported media type', false);
			const body = await readBody(req);
			if (body === undefined) return send(res, 413, 'Too large', false);
			params = new URLSearchParams(body);
		}
		else if (req.method === 'GET') params = url.searchParams;
		else return send(res, 405, 'Method not allowed', false);

		// Not our answer, or not one now: turned away, and the receiver keeps waiting.
		if (finished || expected === undefined || params.get('state') !== expected) return send(res, 400, page(pages, false));

		const code = params.get('code') ?? undefined;
		const error = params.get('error') ?? undefined;
		const description = params.get('error_description') ?? undefined;
		send(res, 200, page(pages, !!code && !error, code && !error ? '' : [error, description].filter(Boolean).join(': ')));
		finish({ answer: { code: error ? undefined : code, error, description } });
	}

	const timer = setTimeout(() => finish({ error: new ReceiverClosed(true) }), timeoutMs);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const port = (server.address() as AddressInfo).port;

	return {
		redirectUri: `http://localhost:${port}`,
		answer(state: string): Promise<SignInAnswer> {
			if (expected !== undefined) return Promise.reject(new Error('this receiver is already waiting'));
			expected = state;
			if (early) return Promise.reject(early);
			return new Promise((resolve, reject) => settle = { resolve, reject });
		},
		close: () => finish({ error: new ReceiverClosed(false) }),
	};
}
