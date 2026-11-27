// The only ways the core talks to the outside world. The command line implements them with
// Node's file system; the plugin implements them with Obsidian's vault.

/** Where a parsed section's attachment bytes come from, one attachment at a time. */
export interface SectionSource {
	/** The bytes of the attachment the parser named `key`. Throws when it is missing. */
	readAsset(key: string): Promise<Uint8Array>;
	/**
	 * How dark each pixel row of the picture named `key` is, as the parser reads it
	 * (`[width, height, paper, dark...]`, see parser/ferry/src/profile.rs), or nothing when it
	 * cannot tell. Not every source can (§11.5 item 67).
	 */
	rowProfile?(key: string): Promise<Float32Array | undefined>;
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

/**
 * What updating notes in place needs on top of writing them (§11.5 item 49). There is no way to
 * delete: what an update replaces or OneNote no longer has is moved aside, never removed.
 */
export interface UpdateSink extends Sink {
	stat(path: string): Promise<{ mtime: number, size: number } | undefined>;
	/** Whether a file or a folder is at the path (as the disk compares names: maybe ignoring case). */
	exists(path: string): boolean | Promise<boolean>;
	readBinary(path: string): Promise<Uint8Array | undefined>;
	/**
	 * Moves (renames) a file or a folder, with the folders above `to` made as needed. Throws when
	 * something else is at `to` already (a change of case only is a rename of the same file).
	 */
	move(from: string, to: string): Promise<void>;
	/** Copies a file, keeping its modification time. Throws when something is at `to` already. */
	copy(from: string, to: string): Promise<void>;
	/** Adds text at the end of a file, making it when there is none. */
	appendText(path: string, text: string): Promise<void>;
}
