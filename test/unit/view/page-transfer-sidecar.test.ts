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

  it('retries the removal when a peer edits elsewhere in the source', async () => {
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

  it('gives up with the source intact and the copy kept when the source keeps changing', async () => {
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
    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(messageOf(error)).toMatch(/refused the removal \(HTTP 412\).*source was kept/i);
  });

  it('keeps the source when a peer has added to the copy before the removal', async () => {
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

  it('keeps the source when a peer has edited the copy before the removal', async () => {
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
    expect(messageOf(error)).toMatch(/incomplete or changed.*copy stays/i);
  });

  it('resolves an unknown source outcome (commit then 504) on retry without a second removal', async () => {
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

  it('keeps the source and the copy when the source refuses for good', async () => {
    const { server, host } = setup();

    server.onEdit((edit) => edit.doc === 'source' ? { refuse: 403 } : undefined);
    const error = await failure(host.run(move));

    expect(server.ids('source')).toEqual(['a', 'a1', 'b']);
    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(messageOf(error)).toMatch(/403/);
  });

  it('keeps the partial copy and the source when a later copy chunk is refused', async () => {
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
    expect(server.ids('target')).toEqual(['t', 'a']);
    expect(server.edits.filter((edit) => edit.doc === 'source')).toHaveLength(0);
    expect(messageOf(error)).toMatch(/part 2 of 3.*partial copy/i);
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

  it('keeps the source when a peer edits a moved block after the copy', async () => {
    const { server, host } = setup();

    server.onEdit((edit) => {
      if (edit.doc === 'target') {
        server.peerEdit('source', 'a1', 'Peer typed in the source');
      }
    });
    const error = await failure(host.run(move));

    expect(server.document('source').blocks.find((block) => block.id === 'a1')?.data.text).toBe('Peer typed in the source');
    expect(server.ids('target')).toEqual(['t', 'a', 'a1']);
    expect(messageOf(error)).toMatch(/changed the blocks being moved.*source was kept/i);
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

  it('keeps the source when a peer edits the copy between chunks', async () => {
    const { server, host } = setup({ maxEditBytes: 400 });
    let targetEdits = 0;
    let sourceEdited = false;

    server.seed('source', [
      { id: 'a', type: 'toggle', data: { text: 'A'.repeat(150) }, content: ['a1', 'a2'] },
      { id: 'a1', type: 'paragraph', parent: 'a', data: { text: '1'.repeat(150) } },
      { id: 'a2', type: 'paragraph', parent: 'a', data: { text: '2'.repeat(150) } },
      { id: 'b', type: 'paragraph', data: { text: 'B' } },
    ]);
    server.onEdit((edit) => {
      if (edit.doc === 'target') {
        targetEdits += 1;
        if (targetEdits === 2) {
          server.peerEdit('target', 'a', 'Peer typed in the copy');
        }
      }
      if (edit.doc === 'source' && !sourceEdited) {
        sourceEdited = true;
        server.peerEdit('source', 'b', 'Peer');
      }
    });
    const error = await failure(host.run(move));

    expect(server.document('target').blocks.find((block) => block.id === 'a')?.data.text).toBe('Peer typed in the copy');
    expect(server.ids('source')).toContain('a');
    expect(messageOf(error)).toMatch(/incomplete or changed.*copy stays/i);
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

  it('keeps a peer block written into the new page before the copy', async () => {
    const { server, host } = setup();
    let once = false;

    server.onEdit((edit) => {
      if (edit.doc === 'new-page' && !once) {
        once = true;
        server.peerInsertRoot('new-page', { id: 'peer', type: 'paragraph', data: { text: 'Peer' } });
      }
    });
    await host.run({
      kind: 'turn-into-page',
      operationId: 'tip-2',
      sourcePageId: 'source',
      targetPageId: 'new-page',
      rootIds: ['a'],
      pointerId: 'ptr',
    });

    expect(server.ids('new-page').sort()).toEqual(['a', 'a1', 'peer']);
    expect(server.ids('source')).toEqual(['ptr', 'b']);
  });

  it('turns a page back into blocks in the parent and leaves the body for the host', async () => {
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
    expect(server.ids('child')).toEqual(['c1', 'c2']);
    expect(receipt.rootIds).toEqual(['c1', 'c2']);
  });

  describe('turn-into-blocks keeps the pointer while the page body differs from the plan', () => {
    const tib: PageTransferRequest = {
      kind: 'turn-into-blocks',
      operationId: 'tib',
      sourcePageId: 'child',
      targetPageId: 'parent',
      pointerId: 'ptr',
    };
    const text = (server: FakeSidecar, doc: string, id: string): unknown =>
      server.document(doc).blocks.find((block) => block.id === id)?.data.text;

    it('(a) a peer edit in the body during the copy', async () => {
      const { server, host } = setup();
      let once = false;

      server.seed('parent', [{ id: 'ptr', type: 'page', data: { pageId: 'child' } }]);
      server.seed('child', [{ id: 'c1', type: 'paragraph', data: { text: 'C1' } }]);
      server.onEdit((edit) => {
        if (edit.doc === 'parent' && !once) {
          once = true;
          server.peerEdit('child', 'c1', 'Peer typed in the body');
        }
      });
      const error = await failure(host.run(tib));

      expect(server.ids('parent')).toContain('ptr');
      expect(text(server, 'child', 'c1')).toBe('Peer typed in the body');
      expect(messageOf(error)).toMatch(/page body "child" changed/i);
    });

    it('(b) a peer block written into an empty body after planning', async () => {
      const { server, log } = setup();
      let parentReads = 0;
      const host = createSidecarTransferHost({
        baseUrl: 'https://sidecar.test/api/blok',
        ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
        log,
        fetch: async (url, init) => {
          // The second parent read is the check before the removal; planning read it first.
          if (url.endsWith('/parent/state') && ++parentReads === 2) {
            server.peerInsertRoot('child', { id: 'peer', type: 'paragraph', data: { text: 'Peer' } });
          }

          return server.fetch(url, init);
        },
      });

      server.seed('parent', [{ id: 'ptr', type: 'page', data: { pageId: 'child' } }]);
      server.seed('child', []);
      const error = await failure(host.run(tib));

      expect(parentReads).toBe(2);

      expect(server.ids('parent')).toEqual(['ptr']);
      expect(server.ids('child')).toEqual(['peer']);
      expect(messageOf(error)).toMatch(/page body "child" changed/i);
    });

    it('(c) a resumed run after the body changed between attempts', async () => {
      const { server, log } = setup();
      const host = (): ReturnType<typeof createSidecarTransferHost> => createSidecarTransferHost({
        baseUrl: 'https://sidecar.test/api/blok',
        ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
        log,
        fetch: server.fetch,
      });
      let dropped = false;

      server.seed('parent', [{ id: 'ptr', type: 'page', data: { pageId: 'child' } }]);
      server.seed('child', [{ id: 'c1', type: 'paragraph', data: { text: 'C1' } }]);
      server.onEdit((edit) => {
        if (edit.doc === 'parent' && JSON.stringify(edit.ops) === '[{"op":"remove","id":"ptr"}]' && !dropped) {
          dropped = true;

          return 'drop';
        }
      });
      await failure(host().run(tib));
      server.peerInsertRoot('child', { id: 'late', type: 'paragraph', data: { text: 'Written after the crash' } });
      server.peerEdit('child', 'c1', 'Edited after the crash');
      const error = await failure(host().run(tib));

      expect(server.ids('parent')).toContain('ptr');
      expect(server.ids('child').sort()).toEqual(['c1', 'late']);
      expect(text(server, 'child', 'c1')).toBe('Edited after the crash');
      expect(messageOf(error)).toMatch(/page body "child" changed/i);
    });
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

describe('overlapping runs with one operation ID', () => {
  it('a retry that overlaps a run mid-removal replays its removal instead of repeating it', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    const ticketFor = (doc: string, access: { write: boolean }): string => `ticket:${doc}:${access.write ? 'write' : 'read'}`;
    const request: PageTransferRequest = { ...move, operationId: 'overlap-1' };
    const latch = (): { promise: Promise<void>; open: () => void } => {
      const opened: Array<() => void> = [];
      const promise = new Promise<void>((resolve) => {
        opened.push(resolve);
      });

      return { promise, open: () => opened.forEach((resolve) => resolve()) };
    };
    const aParked = latch();
    const runs: Array<Promise<unknown>> = [];
    let aPosts = 0;
    let bPosts = 0;

    server.seed('source', [
      { id: 'a', type: 'paragraph', data: { text: 'A' } },
      { id: 'b', type: 'paragraph', data: { text: 'B' } },
    ]);
    server.seed('target', [{ id: 't', type: 'paragraph', data: { text: 'T' } }]);

    const hostB = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor,
      log,
      fetch: async (url, init) => {
        if (init.method === 'POST') {
          bPosts += 1;
          if (bPosts === 1) {
            await aParked.promise;
          }
        }

        return server.fetch(url, init);
      },
    });
    const hostA = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor,
      log,
      fetch: async (url, init) => {
        if (init.method === 'POST') {
          aPosts += 1;
          if (aPosts === 2) {
            runs.push(hostB.run(request).catch((error: unknown) => error));
            server.peerEdit('source', 'b', 'Peer B');
          }
          if (aPosts === 3) {
            server.peerEdit('target', 't', 'Peer T');
          }
        }

        return server.fetch(url, init);
      },
    });

    // A: copy, removal (412: a peer edited b), removal again. B waits for A,
    // then replays the copy and finds the removal already committed.
    const resultA = await hostA.run(request).catch((error: unknown) => error).finally(() => aParked.open());
    const [resultB] = await Promise.all(runs);
    const text = (doc: string, id: string): unknown => server.document(doc).blocks.find((block) => block.id === id)?.data.text;

    expect(text('target', 'a')).toBe('A');
    expect(text('source', 'b')).toBe('Peer B');
    expect(text('target', 't')).toBe('Peer T');
    expect(server.ids('source')).toEqual(['b']);
    expect([aPosts, bPosts]).toEqual([3, 2]);
    expect(resultA).toMatchObject({ durability: { kind: 'saga' } });
    expect(resultB).toMatchObject({ durability: { kind: 'saga' } });
  });
});

describe('review repros: every block survives every interleaving', () => {
  const latch = (): { promise: Promise<void>; open: () => void } => {
    const opened: Array<() => void> = [];
    const promise = new Promise<void>((resolve) => {
      opened.push(resolve);
    });

    return { promise, open: () => opened.forEach((resolve) => resolve()) };
  };
  const ticketFor = (doc: string, access: { write: boolean }): string => `ticket:${doc}:${access.write ? 'write' : 'read'}`;
  const gated = (
    server: FakeSidecar,
    log: SidecarTransferLog,
    gate: (url: string, init: { method: string }) => Promise<void> | void = () => undefined,
    maxEditBytes?: number
  ) => createSidecarTransferHost({
    baseUrl: 'https://sidecar.test/api/blok',
    ticketFor,
    log,
    maxEditBytes,
    fetch: async (url, init) => {
      await gate(url, init);

      return server.fetch(url, init);
    },
  });
  const request: PageTransferRequest = { ...move, operationId: 'op-1' };
  const seedSmall = (server: FakeSidecar): void => {
    server.seed('source', [
      { id: 'a', type: 'paragraph', data: { text: 'A' } },
      { id: 'b', type: 'paragraph', data: { text: 'B' } },
    ]);
    server.seed('target', [{ id: 't', type: 'paragraph', data: { text: 'T' } }]);
  };
  const seedBig = (server: FakeSidecar): void => {
    server.seed('source', [
      { id: 'a', type: 'toggle', data: { text: 'A'.repeat(150) }, content: ['a1', 'a2'] },
      { id: 'a1', type: 'paragraph', parent: 'a', data: { text: '1'.repeat(150) } },
      { id: 'a2', type: 'paragraph', parent: 'a', data: { text: '2'.repeat(150) } },
      { id: 'b', type: 'paragraph', data: { text: 'B' } },
    ]);
    server.seed('target', [{ id: 't', type: 'paragraph', data: { text: 'T' } }]);
  };
  /** Each [id, text] pair that no page holds any more, by ID and exact text. */
  const lost = (server: FakeSidecar, wanted: Array<[string, string]>): string[] => wanted
    .filter(([id, text]) => !['source', 'target'].some((doc) =>
      server.document(doc).blocks.some((block) => block.id === id && block.data.text === text)))
    .map(([id, text]) => `${id}=${text}`);
  const removeIfPresent = (server: FakeSidecar, doc: string, id: string): void => {
    if (server.ids(doc).includes(id)) {
      server.peerRemove(doc, id);
    }
  };

  it('F1: two runs that both plan before either logs, around a peer edit to the moved block', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    const aParked = latch();
    const releaseA = latch();
    const bAtRemoval = latch();
    const releaseB = latch();
    let aPosts = 0;
    let bPosts = 0;
    let aTargetReads = 0;

    seedSmall(server);
    const hostA = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor,
      log,
      fetch: async (url, init) => {
        const response = await server.fetch(url, init);

        // Parks after the planning read returns, before A logs its plan.
        if (init.method === 'GET' && url.endsWith('/target/state') && ++aTargetReads === 1) {
          aParked.open();
          await releaseA.promise;
        }
        if (init.method === 'POST') {
          aPosts += 1;
        }

        return response;
      },
    });
    const hostB = gated(server, log, async (_url, init) => {
      if (init.method === 'POST' && ++bPosts === 2) {
        bAtRemoval.open();
        await releaseB.promise;
      }
    });
    // A has read the source with a = 'A' and parks while planning.
    const runA = failure(hostA.run(request)).finally(() => aParked.open());

    await aParked.promise;
    server.peerEdit('source', 'a', 'A|P1');
    // B plans from a = 'A|P1', copies first, and parks before its removal.
    const runB = hostB.run(request).finally(() => bAtRemoval.open());

    await bAtRemoval.promise;
    releaseA.open();
    const errorA = await runA;

    releaseB.open();
    const receiptB = await runB;

    expect(lost(server, [['a', 'A|P1'], ['b', 'B']])).toEqual([]);
    expect(server.ids('source')).toEqual(['b']);
    expect([aPosts, bPosts]).toEqual([1, 2]);
    expect(messageOf(errorA)).toMatch(/different plan/);
    expect(receiptB.durability.kind).toBe('saga');
  });

  it('F2: a retry that shares the logged plan while a peer edits the moved block mid-removal', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    const aDone = latch();
    const runs: Array<Promise<unknown>> = [];
    let aPosts = 0;
    let bPosts = 0;

    seedSmall(server);
    const hostB = gated(server, log, async (_url, init) => {
      if (init.method === 'POST' && ++bPosts === 1) {
        await aDone.promise;
      }
    });
    const hostA = gated(server, log, (_url, init) => {
      if (init.method === 'POST' && ++aPosts === 2) {
        server.peerEdit('source', 'a', 'A|P1');
        runs.push(failure(hostB.run(request)));
      }
    });
    // A: copy, removal (412), then a replay of the removal with the planned head (refused).
    const errorA = await failure(hostA.run(request)).finally(() => aDone.open());
    // B: replays the copy, sees the moved block changed, replays the removal (refused).
    const [errorB] = await Promise.all(runs);

    expect(lost(server, [['a', 'A|P1'], ['b', 'B']])).toEqual([]);
    expect(server.ids('source')).toEqual(['a', 'b']);
    expect([aPosts, bPosts]).toEqual([3, 2]);
    expect(messageOf(errorA)).toMatch(/changed the blocks being moved/);
    expect(messageOf(errorB)).toMatch(/changed the blocks being moved/);
  });

  it('F3: the source removal is refused once (403), then the run is retried', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    let refuse = true;

    seedSmall(server);
    server.onEdit((edit) => {
      if (edit.doc === 'source' && refuse) {
        refuse = false;

        return { refuse: 403 };
      }
    });
    const host = gated(server, log);
    const first = await failure(host.run(request));

    expect(lost(server, [['a', 'A'], ['b', 'B']])).toEqual([]);
    expect(server.ids('target')).toEqual(['t', 'a']);
    expect(messageOf(first)).toMatch(/403/);

    await host.run(request);

    expect(server.ids('target')).toEqual(['t', 'a']);
    expect(server.ids('source')).toEqual(['b']);
  });

  it('F4a: a retry after the user removed the source duplicate keeps the target copy', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    let first = true;

    seedSmall(server);
    let refuseRemoval = true;

    server.onEdit((edit) => {
      if (edit.doc === 'source' && first) {
        first = false;
        server.peerEdit('source', 'b', 'Peer');
      }
      if (edit.doc === 'target' && refuseRemoval && JSON.stringify(edit.ops) === '[{"op":"remove","id":"a"}]') {
        refuseRemoval = false;

        return { refuse: 403 };
      }
    });
    const host = gated(server, log);

    await failure(host.run(request));
    removeIfPresent(server, 'source', 'a');
    await failure(host.run(request));

    expect(lost(server, [['a', 'A'], ['b', 'Peer']])).toEqual([]);
    expect(server.ids('target')).toContain('a');
  });

  it('F4b: a retry after the user removed the target copy keeps the source', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    let refuse = true;

    seedSmall(server);
    server.onEdit((edit) => {
      if (edit.doc === 'source' && refuse) {
        refuse = false;

        return { refuse: 403 };
      }
    });
    const host = gated(server, log);

    await failure(host.run(request));
    removeIfPresent(server, 'target', 'a');
    const retry = await failure(host.run(request));

    expect(lost(server, [['a', 'A'], ['b', 'B']])).toEqual([]);
    expect(server.ids('source')).toContain('a');
    expect(messageOf(retry)).toMatch(/incomplete or changed/i);
  });

  it('F5a: a peer edit in the target between copy chunks neither strands nor blocks the transfer', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();
    let targetEdits = 0;

    seedBig(server);
    server.onEdit((edit) => {
      if (edit.doc === 'target' && ++targetEdits === 2) {
        server.peerEdit('target', 't', 'Peer T');
      }
    });
    const host = gated(server, log, undefined, 400);

    await failure(host.run(request));
    await failure(host.run(request));

    expect(lost(server, [['a', 'A'.repeat(150)], ['a1', '1'.repeat(150)], ['a2', '2'.repeat(150)], ['b', 'B']])).toEqual([]);
    expect(server.ids('target')).toEqual(['t', 'a', 'a1', 'a2']);
    expect(server.ids('source')).toEqual(['b']);
  });

  it.each([412, 413])('F5: a copy chunk refused with %i resumes on retry with the same operation ID', async (status) => {
    const server = new FakeSidecar();
    const log = memoryLog();
    let targetEdits = 0;

    seedBig(server);
    server.onEdit((edit) => {
      if (edit.doc === 'target' && ++targetEdits === 2) {
        return { refuse: status };
      }
    });
    const host = gated(server, log, undefined, 400);
    const first = await failure(host.run(request));

    expect(lost(server, [['a', 'A'.repeat(150)], ['a1', '1'.repeat(150)], ['a2', '2'.repeat(150)], ['b', 'B']])).toEqual([]);
    expect(server.ids('source')).toEqual(['a', 'a1', 'a2', 'b']);
    expect(messageOf(first)).toMatch(/partial copy/i);

    await host.run(request);

    expect(server.ids('target')).toEqual(['t', 'a', 'a1', 'a2']);
    expect(server.ids('source')).toEqual(['b']);
  });

  it('F6: an overlapping Undo retry while a peer edits the moved block mid-removal', async () => {
    const server = new FakeSidecar();
    const log = memoryLog();

    seedSmall(server);
    const receipt = await gated(server, log).run(request);
    const undo = { operationId: 'undo-1', undoOf: receipt };
    const aDone = latch();
    const runs: Array<Promise<unknown>> = [];
    let aPosts = 0;
    let bPosts = 0;
    const hostB = gated(server, log, async (_url, init) => {
      if (init.method === 'POST' && ++bPosts === 1) {
        await aDone.promise;
      }
    });
    const hostA = gated(server, log, (_url, init) => {
      if (init.method === 'POST' && ++aPosts === 2) {
        server.peerEdit('target', 'a', 'A|P1');
        runs.push(failure(hostB.undo(undo)));
      }
    });
    // Undo A: copy back into the source, removal from the target (412), refused replay.
    const errorA = await failure(hostA.undo(undo)).finally(() => aDone.open());
    const [errorB] = await Promise.all(runs);

    expect(lost(server, [['a', 'A|P1'], ['b', 'B'], ['t', 'T']])).toEqual([]);
    expect(server.ids('target')).toEqual(['t', 'a']);
    expect([aPosts, bPosts]).toEqual([3, 2]);
    expect(messageOf(errorA)).toMatch(/changed the blocks being moved/);
    expect(messageOf(errorB)).toMatch(/changed the blocks being moved/);
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
