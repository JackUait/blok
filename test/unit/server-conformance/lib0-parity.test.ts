/**
 * Blok writes lib0's wire format and runs lib0's text diff with its own code.
 * lib0 is still installed, because yjs and y-protocols depend on it, and here
 * it is only the reference: every case must give the same bytes or diff.
 * The phantom-dependency law allows this file to import lib0 for that reason.
 */
import * as lib0Diff from 'lib0/diff';
import * as lib0Encoding from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Encoder } from '../../../src/components/modules/collaboration/wire-encoding';
import { simpleDiffString } from '../../../src/components/modules/yjs/simple-diff';

type Write =
  | { kind: 'uint'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bytes'; value: Uint8Array };

const ours = (writes: Write[]): Uint8Array => {
  const encoder = new Encoder();

  for (const write of writes) {
    if (write.kind === 'uint') {
      encoder.writeVarUint(write.value);
    } else if (write.kind === 'string') {
      encoder.writeVarString(write.value);
    } else {
      encoder.writeVarUint8Array(write.value);
    }
  }

  return encoder.toUint8Array();
};

const theirs = (writes: Write[]): Uint8Array => {
  const encoder = lib0Encoding.createEncoder();

  for (const write of writes) {
    if (write.kind === 'uint') {
      lib0Encoding.writeVarUint(encoder, write.value);
    } else if (write.kind === 'string') {
      lib0Encoding.writeVarString(encoder, write.value);
    } else {
      lib0Encoding.writeVarUint8Array(encoder, write.value);
    }
  }

  return lib0Encoding.toUint8Array(encoder);
};

const createRandom = (seed: number): ((bound: number) => number) => {
  let state = seed;

  return (bound) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return (state >>> 0) % bound;
  };
};

// Units that stress UTF-8: ASCII, 2- and 3-byte chars, a surrogate pair, and both lone halves.
const UNITS = ['a', 'Z', ' ', '\0', 'é', 'ж', '龟', '\u{fffd}', '\u{d83d}\u{de1d}', '\u{d83d}', '\u{dc77}'];

const randomString = (next: (bound: number) => number, maxUnits: number): string =>
  Array.from({ length: next(maxUnits + 1) }, () => UNITS[next(UNITS.length)]).join('');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lib0 parity: wire-encoding', () => {
  it.each([0, 1, 127, 128, 255, 256, 16383, 16384, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 52, Number.MAX_SAFE_INTEGER])(
    'writes varuint %i as lib0 does',
    (value) => {
      expect(ours([{ kind: 'uint', value }])).toEqual(theirs([{ kind: 'uint', value }]));
    }
  );

  // lib0 encodes short strings through a shared buffer and long ones with
  // TextEncoder.encode; the switch sits at 10000 UTF-16 units.
  it.each([9999, 10000, 10001])('writes a %i-unit string as lib0 does, on both sides of its buffer switch', (units) => {
    for (const unit of ['a', '龟', '\u{d83d}']) {
      const value = unit.repeat(units);

      expect(ours([{ kind: 'string', value }])).toEqual(theirs([{ kind: 'string', value }]));
    }
  });

  it('writes lone surrogates as lib0 does', () => {
    for (const value of ['\u{d83d}', '\u{dc77}', 'a\u{d83d}', '\u{dc77}\u{d83d}', '\u{d83d}\u{d83d}\u{de1d}']) {
      expect(ours([{ kind: 'string', value }])).toEqual(theirs([{ kind: 'string', value }]));
    }
  });

  it('writes random frames as lib0 does', () => {
    const seed = 0x5eed_b10c;
    const next = createRandom(seed);

    for (let frame = 0; frame < 2000; frame += 1) {
      const writes: Write[] = Array.from({ length: next(8) + 1 }, (): Write => {
        const pick = next(3);

        if (pick === 0) {
          // 53 random bits, then cut to a random width so every byte length shows up.
          const full = next(2 ** 26) * 2 ** 27 + next(2 ** 27);

          return { kind: 'uint', value: Math.floor(full / 2 ** next(54)) };
        }

        if (pick === 1) {
          return { kind: 'string', value: randomString(next, 40) };
        }

        return { kind: 'bytes', value: Uint8Array.from({ length: next(600) }, () => next(256)) };
      });

      expect(ours(writes), `seed ${seed}, frame ${frame}`).toEqual(theirs(writes));
    }
  }, 30_000);
});

describe('lib0 parity: simpleDiffString', () => {
  it('diffs random pairs as lib0 does', () => {
    const seed = 0xd1ff;
    const next = createRandom(seed);

    for (let pair = 0; pair < 20_000; pair += 1) {
      const before = randomString(next, 10);
      // Half the pairs share a prefix and suffix, so the trimming paths run.
      const after = next(2) === 0
        ? randomString(next, 10)
        : before.slice(0, next(before.length + 1)) + randomString(next, 3) + before.slice(next(before.length + 1));

      expect(simpleDiffString(before, after), `seed ${seed}, pair ${pair}: ${JSON.stringify([before, after])}`)
        .toEqual(lib0Diff.simpleDiffString(before, after));
    }
  });
});
