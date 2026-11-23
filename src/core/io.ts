// The only ways the core talks to the outside world. The command line implements them with
// Node's file system; the plugin will implement them with Obsidian's vault.

/** Where a parsed section's attachment bytes come from, one attachment at a time. */
export interface SectionSource {
	/** The bytes of the attachment the parser named `key`. Throws when it is missing. */
	readAsset(key: string): Promise<Uint8Array>;
}

/**
 * Where output goes. Paths are relative to the output root and use `/`.
 * Writing a file creates the folders above it.
 */
export interface Sink {
	ensureFolder(path: string): Promise<void>;
	writeText(path: string, text: string): Promise<void>;
	writeBinary(path: string, bytes: Uint8Array): Promise<void>;
	setModifiedTime(path: string, time: Date): Promise<void>;
}
