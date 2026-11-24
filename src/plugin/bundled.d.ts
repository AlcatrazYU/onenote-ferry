// Modules the plugin build provides (scripts/build-plugin.mjs).

declare module 'onenote-ferry:worker' {
	/** The worker's bundled code. */
	const source: string;
	export default source;
}

declare module 'onenote-ferry:wasm' {
	/** The parser's WebAssembly, base64. */
	const base64: string;
	export default base64;
}
