// Writes the room-*.json and version-*.json files under
// test/fixtures/agent-server-scenarios, which C# AgentServerScenarioTests and
// Go TestMatchesTheAgentServerScenarios both read. The expectations are C#'s
// answers: capture them from the C# run, never write them by hand.
//
//   node scripts/generate-agent-room-scenarios.mjs [--out <dir>]
//
// test/unit/server-conformance/agent-room-scenarios.freshness.test.ts fails
// when the committed files differ from what this writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_OUT = join(REPO_ROOT, 'test/fixtures/agent-server-scenarios');

/** A number written with its own text: `15.0` must stay `15.0` (trap T3). */
class RawNumber {
  constructor(text) {
    this.text = text;
  }
}

/** JSON as Python's json.dump(indent=2, ensure_ascii=False) writes it, the files' original format. */
const write = (value, indent = '') => {
  if (value instanceof RawNumber) {
    return value.text;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const inner = `${indent}  `;

    return `[\n${value.map((item) => inner + write(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return '{}';
    }
    const inner = `${indent}  `;

    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${write(item, inner)}`).join(',\n')}\n${indent}}`;
  }

  return JSON.stringify(value);
};

/** Drops `code: null` and `actor: null`, which mean "not given". */
const clean = (node) => {
  if (Array.isArray(node)) {
    return node.map(clean);
  }
  if (node !== null && typeof node === 'object' && !(node instanceof RawNumber)) {
    return Object.fromEntries(Object.entries(node)
      .filter(([key, value]) => !((key === 'code' || key === 'actor') && value === null))
      .map(([key, value]) => [key, clean(value)]));
  }

  return node;
};

export const generate = () => {
  const AGENT = { id: 'agent-cs', name: 'Agent' };
  const ROOM_SEED = { blocks: [
    { id: 'p', type: 'paragraph', data: { text: 'Hello world' } },
    { id: 't', type: 'toggle', data: { text: 'T' }, content: ['k'] },
    { id: 'k', type: 'paragraph', data: { text: 'kid' }, parent: 't' }] };
  const HIST_SEED = { blocks: [
    { id: 'p', type: 'paragraph', data: { text: 'Hello' } },
    { id: 'q', type: 'paragraph', data: { text: 'Other' } }] };
  const VER_SEED = { blocks: [
    { id: 'p', type: 'paragraph', data: { text: 'Hello world' } },
    { id: 'q', type: 'paragraph', data: { text: 'Second' } }] };
  const c = (name, args) => ({ name, args });
  const b = (commands, extra = {}) => ({ ...extra, commands });
  const room = (batch, expect, kw = {}) => ({ run: 'room', actor: AGENT, batch, expect, ...kw });
  const UNDO = b([c('history.undo', {})]);
  const REDO = b([c('history.redo', {})]);
  const insert = (id, text) => b([c('block.insert', { id, type: 'paragraph', data: { text }, position: 'end' })]);
  const replace = (id, text) => b([c('text.replace', { id, with: text })]);
  const setTitle = (title) => b([c('doc.setTitle', { title })]);
  const peer = (id, text) => ({ run: 'peer', ops: { ops: [{ op: 'update', id, data: { text } }] } });
  const S = new Map();
  const scen = (name, seed, steps, roomspec = null, kw = {}) => {
    S.set(name, { name, room: roomspec ?? {}, seed, ...kw, steps });
  };

  // BlokAgentRoomTests
  scen('room-edit-returns-head', ROOM_SEED, [room(b([c('text.format', { id: 'p', range: { find: 'world' }, set: { bold: true } })]),
    { ok: true, saved: false, revision: '@head', committed: 1, result: { '/revision': '@head' },
      state: { '/blocks/0/lastEditedBy': 'agent-cs', '/blocks/0/data/text': [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }] } })]);
  scen('room-expect-revision-is-the-head', ROOM_SEED, [
    room(setTitle('One'), { ok: true, revision: '@head' }),
    room({ ...setTitle('Two'), expectRevision: '{rev:0}' }, { ok: true, committed: 1, state: { '/title': 'Two' } })]);
  scen('room-stale-head-writes-nothing', ROOM_SEED, [
    room(b([c('block.delete', { id: 'p' })], { expectRevision: 'ffffffffffffffffffffffffffffffff:99' }),
      { ok: false, code: 'STALE', committed: 0, blocksUnchanged: true, revision: '@head',
        result: { '/error/retryable': true, '/error/details/revision': '@head', '/revision': '@head' } })]);
  scen('room-stale-carries-current', ROOM_SEED, [
    room(b([c('text.insert', { id: 'p', at: 0, text: 'x' })], { expectRevision: 'ffffffffffffffffffffffffffffffff:99' }),
      { ok: false, code: 'STALE', committed: 0, result: { '/error/details/revision': '@head', '/error/details/current': { present: true } } })]);
  for (const [label, value] of [['h123', 'h123'], ['colon-first', ':1'], ['signed', '{lineage}:-1'], ['space', '{lineage}: 1'], ['number', 5], ['null', null], ['empty', '']]) {
    scen(`room-expect-malformed-${label}`, ROOM_SEED, [room(b([c('doc.read', {})], { expectRevision: value }),
      { ok: false, code: 'INVALID_ARGS', committed: 0, revision: '', result: { '/revision': { absent: true } } })]);
  }
  // T4: the agent's expectRevision is lax.
  for (const [label, value] of [['leading-zero', '{lineage}:00'], ['trailing-nul', '{lineage}:0\u0000'], ['last-colon', 'a:{lineage}:0']]) {
    const lastColon = label === 'last-colon';

    scen(`room-expect-lax-${label}`, ROOM_SEED, [room({ ...setTitle('Lax'), expectRevision: value },
      { ok: !lastColon, code: lastColon ? 'STALE' : null, ...(lastColon ? { committed: 0 } : { state: { '/title': 'Lax' } }) })]);
  }
  scen('room-failed-batch-writes-nothing', ROOM_SEED, [room(b([c('block.delete', { id: 'p' }), c('block.delete', { id: 'missing' })]),
    { ok: false, code: 'BLOCK_NOT_FOUND', committed: 0, blocksUnchanged: true, revision: '' })]);
  scen('room-delete-toggle-keeps-child', ROOM_SEED, [room(b([c('block.delete', { id: 't' })]),
    { ok: true, state: { '/blocks': { length: 2 }, '/blocks/1/id': 'k', '/blocks/1/parent': { absent: true }, '/blocks/1/lastEditedBy': 'agent-cs' } })]);
  scen('room-without-journal', ROOM_SEED, [
    room(setTitle('Plain'), { ok: true, revision: '', state: { '/title': 'Plain' } }),
    room({ ...setTitle('No'), expectRevision: 'abc:1' }, { ok: false, code: 'INVALID_ARGS', revision: '', state: { '/title': 'Plain' },
      result: { '/error/message': 'This room keeps no journal, so expectRevision cannot be checked. Send the batch without it.' } })], { journal: false });
  scen('room-page-rename-writes-a-target-room', ROOM_SEED, [
    { run: 'plain', document: { from: '@seed', set: { '/blocks': [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }] } },
      batch: b([c('page.rename', { id: 'pg', title: 'Roadmap' })]), expect: { ok: true, saved: false, state: { '/title': 'Roadmap' } } }],
  null, { options: { pageTitles: true, target: 'plain' }, pages: { 'page-2': { room: 'agent-room' } } });
  scen('room-read-returns-the-head', ROOM_SEED, [
    room(setTitle('One'), { ok: true }),
    room(b([c('doc.read', {})]), { ok: true, revision: '@head', committed: 0, result: { '/results/0/revision': '@head' } })]);
  scen('room-expect-text-mismatch-is-stale', ROOM_SEED, [room(b([c('text.format', { id: 'p', range: { start: 0, end: 5, expectText: 'Nope!' }, set: { bold: true } })]),
    { ok: false, code: 'STALE', committed: 0, revision: '' })]);
  scen('room-page-rename-from-a-live-source', ROOM_SEED, [
    room(b([c('page.rename', { id: 'pg', title: 'Roadmap' })]), { ok: true, result: { '/results/0': { pageId: 'page-2', applied: true } },
      stateDoc: 'agent-room', state: { '/title': 'Roadmap' } }, { doc: 'source-room', actor: null })],
  { held: { 'source-room': { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }] } } },
  { options: { pageTitles: true, target: 'plain' }, pages: { 'page-2': { room: 'agent-room' } } });
  const RETYPE = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } },
    { id: 'h', type: 'header', data: { text: [{ text: 'Head' }], level: 2 } }] };
  const rows = [
    [c('text.insert', { id: 'p', at: 5, text: ',' }), c('block.convert', { id: 'p', type: 'header', data: { level: 3 } })],
    [c('block.convert', { id: 'p', type: 'header', data: { level: 3 } }), c('text.insert', { id: 'p', at: 5, text: ',' })],
    [c('text.format', { id: 'h', range: { find: 'Head' }, set: { bold: true } }), c('block.convert', { id: 'h', type: 'paragraph' })],
    [c('text.insert', { id: 'p', at: 0, text: '> ' }), c('block.convert', { id: 'p', type: 'quote' }), c('text.delete', { id: 'p', range: { start: 0, end: 2 } })]];
  rows.forEach((commands, at) => {
    scen(`room-edit-and-retype-${at + 1}`, RETYPE, [
      { run: 'plain', document: '@seed', batch: b(commands), expect: { ok: true, saved: true } },
      room(b(commands), { ok: true, stateMatchesSaved: 0 }, { actor: null })]);
  });

  // BlokAgentRoomHistoryTests
  scen('room-undo-redo-the-last-batch', HIST_SEED, [
    room(insert('a', 'first'), { ok: true }), room(insert('b', 'second'), { ok: true }),
    room(UNDO, { ok: true, revision: '@head', committed: 1, state: { '/blocks': { length: 3 }, '/blocks/2/id': 'a' },
      result: { '/results': [{}], '/refs': {}, '/changed': { created: [], updated: [], moved: [], removed: [] }, '/warnings': [] } }),
    room(REDO, { ok: true, state: { '/blocks': { length: 4 }, '/blocks/3/id': 'b' } })]);
  scen('room-undo-nothing-to-replay', HIST_SEED, [
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO', revision: '', result: { '/error/message': 'This session has no step to undo.', '/error/retryable': false } }),
    room(REDO, { ok: false, code: 'NOTHING_TO_REDO', result: { '/error/message': 'This session has no undone step to redo.' } }),
    room(insert('a', 'first'), { ok: true }),
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO' }, { actor: { id: 'agent-2', name: 'Other' } })]);
  scen('room-undo-keeps-a-peer-edit', HIST_SEED, [
    room(replace('p', 'Agent'), { ok: true }), peer('q', 'Peer'),
    room(UNDO, { ok: true, state: { '/blocks/0/data/text': [{ text: 'Hello' }], '/blocks/1/data/text': [{ text: 'Peer' }] } })]);
  scen('room-undo-peer-conflict', HIST_SEED, [
    room(insert('a', 'Agent'), { ok: true }), peer('a', 'Peer typed here'),
    room(UNDO, { ok: false, code: 'CONFLICT', blocksUnchanged: true, committed: 0, result: { '/error/retryable': true,
      '/error/message': 'Someone else changed what this step wrote, so it can no longer be undone. Re-read the document before retrying.' } })]);
  scen('room-undo-move-and-title', HIST_SEED, [
    room(b([c('block.move', { id: 'q', position: { before: 'p' } })]), { ok: true, state: { '/blocks/0/id': 'q', '/blocks/1/id': 'p' } }),
    room(UNDO, { ok: true, state: { '/blocks/0/id': 'p', '/blocks/1/id': 'q' } }),
    room(setTitle('Agent title'), { ok: true, state: { '/title': 'Agent title' } }),
    room(UNDO, { ok: true, state: { '/title': { absent: true } } }),
    room(REDO, { ok: true, state: { '/title': 'Agent title' } })]);
  scen('room-undo-forget-purge', HIST_SEED, [room(insert('a', 'Agent'), { ok: true }), { run: 'purge' },
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO' })]);
  scen('room-undo-forget-restore', HIST_SEED, [room(replace('p', 'Agent'), { ok: true }), { run: 'restore', version: '{lineage}:0' },
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO', blocksUnchanged: true, committed: 0 })]);
  scen('room-undo-forget-reset', HIST_SEED, [room(replace('p', 'Agent'), { ok: true }), { run: 'reset' },
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO', blocksUnchanged: true, committed: 0 })]);
  const forA = { id: 'agent-cs', name: 'Agent', onBehalfOf: 'person-a' };
  const forB = { id: 'agent-cs', name: 'Agent', onBehalfOf: 'person-b' };
  scen('room-undo-per-person', HIST_SEED, [room(insert('a', 'For A'), { ok: true }, { actor: forA }),
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO', state: { '/blocks': { length: 3 } } }, { actor: forB }),
    room(UNDO, { ok: true, state: { '/blocks': { length: 2 } } }, { actor: forA })]);
  scen('room-undo-cap', HIST_SEED, [
    { ...room(replace('p', 'T{i}'), { ok: true }), times: 105 },
    { ...room(UNDO, { ok: true }), times: 100 },
    room(b([c('doc.read', {})]), { ok: true, state: { '/blocks/0/data/text': [{ text: 'T4' }] } }),
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO' })]);
  // T13: an undo with more than args skips the gate and goes to the edit path.
  scen('room-undo-with-args-takes-the-edit-path', HIST_SEED, [room(insert('a', 'Agent'), { ok: true }),
    room(b([c('history.undo', { steps: 1 })]), { ok: false, code: 'INVALID_ARGS', committed: 0, result: { '/error/path': '/commands/0/args/steps' } }),
    // The edit path's bundle session holds no step, so it answers nothing to undo although the room has one.
    room(b([{ name: 'history.undo', args: {}, ref: 'u' }]), { ok: false, code: 'NOTHING_TO_UNDO', committed: 0, revision: '', state: { '/blocks': { length: 3 } } })]);
  // T14: only the first command is checked for a version command.
  scen('room-version-command-not-first', VER_SEED, [room(b([c('doc.read', {}), c('history.versions', {})]), { ok: false, code: 'INVALID_ARGS', committed: 0, result: { '/error/path': '/commands/1/name' } })]);
  // F14: a purged room refuses the edit.
  scen('room-refused-purged', HIST_SEED, [room(setTitle('One'), { ok: true }), { run: 'purge' },
    room(setTitle('Two'), { ok: false, code: 'APPLY_FAILED', revision: '', result: { '/error/retryable': false, '/error/details': { status: 'Purged' },
      '/error/message': 'The room refused the edit (Purged). Nothing was written.' } })]);
  // F10: a room that cannot be read.
  scen('room-unreadable-version-read', VER_SEED, [room(b([c('history.versions', {})]), { ok: false, code: 'APPLY_FAILED', revision: '',
    result: { '/error/retryable': true, '/error/message': 'The room could not be read. Nothing was written.' } }, { doc: 'broken' })],
  { held: { broken: { blocks: 'not a list' } } });
  scen('room-unreadable-page-action', ROOM_SEED, [room(b([c('page.rename', { id: 'pg', title: 'X' })]), { ok: false, code: 'APPLY_FAILED',
    result: { '/error/message': 'The room could not be read. Nothing was written.' } }, { doc: 'broken' })],
  { held: { broken: { blocks: 'not a list' } } }, { options: { pageTitles: true, target: 'plain' } });
  scen('room-page-action-stale', ROOM_SEED, [room(b([c('page.rename', { id: 'pg', title: 'X' })], { expectRevision: '{lineage}:9' }),
    { ok: false, code: 'STALE', revision: '@head', result: { '/error/details/revision': '@head' } }, { doc: 'source-room' })],
  { held: { 'source-room': { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }] } } },
  { options: { pageTitles: true, target: 'plain' }, pages: { 'page-2': { room: 'agent-room' } } });
  scen('room-undo-other-document', ROOM_SEED, [
    room(b([c('page.rename', { id: 'pg', title: 'Roadmap' })]), { ok: true }, { doc: 'source-room', actor: null }),
    room(UNDO, { ok: false, code: 'UNDO_OTHER_DOCUMENT', result: { '/error/retryable': false } }, { doc: 'source-room', actor: null })],
  { held: { 'source-room': { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-2' } }] } } },
  { options: { pageTitles: true, target: 'plain' }, pages: { 'page-2': { room: 'agent-room' } } });

  // BlokAgentVersionHistoryTests
  const CMDS = { 'history.versions': { available: true }, 'history.read': { available: true }, 'history.changes': { available: true }, 'history.restore': { available: true } };
  const UNAV = Object.fromEntries(Object.keys(CMDS).map((key) => [key, { unavailableReason: 'service' }]));
  scen('version-contract-room', VER_SEED, [{ run: 'contract:room', expect: { commands: CMDS } }, { run: 'contract:plain', expect: { commands: UNAV } }]);
  scen('version-contract-room-without-journal', VER_SEED, [{ run: 'contract:room', expect: { commands: UNAV } }], { journal: false });
  scen('version-list-read-changes', VER_SEED, [
    room(replace('p', 'Changed'), { ok: true }),
    room(b([c('history.versions', { group: 1 })]), { ok: true, committed: 0, result: { '/results/0/versions/0/version': '{rev:0}', '/results/0/versions/0/actors': ['agent-cs'] } }),
    room(b([c('history.read', { version: '{lineage}:0' })]), { ok: true, result: { '/results/0/version': '{lineage}:0', '/results/0/blocks/0/text': 'Hello world', '/results/0/revision': { absent: true } } }),
    room(b([c('history.changes', { from: '{lineage}:0' })]), { ok: true, committed: 0, state: { '/blocks/0/data/text/0/text': 'Changed' },
      result: { '/results/0/changed': { length: 1 }, '/results/0/changed/0/id': 'p', '/results/0/changed/0/before/text': 'Hello world',
        '/results/0/changed/0/after/text': 'Changed', '/results/0/added': { length: 0 } } })]);
  // T3: group 15.0 is not an int, so the default grouping stays.
  scen('version-list-group-not-an-int', VER_SEED, [room(replace('p', 'Changed'), { ok: true }),
    room(b([c('history.versions', { group: new RawNumber('15.0') })]), { ok: true }), room(b([c('history.versions', { group: '15' })]), { ok: false, code: 'INVALID_ARGS' })]);
  scen('version-read-unknown', VER_SEED, [room(setTitle('One'), { ok: true }),
    room(b([c('history.read', { version: '{lineage}:99' })]), { ok: false, code: 'INVALID_ARGS', result: { '/error/path': '/commands/0/args/version' } }),
    room(b([c('history.read', { version: 'nocolon' })]), { ok: false, code: 'INVALID_ARGS' })]);
  scen('version-without-history-journal', VER_SEED, [room(b([c('history.versions', {})]), { ok: false, code: 'COMMAND_UNAVAILABLE', result: { '/error/details/reason': 'service' } })], { journal: false });
  scen('version-purged', VER_SEED, [room(setTitle('One'), { ok: true }), { run: 'purge' },
    room(b([c('history.versions', {})]), { ok: false, code: 'TOOL_ACTION_FAILED', result: { '/error/retryable': false, '/error/message': 'The version history failed: this document was deleted.' } }),
    room(b([c('history.read', { version: '{rev:0}' })]), { ok: false, result: { '/error/retryable': false } })]);
  scen('version-stored-has-none', VER_SEED, [{ run: 'plain', document: { from: '@seed', set: { '/blocks': [] } }, batch: b([c('history.versions', {})]), expect: { ok: false, code: 'COMMAND_UNAVAILABLE' } }]);
  scen('version-restore', VER_SEED, [
    room(replace('p', 'Changed'), { ok: true }),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ok: true, committed: 1, revision: '@head', result: { '/results/0/previous': '{rev:0}', '/revision': '@head' },
      state: { '/blocks/0/data/text/0/text': 'Hello world', '/blocks/0/lastEditedWith': { absent: true } } }),
    room(b([c('history.versions', { group: 1 })]), { ok: true, result: { '/results/0/versions/0/actors': ['agent-cs'] } })]);
  scen('version-restore-unknown', VER_SEED, [room(setTitle('One'), { ok: true }),
    room(b([c('history.restore', { version: '{lineage}:99' })]), { ok: false, code: 'VERSION_NOT_FOUND', committed: 0, revision: '@head' })]);
  scen('version-restore-stale', VER_SEED, [room(setTitle('One'), { ok: true }), room(setTitle('Two'), { ok: true }),
    room(b([c('history.restore', { version: '{lineage}:0' })], { expectRevision: '{rev:0}' }), { ok: false, code: 'STALE', committed: 0, revision: '@head', result: { '/error/details/revision': '@head' } })]);
  scen('version-undo-after-restore', VER_SEED, [room(replace('p', 'Changed'), { ok: true }),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ok: true }),
    room(UNDO, { ok: false, code: 'NOTHING_TO_UNDO', committed: 0, state: { '/blocks/0/data/text/0/text': 'Hello world' } })]);

  // F25, F27: the journal cannot list lineages after `after` more listings
  // (a corrupt store). A read lists once per version, a restore lists, reads
  // the version, then lists again inside the restore.
  const failListings = (after) => ({ run: 'failListings', after });
  const failed = (message, revision = '@head') => ({ ok: false, code: 'TOOL_ACTION_FAILED', committed: 0, revision,
    result: { '/error/message': `The version history failed: ${message}`, '/error/retryable': false, '/error/path': '/commands/0/args' } });
  const LIST = failed('The version history could not be read (Corrupt).');
  const unreadable = (version) => failed(`Version "${version}" could not be read (Corrupt).`);
  scen('version-load-failed-list', VER_SEED, [room(setTitle('One'), { ok: true }), failListings(0),
    room(b([c('history.versions', {})]), LIST)]);
  scen('version-load-failed-read', VER_SEED, [room(setTitle('One'), { ok: true }), failListings(0),
    room(b([c('history.read', { version: '{rev:0}' })]), unreadable('{rev:0}'))]);
  scen('version-load-failed-changes-second', VER_SEED, [room(setTitle('One'), { ok: true }), room(setTitle('Two'), { ok: true }), failListings(1),
    room(b([c('history.changes', { from: '{rev:0}', to: '{rev:1}' })]), unreadable('{rev:1}'))]);
  scen('version-restore-failed-list', VER_SEED, [room(replace('p', 'Changed'), { ok: true }), failListings(0),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ...LIST, blocksUnchanged: true })]);
  scen('version-restore-failed-read', VER_SEED, [room(replace('p', 'Changed'), { ok: true }), failListings(1),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ...unreadable('{lineage}:0'), blocksUnchanged: true })]);
  scen('version-restore-failed-corrupt', VER_SEED, [room(replace('p', 'Changed'), { ok: true }), failListings(2),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ok: false, code: 'TOOL_ACTION_FAILED', committed: 0, revision: '', blocksUnchanged: true,
      result: { '/error/message': 'The version history failed: the restore could not run (Corrupt).', '/error/retryable': false, '/revision': { absent: true }, '/error/path': { absent: true } } }),
    room(b([c('history.restore', { version: '{lineage}:0' })]), { ok: true, committed: 1, state: { '/blocks/0/data/text/0/text': 'Hello world' } })]);

  // Page pre-create in a room (BlokAgentPageCreateTests).
  const EMPTY = { blocks: [] };
  const INSERT_PAGE = b([c('block.insert', { type: 'page', id: 'np', position: 'end' })]);
  const CREATOR = { pageTitles: true, target: 'creator' };
  scen('room-page-create-insert-undo-redo', EMPTY, [
    room(INSERT_PAGE, { ok: true, revision: '@head', state: { '/blocks/0/data/pageId': 'host-1' } }, { actor: null }),
    room(UNDO, { ok: true, state: { '/blocks': { length: 0 } } }, { actor: null }),
    room(REDO, { ok: true, state: { '/blocks/0/data/pageId': 'host-1' } }, { actor: null }),
    room(b([c('block.delete', { id: 'np' })]), { ok: true, state: { '/blocks': { length: 0 } } }, { actor: null })],
  null, { options: CREATOR, host: { created: ['host-1'], resolved: [] } });
  scen('room-page-create-stale', EMPTY, [
    room(b([c('block.insert', { type: 'paragraph', id: 'p1', position: 'end' })]), { ok: true }, { actor: null }),
    room(b([c('block.insert', { type: 'paragraph', id: 'p2', position: 'end' })]), { ok: true }, { actor: null }),
    room({ ...INSERT_PAGE, expectRevision: '{rev:0}' }, { ok: false, code: 'STALE', committed: 0, revision: '@head',
      result: { '/error/details/revision': '@head', '/error/details/current': { present: true } } }, { actor: null })],
  null, { options: CREATOR, host: { created: [] } });
  scen('room-page-create-forbidden', EMPTY, [
    room(INSERT_PAGE, { ok: false, code: 'FORBIDDEN', committed: 0, revision: '',
      result: { '/error/message': 'The host does not let this agent create a page here. Nothing was written.' } }, { actor: null })],
  null, { options: CREATOR, create: [''], host: { created: [] } });
  scen('room-page-create-refused-batch', EMPTY, [
    room(b([c('block.insert', { type: 'page', id: 'np', position: 'end' }), c('block.delete', { id: 'missing' })]),
      { ok: false, code: 'BLOCK_NOT_FOUND', committed: 0, revision: '' }, { actor: null })],
  null, { options: CREATOR, host: { created: [] } });
  scen('room-page-create-forbidden-after-one', EMPTY, [
    room(b([c('block.insert', { type: 'page', id: 'a', position: 'end' }), c('block.insert', { type: 'page', id: 'b', position: 'end' })]),
      { ok: false, code: 'ORPHANED_SIDE_EFFECT', committed: 0, revision: '', result: { '/error/details/cause/code': 'FORBIDDEN',
        '/error/details/orphaned': [{ command: 'block.insert', type: 'page', prepared: { pageId: 'host-1' } }] } }, { actor: null })],
  null, { options: CREATOR, create: ['host-1', ''], host: { created: ['host-1'] } });

  // RoomAgentHistory approvals (BlokAgentRoomHistoryTests).
  const TABLE = { id: 'v', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] };
  const SCHEMA = [{ id: 't', name: 'Name', type: 'title', position: 'a0' }];
  const database = (...views) => ({ id: 'db', type: 'database', content: [], data: { title: 'Tasks', activeViewId: 'v', views: [TABLE, ...views], schema: SCHEMA } });
  scen('room-undo-unlock', { blocks: [database()] }, [
    room(b([c('database.setLock', { id: 'db', locked: true })]), { ok: true, state: { '/blocks/0/data/schema/0/databaseLocked': true } }),
    room(UNDO, { ok: false, code: 'APPROVAL_REQUIRED', committed: 0, state: { '/blocks/0/data/schema/0/databaseLocked': true },
      result: { '/error/retryable': false, '/error/details': { reason: 'no-channel', approval: { kind: 'database.unlock', blockId: 'db' } },
        '/error/message': 'This undo would unlock database "db". Unlocking needs a person\'s explicit approval, and nothing here can ask one. Nothing was written. Ask the person to unlock it themselves.' } })]);
  const FORM = { id: 'f', name: 'Signup', type: 'form', position: 'a1', filters: [], sorts: [], visibleProperties: [], form: { public: true } };
  scen('room-undo-share-public-form', { blocks: [database(FORM)] }, [
    room(b([c('database.deleteView', { id: 'db', viewId: 'f' })]), { ok: true, state: { '/blocks/0/data/views': { length: 1 } } }),
    room(UNDO, { ok: false, code: 'APPROVAL_REQUIRED', committed: 0, state: { '/blocks/0/data/views': { length: 1 } },
      result: { '/error/details': { reason: 'no-channel', approval: { kind: 'database.share', blockId: 'db', viewId: 'f' } },
        '/error/message': 'This undo would change who can see or fill out view "f" of database "db". That needs a person\'s explicit approval, and nothing here can ask one. Nothing was written. Ask the person to do it themselves.' } })]);
  const { id: _formId, ...formWithoutId } = FORM;
  for (const [label, view, viewId] of [
    ['no-id', formWithoutId, ''],
    ['submission-access', { ...FORM, form: { submissionAccess: 'everyone' } }, 'f'],
    ['unreadable', { ...FORM, form: { public: 'yes' } }, 'f']]) {
    scen(`room-undo-share-${label}`, { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'P' } }, database(view)] }, [
      room(b([c('block.delete', { id: 'db' })]), { ok: true, state: { '/blocks': { length: 1 } } }),
      room(UNDO, { ok: false, code: 'APPROVAL_REQUIRED', committed: 0, state: { '/blocks': { length: 1 } },
        result: { '/error/details/approval': { kind: 'database.share', blockId: 'db', viewId } } })]);
  }
  // F16: a step from another lineage than the caller's head.
  scen('room-undo-lineage-changed', HIST_SEED, [room(insert('a', 'Agent'), { ok: true }),
    room({ ...UNDO, expectRevision: 'ffffffffffffffffffffffffffffffff:1' }, { ok: false, code: 'CONFLICT', committed: 0, revision: '',
      result: { '/error/retryable': true, '/error/message': 'The room was reset or reloaded since this step, so it can no longer be undone. Re-read the document.' } })]);
  // F14 and F22: a draining room refuses the edit and the undo, and says a retry may pass.
  scen('room-refused-draining', HIST_SEED, [room(insert('a', 'Agent'), { ok: true }), { run: 'drain' },
    room({ ...UNDO, expectRevision: '{rev:0}' }, { ok: false, code: 'APPLY_FAILED', revision: '', result: { '/error/retryable': true,
      '/error/details': { status: 'Draining' }, '/error/message': 'The room refused the undo (Draining). Nothing was written.' } }),
    room(insert('b', 'Late'), { ok: false, code: 'APPLY_FAILED', revision: '', result: { '/error/retryable': true,
      '/error/details': { status: 'Draining' }, '/error/message': 'The room refused the edit (Draining). Nothing was written.' } })]);
  // T7: every call is a new operation id, so the same batch twice commits twice.
  scen('room-same-batch-twice-commits-twice', HIST_SEED, [{ ...room(b([c('text.insert', { id: 'p', at: 0, text: 'x' })]), { ok: true, committed: 1 }), times: 2 },
    room(b([c('doc.read', {})]), { ok: true, state: { '/blocks/0/data/text': [{ text: 'xxHello' }] } })]);

  // H17: an undo puts back the edit stamp the block had, not only its data.
  scen('room-undo-restores-the-stamp', HIST_SEED, [
    room(replace('p', 'One'), { ok: true, state: { '/blocks/0/lastEditedBy': 'agent-b' } }, { actor: { id: 'agent-b', name: 'B' } }),
    room(replace('p', 'Two'), { ok: true, state: { '/blocks/0/lastEditedBy': 'agent-cs' } }),
    room(UNDO, { ok: true, state: { '/blocks/0/lastEditedBy': 'agent-b', '/blocks/0/data/text': [{ text: 'One' }] } })]);

  return new Map([...S].map(([name, scenario]) => [`${name}.json`, `${write(clean(scenario))}\n`]));
};

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag === -1 ? DEFAULT_OUT : process.argv[outFlag + 1];

  mkdirSync(out, { recursive: true });
  const files = generate();

  for (const [name, text] of files) {
    writeFileSync(join(out, name), text);
  }
  console.log(files.size);
}
