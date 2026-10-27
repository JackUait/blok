// Derived from mtx-decompressor 1.8.0 (MPL-2.0); modified for Blok. See NOTICE.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Narrow-width bit-reading fixtures for the MSB-first BitIO reader tests.
 */

export interface WidthSample {
	readonly name: string;
	readonly bytes: readonly number[];
	readonly width: number;
	readonly value: number;
}

export const WIDTH_SAMPLES: readonly WidthSample[] = [
	{ name: '1 bit set', bytes: [0x80], width: 1, value: 1 },
	{ name: '1 bit clear', bytes: [0x00], width: 1, value: 0 },
	{ name: '2 bits', bytes: [0xc0], width: 2, value: 3 },
	{ name: '3 high bits', bytes: [0xe0], width: 3, value: 7 },
	{ name: '3 bits, low set', bytes: [0x20], width: 3, value: 1 },
	{ name: '4 bits', bytes: [0xa0], width: 4, value: 0xa },
];
