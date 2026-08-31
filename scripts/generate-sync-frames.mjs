// Generates the y-protocols wire-frame fixtures the C# sync codec is pinned to.
// Run once per y-protocols/yjs bump; the output is committed under
// test/unit/server-conformance/fixtures/sync-frames.json (beside tickets.json;
// NOT under fixtures/collab/, which generate-collab-fixtures.mjs wipes wholesale).
//
//   node scripts/generate-sync-frames.mjs
//
// Every frame is produced by the REAL reference encoders (y-protocols + lib0 +
// yjs), never assembled by hand, so the fixture is the protocol as stock
// y-websocket clients speak it. Observed framing (lib0 varuint = LEB128, 7 bits
// per byte, high bit = continuation; byte arrays and strings = varuint byte
// length + raw bytes):
//
//   sync            [0][sub 0|1|2][varuint len][payload]   sub 0 SyncStep1 = state vector,
//                                                          sub 1 SyncStep2 / sub 2 Update = yjs update
//   awareness       [1][varuint len][awareness update]     update = [varuint n]{[clientId][clock][varstring json]}*n
//   auth            [2][0][varuint len][utf8 reason]       0 = permissionDenied (the only auth sub-type)
//   queryAwareness  [3]                                    no payload
//   blok control    [100][varuint len][utf8 json]          Blok-only: {"epoch":N,"format":N}, keys in that order
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

// A single fixed client id keeps every update/state vector byte-deterministic.
const CLIENT_ID = 1000;
const SEED_TEXT = 'Hello from Blok';
const APPENDED_TEXT = ' and yjs';
const AWARENESS_STATE = { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1' };
const PERMISSION_DENIED_REASON = 'permission denied: read-only ticket';
const CONTROL = { epoch: 7, format: 1 };

const hex = (bytes) => Buffer.from(bytes).toString('hex');

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

awareness.destroy();
doc.destroy();
replica.destroy();

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
      description: 'Blok epoch control frame: JSON {epoch, format} as a lib0 var-string.',
      frameHex: hex(control),
      payloadHex: hex(payloadOf(control, 1)),
      control: CONTROL,
    },
  ],
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'sync-frames.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${join(OUT, 'sync-frames.json')} (${fixture.frames.length} frames)`);
