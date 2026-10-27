// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Decode the MTX magnitude-compressed VDMX table back to OpenType form.
 *
 * `data` is the bounded compressed byte range, beginning at the table's
 * version field. Ratio offsets retain their reconstructed OpenType positions;
 * compressed groups are read sequentially from offset[0] and expanded into
 * those locations. The returned array may be larger than `data`.
 */

import { EotError, EotErrorCode } from './errors';
import { Stream } from './stream';
import { readMagnitude } from './magnitude';

function malformed(message: string): never {
	throw new EotError(EotErrorCode.CorruptFile, `malformed VDMX table: ${message}`);
}

function ensureRange(start: number, length: number, limit: number, what: string): void {
	if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > limit) {
		malformed(`${what} is outside the ${limit}-byte table`);
	}
}

function toInt16(value: number, what: string): number {
	if (!Number.isInteger(value) || value < -32768 || value > 32767) {
		malformed(`${what} is outside the signed 16-bit range`);
	}
	return value;
}

function validateUncompressed(data: Uint8Array): void {
	if (data.length < 6) malformed('table is shorter than its header');
	const input = new Stream(data, data.length);
	const version = input.readU16();
	if (version !== 0 && version !== 1) malformed(`unsupported OpenType version ${version}`);
	const numRecs = input.readU16();
	const numRatios = input.readU16();
	if (numRecs === 0 || numRatios === 0) malformed('table must contain at least one group and ratio');
	const headerEnd = 6 + numRatios * 6;
	ensureRange(6, numRatios * 4, data.length, 'ratio records');
	input.seekAbsolute(6 + numRatios * 4);
	const offsets: number[] = [];
	for (let i = 0; i < numRatios; i++) offsets.push(input.readU16());
	const groupStarts = [...new Set(offsets)].sort((a, b) => a - b);
	if (groupStarts.length !== numRecs) {
		malformed(`ratio offsets identify ${groupStarts.length} groups, header declares ${numRecs}`);
	}
	for (let i = 0; i < groupStarts.length; i++) {
		const start = groupStarts[i];
		if (start < headerEnd) malformed('group offset overlaps the header');
		ensureRange(start, 4, data.length, `group ${i} header`);
		input.seekAbsolute(start);
		const recs = input.readU16();
		input.readU8(); // startsz
		input.readU8(); // endsz
		if (recs === 0) malformed(`group ${i} has no records`);
		const size = 4 + recs * 6;
		const limit = groupStarts[i + 1] ?? data.length;
		if (start + size > limit) malformed(`group ${i} extends past its table boundary`);
		let previousPpem = -1;
		for (let j = 0; j < recs; j++) {
			const ppem = input.readU16();
			input.readS16();
			input.readS16();
			if (ppem <= previousPpem) malformed(`group ${i} has unsorted ppem heights`);
			previousPpem = ppem;
		}
	}
}

/**
 * Decode a bounded CTF VDMX table. Uncompressed fallback tables are copied
 * through with their original version restored, as prescribed by MTX §5.5.
 */
export function decodeVdmx(data: Uint8Array): Uint8Array {
	if (data.length < 2) {
		throw new EotError(EotErrorCode.InsufficientBytes, 'VDMX table is shorter than its version field');
	}
	const input = new Stream(data, data.length);
	const version = input.readU16();

	if (version > 1) {
		const originalVersion = 0xffff - version;
		if (originalVersion !== 0 && originalVersion !== 1) {
			malformed(`unsupported version marker ${version}`);
		}
		const output = data.slice();
		output[0] = originalVersion >>> 8;
		output[1] = originalVersion & 0xff;
		validateUncompressed(output);
		return output;
	}

	ensureRange(0, 6, data.length, 'header');
	const numRecs = input.readU16();
	const numRatios = input.readU16();
	if (numRecs === 0 || numRatios === 0) {
		malformed('compressed table must contain at least one group and ratio');
	}
	const headerEnd = 6 + numRatios * 6;
	ensureRange(6, numRatios * 4, data.length, 'ratio records');
	input.seekAbsolute(6 + numRatios * 4);
	const offsets: number[] = [];
	for (let i = 0; i < numRatios; i++) offsets.push(input.readU16());
	const groupStarts = [...new Set(offsets)].sort((a, b) => a - b);
	if (groupStarts.length !== numRecs) {
		malformed(`ratio offsets identify ${groupStarts.length} groups, header declares ${numRecs}`);
	}
	if (groupStarts[0] !== offsets[0]) {
		malformed('the first ratio offset must point to the first compressed group');
	}
	for (const offset of groupStarts) {
		if (offset < headerEnd) malformed('group offset overlaps the header');
	}
	input.seekAbsolute(offsets[0]);

	let output = data.slice();
	for (let groupIndex = 0; groupIndex < numRecs; groupIndex++) {
		const compressedStart = input.pos;
		const recs = input.readU16();
		const yMaxMultiplier = input.readS16();
		const yMinMultiplier = input.readS16();
		if (recs === 0) malformed(`group ${groupIndex} has no records`);
		const expandedSize = 4 + recs * 6;
		const groupStart = groupStarts[groupIndex];
		const groupLimit = groupStarts[groupIndex + 1] ?? data.length;
		if (groupIndex + 1 < numRecs && groupStart + expandedSize > groupLimit) {
			malformed(`expanded group ${groupIndex} overlaps the next group`);
		}

		const records = new Stream(null, 0);
		records.reserve(recs * 6);
		let predictedPpem = 8;
		let previousPpem = -1;
		let startSize = 0;
		let endSize = 0;
		for (let i = 0; i < recs; i++) {
			const ppemError = readMagnitude(input);
			const yMaxError = readMagnitude(input);
			const yMinError = readMagnitude(input);
			const ppem = ppemError + predictedPpem;
			if (!Number.isInteger(ppem) || ppem < 0 || ppem > 0xffff || ppem <= previousPpem) {
				malformed(`group ${groupIndex} has an invalid or unsorted ppem`);
			}
			const predictedYMax = Math.trunc((ppem * yMaxMultiplier + 1024) / 2048);
			const predictedYMin = -Math.trunc((ppem * yMinMultiplier + 1024) / 2048);
			const yMax = toInt16(predictedYMax + yMaxError, `group ${groupIndex} yMax`);
			const yMin = toInt16(predictedYMin + yMinError, `group ${groupIndex} yMin`);
			if (i === 0) startSize = ppem;
			if (i === recs - 1) endSize = ppem;
			records.writeU16(ppem);
			records.writeS16(yMax);
			records.writeS16(yMin);
			previousPpem = ppem;
			predictedPpem = ppem + 1;
		}
		if (input.bitPos !== 0) {
			input.pos++;
			input.bitPos = 0;
		}
		ensureRange(compressedStart, input.pos - compressedStart, data.length, `compressed group ${groupIndex}`);
		const outputGroup = new Stream(null, 0);
		outputGroup.reserve(expandedSize);
		outputGroup.writeU16(recs);
		outputGroup.writeU8(startSize & 0xff);
		outputGroup.writeU8(endSize & 0xff);
		for (const byte of records.toUint8Array()) outputGroup.writeU8(byte);
		const groupEnd = groupStart + expandedSize;
		if (groupEnd > output.length) {
			const expanded = new Uint8Array(groupEnd);
			expanded.set(output);
			output = expanded;
		}
		output.set(outputGroup.toUint8Array(), groupStart);
	}

	validateUncompressed(output);
	return output;
}
