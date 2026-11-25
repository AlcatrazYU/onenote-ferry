// Bytes handed to Obsidian or to the window. Node's Buffer.slice is a view on the same memory, not a
// copy, and a small file read from disk sits in Node's shared 8 KB pool: handing on the memory
// under it would hand on the whole pool (a 605-byte picture written as 8 KB of whatever else was in
// it). ArrayBuffer.slice always copies.

/** The bytes as an ArrayBuffer holding exactly them (the vault takes ArrayBuffers). */
export function ownArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? bytes.buffer as ArrayBuffer
		: (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** A copy of the bytes in memory of its own (to hand over to the window, say). */
export function copyOf(bytes: Uint8Array): Uint8Array {
	return new Uint8Array((bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
