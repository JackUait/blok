/**
 * Upload size ceiling for a media tool.
 *
 * - A plain number caps every accepted file, in bytes.
 * - An object caps per MIME type, e.g.
 *     `{ 'image/gif': 30 * 1024 * 1024, '*': 10 * 1024 * 1024 }`
 *   where the `'*'` entry is the fallback for any type not listed. When no
 *   `'*'` entry is present, unlisted types fall back to the tool's own default.
 *
 * Pass `Infinity` (as the number form or a per-type value) to allow any size.
 */
export type MaxSizeConfig = number | Record<string, number>;
