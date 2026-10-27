// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * mtx-decompressor — MicroType Express (MTX) font decompressor.
 *
 * Converts MTX-compressed font data (found inside EOT containers) back into
 * standard TrueType (.ttf) font files.
 *
 * Ported from libeot (MPL 2.0) by Brennan T. Vincent.
 * See: https://github.com/nicowilliams/libeot
 *
 * @packageDocumentation
 */

export { decompressMtx, decompressEotFont, unpackMtx } from './mtx-decompress';
export { parseCTF } from './ctf-parser';
export type { SFNTContainer, SFNTTable, ParseCTFOptions } from './ctf-parser';
export { EotError, EotErrorCode, EOT_WARN } from './errors';
export {
	parseEotMetadata,
	inspectEotProtection,
	eotToTtf,
	canLegallyEdit,
	TTEMBED_SUBSET,
	TTEMBED_TTCOMPRESSED,
	TTEMBED_XORENCRYPTDATA,
} from './eot';
export type { EotMetadata, EotVersion, EotProtection } from './eot';
