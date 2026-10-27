// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { EotError, EotErrorCode } from './errors';
import { Stream } from './stream';

/**
 * Read one MTX magnitude-dependent signed value (section 5.3).
 * Bits are consumed least-significant-bit first within each byte. Zero is a
 * single zero bit; nonzero values are unary magnitude, terminator, then sign.
 */
export function readMagnitude(stream: Stream): number {
	const readBit = (): number => {
		if (stream.pos >= stream.size) {
			throw new EotError(EotErrorCode.InsufficientBytes, 'truncated magnitude value');
		}
		const bit = (stream.buf[stream.pos] >> stream.bitPos) & 1;
		stream.bitPos++;
		if (stream.bitPos === 8) {
			stream.bitPos = 0;
			stream.pos++;
		}
		return bit;
	};

	if (readBit() === 0) return 0;
	let magnitude = 1;
	while (readBit() === 1) magnitude++;
	return readBit() === 1 ? -magnitude : magnitude;
}
