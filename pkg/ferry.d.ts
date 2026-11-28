/* tslint:disable */
/* eslint-disable */
export function parseSection(path: string): ParsedSection;
/**
 * The names a notebook's table of contents (`.onetoc2`, its bytes) lists, in OneNote's order:
 * sections as `<name>.one`, section groups by their folder names. Empty when it cannot be read.
 */
export function tocNames(data: Uint8Array): string[];
/**
 * Current WebAssembly memory in bytes. Memory never shrinks, so after a parse this is its peak.
 */
export function memoryBytes(): number;
export class ParsedSection {
  private constructor();
  free(): void;
  /**
   * The bytes of the attachment named `key` in the JSON (`<sha1>.<ext>`).
   */
  readAsset(key: string): Uint8Array;
  /**
   * How dark each pixel row of the picture named `key` is (see profile.rs), or nothing when it
   * cannot be read (not PNG or JPEG, too large, damaged).
   */
  rowProfile(key: string): Float32Array | undefined;
  /**
   * The section's JSON. Taken once: later calls return an empty string.
   */
  takeJson(): string;
  readonly assetCount: number;
}
