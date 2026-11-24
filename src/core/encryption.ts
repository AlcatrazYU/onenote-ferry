// Recognises a password-protected section. OneNote writes the standard Office encryption description
// (an XML document in the namespace below) near the start of such a file, in the OneDrive download
// format and in the desktop format alike. The parser cannot read these sections: their password has
// to be removed in OneNote first.

const MARKER = new TextEncoder().encode('http://schemas.microsoft.com/office/2006/encryption');

/** How much of the start of a section file to look at. */
export const ENCRYPTION_MARKER_WINDOW = 1024 * 1024;

/** Whether these bytes (the start of a section file) belong to a password-protected section. */
export function isPasswordProtected(bytes: Uint8Array): boolean {
	const first = MARKER[0];
	outer: for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - MARKER.length; i = bytes.indexOf(first, i + 1)) {
		for (let k = 1; k < MARKER.length; k++) if (bytes[i + k] !== MARKER[k]) continue outer;
		return true;
	}
	return false;
}
