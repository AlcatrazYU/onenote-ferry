import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPasswordProtected } from '../src/core/encryption.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

test('a password-protected section is recognised by its Office encryption description', () => {
	const xml = '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption"><keyData cipherAlgorithm="AES"/></encryption>';
	assert.ok(isPasswordProtected(bytes(`\u0000\u0001binary${xml}more`)));
	assert.ok(!isPasswordProtected(bytes('http://schemas.microsoft.com/office/2006/encryptio')));
	assert.ok(!isPasswordProtected(bytes('an ordinary section, nothing encrypted')));
	assert.ok(!isPasswordProtected(new Uint8Array()));
});
