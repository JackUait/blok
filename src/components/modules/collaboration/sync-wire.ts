import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import type { SyncWireDecodeResult, SyncWireFrame, WorkingSetTag } from './types';

/**
 * Client mirror of the server's Blok.Server.Collab.SyncWire. Hand-rolled on
 * lib0/encoding + lib0/decoding (NOT y-protocols/sync, which would bypass the
 * binary seam's flush barriers and echo-suppression registry). One message per
 * WebSocket frame; the wire layout is pinned byte-for-byte, together with the
 * C# codec, by test/unit/server-conformance/fixtures/sync-frames.json.
 *
 *   sync            [0][0|1|2][varuint len][state vector | update]
 *   awareness       [1][varuint len][awareness update]
 *   auth            [2][0][varuint len][utf8 reason]
 *   queryAwareness  [3]
 *   blok control    [100][varuint len]{"epoch":N,"format":N,"lineage":"<32 hex>"}
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;
const MESSAGE_BLOK_CONTROL = 100;

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;
const AUTH_PERMISSION_DENIED = 0;

// lib0 varuints are unbounded; a 64-bit value is at most ten LEB128 bytes.
const MAX_VARUINT_BYTES = 10;

const LINEAGE_PATTERN = /^[0-9a-f]{32}$/;
const CONTROL_KEYS = ['epoch', 'format', 'lineage'] as const;

// `fatal` rejects invalid UTF-8 (the server decodes strictly too); `ignoreBOM`
// keeps a leading U+FEFF in the output instead of silently stripping it, so a
// BOM-prefixed control payload fails JSON.parse and a BOM in an auth reason
// survives — both matching the server's strict handling.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Serializes one frame to its wire bytes. Byte-identical to the reference
 * y-protocols encoders and to the C# server for the same logical frame.
 *
 * Throws only on a programmer contract violation (an empty sync/awareness
 * payload, or a control tag that is not announceable) — never on wire input.
 */
export function encode(frame: SyncWireFrame): Uint8Array {
  const encoder = encoding.createEncoder();

  switch (frame.type) {
    case 'syncStep1':
      writeSync(encoder, SYNC_STEP1, frame.stateVector);
      break;
    case 'syncStep2':
      writeSync(encoder, SYNC_STEP2, frame.update);
      break;
    case 'update':
      writeSync(encoder, SYNC_UPDATE, frame.update);
      break;
    case 'awareness':
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, requirePayload(frame.update));
      break;
    case 'queryAwareness':
      encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
      break;
    case 'permissionDenied':
      encoding.writeVarUint(encoder, MESSAGE_AUTH);
      encoding.writeVarUint(encoder, AUTH_PERMISSION_DENIED);
      encoding.writeVarString(encoder, frame.reason);
      break;
    case 'control':
      encoding.writeVarUint(encoder, MESSAGE_BLOK_CONTROL);
      encoding.writeVarString(encoder, encodeControl(frame.tag));
      break;
  }

  return encoding.toUint8Array(encoder);
}

/**
 * Parses exactly one frame from `bytes`, consuming the whole buffer. Never
 * throws: hostile input returns `malformed`, an unknown outer type returns
 * `unknown`. Strict like the server's TryDecode.
 */
export function decode(bytes: Uint8Array): SyncWireDecodeResult {
  const decoder = decoding.createDecoder(bytes);
  const type = readVarUint(decoder);

  if (type === null) {
    return malformed('the message type is missing or malformed');
  }

  switch (type) {
    case MESSAGE_SYNC:
      return decodeSync(decoder);
    case MESSAGE_AWARENESS: {
      const payload = readPayload(decoder);

      if (payload.type === 'error') {
        return malformed(payload.reason);
      }

      return requireEnd(decoder) ?? { type: 'awareness', update: payload.bytes };
    }
    case MESSAGE_AUTH:
      return decodeAuth(decoder);
    case MESSAGE_QUERY_AWARENESS:
      return requireEnd(decoder) ?? { type: 'queryAwareness' };
    case MESSAGE_BLOK_CONTROL: {
      const json = readVarBytes(decoder);

      if (json === null) {
        return malformed('the control payload is missing or truncated');
      }

      const control = decodeControl(json);

      if (!control.ok) {
        return malformed(control.reason);
      }

      return requireEnd(decoder) ?? { type: 'control', tag: control.tag };
    }
    default:
      // Unknown OUTER type: ignorable, and the payload is left unread — so no
      // trailing-byte check here, matching the server (SyncWire.cs TryDecode).
      return { type: 'unknown', messageType: type };
  }
}

function decodeSync(decoder: decoding.Decoder): SyncWireDecodeResult {
  const subType = readVarUint(decoder);

  if (subType === null) {
    return malformed('the sync sub-type is missing or malformed');
  }

  if (subType > SYNC_UPDATE) {
    return malformed(`unknown sync sub-type ${subType}`);
  }

  const payload = readPayload(decoder);

  if (payload.type === 'error') {
    return malformed(payload.reason);
  }

  const end = requireEnd(decoder);

  if (end !== null) {
    return end;
  }

  if (subType === SYNC_STEP1) {
    return { type: 'syncStep1', stateVector: payload.bytes };
  }

  if (subType === SYNC_STEP2) {
    return { type: 'syncStep2', update: payload.bytes };
  }

  return { type: 'update', update: payload.bytes };
}

function decodeAuth(decoder: decoding.Decoder): SyncWireDecodeResult {
  const subType = readVarUint(decoder);

  if (subType === null) {
    return malformed('the auth sub-type is missing or malformed');
  }

  if (subType !== AUTH_PERMISSION_DENIED) {
    return malformed(`unknown auth sub-type ${subType}`);
  }

  // The reason goes through readVarBytes with no empty check, so an empty
  // reason is legal (a permissionDenied with '').
  const reasonBytes = readVarBytes(decoder);

  if (reasonBytes === null) {
    return malformed('the auth reason is missing or truncated');
  }

  const reason = tryDecodeUtf8(reasonBytes);

  if (reason === null) {
    return malformed('the auth reason is not valid UTF-8');
  }

  return requireEnd(decoder) ?? { type: 'permissionDenied', reason };
}

type ControlResult = { ok: true; tag: WorkingSetTag } | { ok: false; reason: string };

function decodeControl(json: Uint8Array): ControlResult {
  const text = tryDecodeUtf8(json);

  if (text === null) {
    return { ok: false, reason: 'the control payload is not valid UTF-8' };
  }

  // The server's Utf8JsonWriter never escapes this payload (ASCII keys, integer
  // and lowercase-hex values), so any backslash marks a crafted payload.
  // Rejecting it keeps every string quote-free, which is what makes the
  // key-count duplicate check below exact and closes the \uXXXX escaped-key
  // evasion of that check.
  if (text.includes('\\')) {
    return { ok: false, reason: 'the control payload contains an escape' };
  }

  // JSON.parse rejects trailing content (whitespace aside), matching the
  // server's Utf8JsonReader end-of-document check.
  const parsed = tryParseJson(text);

  if (!parsed.ok) {
    return { ok: false, reason: 'the control payload is not valid JSON' };
  }

  const record = parsed.value;

  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { ok: false, reason: 'the control payload is not a JSON object' };
  }

  const fields = record as Record<string, unknown>;

  if (Object.keys(fields).some((key) => !(CONTROL_KEYS as readonly string[]).includes(key))) {
    return { ok: false, reason: 'the control payload has an unknown property' };
  }

  const { epoch, format, lineage } = fields;

  if (
    typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0 ||
    typeof format !== 'number' || !Number.isSafeInteger(format) || format < 1 ||
    typeof lineage !== 'string' || !LINEAGE_PATTERN.test(lineage)
  ) {
    return { ok: false, reason: 'the control payload needs epoch >= 0, format >= 1 and a 32-hex lineage' };
  }

  // With no backslash and only integer/hex values, each key string can appear
  // only as a key token; a second occurrence is a duplicate key.
  if (CONTROL_KEYS.some((key) => occurrences(text, `"${key}"`) > 1)) {
    return { ok: false, reason: 'the control payload has a repeated property' };
  }

  return { ok: true, tag: { format, epoch, lineage } };
}

type PayloadResult = { type: 'bytes'; bytes: Uint8Array } | { type: 'error'; reason: string };

/** Reads a length-prefixed payload, rejecting an empty one (sync + awareness). */
function readPayload(decoder: decoding.Decoder): PayloadResult {
  const bytes = readVarBytes(decoder);

  if (bytes === null) {
    return { type: 'error', reason: 'the payload is missing or truncated' };
  }

  if (bytes.length === 0) {
    return { type: 'error', reason: 'the payload is empty' };
  }

  return { type: 'bytes', bytes };
}

interface VarUintPeek {
  value: number;
  byteLength: number;
}

/**
 * Reads a lib0 varuint from the decoder's current position with the server's
 * strict bounds: at most 10 bytes, and the tenth byte may only carry the top
 * bit of a 64-bit value. Returns null (never throws) on a malformed or
 * truncated varuint.
 *
 * lib0's own decoding.readVarUint is unusable here on both counts: it accepts
 * an 11-byte encoding of a small value (ten continuation bytes + a terminator)
 * and it THROWS on a truncated one. So the framing is peeked by hand; lib0 only
 * advances the cursor (readUint8Array) once the peek has proven the bytes good.
 */
function readVarUint(decoder: decoding.Decoder): number | null {
  const peek = peekVarUint(decoder.arr, decoder.pos);

  if (peek === null) {
    return null;
  }

  // Advance the cursor through lib0 rather than reassigning decoder.pos here.
  decoding.readUint8Array(decoder, peek.byteLength);

  return peek.value;
}

function peekVarUint(arr: Uint8Array, pos: number): VarUintPeek | null {
  const window = arr.subarray(pos, pos + MAX_VARUINT_BYTES);
  const terminator = window.findIndex((byte) => (byte & 0x80) === 0);

  // No terminator within 10 bytes (or the buffer ended first) is malformed.
  if (terminator === -1) {
    return null;
  }

  if (terminator === MAX_VARUINT_BYTES - 1 && (window[terminator] & 0x7f) > 1) {
    return null;
  }

  // Multiplication (lib0's own idiom), not `<<`: a shift is 32-bit in JS and
  // es2017 forbids BigInt literals. Every known type and any in-bounds length
  // is < 2^53 and exact; a value above that only ever rounds relatively, so it
  // can never collide with a small known type or slip a bounds check.
  const value = window
    .subarray(0, terminator + 1)
    .reduce((total, byte, index) => total + (byte & 0x7f) * 128 ** index, 0);

  return { value, byteLength: terminator + 1 };
}

/** Reads a varuint length then that many bytes, bounds-checked before any copy. */
function readVarBytes(decoder: decoding.Decoder): Uint8Array | null {
  const length = readVarUint(decoder);

  if (length === null) {
    return null;
  }

  // Bounds check BEFORE reading: a 2GB length prefix must never allocate.
  if (length > decoder.arr.length - decoder.pos) {
    return null;
  }

  // lib0 returns a view; slice() detaches an owned copy (matches server ToArray).
  return decoding.readUint8Array(decoder, length).slice();
}

/** Malformed unless the whole frame was consumed (one message per frame). */
function requireEnd(decoder: decoding.Decoder): { type: 'malformed'; reason: string } | null {
  return decoding.hasContent(decoder)
    ? malformed(`${decoder.arr.length - decoder.pos} trailing byte(s) after the message`)
    : null;
}

function writeSync(encoder: encoding.Encoder, subType: number, payload: Uint8Array): void {
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, subType);
  encoding.writeVarUint8Array(encoder, requirePayload(payload));
}

function requirePayload(payload: Uint8Array): Uint8Array {
  if (payload.length === 0) {
    throw new Error('collab: sync and awareness payloads must not be empty.');
  }

  return payload;
}

function encodeControl(tag: WorkingSetTag): string {
  if (!isAnnounceable(tag)) {
    throw new Error(`collab: the tag ${JSON.stringify(tag)} is not encodable.`);
  }

  // Key order matters: {epoch, format, lineage} — the fixture pins these bytes.
  return JSON.stringify({ epoch: tag.epoch, format: tag.format, lineage: tag.lineage });
}

function isAnnounceable(tag: WorkingSetTag): boolean {
  return (
    Number.isSafeInteger(tag.format) && tag.format >= 1 &&
    Number.isSafeInteger(tag.epoch) && tag.epoch >= 0 &&
    LINEAGE_PATTERN.test(tag.lineage)
  );
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Non-overlapping occurrences of `needle`; needles here can never self-overlap. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function malformed(reason: string): { type: 'malformed'; reason: string } {
  return { type: 'malformed', reason };
}
