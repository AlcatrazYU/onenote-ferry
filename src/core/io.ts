// The only ways the core talks to the outside world. The command line implements them with
// Node's file system; the plugin implements them with Obsidian's vault.

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
	/** Writes a text file (replacing one that is there), with `modified` as its modification time when given. */
	writeText(path: string, text: string, modified?: Date): Promise<void>;
	writeBinary(path: string, bytes: Uint8Array): Promise<void>;
	/** Text of a file written earlier, or undefined when there is none. */
	readText(path: string): Promise<string | undefined>;
	/** Every file below a folder, as paths from the output root. */
	listFiles(folder: string): Promise<string[]>;
	/** A file's modification time (milliseconds) and size, or undefined when there is none; not every sink can tell. */
	stat?(path: string): Promise<{ mtime: number, size: number } | undefined>;
}
