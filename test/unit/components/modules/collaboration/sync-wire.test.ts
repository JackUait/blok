// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type {
  SyncWireDecodeResult,
  SyncWireFrame,
} from '../../../../../src/components/modules/collaboration/types';

/**
 * The client codec is the THIRD implementation pinned by
 * test/unit/server-conformance/fixtures/sync-frames.json — the same file the
 * C# SyncWireFramingTests loads. Every fixture must decode to the right
 * semantics AND re-encode byte-for-byte, so the client, the server and the
 * reference y-protocols encoders never drift.
 */

interface FixtureFrame {
  name: string;
  messageType: number;
  syncType?: number;
  authType?: number;
  description: string;
  frameHex: string;
  payloadHex: string;
  reason?: string;
  awareness?: { clientId: number; clock: number; stateJson: string };
  control?: { epoch: number; format: number; lineage: string };
  limits?: { maxMessageBytes: number };
}

interface V2Metadata {
  lineage: string;
  operationId: string;
  serverSequence?: string;
  code?: string;
}

interface V2FrameFixture {
  name: string;
  messageType: number;
  canonical: boolean;
  description: string;
  frameHex: string;
  metadataJson: string;
  metadata: V2Metadata;
  updateHex?: string;
}

interface V2NegativeFixture {
  name: string;
  messageType?: number;
  expect: 'malformed' | 'unknown';
  rule?: number;
  description: string;
  frameHex: string;
  metadataJson?: string;
}

interface V2Fixture {
  protocol: string;
  lineage: string;
  operationId: string;
  rejectionCodes: string[];
  rejectionCodePattern: string;
  frames: V2FrameFixture[];
  negative: V2NegativeFixture[];
}

interface Fixture {
  frames: FixtureFrame[];
  v2: V2Fixture;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../server-conformance/fixtures/sync-frames.json', import.meta.url),
    ),
    'utf8',
  ),
) as Fixture;

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
const hex = (data: Uint8Array): string => Buffer.from(data).toString('hex');

/** Narrows a decode result to a good frame or fails the test with its reason. */
function goodFrame(result: SyncWireDecodeResult): SyncWireFrame {
  if (result.type === 'malformed') {
    throw new Error(`expected a frame, got malformed: ${result.reason}`);
  }

  if (result.type === 'unknown') {
    throw new Error(`expected a frame, got unknown type ${result.messageType}`);
  }

  return result;
}

const frameByName = (name: string): FixtureFrame => {
  const found = fixture.frames.find((frame) => frame.name === name);

  if (found === undefined) {
    throw new Error(`fixture is missing frame "${name}"`);
  }

  return found;
};

const v2FrameByName = (name: string): V2FrameFixture => {
  const found = fixture.v2.frames.find((frame) => frame.name === name);

  if (found === undefined) {
    throw new Error(`fixture is missing v2 frame "${name}"`);
  }

  return found;
};

describe('sync-wire codec — committed fixtures (cross-impl contract)', () => {
  it('the fixture carries every message type this codec speaks', () => {
    expect(fixture.frames.map((frame) => frame.name).sort()).toEqual(
      ['awareness', 'blokControl', 'blokLimits', 'permissionDenied', 'queryAwareness', 'syncStep1', 'syncStep2', 'update'].sort(),
    );
  });

  it('decodes syncStep1 to the seed state vector and re-encodes byte-identically', () => {
    const frame = frameByName('syncStep1');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('syncStep1');

    if (decoded.type !== 'syncStep1') {
      throw new Error('unreachable');
    }

    expect(hex(decoded.stateVector)).toBe(frame.payloadHex);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes syncStep2 to the full update and re-encodes byte-identically', () => {
    const frame = frameByName('syncStep2');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('syncStep2');

    if (decoded.type !== 'syncStep2') {
      throw new Error('unreachable');
    }

    expect(hex(decoded.update)).toBe(frame.payloadHex);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes an incremental update and re-encodes byte-identically', () => {
    const frame = frameByName('update');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('update');

    if (decoded.type !== 'update') {
      throw new Error('unreachable');
    }

    expect(hex(decoded.update)).toBe(frame.payloadHex);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes awareness as opaque relayed bytes and re-encodes byte-identically', () => {
    const frame = frameByName('awareness');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('awareness');

    if (decoded.type !== 'awareness') {
      throw new Error('unreachable');
    }

    // The codec never parses the awareness interior; it relays the bytes verbatim.
    expect(hex(decoded.update)).toBe(frame.payloadHex);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes an auth permission-denied reason and re-encodes byte-identically', () => {
    const frame = frameByName('permissionDenied');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('permissionDenied');

    if (decoded.type !== 'permissionDenied') {
      throw new Error('unreachable');
    }

    expect(decoded.reason).toBe(frame.reason);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes queryAwareness and re-encodes byte-identically', () => {
    const frame = frameByName('queryAwareness');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('queryAwareness');
    expect(hex(encode(goodFrame(decoded)))).toBe(frame.frameHex);
  });

  it('decodes the blok control frame to its working-set tag and re-encodes byte-identically', () => {
    const frame = frameByName('blokControl');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('control');

    if (decoded.type !== 'control') {
      throw new Error('unreachable');
    }

    expect(decoded.tag).toEqual(frame.control);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('decodes the blok limits frame to its message cap and re-encodes byte-identically', () => {
    const frame = frameByName('blokLimits');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('limits');

    if (decoded.type !== 'limits') {
      throw new Error('unreachable');
    }

    expect(decoded.maxMessageBytes).toBe(frame.limits?.maxMessageBytes);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });
});

describe('sync-wire codec — encode contract', () => {
  it('round-trips a control frame at the epoch-0 / all-zero-lineage boundary', () => {
    const tag = { epoch: 0, format: 1, lineage: '0'.repeat(32) };
    const decoded = decode(encode({ type: 'control', tag }));

    expect(decoded).toEqual({ type: 'control', tag });
  });

  it('refuses to encode an empty sync payload', () => {
    expect(() => encode({ type: 'syncStep1', stateVector: new Uint8Array(0) })).toThrow();
  });

  it('refuses to encode a non-announceable control tag', () => {
    expect(() => encode({ type: 'control', tag: { epoch: -1, format: 1, lineage: '0'.repeat(32) } })).toThrow();
    expect(() => encode({ type: 'control', tag: { epoch: 0, format: 0, lineage: '0'.repeat(32) } })).toThrow();
    expect(() => encode({ type: 'control', tag: { epoch: 0, format: 1, lineage: 'nothex' } })).toThrow();
  });

  it('round-trips a limits frame at the 1-byte boundary', () => {
    const decoded = decode(encode({ type: 'limits', maxMessageBytes: 1 }));

    expect(decoded).toEqual({ type: 'limits', maxMessageBytes: 1 });
  });

  it('refuses to encode a non-positive, fractional or unsafe limits value', () => {
    expect(() => encode({ type: 'limits', maxMessageBytes: 0 })).toThrow();
    expect(() => encode({ type: 'limits', maxMessageBytes: -1 })).toThrow();
    expect(() => encode({ type: 'limits', maxMessageBytes: 1.5 })).toThrow();
    expect(() => encode({ type: 'limits', maxMessageBytes: 2 ** 53 })).toThrow();
  });
});

const VALID_LINEAGE = '5f3a9c1e7b04d28a6cf1e0937b52d84a';

const controlFrame = (json: string): Uint8Array => {
  const payload = new TextEncoder().encode(json);
  const out = new Uint8Array(payload.length + 2);

  // [100][varuint len < 128][utf8 json]; every JSON below fits one length byte.
  out[0] = 100;
  out[1] = payload.length;
  out.set(payload, 2);

  return out;
};

const bomControlFrame = (json: string): Uint8Array => {
  const payload = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json)]);
  const out = new Uint8Array(payload.length + 2);

  out[0] = 100;
  out[1] = payload.length;
  out.set(payload, 2);

  return out;
};

const limitsFrame = (json: string): Uint8Array => {
  const payload = new TextEncoder().encode(json);
  const out = new Uint8Array(payload.length + 2);

  // [101][varuint len < 128][utf8 json]; every JSON below fits one length byte.
  out[0] = 101;
  out[1] = payload.length;
  out.set(payload, 2);

  return out;
};

describe('sync-wire codec — fuzz / hostile input never throws', () => {
  const malformedCases: Array<{ name: string; input: Uint8Array }> = [
    { name: 'a zero-length frame', input: new Uint8Array(0) },
    { name: 'trailing bytes after queryAwareness', input: bytes('0300') },
    { name: 'a sync sub-type past Update (3)', input: bytes('0003') },
    { name: 'an auth sub-type other than permissionDenied (1)', input: bytes('0201') },
    { name: 'a sync length prefix beyond the buffer', input: bytes('0000ff') },
    // Awareness length prefix = 2^31, checked before any allocation.
    { name: 'a 2GB awareness length prefix (no alloc before bounds check)', input: bytes('018080808008') },
    // Ten 0x80 continuation bytes + 0x00 = an 11-byte varuint lib0 itself accepts.
    { name: 'a varuint longer than 10 bytes', input: bytes('8080808080808080808000') },
    // Ten bytes whose tenth carries more than the top bit of a 64-bit value.
    { name: 'a 10-byte varuint whose tenth byte is 0x02', input: bytes('80808080808080808002') },
    { name: 'a non-UTF-8 control payload', input: bytes('6402ffff') },
    { name: 'a BOM-prefixed control payload', input: bomControlFrame(`{"epoch":7,"format":1,"lineage":"${VALID_LINEAGE}"}`) },
    { name: 'a control payload with a duplicate key', input: controlFrame(`{"epoch":7,"epoch":8,"format":1,"lineage":"${VALID_LINEAGE}"}`) },
    { name: 'a control payload with a unicode-escaped (dup-evading) key', input: controlFrame(`{"ep\\u006fch":8,"epoch":7,"format":1,"lineage":"${VALID_LINEAGE}"}`) },
    { name: 'a control payload with an unknown key', input: controlFrame(`{"epoch":7,"format":1,"lineage":"${VALID_LINEAGE}","extra":1}`) },
    { name: 'a control payload missing lineage', input: controlFrame('{"epoch":7,"format":1}') },
    { name: 'a control payload with a non-32-hex lineage', input: controlFrame('{"epoch":7,"format":1,"lineage":"xyz"}') },
    { name: 'a control payload with an uppercase-hex lineage', input: controlFrame(`{"epoch":7,"format":1,"lineage":"${VALID_LINEAGE.toUpperCase()}"}`) },
    { name: 'a control payload with a fractional epoch', input: controlFrame(`{"epoch":7.5,"format":1,"lineage":"${VALID_LINEAGE}"}`) },
    { name: 'a control payload with format 0', input: controlFrame(`{"epoch":0,"format":0,"lineage":"${VALID_LINEAGE}"}`) },
    { name: 'a control payload that is a JSON array', input: controlFrame('[1,2,3]') },
    { name: 'a control payload that is a JSON string', input: controlFrame('"hello"') },
    { name: 'a control payload that is not JSON', input: controlFrame('not json') },
    { name: 'a truncated control length prefix', input: bytes('64ff') },
    { name: 'a truncated limits length prefix', input: bytes('65ff') },
    { name: 'a limits frame without a payload', input: bytes('65') },
    { name: 'a non-UTF-8 limits payload', input: bytes('6502ffff') },
    { name: 'a limits payload with an unknown key', input: limitsFrame('{"maxMessageBytes":1048576,"extra":1}') },
    { name: 'a limits payload missing its key', input: limitsFrame('{}') },
    { name: 'a limits payload with a string value', input: limitsFrame('{"maxMessageBytes":"big"}') },
    { name: 'a limits payload with a negative value', input: limitsFrame('{"maxMessageBytes":-1}') },
    { name: 'a limits payload with a zero value', input: limitsFrame('{"maxMessageBytes":0}') },
    { name: 'a limits payload with a fractional value', input: limitsFrame('{"maxMessageBytes":1.5}') },
    { name: 'a limits payload past the safe-integer range', input: limitsFrame('{"maxMessageBytes":9007199254740992}') },
    { name: 'a limits payload with a duplicate key', input: limitsFrame('{"maxMessageBytes":1,"maxMessageBytes":2}') },
    { name: 'a limits payload with a unicode-escaped (dup-evading) key', input: limitsFrame('{"maxMessageByte\\u0073":1,"maxMessageBytes":2}') },
    { name: 'a limits payload that is a JSON array', input: limitsFrame('[1048576]') },
    { name: 'a limits payload that is not JSON', input: limitsFrame('not json') },
  ];

  for (const { name, input } of malformedCases) {
    it(`treats ${name} as malformed without throwing`, () => {
      let result: SyncWireDecodeResult | undefined;

      expect(() => {
        result = decode(input);
      }).not.toThrow();
      expect(result?.type).toBe('malformed');
    });
  }

  it('treats an unknown OUTER type as an ignorable unknown frame, trailing bytes and all', () => {
    // Type 5 is unknown; the payload after it is left unread (no RequireEnd).
    const withTrailing = decode(bytes('05ffff'));

    expect(withTrailing).toEqual({ type: 'unknown', messageType: 5 });

    const bare = decode(bytes('63'));

    expect(bare).toEqual({ type: 'unknown', messageType: 99 });
  });

  it('accepts a 10-byte varuint type whose tenth byte is the top bit as a (huge) unknown type', () => {
    const result = decode(bytes('80808080808080808001'));

    expect(result.type).toBe('unknown');
  });

  it('accepts an empty auth reason (permissionDenied with an empty string)', () => {
    const result = decode(bytes('020000'));

    expect(result).toEqual({ type: 'permissionDenied', reason: '' });
  });

  it('decodes a frame carried in a view with a non-zero byteOffset', () => {
    // A decoder built from a subarray must honour the view's byteOffset when it
    // constructs its own byte views; otherwise every read is shifted.
    const frame = frameByName('queryAwareness');
    const raw = bytes(frame.frameHex);
    const padded = new Uint8Array(raw.length + 3);

    padded.set(raw, 3);

    const view = new Uint8Array(padded.buffer, 3, raw.length);

    expect(decode(view)).toEqual({ type: 'queryAwareness' });
  });

  it('never throws and always returns a known discriminator on random bytes', () => {
    const known = new Set([
      'syncStep1', 'syncStep2', 'update', 'awareness',
      'queryAwareness', 'permissionDenied', 'control', 'limits', 'unknown', 'malformed',
    ]);
    let seed = 0x12345678;
    const nextByte = (): number => {
      // Deterministic xorshift so a red run reproduces exactly.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;

      return seed & 0xff;
    };

    for (let iteration = 0; iteration < 2000; iteration += 1) {
      const length = nextByte() % 40;
      const input = new Uint8Array(length);

      for (let index = 0; index < length; index += 1) {
        input[index] = nextByte();
      }

      let result: SyncWireDecodeResult | undefined;

      expect(() => {
        result = decode(input);
      }, `random input ${hex(input)}`).not.toThrow();
      expect(known.has(result?.type ?? ''), `random input ${hex(input)}`).toBe(true);
    }
  });
});

describe('sync-wire codec — v2 operations, acknowledgements and rejections', () => {
  it('the fixture carries every v2 positive frame this codec speaks', () => {
    const expectedNames = [
      'operation',
      'acknowledgement',
      'acknowledgementMaxSequence',
      'acknowledgementKeysOutOfOrder',
      'rejection:lineage-mismatch',
      'rejection:read-only',
      'rejection:not-synced',
      'rejection:invalid-update',
      'rejection:oversized-update',
      'rejection:operation-id-conflict',
      'rejectionUnrecognisedCode',
      'rejectionCodeMaxLength',
    ];

    expect(fixture.v2.frames.map((frame) => frame.name).sort()).toEqual(expectedNames.sort());
  });

  it('round-trips an operation byte-identically', () => {
    const frame = v2FrameByName('operation');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('operation');

    if (decoded.type !== 'operation') {
      throw new Error('unreachable');
    }

    expect(decoded.lineage).toBe(frame.metadata.lineage);
    expect(decoded.operationId).toBe(frame.metadata.operationId);
    expect(hex(decoded.update)).toBe(frame.updateHex);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('round-trips an exact acknowledgement with a decimal server sequence', () => {
    for (const name of ['acknowledgement', 'acknowledgementMaxSequence']) {
      const frame = v2FrameByName(name);
      const decoded = decode(bytes(frame.frameHex));

      expect(decoded.type, name).toBe('acknowledgement');

      if (decoded.type !== 'acknowledgement') {
        throw new Error('unreachable');
      }

      expect(decoded.lineage, name).toBe(frame.metadata.lineage);
      expect(decoded.operationId, name).toBe(frame.metadata.operationId);
      // A decimal STRING, not a number — the u64 ceiling doesn't fit a double.
      expect(typeof decoded.serverSequence, name).toBe('string');
      expect(decoded.serverSequence, name).toBe(frame.metadata.serverSequence);
      expect(hex(encode(decoded)), name).toBe(frame.frameHex);
    }
  });

  it('decodes an acknowledgement whose metadata keys arrived out of order, decode-only', () => {
    // canonical: false — an encoder fed these fields would rightly emit the
    // canonical key order, so re-encoding is never asserted for this fixture.
    const frame = v2FrameByName('acknowledgementKeysOutOfOrder');

    expect(frame.canonical).toBe(false);

    const decoded = decode(bytes(frame.frameHex));

    expect(decoded).toEqual({
      type: 'acknowledgement',
      lineage: frame.metadata.lineage,
      operationId: frame.metadata.operationId,
      serverSequence: frame.metadata.serverSequence,
    });
  });

  it('round-trips every stable rejection code', () => {
    expect(fixture.v2.rejectionCodes.length).toBe(6);

    for (const code of fixture.v2.rejectionCodes) {
      const frame = v2FrameByName(`rejection:${code}`);
      const decoded = decode(bytes(frame.frameHex));

      expect(decoded.type, code).toBe('rejection');

      if (decoded.type !== 'rejection') {
        throw new Error('unreachable');
      }

      expect(decoded.lineage, code).toBe(frame.metadata.lineage);
      expect(decoded.operationId, code).toBe(frame.metadata.operationId);
      expect(decoded.code, code).toBe(code);
      expect(hex(encode(decoded)), code).toBe(frame.frameHex);
    }
  });

  it('accepts a rejection code outside the stable six as a final rejection, not malformed', () => {
    const frame = v2FrameByName('rejectionUnrecognisedCode');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('rejection');

    if (decoded.type !== 'rejection') {
      throw new Error('unreachable');
    }

    expect(decoded.code).toBe(frame.metadata.code);
    expect(fixture.v2.rejectionCodes).not.toContain(decoded.code);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('round-trips a rejection code at the 64-character grammar ceiling', () => {
    const frame = v2FrameByName('rejectionCodeMaxLength');
    const decoded = decode(bytes(frame.frameHex));

    expect(decoded.type).toBe('rejection');

    if (decoded.type !== 'rejection') {
      throw new Error('unreachable');
    }

    expect(decoded.code.length).toBe(64);
    expect(hex(encode(decoded))).toBe(frame.frameHex);
  });

  it('rejects every malformed v2 fixture', () => {
    const malformedFixtures = fixture.v2.negative.filter((entry) => entry.expect === 'malformed');

    // Every rule 1-12 in the spec has at least one vector; this keeps the loop
    // below from silently covering nothing if the fixture ever shrinks.
    expect(malformedFixtures.length).toBeGreaterThanOrEqual(12);

    for (const negative of malformedFixtures) {
      const result = decode(bytes(negative.frameHex));

      expect(result.type, negative.name).toBe('malformed');

      if (result.type !== 'malformed') {
        throw new Error('unreachable');
      }

      // The rule attribution IS the assertion: a decoder that refuses every
      // vector for the wrong reason must not pass this test.
      expect(result.rule, `${negative.name}: ${negative.description}`).toBe(negative.rule);
    }
  });

  it('attributes the lower-numbered framing rule over a metadata rule the same frame also violates', () => {
    // No fixture pins this (every fixture violates exactly one rule, or a
    // documented pair within 6-12). type(102) varstring(len=1, 0xff — invalid
    // UTF-8, rule 6) varbytes(len=0 — empty update, rule 4). A decoder that
    // checks framing section-by-section (read metadata, decode it, THEN read
    // the update) finds rule 6 first; the spec's normative ascending order
    // means every framing rule (1-5) is decided before any metadata rule
    // (6-12), so the correct answer is rule 4.
    const result = decode(bytes('6601ff00'));

    expect(result.type).toBe('malformed');

    if (result.type !== 'malformed') {
      throw new Error('unreachable');
    }

    expect(result.rule).toBe(4);
  });

  it('keeps every v1 fixture byte-identical', () => {
    for (const frame of fixture.frames) {
      const decoded = goodFrame(decode(bytes(frame.frameHex)));

      expect(hex(encode(decoded)), frame.name).toBe(frame.frameHex);
    }
  });

  it('ignores an unknown outer type', () => {
    const negative = fixture.v2.negative.find((entry) => entry.name === 'unknownOuterType');

    if (negative === undefined) {
      throw new Error('fixture is missing negative "unknownOuterType"');
    }

    expect(negative.expect).toBe('unknown');

    const decoded = decode(bytes(negative.frameHex));

    expect(decoded).toEqual({ type: 'unknown', messageType: negative.messageType });
  });
});
