// Generates the y-protocols wire-frame fixtures the C# sync codec is pinned to.
// Run once per y-protocols/yjs bump; the output is committed under
// test/unit/server-conformance/fixtures/sync-frames.json (beside tickets.json;
// NOT under fixtures/collab/, whose case directories generate-collab-fixtures.mjs
// owns and rewrites).
//
//   node scripts/generate-sync-frames.mjs
//
// Every frame under `frames`, and every `canonical: true` frame under
// `v2.frames`, is produced by the REAL reference encoders (y-protocols + lib0 +
// yjs), so the fixture is the protocol as stock y-websocket clients speak it.
// Two groups are hand-written because no conformant encoder emits them: the
// `v2.negative` cases (malformed bytes have no reference encoder, and where a
// length prefix or a trailing byte has to lie the frame bytes are spliced by
// hand too) and the single `canonical: false` v2 frame, whose keys are a valid
// set in an order an emitter never writes. Observed framing (lib0 varuint = LEB128, 7
// bits per byte, high bit = continuation; byte arrays and strings = varuint
// byte length + raw bytes):
//
//   sync            [0][sub 0|1|2][varuint len][payload]   sub 0 SyncStep1 = state vector,
//                                                          sub 1 SyncStep2 / sub 2 Update = yjs update
//   awareness       [1][varuint len][awareness update]     update = [varuint n]{[clientId][clock][varstring json]}*n
//   auth            [2][0][varuint len][utf8 reason]       0 = permissionDenied (the only auth sub-type)
//   queryAwareness  [3]                                    no payload
//   blok control    [100][varuint len][utf8 json]          Blok-only: {"epoch":N,"format":N,"lineage":"<32 hex>"},
//                                                          keys in that order
//   blok limits     [101][varuint len][utf8 json]          Blok-only: {"maxMessageBytes":N}
//   blok operation  [102][varuint len][utf8 json][varuint len][yjs update]
//                                                          blok-sync.v2, client->server. TWO
//                                                          length-prefixed sections, unlike
//                                                          single-section 100/101.
//                                                          json = {"lineage","operationId"}
//   blok ack        [103][varuint len][utf8 json]          {"lineage","operationId","serverSequence"}
//   blok rejection  [104][varuint len][utf8 json]          {"lineage","operationId","code"}
//
// The v2 metadata keys are emitted in exactly the order listed above and the
// fixture pins those bytes; serverSequence is a decimal STRING because its
// ceiling (2^64 - 1) does not fit an IEEE-754 double. See
// packages/server/protocol/blok-sync-v2.md for the normative spec.
//
// The outer type byte comes from y-websocket, not y-protocols: the sync/auth
// writers only emit the sub-type, so this script writes 0/1/2/3 itself exactly
// as y-websocket.js does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as authProtocol from 'y-protocols/auth';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const require = createRequire(import.meta.url);
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'unit',
  'server-conformance',
  'fixtures',
);

// y-websocket.js message types (y-protocols itself only defines the sub-types).
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;
// Blok control frame (Phase 2 plan, decision 6).
const MESSAGE_BLOK_CONTROL = 100;
// Blok limits frame (Phase 4 A1): the server's message cap, announced at join.
const MESSAGE_BLOK_LIMITS = 101;
// blok-sync.v2 operation frames (acknowledged-operation-persistence plan).
const MESSAGE_BLOK_OPERATION = 102;
const MESSAGE_BLOK_ACK = 103;
const MESSAGE_BLOK_REJECTION = 104;
// Outside 0-3 and 100-104, so a v2 decoder must report it ignorable, not malformed.
const MESSAGE_UNKNOWN_OUTER = 105;

// A single fixed client id keeps every update/state vector byte-deterministic.
const CLIENT_ID = 1000;
const SEED_TEXT = 'Hello from Blok';
const APPENDED_TEXT = ' and yjs';
const AWARENESS_STATE = { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1' };
const PERMISSION_DENIED_REASON = 'permission denied: read-only ticket';
// The lineage is 16 random bytes at runtime; the fixture pins one value so
// regenerating the file does not churn the bytes.
const CONTROL = { epoch: 7, format: 1, lineage: '5f3a9c1e7b04d28a6cf1e0937b52d84a' };
// The server default (BlokServerOptions.CollabMaxMessageBytes = 1 MiB).
const LIMITS = { maxMessageBytes: 1048576 };
// 128 CSPRNG bits at runtime; pinned here so regenerating does not churn bytes.
const OPERATION_ID = '9b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e';
const SERVER_SEQUENCE = '42';
// u64 max: the documented ceiling, pinned positively so a decoder that parses
// serverSequence into a signed 64-bit integer fails a fixture instead of ours.
const MAX_SERVER_SEQUENCE = '18446744073709551615';
// The stable set. A decoder must ACCEPT any other code matching
// REJECTION_CODE_PATTERN: refusing one would leave a client unable to learn its
// operation was rejected, so it would redrive the same outbox row forever.
const REJECTION_CODES = [
  'lineage-mismatch',
  'read-only',
  'not-synced',
  'invalid-update',
  'oversized-update',
  'operation-id-conflict',
];
const REJECTION_CODE_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const UNRECOGNISED_CODE = 'teapot';
// 5 + 59 = 64 characters, the pattern's ceiling; one more must be refused.
const MAX_LENGTH_CODE = `code-${'a'.repeat(59)}`;
const OVER_LENGTH_CODE = `${MAX_LENGTH_CODE}a`;

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const utf8 = (text) => new TextEncoder().encode(text);
const concat = (...parts) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));

const frame = (write) => {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
};

// Strips the outer type varuint(s) so the fixture also records the bare payload.
const payloadOf = (bytes, prefixVarUints) => {
  const decoder = decoding.createDecoder(bytes);
  for (let index = 0; index < prefixVarUints; index += 1) {
    decoding.readVarUint(decoder);
  }
  return decoding.readVarUint8Array(decoder);
};

const doc = new Y.Doc();
doc.clientID = CLIENT_ID;
const updates = [];
doc.on('update', (update) => updates.push(update));

doc.transact(() => {
  doc.getText('content').insert(0, SEED_TEXT);
  doc.getMap('meta').set('kind', 'paragraph');
});
const seedUpdate = Y.encodeStateAsUpdate(doc);
const seedStateVector = Y.encodeStateVector(doc);

const syncStep1 = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
});
const syncStep2 = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(encoder, doc, Y.encodeStateVector(new Y.Doc()));
});

doc.transact(() => {
  const text = doc.getText('content');
  text.insert(text.length, APPENDED_TEXT);
});
const incrementalUpdate = updates[1];
const update = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, incrementalUpdate);
});

const awareness = new awarenessProtocol.Awareness(doc);
awareness.setLocalState(AWARENESS_STATE);
const awarenessFrame = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
  );
});
const awarenessClock = awareness.meta.get(doc.clientID).clock;

const queryAwareness = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
});
const permissionDenied = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_AUTH);
  authProtocol.writePermissionDenied(encoder, PERMISSION_DENIED_REASON);
});
const control = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_BLOK_CONTROL);
  encoding.writeVarString(encoder, JSON.stringify(CONTROL));
});
const limits = frame((encoder) => {
  encoding.writeVarUint(encoder, MESSAGE_BLOK_LIMITS);
  encoding.writeVarString(encoder, JSON.stringify(LIMITS));
});

// The metadata section goes through writeVarUint8Array rather than
// writeVarString: lib0 gives both the same varuint-length + raw-bytes framing,
// and only the byte-array writer can carry the deliberately invalid UTF-8 a
// negative case needs. `update` omitted = no second section at all.
const v2Frame = (type, metadataBytes, update) =>
  frame((encoder) => {
    encoding.writeVarUint(encoder, type);
    encoding.writeVarUint8Array(encoder, metadataBytes);

    if (update !== undefined) {
      encoding.writeVarUint8Array(encoder, update);
    }
  });

// Key insertion order IS the wire order; JSON.stringify preserves it.
const OPERATION_METADATA = JSON.stringify({
  lineage: CONTROL.lineage,
  operationId: OPERATION_ID,
});
const ackMetadata = (serverSequence) =>
  JSON.stringify({ lineage: CONTROL.lineage, operationId: OPERATION_ID, serverSequence });
const rejectionMetadata = (code) =>
  JSON.stringify({ lineage: CONTROL.lineage, operationId: OPERATION_ID, code });

const operation = v2Frame(MESSAGE_BLOK_OPERATION, utf8(OPERATION_METADATA), incrementalUpdate);
const acknowledgement = v2Frame(MESSAGE_BLOK_ACK, utf8(ackMetadata(SERVER_SEQUENCE)));
const acknowledgementMax = v2Frame(MESSAGE_BLOK_ACK, utf8(ackMetadata(MAX_SERVER_SEQUENCE)));
const rejections = REJECTION_CODES.map((code) => ({
  code,
  json: rejectionMetadata(code),
  bytes: v2Frame(MESSAGE_BLOK_REJECTION, utf8(rejectionMetadata(code))),
}));
const rejectionUnrecognised = rejectionMetadata(UNRECOGNISED_CODE);
const rejectionMaxLength = rejectionMetadata(MAX_LENGTH_CODE);

// Hand-written: JSON.stringify cannot emit a non-canonical key order, and no
// conformant emitter would. Decoders validate the key SET, not the sequence.
const ACK_METADATA_OUT_OF_ORDER =
  `{"operationId":"${OPERATION_ID}","serverSequence":"${SERVER_SEQUENCE}","lineage":"${CONTROL.lineage}"}`;

// Self-check: the fixtures must replay through the reference decoders.
const replica = new Y.Doc();
Y.applyUpdate(replica, payloadOf(syncStep2, 2));
if (replica.getText('content').toString() !== SEED_TEXT) {
  throw new Error('SyncStep2 did not replay the seed text');
}
Y.applyUpdate(replica, payloadOf(update, 2));
if (replica.getText('content').toString() !== SEED_TEXT + APPENDED_TEXT) {
  throw new Error('Update did not replay the appended text');
}
if (hex(payloadOf(syncStep1, 2)) !== hex(seedStateVector)) {
  throw new Error('SyncStep1 does not carry the seed state vector');
}

// The 102 self-check has to walk BOTH sections: a decoder that stops after the
// metadata (the 100/101 shape) would still look correct against a one-section
// check, and that is the exact mistake this fixture exists to catch.
const operationDecoder = decoding.createDecoder(operation);

if (decoding.readVarUint(operationDecoder) !== MESSAGE_BLOK_OPERATION) {
  throw new Error('the operation frame does not start with type 102');
}
if (decoding.readVarString(operationDecoder) !== OPERATION_METADATA) {
  throw new Error('the operation metadata section does not round-trip');
}

const operationReplica = new Y.Doc();
Y.applyUpdate(operationReplica, payloadOf(syncStep2, 2));
Y.applyUpdate(operationReplica, decoding.readVarUint8Array(operationDecoder));

if (decoding.hasContent(operationDecoder)) {
  throw new Error('the operation frame has trailing bytes after its update');
}
if (operationReplica.getText('content').toString() !== SEED_TEXT + APPENDED_TEXT) {
  throw new Error('the operation update section did not replay the appended text');
}

awareness.destroy();
doc.destroy();
replica.destroy();
operationReplica.destroy();

// ---------------------------------------------------------------------------
// Negative v2 cases. These are the only frames in the file NOT produced by a
// reference encoder: the metadata JSON below is written by hand, and three
// cases splice bytes afterwards, because a conformant encoder cannot emit any
// of it. lib0 still does the outer framing, so the only thing wrong with each
// frame is the one defect its name states.
// ---------------------------------------------------------------------------
const L = CONTROL.lineage;

// One helper per shape so the metadata text is written ONCE per case:
// `metadataJson` has to describe exactly the bytes in `frameHex`, and a second
// copy of the same template literal is how those two drift apart.
const badOperation = (name, description, metadataJson, update = incrementalUpdate) => ({
  name,
  messageType: MESSAGE_BLOK_OPERATION,
  expect: 'malformed',
  description,
  metadataJson,
  frameHex: hex(v2Frame(MESSAGE_BLOK_OPERATION, utf8(metadataJson), update)),
});

// 103 and 104 have no second section, so their crafted frames are metadata only.
const badMetadataOnly = (name, messageType, description, metadataJson) => ({
  name,
  messageType,
  expect: 'malformed',
  description,
  metadataJson,
  frameHex: hex(v2Frame(messageType, utf8(metadataJson))),
});

// One lineage hex character overwritten with a lone 0xff: no UTF-8 sequence
// starts with that byte, so strict decoding fails before any JSON parse.
const invalidUtf8Metadata = Uint8Array.from(utf8(OPERATION_METADATA));

invalidUtf8Metadata[OPERATION_METADATA.indexOf(L)] = 0xff;

// [102][len][metadata] then an update length prefix claiming 16 bytes over 3.
const truncatedUpdate = concat(
  v2Frame(MESSAGE_BLOK_OPERATION, utf8(OPERATION_METADATA)),
  Uint8Array.from([0x10, 0x01, 0x02, 0x03]),
);

const negative = [
  badOperation(
    'operationUppercaseLineage',
    'Lineage in uppercase hex; IDs are lowercase-only.',
    `{"lineage":"${L.toUpperCase()}","operationId":"${OPERATION_ID}"}`,
  ),
  badOperation(
    'operationShortOperationId',
    'operationId is 31 hex characters, one short of 128 bits.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID.slice(0, 31)}"}`,
  ),
  badOperation(
    'operationMissingOperationId',
    'The operationId key is absent.',
    `{"lineage":"${L}"}`,
  ),
  badOperation(
    'operationExtraKey',
    'A serverSequence key, which belongs to 103 and not to 102.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":"1"}`,
  ),
  badOperation(
    'operationEscapedDuplicateKey',
    'An escaped "lineage" ahead of the real one: the key is present twice while the literal token appears once, so only the no-backslash rule catches it.',
    `{"lin\\u0065age":"${L}","lineage":"${L}","operationId":"${OPERATION_ID}"}`,
  ),
  badOperation(
    'operationEmptyUpdate',
    'Valid metadata, then a zero-length update section.',
    OPERATION_METADATA,
    new Uint8Array(0),
  ),
  {
    name: 'operationInvalidUtf8Metadata',
    messageType: MESSAGE_BLOK_OPERATION,
    expect: 'malformed',
    description: 'A lone 0xff inside the metadata section; otherwise a valid operation.',
    frameHex: hex(v2Frame(MESSAGE_BLOK_OPERATION, invalidUtf8Metadata, incrementalUpdate)),
  },
  {
    name: 'operationMissingUpdateSection',
    messageType: MESSAGE_BLOK_OPERATION,
    expect: 'malformed',
    description:
      'The frame ends after the metadata, so it is shaped like 100/101. A decoder that stops at one section accepts this.',
    metadataJson: OPERATION_METADATA,
    frameHex: hex(v2Frame(MESSAGE_BLOK_OPERATION, utf8(OPERATION_METADATA))),
  },
  {
    name: 'operationTruncatedUpdate',
    messageType: MESSAGE_BLOK_OPERATION,
    expect: 'malformed',
    description: 'The update length prefix claims 16 bytes and only 3 follow.',
    metadataJson: OPERATION_METADATA,
    frameHex: hex(truncatedUpdate),
  },
  {
    name: 'operationTrailingByte',
    messageType: MESSAGE_BLOK_OPERATION,
    expect: 'malformed',
    description: 'A complete operation plus one byte; one frame per message.',
    metadataJson: OPERATION_METADATA,
    frameHex: hex(concat(operation, Uint8Array.from([0x00]))),
  },
  badMetadataOnly(
    'acknowledgementDuplicateKey',
    MESSAGE_BLOK_ACK,
    'The lineage key appears twice, unescaped.',
    `{"lineage":"${L}","lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":"${SERVER_SEQUENCE}"}`,
  ),
  badMetadataOnly(
    'acknowledgementNumericServerSequence',
    MESSAGE_BLOK_ACK,
    'serverSequence sent as a JSON number instead of a decimal string.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":${SERVER_SEQUENCE}}`,
  ),
  badMetadataOnly(
    'acknowledgementLeadingZeroServerSequence',
    MESSAGE_BLOK_ACK,
    'serverSequence "0042": two texts would denote one value.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":"0042"}`,
  ),
  badMetadataOnly(
    'acknowledgementNegativeServerSequence',
    MESSAGE_BLOK_ACK,
    'serverSequence "-1"; the pattern allows no sign.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":"-1"}`,
  ),
  badMetadataOnly(
    'acknowledgementOverRangeServerSequence',
    MESSAGE_BLOK_ACK,
    'serverSequence one past the u64 ceiling (18446744073709551616).',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","serverSequence":"18446744073709551616"}`,
  ),
  badMetadataOnly(
    'acknowledgementMissingServerSequence',
    MESSAGE_BLOK_ACK,
    'The 102 key set on a 103 frame; serverSequence is absent.',
    OPERATION_METADATA,
  ),
  {
    name: 'acknowledgementTrailingByte',
    messageType: MESSAGE_BLOK_ACK,
    expect: 'malformed',
    description: 'A complete acknowledgement plus one byte.',
    metadataJson: ackMetadata(SERVER_SEQUENCE),
    frameHex: hex(concat(acknowledgement, Uint8Array.from([0x00]))),
  },
  badMetadataOnly(
    'rejectionEscapedCode',
    MESSAGE_BLOK_REJECTION,
    'An escaped code that parses to the valid read-only; only the no-backslash rule rejects it.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","code":"read\\u002donly"}`,
  ),
  badMetadataOnly(
    'rejectionCodeEmpty',
    MESSAGE_BLOK_REJECTION,
    'An empty code. The shape rule needs at least one character, and an empty string is the classic value a decoder mistakes for an absent key.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","code":""}`,
  ),
  badMetadataOnly(
    'rejectionCodeUppercase',
    MESSAGE_BLOK_REJECTION,
    'Code "Read-Only": the shape rule is lowercase-only, so a case variant of a stable code is not that code.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","code":"Read-Only"}`,
  ),
  badMetadataOnly(
    'rejectionCodeOverLength',
    MESSAGE_BLOK_REJECTION,
    'A 65-character code, one past the shape rule; rejectionCodeMaxLength pins the other side of the same boundary.',
    `{"lineage":"${L}","operationId":"${OPERATION_ID}","code":"${OVER_LENGTH_CODE}"}`,
  ),
  {
    name: 'unknownOuterType',
    messageType: MESSAGE_UNKNOWN_OUTER,
    expect: 'unknown',
    description:
      'Type 105 carrying an operation-shaped section. An unknown OUTER type is ignorable, never malformed, and its payload is left unread.',
    frameHex: hex(v2Frame(MESSAGE_UNKNOWN_OUTER, utf8(OPERATION_METADATA))),
  },
];

// `canonical: true` = the bytes a conformant emitter produces, so a decoder
// must re-encode them byte-for-byte. `canonical: false` = valid on the wire but
// never emitted, so it is decode-only: asserting a byte-identical re-encode on
// it would wrongly demand that encoders preserve a foreign key order.
const v2Frames = [
  {
    name: 'operation',
    messageType: MESSAGE_BLOK_OPERATION,
    canonical: true,
    description:
      'Client operation: var-string metadata {lineage, operationId} then the Yjs update as a var-uint-length-prefixed byte string.',
    frameHex: hex(operation),
    metadataJson: OPERATION_METADATA,
    metadata: { lineage: CONTROL.lineage, operationId: OPERATION_ID },
    updateHex: hex(incrementalUpdate),
  },
  {
    name: 'acknowledgement',
    messageType: MESSAGE_BLOK_ACK,
    canonical: true,
    description:
      'Server acknowledgement: var-string metadata {lineage, operationId, serverSequence}.',
    frameHex: hex(acknowledgement),
    metadataJson: ackMetadata(SERVER_SEQUENCE),
    metadata: {
      lineage: CONTROL.lineage,
      operationId: OPERATION_ID,
      serverSequence: SERVER_SEQUENCE,
    },
  },
  {
    name: 'acknowledgementMaxSequence',
    messageType: MESSAGE_BLOK_ACK,
    canonical: true,
    description:
      'Acknowledgement at the documented u64 ceiling; a decoder parsing serverSequence as a signed 64-bit integer or a double fails here.',
    frameHex: hex(acknowledgementMax),
    metadataJson: ackMetadata(MAX_SERVER_SEQUENCE),
    metadata: {
      lineage: CONTROL.lineage,
      operationId: OPERATION_ID,
      serverSequence: MAX_SERVER_SEQUENCE,
    },
  },
  {
    name: 'acknowledgementKeysOutOfOrder',
    messageType: MESSAGE_BLOK_ACK,
    canonical: false,
    description:
      'The 103 key set in the order {operationId, serverSequence, lineage}. Decoders validate the key SET and MUST accept this; the fixed order is an emitter rule, and most JSON libraries never expose key order to a decoder at all.',
    frameHex: hex(v2Frame(MESSAGE_BLOK_ACK, utf8(ACK_METADATA_OUT_OF_ORDER))),
    metadataJson: ACK_METADATA_OUT_OF_ORDER,
    metadata: {
      lineage: CONTROL.lineage,
      operationId: OPERATION_ID,
      serverSequence: SERVER_SEQUENCE,
    },
  },
  ...rejections.map(({ code, json, bytes }) => ({
    name: `rejection:${code}`,
    messageType: MESSAGE_BLOK_REJECTION,
    canonical: true,
    description: `Server rejection with the stable code ${code}.`,
    frameHex: hex(bytes),
    metadataJson: json,
    metadata: { lineage: CONTROL.lineage, operationId: OPERATION_ID, code },
  })),
  {
    name: 'rejectionUnrecognisedCode',
    messageType: MESSAGE_BLOK_REJECTION,
    canonical: true,
    description:
      'A shape-conforming code outside the stable six. A decoder MUST accept it; refusing it would hide the rejection from the client, which would then redrive the same outbox row forever. The receiver treats it as a FINAL rejection.',
    frameHex: hex(v2Frame(MESSAGE_BLOK_REJECTION, utf8(rejectionUnrecognised))),
    metadataJson: rejectionUnrecognised,
    metadata: { lineage: CONTROL.lineage, operationId: OPERATION_ID, code: UNRECOGNISED_CODE },
  },
  {
    name: 'rejectionCodeMaxLength',
    messageType: MESSAGE_BLOK_REJECTION,
    canonical: true,
    description:
      'A 64-character code, the shape rule ceiling; rejectionCodeOverLength pins the other side of the same boundary.',
    frameHex: hex(v2Frame(MESSAGE_BLOK_REJECTION, utf8(rejectionMaxLength))),
    metadataJson: rejectionMaxLength,
    metadata: { lineage: CONTROL.lineage, operationId: OPERATION_ID, code: MAX_LENGTH_CODE },
  },
];

// Self-check: every recorded metadataJson must be the exact text of its frame's
// metadata section. The helpers derive one from the other, but the byte-spliced
// negatives and the out-of-order positive pair them by hand.
for (const entry of [...v2Frames, ...negative]) {
  if (entry.metadataJson === undefined) {
    continue;
  }

  const decoder = decoding.createDecoder(Uint8Array.from(Buffer.from(entry.frameHex, 'hex')));

  decoding.readVarUint(decoder);

  if (decoding.readVarString(decoder) !== entry.metadataJson) {
    throw new Error(`${entry.name}: metadataJson is not the frame's metadata section`);
  }
}

const fixture = {
  $comment: 'Generated by scripts/generate-sync-frames.mjs. Do not edit by hand.',
  generator: {
    yjs: require('yjs/package.json').version,
    'y-protocols': require('y-protocols/package.json').version,
    lib0: require('lib0/package.json').version,
  },
  clientId: CLIENT_ID,
  seedUpdateHex: hex(seedUpdate),
  incrementalUpdateHex: hex(incrementalUpdate),
  expected: {
    textAfterSeed: SEED_TEXT,
    metaKindAfterSeed: 'paragraph',
    textAfterIncremental: SEED_TEXT + APPENDED_TEXT,
  },
  frames: [
    {
      name: 'syncStep1',
      messageType: MESSAGE_SYNC,
      syncType: syncProtocol.messageYjsSyncStep1,
      description: 'State vector of the seeded doc (one client, seed writes only).',
      frameHex: hex(syncStep1),
      payloadHex: hex(payloadOf(syncStep1, 2)),
    },
    {
      name: 'syncStep2',
      messageType: MESSAGE_SYNC,
      syncType: syncProtocol.messageYjsSyncStep2,
      description: 'Diff of the seeded doc against an empty state vector (= full state).',
      frameHex: hex(syncStep2),
      payloadHex: hex(payloadOf(syncStep2, 2)),
    },
    {
      name: 'update',
      messageType: MESSAGE_SYNC,
      syncType: syncProtocol.messageYjsUpdate,
      description: 'Incremental update appending text to the seeded doc.',
      frameHex: hex(update),
      payloadHex: hex(payloadOf(update, 2)),
    },
    {
      name: 'awareness',
      messageType: MESSAGE_AWARENESS,
      description: 'Awareness update with one client state.',
      frameHex: hex(awarenessFrame),
      payloadHex: hex(payloadOf(awarenessFrame, 1)),
      awareness: {
        clientId: CLIENT_ID,
        clock: awarenessClock,
        stateJson: JSON.stringify(AWARENESS_STATE),
      },
    },
    {
      name: 'permissionDenied',
      messageType: MESSAGE_AUTH,
      authType: authProtocol.messagePermissionDenied,
      description: 'Auth permission-denied with a reason string.',
      frameHex: hex(permissionDenied),
      payloadHex: hex(payloadOf(permissionDenied, 2)),
      reason: PERMISSION_DENIED_REASON,
    },
    {
      name: 'queryAwareness',
      messageType: MESSAGE_QUERY_AWARENESS,
      description: 'Awareness re-query; the type varuint is the whole frame.',
      frameHex: hex(queryAwareness),
      payloadHex: '',
    },
    {
      name: 'blokControl',
      messageType: MESSAGE_BLOK_CONTROL,
      description:
        'Blok working-set control frame: JSON {epoch, format, lineage} as a lib0 var-string.',
      frameHex: hex(control),
      payloadHex: hex(payloadOf(control, 1)),
      control: CONTROL,
    },
    {
      name: 'blokLimits',
      messageType: MESSAGE_BLOK_LIMITS,
      description:
        'Blok limits frame: JSON {maxMessageBytes} as a lib0 var-string, sent right after the control frame.',
      frameHex: hex(limits),
      payloadHex: hex(payloadOf(limits, 1)),
      limits: LIMITS,
    },
  ],
  // blok-sync.v2 lives in its own section: the v1 `frames` list above is
  // asserted name-for-name by both consumers, and neither can decode 102-104
  // yet. Spec: packages/server/protocol/blok-sync-v2.md.
  v2: {
    protocol: 'blok-sync.v2',
    lineage: CONTROL.lineage,
    operationId: OPERATION_ID,
    rejectionCodes: REJECTION_CODES,
    rejectionCodePattern: REJECTION_CODE_PATTERN,
    frames: v2Frames,
    negative,
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'sync-frames.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `wrote ${join(OUT, 'sync-frames.json')} ` +
    `(${fixture.frames.length} v1 frames, ${fixture.v2.frames.length} v2 frames, ` +
    `${fixture.v2.negative.length} negative cases)`,
);
