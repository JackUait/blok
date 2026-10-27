// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Translation of the MicroType Express CTF `hdmx` table to its SFNT form. */

import { EotError, EotErrorCode } from './errors';
import { readMagnitude } from './magnitude';
import { Stream } from './stream';

export interface HdmxMetadata {
	/** `maxp.numGlyphs`. */
	numGlyphs: number;
	/** `head.unitsPerEm`. */
	unitsPerEm: number;
	/** `hhea.numberOfHMetrics`. */
	numberOfHMetrics: number;
	/** Raw big-endian SFNT `hmtx` table bytes. */
	hmtx: Uint8Array;
}

// Match the LZCOMP expansion budget before allocating reconstructed metrics.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function fail(message: string): never {
	throw new EotError(EotErrorCode.CorruptFile, `invalid hdmx table: ${message}`);
}

function u16(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
	return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
}

function putU16(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value >>> 8;
	bytes[offset + 1] = value & 0xff;
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
	bytes[offset] = value >>> 24;
	bytes[offset + 1] = value >>> 16;
	bytes[offset + 2] = value >>> 8;
	bytes[offset + 3] = value;
}

/**
 * Decode an `hdmx` table from CTF bytes. Tables stored uncompressed by the
 * MTX encoder (complemented version field) are copied with their version
 * restored and do not need metric metadata.
 */
export function decodeHdmx(data: Uint8Array, metadata?: HdmxMetadata): Uint8Array {
	if (data.length < 8) {
		throw new EotError(EotErrorCode.InsufficientBytes, 'truncated hdmx header');
	}
	const encodedVersion = u16(data, 0);
	const numRecords = u16(data, 2);
	const recordSize = u32(data, 4);

	// CTF stores an incompressible table verbatim with version = 0xFFFF - TTF version.
	// OpenType hdmx currently defines only version 0.
	if (encodedVersion === 0xffff) {
		if (recordSize < 2 || recordSize % 4 !== 0) fail('invalid raw record size');
		const rawLength = 8 + numRecords * recordSize;
		if (!Number.isSafeInteger(rawLength) || rawLength > data.length) {
			throw new EotError(EotErrorCode.InsufficientBytes, 'truncated raw hdmx records');
		}
		const raw = data.slice();
		putU16(raw, 0, 0);
		return raw;
	}
	if (encodedVersion !== 0) fail(`unsupported version ${encodedVersion}`);

	if (!metadata) fail('missing head/hhea/hmtx/maxp metadata');
	const { numGlyphs, unitsPerEm, numberOfHMetrics, hmtx } = metadata;
	if (!Number.isInteger(numGlyphs) || numGlyphs < 0 || numGlyphs > 0xffff) fail('invalid numGlyphs');
	if (!Number.isInteger(unitsPerEm) || unitsPerEm <= 0 || unitsPerEm > 0xffff) fail('invalid unitsPerEm');
	if (!Number.isInteger(numberOfHMetrics) || numberOfHMetrics < 1 || numberOfHMetrics > numGlyphs) {
		fail('invalid numberOfHMetrics');
	}

	const expectedRecordSize = (numGlyphs + 2 + 3) & ~3;
	if (recordSize !== expectedRecordSize) fail('recordSize does not match glyph count');
	const outputLength = 8 + numRecords * recordSize;
	if (!Number.isSafeInteger(outputLength) || outputLength > MAX_OUTPUT_BYTES) {
		fail('decoded table is too large');
	}
	const headerLength = 8 + numRecords * 2;
	if (headerLength > data.length) {
		throw new EotError(EotErrorCode.InsufficientBytes, 'truncated hdmx record headers');
	}
	const minBitsBytes = Math.ceil((numRecords * numGlyphs) / 8);
	if (headerLength + minBitsBytes > data.length) {
		throw new EotError(EotErrorCode.InsufficientBytes, 'truncated hdmx magnitude data');
	}

	const hmtxLength = numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2;
	if (hmtx.length < hmtxLength) fail('hmtx table is too short');
	const advances = new Uint16Array(numGlyphs);
	let lastAdvance = 0;
	for (let glyph = 0; glyph < numGlyphs; glyph++) {
		if (glyph < numberOfHMetrics) {
			lastAdvance = u16(hmtx, glyph * 4);
		}
		advances[glyph] = lastAdvance;
	}

	const out = new Uint8Array(outputLength);
	putU16(out, 0, encodedVersion);
	putU16(out, 2, numRecords);
	putU32(out, 4, recordSize);
	const bits = new Stream(data.subarray(headerLength), data.length - headerLength);
	for (let record = 0; record < numRecords; record++) {
		const sourceRecord = 8 + record * 2;
		const targetRecord = 8 + record * recordSize;
		const ppem = data[sourceRecord];
		out[targetRecord] = ppem;
		out[targetRecord + 1] = data[sourceRecord + 1]; // maxWidth is stored as-is in CTF.
		for (let glyph = 0; glyph < numGlyphs; glyph++) {
			const aw = advances[glyph];
			const rounded64 = Math.floor((64 * ppem * aw + unitsPerEm / 2) / unitsPerEm);
			const predicted = Math.floor((rounded64 + 32) / 64);
			const width = predicted + readMagnitude(bits);
			if (width < 0 || width > 0xff) fail(`decoded width out of range (${width})`);
			out[targetRecord + 2 + glyph] = width;
		}
	}
	return out;
}
