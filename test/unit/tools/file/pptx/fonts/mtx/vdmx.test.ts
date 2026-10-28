// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from 'vitest';

import { decodeVdmx } from '../../../../../../../src/tools/file/pptx/fonts/mtx/vdmx';
import { EotError, EotErrorCode } from '../../../../../../../src/tools/file/pptx/fonts/mtx/errors';
import { Stream } from '../../../../../../../src/tools/file/pptx/fonts/mtx/stream';

function magnitudeBits(value: number): number[] {
	if (value === 0) return [0];
	return [...new Array<number>(Math.abs(value)).fill(1), 0, value < 0 ? 1 : 0];
}

function packLsbBits(bits: number[]): Uint8Array {
	const bytes = new Uint8Array(Math.ceil(bits.length / 8));
	for (let i = 0; i < bits.length; i++) bytes[i >> 3] |= bits[i] << (i & 7);
	return bytes;
}

function compressedVdmx(
	entries: { ppemError: number; yMaxError: number; yMinError: number }[],
	options: { version?: number; offset?: number; padding?: number } = {},
): Uint8Array {
	const groupOffset = options.offset ?? 12;
	const s = new Stream(null, 0);
	s.writeU16(options.version ?? 1);
	s.writeU16(1); // numRecs
	s.writeU16(1); // numRatios
	s.writeU8(0);
	s.writeU8(0);
	s.writeU8(0);
	s.writeU8(0);
	s.writeU16(groupOffset);
	while (s.pos < groupOffset) s.writeU8(0);
	s.writeU16(entries.length);
	s.writeS16(2048); // yMaxMultiplier = 1.0 in 7.11 fixed point
	s.writeS16(2048); // yMinMultiplier = 1.0 in 7.11 fixed point
	const bits = entries.flatMap((entry) => [
		...magnitudeBits(entry.ppemError),
		...magnitudeBits(entry.yMaxError),
		...magnitudeBits(entry.yMinError),
	]);
	for (const byte of packLsbBits(bits)) s.writeU8(byte);
	for (let i = 0; i < (options.padding ?? 0); i++) s.writeU8(0xaa);
	return s.toUint8Array();
}

function compressedVdmxWithGroups(): Uint8Array {
	const s = new Stream(null, 0);
	s.writeU16(1);
	s.writeU16(2); // numRecs
	s.writeU16(3); // numRatios, with an alias for group zero
	for (let i = 0; i < 3; i++) {
		s.writeU8(0);
		s.writeU8(0);
		s.writeU8(0);
		s.writeU8(0);
	}
	s.writeU16(24);
	s.writeU16(24);
	s.writeU16(100); // second expanded group lies beyond the compressed input
	while (s.pos < 24) s.writeU8(0);
	for (let i = 0; i < 2; i++) {
		s.writeU16(1);
		s.writeS16(2048);
		s.writeS16(2048);
		s.writeU8(0); // three zero surprises, then byte aligned
	}
	return s.toUint8Array();
}

function rawVdmx(): Uint8Array {
	return new Uint8Array([
		0, 0, // version
		0, 1, // numRecs
		0, 1, // numRatios
		0, 1, 1, 1, // ratio record
		0, 12, // group offset
		0, 1, 9, 9, // one record, startsz, endsz
		0, 9, 0, 5, 0xff, 0xfb, // yPelHeight, yMax, yMin
	]);
}

describe('decodeVdmx', () => {
	it('rejects truncated raw fallback headers and records', () => {
		expect(() => decodeVdmx(new Uint8Array([0xff, 0xff]))).toThrow(EotError);
		const truncated = rawVdmx().slice(0, -1);
		truncated[0] = truncated[1] = 0xff;
		expect(() => decodeVdmx(truncated)).toThrow(EotError);
	});

	it('reconstructs ppem, yMax and yMin records from magnitude errors', () => {
		const input = compressedVdmx(
			[
				{ ppemError: 1, yMaxError: -4, yMinError: 4 },
				{ ppemError: 1, yMaxError: -1, yMinError: 5 },
			],
		);
		const result = decodeVdmx(input);
		expect(result).toHaveLength(28);
		expect(result.slice(12, 28)).toEqual(
			new Uint8Array([
				0, 2, 9, 11,
				0, 9, 0, 5, 0xff, 0xfb,
				0, 11, 0, 10, 0xff, 0xfa,
			]),
		);
	});

	it('restores the original version for uncompressed fallback tables', () => {
		const raw = rawVdmx();
		const input = raw.slice();
		input[0] = 0xff;
		input[1] = 0xff;
		expect(decodeVdmx(input)).toEqual(raw);
	});

	it('expands sequential groups while preserving aliased ratio offsets', () => {
		const output = decodeVdmx(compressedVdmxWithGroups());
		expect(output).toHaveLength(110);
		expect(output[18] * 256 + output[19]).toBe(24);
		expect(output[20] * 256 + output[21]).toBe(24);
		expect(output[22] * 256 + output[23]).toBe(100);
		expect(output.slice(24, 34)).toEqual(new Uint8Array([0, 1, 8, 8, 0, 8, 0, 8, 0xff, 0xf8]));
		expect(output.slice(100, 110)).toEqual(new Uint8Array([0, 1, 8, 8, 0, 8, 0, 8, 0xff, 0xf8]));
	});

	it('rejects an offset that overlaps the table header', () => {
		const input = compressedVdmx([{ ppemError: 0, yMaxError: 0, yMinError: 0 }], { offset: 8 });
		expect(() => decodeVdmx(input)).toThrow(EotError);
		try {
			decodeVdmx(input);
		} catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.CorruptFile);
		}
	});

	it('rejects truncated magnitude data with a typed byte error', () => {
		const input = compressedVdmx([{ ppemError: 0, yMaxError: 0, yMinError: 0 }]);
		const truncated = input.slice(0, 18); // group header only, no encoded values
		expect(() => decodeVdmx(truncated)).toThrow(EotError);
		try {
			decodeVdmx(truncated);
		} catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.InsufficientBytes);
		}
	});

	it('rejects non-increasing reconstructed ppem heights', () => {
		const input = compressedVdmx([
			{ ppemError: 0, yMaxError: 0, yMinError: 0 },
			{ ppemError: -2, yMaxError: 0, yMinError: 0 },
		], { padding: 12 });
		expect(() => decodeVdmx(input)).toThrow(/invalid or unsorted ppem/);
	});
});
