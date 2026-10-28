// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, it, expect } from 'vitest';

import { parseCTF } from '../../../../../../../src/tools/file/pptx/fonts/mtx/ctf-parser';
import { EotError, EotErrorCode } from '../../../../../../../src/tools/file/pptx/fonts/mtx/errors';
import { Stream } from '../../../../../../../src/tools/file/pptx/fonts/mtx/stream';
import { dumpContainer } from '../../../../../../../src/tools/file/pptx/fonts/mtx/sfnt-builder';

/** Minimal 54-byte `head` table (indexToLocFormat lives at offset 50). */
function minimalHead(): Uint8Array {
	return new Uint8Array(54);
}

/** Minimal 32-byte `maxp` v1.0 table with numGlyphs = 0. */
function minimalMaxp(): Uint8Array {
	const s = new Stream(null, 0);
	s.reserve(32);
	s.writeU32(0x00010000); // version 1.0
	for (let i = 0; i < 14; i++) {
		s.writeU16(0); // numGlyphs + the 13 v1.0 limit fields
	}
	return s.toUint8Array();
}

/** Build one large composite glyph to exercise loca offset boundaries. */
function largeCompositeGlyph(componentCount: number, extraScaleBytes = 0): Uint8Array {
	const s = new Stream(null, 0);
	s.writeS16(-1); // composite glyph
	for (let i = 0; i < 4; i++) s.writeS16(0); // bbox
	for (let i = 0; i < componentCount; i++) {
		const last = i === componentCount - 1;
		const hasScale = last && extraScaleBytes > 0;
		const transformFlag = extraScaleBytes === 2 ? 0x0008 : 0x0040;
		s.writeU16((last ? 0 : 0x0020) | (hasScale ? transformFlag : 0)); // component flags
		s.writeU16(0); // glyph index
		s.writeU8(0); // x argument
		s.writeU8(0); // y argument
		if (hasScale) s.writeS16(0x4000);
		if (hasScale && extraScaleBytes === 4) s.writeS16(0x4000);
	}
	return s.toUint8Array();
}

function parseCompositeForLoca(glyphData: Uint8Array) {
	const head = minimalHead();
	const maxp = minimalMaxp();
	maxp[4] = 0;
	maxp[5] = 1; // numGlyphs = 1
	maxp[28] = 0xff;
	maxp[29] = 0xff; // generous maxComponentElements
	return parseCTF([
		buildMinimalCTFStream0([
			{ tag: 'glyf', data: glyphData },
			{ tag: 'head', data: head },
			{ tag: 'maxp', data: maxp },
		]),
		new Stream(null, 0),
		new Stream(null, 0),
	]);
}

/**
 * Ensure the structural tables parseCTF requires (head, maxp, hmtx) are
 * present, injecting minimal versions for any the caller did not supply.
 */
function withRequiredTables(
	tables: { tag: string; data: Uint8Array }[],
): { tag: string; data: Uint8Array }[] {
	const have = new Set(tables.map((t) => t.tag));
	const result = [...tables];
	if (!have.has('head')) {
		result.push({ tag: 'head', data: minimalHead() });
	}
	if (!have.has('maxp')) {
		result.push({ tag: 'maxp', data: minimalMaxp() });
	}
	if (!have.has('hmtx')) {
		result.push({ tag: 'hmtx', data: new Uint8Array([0, 0, 0, 0]) });
	}
	return result;
}

/**
 * Build a minimal CTF stream[0] that contains an SFNT header and
 * table directory, plus the raw table data. The structural tables required
 * by parseCTF (head, maxp, hmtx) are injected automatically when absent.
 *
 * This is a helper for constructing test inputs for parseCTF.
 */
function buildMinimalCTFStream0(inputTables: { tag: string; data: Uint8Array }[]): Stream {
	return buildRawCTFStream0(withRequiredTables(inputTables));
}

/**
 * Build a CTF stream[0] from exactly the given tables, with no injection of
 * required structural tables. Use this to exercise the missing-table guards.
 */
function buildRawCTFStream0(tables: { tag: string; data: Uint8Array }[]): Stream {
	const s = new Stream(null, 0);

	// --- SFNT offset table (12 bytes) ---
	s.writeU32(0x00010000); // scalarType (TrueType)
	s.writeU16(tables.length); // numTables
	s.writeU16(0); // searchRange (not validated by parser)
	s.writeU16(0); // entrySelector
	s.writeU16(0); // rangeShift

	// The table directory follows immediately: 16 bytes per entry.
	// After the directory, we'll place each table's data.
	const dirEnd = 12 + tables.length * 16;
	let currentOffset = dirEnd;

	// --- Table directory entries ---
	for (const t of tables) {
		// 4-byte ASCII tag
		for (let i = 0; i < 4; i++) {
			s.writeU8(t.tag.charCodeAt(i));
		}
		s.writeU32(0); // checksum (skipped by parser)
		s.writeU32(currentOffset); // offset
		s.writeU32(t.data.length); // size
		currentOffset += t.data.length;
	}

	// --- Table data ---
	for (const t of tables) {
		for (let i = 0; i < t.data.length; i++) {
			s.writeU8(t.data[i]);
		}
	}

	s.seekAbsolute(0);
	return s;
}

describe('parseCTF', () => {
	// -----------------------------------------------------------------------
	// Minimal container with no glyf/loca
	// -----------------------------------------------------------------------
	it('parses a minimal CTF with a single table', () => {
		const tableData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
		const s0 = buildMinimalCTFStream0([{ tag: 'name', data: tableData }]);
		const s1 = new Stream(new Uint8Array(0), 0);
		const s2 = new Stream(new Uint8Array(0), 0);

		const container = parseCTF([s0, s1, s2]);

		const name = container.tables.find((t) => t.tag === 'name')!;
		expect(name).toBeDefined();
		expect(name.bufSize).toBe(4);
		expect(name.buf).toStrictEqual(tableData);
	});

	it('parses multiple tables', () => {
		const tables = [
			{ tag: 'name', data: new Uint8Array([0x01, 0x02]) },
			{ tag: 'post', data: new Uint8Array([0x03, 0x04, 0x05]) },
			{ tag: 'OS/2', data: new Uint8Array([0x06]) },
		];
		const s0 = buildMinimalCTFStream0(tables);
		const s1 = new Stream(new Uint8Array(0), 0);
		const s2 = new Stream(new Uint8Array(0), 0);

		const container = parseCTF([s0, s1, s2]);

		expect(container.tables.find((t) => t.tag === 'name')).toBeDefined();
		expect(container.tables.find((t) => t.tag === 'post')).toBeDefined();
		expect(container.tables.find((t) => t.tag === 'OS/2')).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// Metric table reconstruction
	// -----------------------------------------------------------------------
	it('preserves raw hdmx tables and restores their complemented version', () => {
		const raw = new Uint8Array([0xff, 0xff, 0, 1, 0, 0, 0, 4, 10, 6, 6, 5]);
		const s0 = buildMinimalCTFStream0([
			{ tag: 'hdmx', data: raw },
			{ tag: 'name', data: new Uint8Array([0xaa, 0xbb]) },
		]);
		const warnings: string[] = [];
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)], {
			onWarn: (m) => warnings.push(m),
		});

		const expected = raw.slice();
		expected[0] = expected[1] = 0;
		expect(container.tables.find((t) => t.tag === 'hdmx')?.buf).toEqual(expected);
		const name = container.tables.find((t) => t.tag === 'name')!;
		expect(name).toBeDefined();
		expect(name.buf).toStrictEqual(new Uint8Array([0xaa, 0xbb]));

		expect(container.droppedTables).toBeUndefined();
		expect(warnings).toHaveLength(0);
	});

	it('reconstructs compressed VDMX records', () => {
		const data = new Uint8Array([
			0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 12,
			0, 2, 8, 0, 4, 0, 0,
		]);
		const s0 = buildMinimalCTFStream0([{ tag: 'VDMX', data }]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);
		expect(container.tables.find((t) => t.tag === 'VDMX')?.buf).toEqual(new Uint8Array([
			0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 12,
			0, 2, 8, 9, 0, 8, 0, 8, 255, 252, 0, 9, 0, 9, 255, 251,
		]));
		expect(container.droppedTables).toBeUndefined();
	});

	it('reconstructs hdmx using dependencies appearing later in the directory', () => {
		const head = minimalHead();
		head[18] = 3;
		head[19] = 232; // unitsPerEm = 1000
		const maxp = minimalMaxp();
		maxp[5] = 2;
		const hhea = new Uint8Array(36);
		hhea[35] = 1; // last advance width is reused for glyph 1
		const s0 = buildMinimalCTFStream0([
			{ tag: 'hdmx', data: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 4, 10, 6, 1]) },
			{ tag: 'head', data: head }, { tag: 'maxp', data: maxp },
			{ tag: 'hhea', data: hhea },
			{ tag: 'hmtx', data: new Uint8Array([1, 244, 0, 0, 0, 0]) },
		]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);
		const expected = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 4, 10, 6, 6, 5]);
		const hdmx = container.tables.find((t) => t.tag === 'hdmx')!;
		expect(hdmx.buf).toEqual(expected);
		expect(hdmx.bufSize).toBe(expected.length);
		const font = dumpContainer(container);
		expect(font.subarray(hdmx.offset, hdmx.offset + hdmx.bufSize)).toEqual(expected);
		let checksum = 0;
		const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
		for (let offset = 0; offset < font.length; offset += 4) {
			checksum = (checksum + view.getUint32(offset)) >>> 0;
		}
		expect(checksum).toBe(0xb1b0afba);
	});

	it.each(['hdmx', 'VDMX'])('rejects truncated %s instead of dropping it', (tag) => {
		const s0 = buildMinimalCTFStream0([{ tag, data: new Uint8Array([0]) }]);
		expect(() => parseCTF([s0, new Stream(null, 0), new Stream(null, 0)])).toThrow(EotError);
	});

	it('omits droppedTables when nothing is dropped', () => {
		const s0 = buildMinimalCTFStream0([{ tag: 'name', data: new Uint8Array([0xaa, 0xbb]) }]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);
		expect(container.droppedTables).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// head table zeroing of checksumAdjustment
	// -----------------------------------------------------------------------
	it('zeroes out bytes 8-11 of the head table', () => {
		// A minimal head table (54 bytes minimum for indexToLocFormat at offset 50)
		const headData = new Uint8Array(54);
		// Set bytes 8-11 to non-zero values
		headData[8] = 0xde;
		headData[9] = 0xad;
		headData[10] = 0xbe;
		headData[11] = 0xef;
		// Set indexToLocFormat at offset 50-51
		headData[50] = 0x00;
		headData[51] = 0x00;

		const s0 = buildMinimalCTFStream0([{ tag: 'head', data: headData }]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);

		const head = container.tables.find((t) => t.tag === 'head')!;
		expect(head).toBeDefined();
		// checksumAdjustment (bytes 8-11) should be zeroed
		expect(head.buf[8]).toBe(0);
		expect(head.buf[9]).toBe(0);
		expect(head.buf[10]).toBe(0);
		expect(head.buf[11]).toBe(0);
	});

	it('keeps short loca at the maximum representable offset', () => {
		// 10-byte composite header + 21843 six-byte components + a two-byte scale
		// field gives an even final offset of exactly 131070.
		const container = parseCompositeForLoca(largeCompositeGlyph(21843, 2));
		const loca = container.tables.find((t) => t.tag === 'loca')!;
		const head = container.tables.find((t) => t.tag === 'head')!;
		expect(loca.bufSize).toBe(4);
		expect(loca.buf[2] * 256 + loca.buf[3]).toBe(65535);
		expect(head.buf[50]).toBe(0);
		expect(head.buf[51]).toBe(0);
	});

	it('promotes short loca when reconstructed glyf exceeds 131070 bytes', () => {
		const container = parseCompositeForLoca(largeCompositeGlyph(21843, 4));
		const loca = container.tables.find((t) => t.tag === 'loca')!;
		const head = container.tables.find((t) => t.tag === 'head')!;
		const finalOffset =
			loca.buf[4] * 0x1000000 +
			loca.buf[5] * 0x10000 +
			loca.buf[6] * 0x100 +
			loca.buf[7];
		expect(finalOffset).toBe(131072);
		expect(loca.bufSize).toBe(8);
		expect(head.buf[50]).toBe(0);
		expect(head.buf[51]).toBe(1);
	});

	it('rejects an invalid head indexToLocFormat', () => {
		const head = minimalHead();
		head[51] = 2;
		const s0 = buildMinimalCTFStream0([{ tag: 'head', data: head }]);
		expect(() => parseCTF([s0, new Stream(null, 0), new Stream(null, 0)])).toThrow(
			/malformed head table|invalid head indexToLocFormat/i,
		);
	});

	// -----------------------------------------------------------------------
	// Container type
	// -----------------------------------------------------------------------
	it('returns an SFNTContainer with a tables array', () => {
		const s0 = buildMinimalCTFStream0([{ tag: 'cmap', data: new Uint8Array(10) }]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);
		expect(container).toHaveProperty('tables');
		expect(Array.isArray(container.tables)).toBeTruthy();
	});

	// -----------------------------------------------------------------------
	// Empty container
	// -----------------------------------------------------------------------
	it('rejects a container with zero tables (no required tables present)', () => {
		const s = new Stream(null, 0);
		s.writeU32(0x00010000);
		s.writeU16(0); // 0 tables
		s.writeU16(0);
		s.writeU16(0);
		s.writeU16(0);
		s.seekAbsolute(0);

		// A font with no tables is missing maxp/head/hmtx — parseCTF must reject
		// it rather than return an empty container.
		expect(() => parseCTF([s, new Stream(null, 0), new Stream(null, 0)])).toThrow(
			/missing a maxp table/,
		);
	});

	// -----------------------------------------------------------------------
	// Table data integrity
	// -----------------------------------------------------------------------
	it('preserves exact table data bytes', () => {
		const data = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			data[i] = i;
		}

		const s0 = buildMinimalCTFStream0([{ tag: 'cmap', data }]);
		const container = parseCTF([s0, new Stream(null, 0), new Stream(null, 0)]);

		const cmap = container.tables.find((t) => t.tag === 'cmap')!;
		expect(cmap).toBeDefined();
		expect(cmap.bufSize).toBe(256);
		for (let i = 0; i < 256; i++) {
			expect(cmap.buf[i]).toBe(i);
		}
	});

	// -----------------------------------------------------------------------
	// Structural validity guards (ported from libeot parseCTF.c)
	// -----------------------------------------------------------------------
	const empty = () => new Stream(null, 0);

	it('throws EotError NoMaxpTable when maxp is absent', () => {
		// head + hmtx present, maxp deliberately omitted (raw builder — no injection).
		const s0 = buildRawCTFStream0([
			{ tag: 'head', data: minimalHead() },
			{ tag: 'hmtx', data: new Uint8Array([0, 0, 0, 0]) },
		]);
		try {
			parseCTF([s0, empty(), empty()]);
			expect.fail('expected parseCTF to throw for missing maxp');
		} catch (e) {
			expect(e).toBeInstanceOf(EotError);
			expect((e as EotError).code).toBe(EotErrorCode.NoMaxpTable);
		}
	});

	it('throws EotError NoHmtxTable when hmtx is absent', () => {
		const s0 = buildRawCTFStream0([
			{ tag: 'head', data: minimalHead() },
			{ tag: 'maxp', data: minimalMaxp() },
		]);
		try {
			parseCTF([s0, empty(), empty()]);
			expect.fail('expected parseCTF to throw for missing hmtx');
		} catch (e) {
			expect(e).toBeInstanceOf(EotError);
			expect((e as EotError).code).toBe(EotErrorCode.NoHmtxTable);
		}
	});

	it('throws EotError MalformedHeadTable for a head table shorter than 12 bytes', () => {
		const s0 = buildRawCTFStream0([
			{ tag: 'head', data: new Uint8Array(8) },
			{ tag: 'maxp', data: minimalMaxp() },
			{ tag: 'hmtx', data: new Uint8Array([0, 0, 0, 0]) },
		]);
		try {
			parseCTF([s0, empty(), empty()]);
			expect.fail('expected parseCTF to throw for a short head table');
		} catch (e) {
			expect(e).toBeInstanceOf(EotError);
			expect((e as EotError).code).toBe(EotErrorCode.MalformedHeadTable);
		}
	});
});
