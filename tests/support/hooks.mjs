// Module hooks for tests of plugin code: `obsidian` is the stub beside this file, and the two
// modules the plugin build makes up (the worker's code and the parser) are empty.

const STUB = new URL('./obsidian.mjs', import.meta.url).href;
const EMPTY = 'data:text/javascript,export default ""';

export async function resolve(specifier, context, next) {
	if (specifier === 'obsidian') return { url: STUB, shortCircuit: true };
	if (specifier === 'onenote-ferry:worker' || specifier === 'onenote-ferry:wasm') return { url: EMPTY, shortCircuit: true };
	return next(specifier, context);
}
