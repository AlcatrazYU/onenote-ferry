// SHA-1 for the WebAssembly build, computed by Node's crypto (native speed) instead of in
// WebAssembly. The view passed in is not copied.
const { createHash } = require('node:crypto');

function sha1Hex(data) {
	return createHash('sha1').update(data).digest('hex');
}

module.exports = { sha1Hex };
