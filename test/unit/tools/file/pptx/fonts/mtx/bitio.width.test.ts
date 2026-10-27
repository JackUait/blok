// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from 'vitest';

import { WIDTH_SAMPLES } from './__fixtures__/value-edge-samples';
import { BitIO } from '../../../../../../../src/tools/file/pptx/fonts/mtx/bitio';

describe('BitIO — narrow widths (fixtures)', () => {
	it.each(WIDTH_SAMPLES)('readValue $name -> $value', ({ bytes, width, value }) => {
		const io = new BitIO(Uint8Array.from(bytes));
		expect(io.readValue(width)).toBe(value);
	});
});
