// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from 'vitest';

import { EotError, EotErrorCode } from '../../../../../../../src/tools/file/pptx/fonts/mtx/errors';
import { readMagnitude } from '../../../../../../../src/tools/file/pptx/fonts/mtx/magnitude';
import { Stream } from '../../../../../../../src/tools/file/pptx/fonts/mtx/stream';

describe('readMagnitude', () => {
	it('reads zero and positive/negative unary magnitudes LSB first', () => {
		// 0, +1 (100), -1 (101), +2 (1100), -2 (1101), packed low bit first.
		const stream = new Stream(new Uint8Array([0b11010010, 0b01011001]), 2);
		const values = [0, 1, -1, 2, -2];
		for (const value of values) expect(readMagnitude(stream)).toBe(value);
	});

	it('throws INSUFFICIENT_BYTES for a truncated magnitude', () => {
		const stream = new Stream(new Uint8Array([0xff]), 1);
		expect(() => readMagnitude(stream)).toThrow(EotError);
		try { readMagnitude(stream); } catch (error) {
			expect((error as EotError).code).toBe(EotErrorCode.InsufficientBytes);
		}
	});
});
