// Runs in a Web Worker inside Obsidian, where Node integration is on: the parser (WebAssembly)
// works here so that Obsidian's window never waits for it.

interface Ferry {
	parseSection(path: string): { takeJson(): string; readAsset(key: string): Uint8Array; free(): void; readonly assetCount: number };
	memoryBytes(): number;
}

declare const require: (id: string) => any;

type Request =
	| { type: 'init', id: number, wasm: ArrayBuffer }
	| { type: 'parse', id: number, path: string };

let ferry: Ferry | undefined;

/** The parser, started on first use from the WebAssembly bytes the plugin handed over. */
function parser(): Ferry {
	if (!ferry) ferry = require('../../build/parser-wasm/ferry.js') as Ferry;
	return ferry;
}

function reply(message: unknown, transfer: Transferable[] = []): void {
	(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(message, transfer);
}

self.onmessage = (event: MessageEvent<Request>) => {
	const request = event.data;
	if (request.type === 'init') {
		(globalThis as { __ONENOTE_FERRY_WASM__?: Uint8Array }).__ONENOTE_FERRY_WASM__ = new Uint8Array(request.wasm);
		const started = performance.now();
		parser();
		reply({ type: 'ready', id: request.id, startMs: performance.now() - started });
		return;
	}
	if (request.type === 'parse') {
		try {
			const started = performance.now();
			const parsed = parser().parseSection(request.path);
			const json = parsed.takeJson();
			const parsedAt = performance.now();
			let assetBytes = 0;
			for (const key of new Set([...json.matchAll(/"asset":"([0-9a-f]{40}\.[a-z0-9]+)"/g)].map(m => m[1]))) assetBytes += parsed.readAsset(key).length;
			const assetCount = parsed.assetCount;
			parsed.free();
			const hash = require('crypto').createHash('sha1').update(json).digest('hex');
			reply({
				type: 'parsed', id: request.id, jsonLength: json.length, jsonSha1: hash, assetCount, assetBytes,
				parseMs: Math.round(parsedAt - started), assetsMs: Math.round(performance.now() - parsedAt),
				wasmMiB: Math.round(parser().memoryBytes() / 1048576),
			});
		}
		catch (error) {
			reply({ type: 'error', id: request.id, message: String((error as Error)?.message ?? error) });
		}
	}
};
