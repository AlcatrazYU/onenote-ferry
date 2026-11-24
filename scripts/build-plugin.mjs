// Builds the Obsidian plugin: build/plugin/main.js and manifest.json.
//
// The community store ships only main.js, manifest.json and styles.css, so main.js carries
// everything: the worker's code as text, and the parser's WebAssembly as base64 (decoded only
// when an import starts, so loading the plugin stays cheap).
//
// Usage: node scripts/build-plugin.mjs [--install <plugin folder in a vault>]
// Needs the parser build first (npm run build:parser).

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'build/plugin');
const WASM_DIR = join(ROOT, 'build/parser-wasm');
const install = process.argv.includes('--install') ? process.argv[process.argv.indexOf('--install') + 1] : undefined;

if (!existsSync(join(WASM_DIR, 'ferry_bg.wasm'))) {
	console.error('Missing build/parser-wasm: run npm run build:parser first.');
	process.exit(1);
}

/**
 * wasm-pack's Node glue loads the WebAssembly from a file next to it and names its helper files
 * with String.raw templates. In the worker there is no such file: the bytes come from the plugin.
 */
const parserGlue = {
	name: 'parser-glue',
	setup(b) {
		b.onLoad({ filter: /parser-wasm[\\/]ferry\.js$/ }, args => {
			let source = readFileSync(args.path, 'utf8');
			const loading = "const path = require('path').join(__dirname, 'ferry_bg.wasm');\nconst bytes = require('fs').readFileSync(path);";
			if (!source.includes(loading)) throw new Error('ferry.js: the WebAssembly loading code changed; update scripts/build-plugin.mjs');
			source = source.replace(loading, 'const bytes = globalThis.__ONENOTE_FERRY_WASM__;');
			source = source.replace(/require\((?:String\.raw)?`([^`$]+)`\)/g, (_, id) => `require(${JSON.stringify(id)})`);
			return { contents: source, loader: 'js', resolveDir: WASM_DIR };
		});
	},
};

// 1. The worker: parser and converter, as one script run from a Blob URL.
const worker = await build({
	entryPoints: [join(ROOT, 'src/plugin/worker.ts')],
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'node',
	target: 'es2022',
	minify: false,
	legalComments: 'inline',
	plugins: [parserGlue],
	logLevel: 'warning',
});
const workerSource = worker.outputFiles[0].text;

// 2. The plugin, with the worker's code and the WebAssembly inside it.
const virtualModules = {
	name: 'virtual-modules',
	setup(b) {
		b.onResolve({ filter: /^onenote-ferry:(worker|wasm)$/ }, args => ({ path: args.path, namespace: 'onenote-ferry' }));
		b.onLoad({ filter: /.*/, namespace: 'onenote-ferry' }, args => (args.path === 'onenote-ferry:worker'
			? { contents: workerSource, loader: 'text' }
			: { contents: readFileSync(join(WASM_DIR, 'ferry_bg.wasm')), loader: 'base64' }));
	},
};
mkdirSync(OUT, { recursive: true });
await build({
	entryPoints: [join(ROOT, 'src/plugin/main.ts')],
	bundle: true,
	outfile: join(OUT, 'main.js'),
	format: 'cjs',
	platform: 'browser',
	target: 'es2022',
	// Obsidian and Electron are there at run time; so is Node, since the plugin is desktop only.
	external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
	legalComments: 'inline',
	plugins: [virtualModules],
	logLevel: 'warning',
});
copyFileSync(join(ROOT, 'manifest.json'), join(OUT, 'manifest.json'));
copyFileSync(join(ROOT, 'styles.css'), join(OUT, 'styles.css'));
console.log(`build/plugin/main.js: ${(statSync(join(OUT, 'main.js')).size / 1048576).toFixed(2)} MB (worker ${(workerSource.length / 1024).toFixed(0)} KB)`);

if (install) {
	mkdirSync(install, { recursive: true });
	for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(OUT, file), join(install, file));
	console.log(`Installed into ${install}`);
}
