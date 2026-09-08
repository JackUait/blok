// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';

/**
 * Mutation-hardening companion to sync-wire.test.ts.
 *
 * The committed-fixture suite proves the codec agrees with the C# server on
 * every good frame, and that hostile input is refused — but it asserts only
 * `result.type === 'malformed'`, so every refusal REASON and every rule
 * attribution behind it is unpinned. This file asserts the COMPLETE decode
 * result (`toStrictEqual`, which sees an absent `rule` key as different from
 * `rule: undefined`) and the exact message of every encoder throw, so a
 * decoder that refuses the right frames for the wrong reason is red.
 *
 * PROVEN-EQUIVALENT mutants (measured, not assumed — see the probe results
 * quoted on each line):
 *
 *  - 308:5 `typeof epoch !== 'number'`, 309:5 `typeof format !== 'number'` and
 *    358:7 `typeof maxMessageBytes !== 'number'` forced to false. Each is
 *    followed by `!Number.isSafeInteger(sameValue)`, and Number.isSafeInteger
 *    returns false for every non-Number (measured: '7' -> false, undefined ->
 *    false, null -> false, [1] -> false, true -> false), so the negation is
 *    true exactly when the typeof guard was. The disjunction, and therefore
 *    the reason string, is unchanged for every possible input.
 *  - 665:18 `{ type: 'bytes', ... }` -> `{ type: '', ... }`. PayloadResult's
 *    discriminator is read in exactly two places, sync-wire.ts:152 and :218,
 *    and both compare it against 'error' only; nothing ever tests for
 *    'bytes'. Renaming the success tag is unobservable.
 *  - 825:12 `return { ok: false };` -> `return {}` in tryParseJson's catch.
 *    All three callers (decodeControl 289-293, decodeLimits 340-344,
 *    decodeV2Metadata 432-436) branch on `!parsed.ok` and RETURN before
 *    touching `.value`; `{}.ok` and `{ ok: false }.ok` are both falsy.
 */

const utf8 = new TextEncoder();

/** 32 lowercase hex characters — the shape both v2 ids and a v1 lineage take. */
const ID = '5f3a9c1e7b04d28a6cf1e0937b52d84a';
const OTHER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ZERO_LINEAGE = '0'.repeat(32);

const hex = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'hex'));

/** Appends one lib0 varuint (LEB128, low 7 bits first). */
function pushVarUint(out: number[], value: number): void {
  let rest = value;

  while (rest > 127) {
    out.push(128 | (rest % 128));
    rest = Math.floor(rest / 128);
  }

  out.push(rest);
}

/** [varuint type] followed by one [varuint length][bytes] section per argument. */
function frame(type: number, ...sections: Array<Uint8Array | string>): Uint8Array {
  const out: number[] = [];

  pushVarUint(out, type);

  for (const section of sections) {
    const raw = typeof section === 'string' ? utf8.encode(section) : section;

    pushVarUint(out, raw.length);
    out.push(...raw);
  }

  return new Uint8Array(out);
}

const withTrailing = (base: Uint8Array, ...extra: number[]): Uint8Array =>
  new Uint8Array([...base, ...extra]);

const controlFrame = (json: string): Uint8Array => frame(100, json);
const limitsFrame = (json: string): Uint8Array => frame(101, json);
const operationFrame = (metadataJson: string, update = new Uint8Array([0x01])): Uint8Array =>
  frame(102, metadataJson, update);
const acknowledgementFrame = (metadataJson: string): Uint8Array => frame(103, metadataJson);
const rejectionFrame = (metadataJson: string): Uint8Array => frame(104, metadataJson);

const operationMetadata = `{"lineage":"${ID}","operationId":"${OTHER_ID}"}`;
const rejectionMetadata = `{"lineage":"${ID}","operationId":"${OTHER_ID}","code":"read-only"}`;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sync-wire decode — the outer message type', () => {
  it('attributes rule 1 with its own reason to a frame with no message type', () => {
    expect(decode(new Uint8Array(0))).toStrictEqual({
      type: 'malformed',
      reason: 'the message type is missing or malformed',
      rule: 1,
    });
  });
});

describe('sync-wire decode — sync (type 0) refusal reasons', () => {
  it('names the missing sub-type, not the missing payload', () => {
    expect(decode(hex('00'))).toStrictEqual({
      type: 'malformed',
      reason: 'the sync sub-type is missing or malformed',
    });
  });

  it('names the out-of-range sub-type and its value', () => {
    expect(decode(hex('0003'))).toStrictEqual({
      type: 'malformed',
      reason: 'unknown sync sub-type 3',
    });
  });

  it('distinguishes a truncated payload from an empty one', () => {
    // [0][0][len 5] with nothing left: readVarBytes bounds-checks before any copy.
    expect(decode(hex('000005'))).toStrictEqual({
      type: 'malformed',
      reason: 'the payload is missing or truncated',
    });
  });

  it('refuses an empty sync payload instead of decoding a zero-length state vector', () => {
    expect(decode(hex('000000'))).toStrictEqual({
      type: 'malformed',
      reason: 'the payload is empty',
    });
  });

  it('counts the trailing bytes after a complete sync frame', () => {
    // [0][0][len 1][0x01] plus one byte nobody asked for.
    expect(decode(hex('00000101ff'))).toStrictEqual({
      type: 'malformed',
      reason: '1 trailing byte(s) after the message',
    });
  });
});

describe('sync-wire decode — auth (type 2) refusal reasons', () => {
  it('names the missing auth sub-type', () => {
    expect(decode(hex('02'))).toStrictEqual({
      type: 'malformed',
      reason: 'the auth sub-type is missing or malformed',
    });
  });

  it('names the unknown auth sub-type and its value', () => {
    expect(decode(hex('0201'))).toStrictEqual({
      type: 'malformed',
      reason: 'unknown auth sub-type 1',
    });
  });

  it('names a truncated auth reason', () => {
    // [2][0][len 2] with zero bytes left.
    expect(decode(hex('020002'))).toStrictEqual({
      type: 'malformed',
      reason: 'the auth reason is missing or truncated',
    });
  });

  it('refuses a non-UTF-8 auth reason instead of surfacing a null reason', () => {
    expect(decode(hex('020002ffff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the auth reason is not valid UTF-8',
    });
  });
});

describe('sync-wire decode — control (type 100) refusal reasons', () => {
  it('names a missing or truncated control payload before decoding it', () => {
    expect(decode(hex('64ff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is missing or truncated',
    });
  });

  it('names a non-UTF-8 control payload', () => {
    expect(decode(hex('6402ffff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is not valid UTF-8',
    });
  });

  it('names the escape in a control payload', () => {
    const input = controlFrame(`{"ep\\u006fch":8,"epoch":7,"format":1,"lineage":"${ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload contains an escape',
    });
  });

  it('separates unparseable JSON from a parsed non-object', () => {
    expect(decode(controlFrame('not json'))).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is not valid JSON',
    });
  });

  it('names a JSON array control payload as a non-object', () => {
    expect(decode(controlFrame('[1,2,3]'))).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is not a JSON object',
    });
  });

  it('names a JSON string control payload as a non-object, not an unknown property', () => {
    // Object.keys('hello') is ['0'..'4']; a decoder that reaches the key scan
    // reports the wrong reason instead of "not a JSON object".
    expect(decode(controlFrame('"hello"'))).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is not a JSON object',
    });
  });

  it('refuses a JSON-null control payload without throwing on Object.keys(null)', () => {
    const input = controlFrame('null');

    expect(() => decode(input)).not.toThrow();
    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload is not a JSON object',
    });
  });

  it('names an unknown control property', () => {
    const input = controlFrame(`{"epoch":7,"format":1,"lineage":"${ID}","extra":1}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload has an unknown property',
    });
  });

  it('refuses a negative epoch rather than announcing it', () => {
    const input = controlFrame(`{"epoch":-1,"format":1,"lineage":"${ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload needs epoch >= 0, format >= 1 and a 32-hex lineage',
    });
  });

  it('refuses an array-wrapped lineage that only LOOKS like 32 hex to a coercing regex', () => {
    // RegExp.test stringifies its argument, so ['<32 hex>'] passes the pattern
    // and only the typeof guard keeps a non-string lineage out of the tag.
    const input = controlFrame(`{"epoch":7,"format":1,"lineage":["${ID}"]}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload needs epoch >= 0, format >= 1 and a 32-hex lineage',
    });
  });

  it('names a repeated control property', () => {
    const input = controlFrame(`{"epoch":7,"epoch":8,"format":1,"lineage":"${ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the control payload has a repeated property',
    });
  });
});

describe('sync-wire decode — limits (type 101) refusal reasons', () => {
  it('names a missing or truncated limits payload before decoding it', () => {
    expect(decode(hex('65ff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is missing or truncated',
    });
  });

  it('names a non-UTF-8 limits payload', () => {
    expect(decode(hex('6502ffff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is not valid UTF-8',
    });
  });

  it('names the escape in a limits payload', () => {
    const input = limitsFrame('{"maxMessageByte\\u0073":1,"maxMessageBytes":2}');

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload contains an escape',
    });
  });

  it('separates unparseable JSON from a parsed non-object', () => {
    expect(decode(limitsFrame('not json'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is not valid JSON',
    });
  });

  it('names a JSON array limits payload as a non-object', () => {
    expect(decode(limitsFrame('[1048576]'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is not a JSON object',
    });
  });

  it('names a JSON string limits payload as a non-object, not an unknown property', () => {
    expect(decode(limitsFrame('"big"'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is not a JSON object',
    });
  });

  it('refuses a JSON-null limits payload without throwing on Object.keys(null)', () => {
    const input = limitsFrame('null');

    expect(() => decode(input)).not.toThrow();
    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload is not a JSON object',
    });
  });

  it('names an unknown limits property', () => {
    const input = limitsFrame('{"maxMessageBytes":1048576,"extra":1}');

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload has an unknown property',
    });
  });

  it('names a non-positive maxMessageBytes', () => {
    expect(decode(limitsFrame('{"maxMessageBytes":0}'))).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload needs a positive integer maxMessageBytes',
    });
  });

  it('names a repeated limits property', () => {
    const input = limitsFrame('{"maxMessageBytes":1,"maxMessageBytes":2}');

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the limits payload has a repeated property',
    });
  });
});

describe('sync-wire decode — v2 framing (rules 2-5) reasons', () => {
  it('names the operation metadata section when it is absent entirely', () => {
    expect(decode(hex('66'))).toStrictEqual({
      type: 'malformed',
      reason: 'the operation metadata section is missing or truncated',
      rule: 3,
    });
  });

  it('names the operation metadata section when its length prefix is corrupt', () => {
    expect(decode(hex('66ff'))).toStrictEqual({
      type: 'malformed',
      reason: 'the operation metadata section is missing or truncated',
      rule: 2,
    });
  });

  it('names the operation UPDATE section when only the metadata arrived', () => {
    expect(decode(frame(102, operationMetadata))).toStrictEqual({
      type: 'malformed',
      reason: 'the operation update section is missing or truncated',
      rule: 3,
    });
  });

  it('names an empty operation update as rule 4 with its own reason', () => {
    const input = operationFrame(operationMetadata, new Uint8Array(0));

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the operation update must not be empty',
      rule: 4,
    });
  });

  it('names the acknowledgement metadata section when it is absent entirely', () => {
    expect(decode(hex('67'))).toStrictEqual({
      type: 'malformed',
      reason: 'the acknowledgement metadata section is missing or truncated',
      rule: 3,
    });
  });

  it('names the rejection metadata section when it is absent entirely', () => {
    expect(decode(hex('68'))).toStrictEqual({
      type: 'malformed',
      reason: 'the rejection metadata section is missing or truncated',
      rule: 3,
    });
  });

  it('counts the trailing bytes after an otherwise valid rejection', () => {
    const input = withTrailing(rejectionFrame(rejectionMetadata), 0x00);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: '1 trailing byte(s) after the message',
      rule: 5,
    });
  });
});

describe('sync-wire decode — v2 metadata (rules 6-11) reasons', () => {
  it('names non-UTF-8 metadata as rule 6', () => {
    const input = frame(102, new Uint8Array([0xff]), new Uint8Array([0x01]));

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section is not valid UTF-8',
      rule: 6,
    });
  });

  it('names an escape in the metadata as rule 7', () => {
    const input = operationFrame(`{"lineage":"${ID}","operation\\u0049d":"${OTHER_ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section contains an escape',
      rule: 7,
    });
  });

  it('names JSON whitespace in the metadata as rule 8', () => {
    const input = operationFrame(`{"lineage":"${ID}", "operationId":"${OTHER_ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section contains whitespace',
      rule: 8,
    });
  });

  it('names unparseable metadata as rule 9', () => {
    expect(decode(operationFrame('nope'))).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section is not exactly one JSON value',
      rule: 9,
    });
  });

  it('names a JSON string metadata section as rule 10, not a missing key', () => {
    // Object.keys('x') is ['0']; a decoder that walks on reports rule 11.
    const input = operationFrame('"x"');

    expect(() => decode(input)).not.toThrow();
    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section is not a JSON object',
      rule: 10,
    });
  });

  it('names a JSON-null metadata section as rule 10 without throwing', () => {
    const input = operationFrame('null');

    expect(() => decode(input)).not.toThrow();
    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section is not a JSON object',
      rule: 10,
    });
  });

  it('names the MISSING key in a rule-11 refusal', () => {
    const input = operationFrame(`{"lineage":"${ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section is missing "operationId"',
      rule: 11,
    });
  });

  it('names the UNKNOWN key in a rule-11 refusal', () => {
    const input = operationFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","extra":1}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section has an unknown key "extra"',
      rule: 11,
    });
  });

  it('names the REPEATED key in a rule-11 refusal', () => {
    const input = operationFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","operationId":"${OTHER_ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'the metadata section repeats "operationId"',
      rule: 11,
    });
  });
});

describe('sync-wire decode — v2 value (rule 12) reasons', () => {
  it('names the lineage FIELD in an operation whose lineage is not 32 hex', () => {
    const input = operationFrame(`{"lineage":"zz","operationId":"${OTHER_ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'lineage must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('names the operationId FIELD in an operation whose operationId is not 32 hex', () => {
    const input = operationFrame(`{"lineage":"${ID}","operationId":"zz"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'operationId must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('refuses an array-wrapped operation lineage the coercing regex would accept', () => {
    const input = operationFrame(`{"lineage":["${ID}"],"operationId":"${OTHER_ID}"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'lineage must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('refuses an acknowledgement whose lineage is not 32 hex instead of emitting an undefined one', () => {
    const input = acknowledgementFrame(`{"lineage":"zz","operationId":"${OTHER_ID}","serverSequence":"1"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'lineage must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('names the operationId FIELD in an acknowledgement whose operationId is not 32 hex', () => {
    const input = acknowledgementFrame(`{"lineage":"${ID}","operationId":"zz","serverSequence":"1"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'operationId must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('names a serverSequence with a leading zero', () => {
    const input = acknowledgementFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","serverSequence":"01"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'serverSequence must be a decimal string with no sign, leading zero or exponent',
      rule: 12,
    });
  });

  it('names a serverSequence one past the u64 ceiling', () => {
    const input = acknowledgementFrame(
      `{"lineage":"${ID}","operationId":"${OTHER_ID}","serverSequence":"18446744073709551616"}`,
    );

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'serverSequence exceeds the u64 ceiling 18446744073709551615',
      rule: 12,
    });
  });

  it('names a zero serverSequence separately from a malformed one', () => {
    const input = acknowledgementFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","serverSequence":"0"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'serverSequence must be at least 1 in an acknowledgement',
      rule: 12,
    });
  });

  it('names the lineage FIELD in a rejection whose lineage is not 32 hex', () => {
    const input = rejectionFrame(`{"lineage":"zz","operationId":"${OTHER_ID}","code":"read-only"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'lineage must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('refuses a rejection whose operationId is not 32 hex instead of emitting an undefined one', () => {
    const input = rejectionFrame(`{"lineage":"${ID}","operationId":"zz","code":"read-only"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'operationId must be 32 lowercase hex characters',
      rule: 12,
    });
  });

  it('names the code grammar in a rejection with an out-of-grammar code', () => {
    const input = rejectionFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","code":"Read-Only"}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'code must match ^[a-z][a-z0-9-]{0,63}$',
      rule: 12,
    });
  });

  it('refuses an array-wrapped rejection code the coercing regex would accept', () => {
    const input = rejectionFrame(`{"lineage":"${ID}","operationId":"${OTHER_ID}","code":["read-only"]}`);

    expect(decode(input)).toStrictEqual({
      type: 'malformed',
      reason: 'code must match ^[a-z][a-z0-9-]{0,63}$',
      rule: 12,
    });
  });
});

describe('sync-wire decode — payload ownership', () => {
  it('hands back an owned copy, not a view that the caller can still rewrite', () => {
    // lib0's readUint8Array returns `new Uint8Array(decoder.arr.buffer, ...)`,
    // so without the slice() the payload aliases the frame the socket owns.
    const raw = hex('00000101');
    const decoded = decode(raw);

    raw[3] = 0xff;

    expect(decoded).toStrictEqual({ type: 'syncStep1', stateVector: new Uint8Array([0x01]) });
  });
});

describe('sync-wire encode — contract-violation messages', () => {
  it('names the empty-payload contract in its throw', () => {
    expect(() => encode({ type: 'syncStep1', stateVector: new Uint8Array(0) })).toThrow(
      'collab: sync, awareness and operation-update payloads must not be empty.',
    );
  });

  it('quotes the offending tag in the control throw', () => {
    expect(() => encode({ type: 'control', tag: { epoch: -1, format: 1, lineage: ZERO_LINEAGE } })).toThrow(
      `collab: the tag {"epoch":-1,"format":1,"lineage":"${ZERO_LINEAGE}"} is not encodable.`,
    );
  });

  it('quotes the offending limit in the limits throw', () => {
    expect(() => encode({ type: 'limits', maxMessageBytes: 0 })).toThrow(
      'collab: the limit 0 is not encodable.',
    );
  });

  it('refuses to encode an operation whose lineage alone is not 32 hex', () => {
    expect(() =>
      encode({ type: 'operation', lineage: 'not-hex', operationId: OTHER_ID, update: new Uint8Array([0x01]) }),
    ).toThrow('collab: an operation frame needs a 32-lowercase-hex lineage and operationId.');
  });

  it('refuses to encode an operation whose operationId alone is not 32 hex', () => {
    expect(() =>
      encode({ type: 'operation', lineage: ID, operationId: 'not-hex', update: new Uint8Array([0x01]) }),
    ).toThrow('collab: an operation frame needs a 32-lowercase-hex lineage and operationId.');
  });

  it('refuses to encode an acknowledgement whose lineage alone is not 32 hex', () => {
    expect(() =>
      encode({ type: 'acknowledgement', lineage: 'not-hex', operationId: OTHER_ID, serverSequence: '1' }),
    ).toThrow(
      'collab: an acknowledgement frame needs a 32-lowercase-hex lineage/operationId and a serverSequence >= 1.',
    );
  });

  it('refuses to encode an acknowledgement whose serverSequence alone is out of range', () => {
    expect(() =>
      encode({ type: 'acknowledgement', lineage: ID, operationId: OTHER_ID, serverSequence: '0' }),
    ).toThrow(
      'collab: an acknowledgement frame needs a 32-lowercase-hex lineage/operationId and a serverSequence >= 1.',
    );
  });

  it('refuses to encode a rejection whose lineage alone is not 32 hex', () => {
    expect(() =>
      encode({ type: 'rejection', lineage: 'not-hex', operationId: OTHER_ID, code: 'read-only' }),
    ).toThrow(
      'collab: a rejection frame needs a 32-lowercase-hex lineage/operationId and a code matching ^[a-z][a-z0-9-]{0,63}$.',
    );
  });

  it('refuses to encode a rejection whose code alone is out of grammar', () => {
    expect(() =>
      encode({ type: 'rejection', lineage: ID, operationId: OTHER_ID, code: 'Read-Only' }),
    ).toThrow(
      'collab: a rejection frame needs a 32-lowercase-hex lineage/operationId and a code matching ^[a-z][a-z0-9-]{0,63}$.',
    );
  });
});
