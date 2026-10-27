// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from 'vitest';

import { EotError, EotErrorCode } from '../../../../../../../src/tools/file/pptx/fonts/mtx/errors';
import { decodeHdmx } from '../../../../../../../src/tools/file/pptx/fonts/mtx/hdmx';

function compressedHdmx(numRecords: number, recordSize: number, recordHeaders: number[], bits: number[]): Uint8Array {
	const out = new Uint8Array(8 + recordHeaders.length + bits.length);
	out[0] = 0;
	out[1] = 0; // compressed version 0
	out[2] = numRecords >>> 8;
	out[3] = numRecords;
	out[4] = recordSize >>> 24;
	out[5] = recordSize >>> 16;
	out[6] = recordSize >>> 8;
	out[7] = recordSize;
	out.set(recordHeaders, 8);
	out.set(bits, 8 + recordHeaders.length);
	return out;
}

describe('decodeHdmx', () => {
	it('rejects expanded tables beyond the memory budget before allocation', () => {
		const input = compressedHdmx(1024, 65540, [], []);
		expect(() => decodeHdmx(input, {
			numGlyphs: 65535, unitsPerEm: 1000, numberOfHMetrics: 1, hmtx: new Uint8Array(4),
		})).toThrow(/decoded table is too large/);
	});

	it('reconstructs device widths from hmtx predictions plus LSB-first surprises', () => {
		// For ppem 10 and unitsPerEm 1000, advances [500,1000,1000] predict [5,10,10].
		// Encoded surprises 0,+1,-1 occupy bits 0 | 100 | 101 = 0x52.
		const input = compressedHdmx(1, 8, [10, 17], [0x52]);
		const result = decodeHdmx(input, {
			numGlyphs: 3,
			unitsPerEm: 1000,
			numberOfHMetrics: 2,
			hmtx: new Uint8Array([0x01, 0xf4, 0, 0, 0x03, 0xe8, 0, 0, 0, 0]),
		});
		expect(result).toHaveLength(16);
		expect(Array.from(result.subarray(8, 13))).toEqual([10, 17, 5, 11, 9]);
		expect(Array.from(result.subarray(13))).toEqual([0, 0, 0]);
	});

	it('applies OpenType integer rounding to predicted advance widths', () => {
		const input = compressedHdmx(1, 4, [3, 4], [0]);
		const result = decodeHdmx(input, {
			numGlyphs: 1,
			unitsPerEm: 1000,
			numberOfHMetrics: 1,
			hmtx: new Uint8Array([0x01, 0xf4, 0, 0]),
		});
		expect(result[10]).toBe(2); // 3 * 500 / 1000 rounds from 1.5 to 2.
	});

	it('reads all record headers before one shared bitstream across record boundaries', () => {
		// Record 1's zero consumes one bit; record 2's +1 starts at bitPos 1.
		const input = compressedHdmx(2, 4, [10, 8, 20, 12], [0b00000010]);
		const result = decodeHdmx(input, {
			numGlyphs: 1,
			unitsPerEm: 1000,
			numberOfHMetrics: 1,
			hmtx: new Uint8Array([0x01, 0xf4, 0, 0]),
		});
		expect(Array.from(result.subarray(8, 12))).toEqual([10, 8, 5, 0]);
		expect(Array.from(result.subarray(12, 16))).toEqual([20, 12, 11, 0]);
	});

	it('uses MTX fixed-point rounding at a subpixel boundary', () => {
		// 499/1000 is below 0.5, but MTX's 1/64 intermediate rounding yields 1.
		const input = compressedHdmx(1, 4, [1, 0], [0]);
		const result = decodeHdmx(input, {
			numGlyphs: 1,
			unitsPerEm: 1000,
			numberOfHMetrics: 1,
			hmtx: new Uint8Array([0x01, 0xf3, 0, 0]),
		});
		expect(result[10]).toBe(1);
	});

	it('restores the complemented version for an uncompressed CTF table', () => {
		const input = new Uint8Array([0xff, 0xff, 0, 1, 0, 0, 0, 4, 12, 8, 9, 0]);
		const result = decodeHdmx(input);
		expect(result[0]).toBe(0);
		expect(result[1]).toBe(0);
		expect(result.subarray(2)).toEqual(input.subarray(2));
	});

	it('rejects truncated raw records and unsupported versions', () => {
		const truncated = new Uint8Array([0xff, 0xff, 0, 1, 0, 0, 0, 8, 12, 0, 0, 0]);
		expect(() => decodeHdmx(truncated)).toThrow(EotError);
		try { decodeHdmx(truncated); } catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.InsufficientBytes);
		}
		const unsupported = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]);
		expect(() => decodeHdmx(unsupported)).toThrow(EotError);
		try { decodeHdmx(unsupported); } catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.CorruptFile);
		}
	});

	it('rejects missing metric metadata for compressed input', () => {
		expect(() => decodeHdmx(compressedHdmx(1, 4, [10, 0], [0]))).toThrow(EotError);
		try { decodeHdmx(compressedHdmx(1, 4, [10, 0], [0])); } catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.CorruptFile);
		}
	});

	it('rejects truncated headers and magnitude payloads with typed errors', () => {
		expect(() => decodeHdmx(new Uint8Array(7))).toThrow(EotError);
		try { decodeHdmx(new Uint8Array(7)); } catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.InsufficientBytes);
		}
		const missingBits = compressedHdmx(1, 4, [10, 0], []);
		expect(() => decodeHdmx(missingBits, {
			numGlyphs: 1, unitsPerEm: 1000, numberOfHMetrics: 1, hmtx: new Uint8Array(4),
		})).toThrow(EotError);
		try {
			decodeHdmx(missingBits, {
				numGlyphs: 1, unitsPerEm: 1000, numberOfHMetrics: 1, hmtx: new Uint8Array(4),
			});
		} catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.InsufficientBytes);
		}
	});

	it('rejects inconsistent record size before allocating output', () => {
		const invalid = compressedHdmx(0xffff, 0xffffffff, [], []);
		expect(() => decodeHdmx(invalid, {
			numGlyphs: 1,
			unitsPerEm: 1000,
			numberOfHMetrics: 1,
			hmtx: new Uint8Array(4),
		})).toThrow(EotError);
	});
});
