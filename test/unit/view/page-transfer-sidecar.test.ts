// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSidecarTransferHost,
  executePageTransfer,
  undoPageTransfer,
} from '../../../src/view';
import type {
  PageTransferHost,
  PageTransferReceipt,
  PageTransferRequest,
  SidecarTransferLog,
  SidecarTransferRecord,
} from '../../../src/view';
import { FakeSidecar } from './page-transfer-sidecar-fixture';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const memoryLog = (): SidecarTransferLog & { records: Map<string, SidecarTransferRecord> } => {
  const records = new Map<string, SidecarTransferRecord>();

  return {
    records,
    get: (operationId) => {
      const record = records.get(operationId);

      return record === undefined ? undefined : structuredClone(record);
    },
    put: (record) => {
      records.set(record.operationId, structuredClone(record));
    },
  };
};

const setup = (options: { maxEditBytes?: number; maxAttempts?: number } = {}) => {
  const server = new FakeSidecar();
  const log = memoryLog();
  const host = createSidecarTransferHost({
    baseUrl: 'https://sidecar.test/api/blok/',
    ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
    log,
    fetch: server.fetch,
    ...options,
  });

  server.seed('source', [
    { id: 'a', type: 'toggle', data: { text: 'A' }, content: ['a1'] },
    { id: 'a1', type: 'paragraph', parent: 'a', data: { text: 'A1' } },
    { id: 'b', type: 'paragraph', data: { text: 'B' } },
  ]);
  server.seed('target', [
    { id: 't', type: 'paragraph', data: { text: 'T' } },
  ]);

  return { server, log, host };
};

const move: PageTransferRequest = {
  kind: 'move-blocks',
  operationId: 'move-1',
  sourcePageId: 'source',
  targetPageId: 'target',
  rootIds: ['a'],
  place: { parentId: null, afterId: 't' },
};

const failure = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => new Error('expected a refusal'), (error: unknown) => error);

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const ofTarget = (server: FakeSidecar, id: string): number =>
  server.ids('target').filter((entry) => entry === id).length;

describe('createSidecarTransferHost', () => {
  it('moves a subtree: the target gains it, the source loses it, two saga steps', async () => {
    const { server, host } = setup();

    const receipt = await executePageTransfer(host, move, { collaboration: true });

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(server.document('target').blocks.find((block) => block.id === 'a1')?.parent).toBe('a');
    expect(server.document('target').blocks.find((block) => block.id === 'a')?.content).toEqual(['a1']);
    expect(server.ids('source')).toEqual(['b']);
    expect(host.mode).toBe('live-saga');
    expect(receipt.durability).toEqual({
      kind: 'saga',
      steps: [
        { doc: 'target', lineage: expect.any(String), sequence: '2' },
        { doc: 'source', lineage: expect.any(String), sequence: '2' },
      ],
    });
    expect(receipt.rootIds).toEqual(['a']);
  });

  it('sends write tickets on edits and read tickets on state reads', async () => {
    const { server, host } = setup();

    await host.run(move);

    expect(server.edits.map((edit) => edit.authorization)).toEqual([
      'Bearer ticket:target:write',
      'Bearer ticket:source:write',
    ]);
  });

  it('does not copy twice when the target response is lost and the run is retried', async () => {
    const { server, host } = setup();
    let lost = false;

    server.onEdit((edit) => {
      if (edit.doc === 'target' && !lost) {
        lost = true;

        return 'lose-response';
      }
    });

    const first = await failure(host.run(move));

    expect(ofTarget(server, 'a')).toBe(1);
    expect(server.ids('source')).toContain('a');
    expect(messageOf(first)).toMatch(/fetch failed/);

    await host.run(move);

    expect(ofTarget(server, 'a')).toBe(1);
    expect(ofTarget(server, 'a1')).toBe(1);
    expect(server.ids('source')).toEqual(['b']);
  });

  it('keeps the only copy when the source response is lost and a peer then edits the source', async () => {
    const { server, host } = setup();
    let lost = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !lost) {
        lost = true;

        return 'lose-response';
      }
    });

    await failure(host.run(move));
    server.peerEdit('source', 'b', 'Peer');
    const receipt = await host.run(move);

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(server.ids('source')).toEqual(['b']);
    expect(server.document('source').blocks[0]?.data.text).toBe('Peer');
    expect(receipt.durability.kind).toBe('saga');
  });

  it('resumes from the log after a crash between the target and source steps', async () => {
    const { server, log, host } = setup();
    let dropped = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !dropped) {
        dropped = true;

        return 'drop';
      }
    });

    const first = await failure(host.run(move));

    expect(ofTarget(server, 'a')).toBe(1);
    expect(server.ids('source')).toContain('a');
    expect(log.records.has('move-1')).toBe(true);
    expect(messageOf(first)).toMatch(/fetch failed/);

    const restarted = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
      log,
      fetch: server.fetch,
    });

    await restarted.run(move);

    expect(ofTarget(server, 'a')).toBe(1);
    expect(server.ids('source')).toEqual(['b']);
    expect(server.appliedEdits.filter((edit) => edit.doc === 'target')).toHaveLength(1);
  });

  it('returns the stored receipt for a finished operation without writing again', async () => {
    const { server, host } = setup();

    const first = await host.run(move);
    const edits = server.edits.length;
    const second = await host.run(move);

    expect(server.edits).toHaveLength(edits);
    expect(second).toEqual(first);
  });

  it('refuses a reused operation ID for a different request', async () => {
    const { server, host } = setup();

    await host.run(move);
    const error = await failure(host.run({ ...move, rootIds: ['b'] }));

    expect(server.ids('source')).toEqual(['b']);
    expect(messageOf(error)).toMatch(/different request/i);
  });

  it('removes the target copy and retries when a peer edits the source first', async () => {
    const { server, host } = setup();
    let edited = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !edited) {
        edited = true;
        server.peerEdit('source', 'b', 'Peer');
      }
    });

    await host.run(move);

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(server.ids('source')).toEqual(['b']);
    expect(server.document('source').blocks[0]?.data.text).toBe('Peer');
  });

  it('gives up with the source intact and no target copy when the source keeps changing', async () => {
    const { server, host } = setup({ maxAttempts: 2 });
    let peerText = 0;

    server.onEdit((edit) => {
      if (edit.doc === 'source') {
        peerText += 1;
        server.peerEdit('source', 'b', `Peer ${peerText}`);
      }
    });

    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.document('source').blocks[2]?.data.text).toBe('Peer 2');
    expect(server.ids('target')).toEqual(['t']);
    expect(messageOf(error)).toMatch(/changed during the transfer/i);
  });

  it('leaves the copy in place when a peer has added to it before compensation', async () => {
    const { server, host } = setup();
    let edited = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !edited) {
        edited = true;
        server.peerEdit('source', 'b', 'Peer');
        server.peerInsertChild('target', 'a', { id: 'peer-child', type: 'paragraph', data: { text: 'Peer' } });
      }
    });

    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.ids('target')).toContain('peer-child');
    expect(ofTarget(server, 'a')).toBe(1);
    expect(messageOf(error)).toMatch(/copy/i);
  });

  it('leaves the copy in place when a peer has edited it before compensation', async () => {
    const { server, host } = setup();
    let edited = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !edited) {
        edited = true;
        server.peerEdit('source', 'b', 'Peer');
        server.peerEdit('target', 'a1', 'Peer typed in the copy');
      }
    });

    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.document('target').blocks.find((block) => block.id === 'a1')?.data.text).toBe('Peer typed in the copy');
    expect(ofTarget(server, 'a')).toBe(1);
    expect(messageOf(error)).toMatch(/copy .* left in place/i);
  });

  it('never compensates when the source step outcome is unknown (commit then 504)', async () => {
    const { server, host } = setup();
    let once = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !once) {
        once = true;

        return 'commit-then-504';
      }
    });

    const error = await failure(host.run(move));

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(server.ids('source')).toEqual(['b']);
    expect(messageOf(error)).toMatch(/504.*same operation ID/i);

    await host.run(move);

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(server.ids('source')).toEqual(['b']);
  });

  it('removes the copy and keeps the source when the source refuses for good', async () => {
    const { server, host } = setup();

    server.onEdit((edit) => edit.doc === 'source' ? { refuse: 403 } : undefined);
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.ids('target')).toEqual(['t']);
    expect(messageOf(error)).toMatch(/403/);
  });

  it('removes the partial copy when a later copy chunk is refused', async () => {
    const { server, host } = setup({ maxEditBytes: 400 });
    let targetEdits = 0;

    server.seed('source', [
      { id: 'a', type: 'toggle', data: { text: 'A'.repeat(150) }, content: ['a1', 'a2'] },
      { id: 'a1', type: 'paragraph', parent: 'a', data: { text: '1'.repeat(150) } },
      { id: 'a2', type: 'paragraph', parent: 'a', data: { text: '2'.repeat(150) } },
    ]);
    server.onEdit((edit) => {
      if (edit.doc !== 'target') {
        return undefined;
      }
      targetEdits += 1;

      return targetEdits === 2 ? { refuse: 422 } : undefined;
    });
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'a2']);
    expect(server.ids('target')).toEqual(['t']);
    expect(server.edits.filter((edit) => edit.doc === 'source')).toHaveLength(0);
    expect(messageOf(error)).toMatch(/refused the copy/i);
  });

  it('stops before any edit when the host log cannot store the plan', async () => {
    const { server } = setup();
    const host = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
      log: {
        get: () => undefined,
        put: () => {
          throw new Error('log is down');
        },
      },
      fetch: server.fetch,
    });
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.edits).toHaveLength(0);
    expect(messageOf(error)).toMatch(/log is down/);
  });

  it('refuses a block field the edit cannot carry instead of dropping it', async () => {
    const { server, host } = setup();

    server.seed('source', [{ id: 'a', type: 'paragraph', data: { text: 'Indented' }, indent: 2 }]);
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a']);
    expect(server.edits).toHaveLength(0);
    expect(messageOf(error)).toMatch(/indent/);
  });

  it('refuses a reparent of a pointer into the page it owns', async () => {
    const { server, host } = setup();

    server.seed('source', [{ id: 'p', type: 'page', data: { pageId: 'target' } }]);
    const error = await failure(host.run({ ...move, kind: 'reparent-page', rootIds: ['p'] }));

    expect(server.ids('source')).toEqual(['p']);
    expect(server.edits).toHaveLength(0);
    expect(messageOf(error)).toMatch(/cycle/i);
  });

  it('refuses a server without an operation journal before writing anything', async () => {
    const { server, host } = setup();

    server.journal = false;
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.ids('target')).toEqual(['t']);
    expect(server.edits).toHaveLength(0);
    expect(messageOf(error)).toMatch(/journal/i);
  });

  it('refuses an edit 204 that carries no durable receipt and leaves the source', async () => {
    const { server, host } = setup();

    server.onEdit(() => {
      server.journal = false;
    });
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.edits.filter((edit) => edit.doc === 'source')).toHaveLength(0);
    expect(messageOf(error)).toMatch(/durable/i);
  });

  it('refuses to resume when a document lineage changed between attempts', async () => {
    const { server, host } = setup();
    let dropped = false;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && !dropped) {
        dropped = true;

        return 'drop';
      }
    });

    await failure(host.run(move));
    server.resetLineage('target');
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(ofTarget(server, 'a')).toBe(1);
    expect(server.edits.filter((edit) => edit.doc === 'source')).toHaveLength(1);
    expect(messageOf(error)).toMatch(/lineage/i);
  });

  it('refuses duplicate-page without any request', async () => {
    const { server, host } = setup();
    const error = await failure(host.run({
      kind: 'duplicate-page',
      operationId: 'dup-1',
      sourcePageId: 'source',
      targetPageId: 'target',
      pointerId: 'a',
      place: { parentId: null, afterId: null },
    }));

    expect(server.ids('target')).toEqual(['t']);
    expect(server.edits).toHaveLength(0);
    expect(server.stateReads).toBe(0);
    expect(messageOf(error)).toMatch(/duplicate/i);
  });

  it('splits a large copy into parent-first chunks', async () => {
    const { server, host } = setup({ maxEditBytes: 400 });

    server.seed('source', [
      { id: 'a', type: 'toggle', data: { text: 'A'.repeat(150) }, content: ['a1', 'a2'] },
      { id: 'a1', type: 'paragraph', parent: 'a', data: { text: '1'.repeat(150) } },
      { id: 'a2', type: 'paragraph', parent: 'a', data: { text: '2'.repeat(150) } },
    ]);

    await host.run(move);

    expect(server.ids('target')).toEqual(['t', 'a', 'a1', 'a2']);
    expect(server.document('target').blocks.find((block) => block.id === 'a')?.content).toEqual(['a1', 'a2']);
    expect(server.ids('source')).toEqual([]);
    expect(server.appliedEdits.filter((edit) => edit.doc === 'target').length).toBeGreaterThan(1);
  });

  it('refuses a block larger than one edit request before writing', async () => {
    const { server, host } = setup({ maxEditBytes: 200 });

    server.seed('source', [{ id: 'a', type: 'paragraph', data: { text: 'x'.repeat(300) } }]);
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a']);
    expect(server.edits).toHaveLength(0);
    expect(messageOf(error)).toMatch(/too large/i);
  });

  it('turns blocks into a new page and leaves a pointer in their place', async () => {
    const { server, host } = setup();

    await host.run({
      kind: 'turn-into-page',
      operationId: 'tip-1',
      sourcePageId: 'source',
      targetPageId: 'new-page',
      rootIds: ['a'],
      pointerId: 'ptr',
    });

    expect(server.ids('new-page')).toEqual(['a', 'a1']);
    expect(server.ids('source')).toEqual(['ptr', 'b']);
    expect(server.document('source').blocks[0]).toEqual({ id: 'ptr', type: 'page', data: { pageId: 'new-page' } });
  });

  it('refuses turn-into-page when a peer writes into the new page first', async () => {
    const { server, host } = setup();
    let once = false;

    server.onEdit((edit) => {
      if (edit.doc === 'new-page' && !once) {
        once = true;
        server.peerInsertRoot('new-page', { id: 'peer', type: 'paragraph', data: { text: 'Peer' } });
      }
    });
    const error = await failure(host.run({
      kind: 'turn-into-page',
      operationId: 'tip-2',
      sourcePageId: 'source',
      targetPageId: 'new-page',
      rootIds: ['a'],
      pointerId: 'ptr',
    }));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.ids('new-page')).toEqual(['peer']);
    expect(messageOf(error)).toMatch(/empty new page/i);
  });

  it('turns a page back into blocks in the parent and empties the page', async () => {
    const { server, host } = setup();

    server.seed('parent', [
      { id: 'x', type: 'paragraph', data: { text: 'X' } },
      { id: 'ptr', type: 'page', data: { pageId: 'child' } },
      { id: 'z', type: 'paragraph', data: { text: 'Z' } },
    ]);
    server.seed('child', [
      { id: 'c1', type: 'paragraph', data: { text: 'C1' } },
      { id: 'c2', type: 'paragraph', data: { text: 'C2' } },
    ]);

    const receipt = await host.run({
      kind: 'turn-into-blocks',
      operationId: 'tib-1',
      sourcePageId: 'child',
      targetPageId: 'parent',
      pointerId: 'ptr',
    });

    expect(server.ids('parent')).toEqual(['x', 'c1', 'c2', 'z']);
    expect(server.ids('child')).toEqual([]);
    expect(receipt.rootIds).toEqual(['c1', 'c2']);
  });

  it('refuses turn-into-blocks when the pointer names another page', async () => {
    const { server, host } = setup();

    server.seed('parent', [{ id: 'ptr', type: 'page', data: { pageId: 'other' } }]);
    server.seed('child', [{ id: 'c1', type: 'paragraph', data: { text: 'C1' } }]);
    const error = await failure(host.run({
      kind: 'turn-into-blocks',
      operationId: 'tib-2',
      sourcePageId: 'child',
      targetPageId: 'parent',
      pointerId: 'ptr',
    }));

    expect(server.ids('parent')).toEqual(['ptr']);
    expect(server.ids('child')).toEqual(['c1']);
    expect(messageOf(error)).toMatch(/mismatch/i);
  });

  it('undoes a move by moving the current subtree back', async () => {
    const { server, host } = setup();
    const receipt = await executePageTransfer(host, move, { collaboration: true });

    server.peerEdit('target', 'a1', 'Edited after move');
    const undo = await undoPageTransfer(host, { operationId: 'undo-1', undoOf: receipt }, { collaboration: true });

    expect(server.ids('source')).toEqual(['a', 'b', 'a1']);
    expect(server.document('source').blocks.find((block) => block.id === 'a')?.content).toEqual(['a1']);
    expect(server.document('source').blocks.find((block) => block.id === 'a1')?.data.text).toBe('Edited after move');
    expect(server.ids('target')).toEqual(['t']);
    expect(undo.durability.kind).toBe('saga');
    expect(undo.undoOfOperationId).toBe('move-1');
  });

  it('refuses Undo when a peer moved the root away from the destination', async () => {
    const { server, host } = setup();
    const receipt = await host.run(move);

    server.peerRemove('target', 'a');
    const error = await failure(host.undo({ operationId: 'undo-1', undoOf: receipt }));

    expect(server.ids('source')).toEqual(['b']);
    expect(server.ids('target')).toEqual(['t']);
    expect(messageOf(error)).toMatch(/destination/i);
  });

  it('refuses Undo of a receipt the log does not hold', async () => {
    const { server, host } = setup();
    const receipt = await host.run(move);
    const error = await failure(host.undo({
      operationId: 'undo-1',
      undoOf: { ...receipt, undoToken: 'forged' },
    }));

    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(messageOf(error)).toMatch(/receipt/i);
  });
});

describe('executePageTransfer with a saga host', () => {
  const sagaReceipt: PageTransferReceipt = {
    operationId: 'move-1',
    kind: 'move-blocks',
    sourcePageId: 'source',
    targetPageId: 'target',
    rootIds: ['a'],
    undoToken: 'undo',
    durability: { kind: 'saga', steps: [{ doc: 'target', lineage: 'l', sequence: '2' }] },
  };

  it('accepts a live-saga host during collaboration', async () => {
    const host: PageTransferHost = { mode: 'live-saga', run: vi.fn().mockResolvedValue(sagaReceipt) };

    await expect(executePageTransfer(host, move, { collaboration: true })).resolves.toEqual(sagaReceipt);
  });

  it('still refuses a saved-transaction host during collaboration', async () => {
    const run = vi.fn();
    const host: PageTransferHost = { mode: 'saved-transaction', run };

    await expect(executePageTransfer(host, move, { collaboration: true })).rejects.toThrow(/durable live/i);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ['no steps', []],
    ['an empty lineage', [{ doc: 'target', lineage: '', sequence: '2' }]],
    ['an empty sequence', [{ doc: 'target', lineage: 'l', sequence: '' }]],
    ['an empty doc', [{ doc: '', lineage: 'l', sequence: '2' }]],
  ])('refuses a saga receipt with %s', async (_label, steps) => {
    const host: PageTransferHost = {
      mode: 'live-saga',
      run: vi.fn().mockResolvedValue({ ...sagaReceipt, durability: { kind: 'saga', steps } }),
    };

    await expect(executePageTransfer(host, move, { collaboration: true })).rejects.toThrow(/receipt/i);
  });
});
