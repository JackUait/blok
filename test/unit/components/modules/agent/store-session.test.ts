// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStoreAgentSession } from '../../../../../src/components/modules/agent/store-session';
import { AGENT_HISTORY_LIMITS } from '../../../../../src/shared/agent/document-session';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { createHeadlessAgentSetup } from '../../../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-node';

import type { AgentActor, AgentSession, DocumentView, ViewArgs } from '../../../../../types/agent';
import type { OutputBlockData } from '../../../../../types/data-formats/output-data';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const originalStamp = { createdAt: 1, createdBy: 'creator-1', lastEditedAt: 7, lastEditedBy: 'human-1' };
const history: Array<'history.undo' | 'history.redo'> = ['history.undo', 'history.redo'];
const stores: DocumentStore[] = [];
const sessions: AgentSession[] = [];

const initial = (): OutputBlockData[] => [
  { ...originalStamp, id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
  { ...originalStamp, id: 'q', type: 'paragraph', data: { text: [{ text: 'Q' }] } },
];

const open = (blocks: OutputBlockData[] = initial(), sessionActor: AgentActor = actor) => {
  const setup = createHeadlessAgentSetup({ runtime: 'node-live' });
  const serializer = new YBlockSerializer({
    htmlToSegments: htmlToSegmentsNode,
    richTextFieldsFor: setup.richTextFieldsFor,
  });
  const store = new DocumentStore(serializer);

  stores.push(store);
  store.fromJSON(blocks);
  const session = createStoreAgentSession({
    store, tools: setup.tools, contract: setup.contract, actor: sessionActor, ports: setup.ports,
    richTextFieldsFor: setup.richTextFieldsFor,
  });

  sessions.push(session);

  return { store, serializer, session };
};

const storedBlock = (store: DocumentStore, id: string): OutputBlockData => {
  const block = store.toJSON().find(item => item.id === id);

  if (block === undefined) {
    throw new Error(`Expected stored block "${id}".`);
  }

  return block;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  try {
    for (const session of sessions.splice(0)) {
      await Promise.resolve(session.close());
    }
  } finally {
    try {
      await stores.splice(0).reduce(
        (cleanup, store) => cleanup.then(() => store.destroy()),
        Promise.resolve()
      );
    } finally {
      vi.restoreAllMocks();
    }
  }
});

describe('createStoreAgentSession', () => {
  it('persists rich formatting with agent metadata without stamping an untouched block', async () => {
    const { store, serializer, session } = open();
    const untouched = storedBlock(store, 'q');
    const started = Date.now();
    const result = await session.execute({
      commands: [{ name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } }],
    });
    const finished = Date.now();
    const written = storedBlock(store, 'p');

    expect(serializer.toRichSegments(written.data.text)).toEqual([{ text: 'P', marks: { bold: true } }]);
    expect(written).toMatchObject({ lastEditedBy: actor.id, createdAt: 1, createdBy: 'creator-1' });
    if (typeof written.lastEditedAt !== 'number') {
      throw new Error('Expected the edit timestamp.');
    }
    expect(written.lastEditedAt).toBeGreaterThanOrEqual(started);
    expect(written.lastEditedAt).toBeLessThanOrEqual(finished);
    expect(storedBlock(store, 'q')).toEqual(untouched);
    expect(result).toMatchObject({ ok: true, changed: { updated: ['p'] } });
    expect(result.revision).toBe((await session.read()).revision);
  });

  it('credits the person the agent acts for, with the agent, on an insert and an update', async () => {
    const { store, session } = open(initial(), { ...actor, onBehalfOf: 'human-9' });
    const result = await session.execute({ commands: [
      { name: 'block.update', args: { id: 'p', data: { text: 'edited' } } },
      { name: 'block.insert', ref: 'n', args: { type: 'paragraph', data: { text: 'new' } } },
    ] });

    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(storedBlock(store, 'p')).toMatchObject({ createdBy: 'creator-1', lastEditedBy: 'human-9', lastEditedWith: actor.id });
    expect(storedBlock(store, 'p')).not.toHaveProperty('createdWith');
    expect(storedBlock(store, String(result.refs.n))).toMatchObject({
      createdBy: 'human-9', createdWith: actor.id, lastEditedBy: 'human-9', lastEditedWith: actor.id,
    });
  });

  describe('history.undo and history.redo', () => {
    const textOf = (store: DocumentStore, serializer: YBlockSerializer, id: string): unknown =>
      serializer.toRichSegments(storedBlock(store, id).data.text);

    // A second client in the same room: its writes reach the agent's store as remote updates.
    const joinPeer = (store: DocumentStore, serializer: YBlockSerializer) => {
      const peer = new DocumentStore(serializer);

      stores.push(peer);
      peer.applyRemoteUpdate(store.encodeStateAsUpdate(peer.getStateVector()), 'agent-room');

      return {
        peer,
        write: (fn: () => void): void => {
          peer.applyRemoteUpdate(store.encodeStateAsUpdate(peer.getStateVector()), 'agent-room');
          fn();
          store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()), peer);
        },
      };
    };

    it.each(history)('offers %s in the live contract', name => {
      const { session } = open();

      expect(session.describe({ command: name })).toMatchObject({ command: { name, available: true } });
    });

    it('takes back only the last batch, and redo writes it again', async () => {
      const { store, serializer, session } = open();

      expect(await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', with: 'First' } }] })).toMatchObject({ ok: true });
      const second = await session.execute({ commands: [
        { name: 'text.replace', args: { id: 'p', with: 'Second' } },
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'New' }, position: { after: 'q' } } },
        { name: 'doc.setTitle', args: { title: 'Agent title' } },
      ] });

      expect(second).toMatchObject({ ok: true });
      const afterSecond = store.toJSON();
      const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

      expect(undone).toMatchObject({ ok: true, results: [{}] });
      expect(textOf(store, serializer, 'p')).toEqual([{ text: 'First' }]);
      expect(store.orderedIds()).toEqual(['p', 'q']);
      expect(store.page.get('title')).toBeUndefined();
      expect(undone.revision).toBe((await session.read()).revision);

      expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: true });
      expect(store.toJSON()).toEqual(afterSecond);
      expect(store.page.get('title')).toBe('Agent title');
    });

    it('answers NOTHING_TO_UNDO and NOTHING_TO_REDO without writing', async () => {
      const { store, session } = open();
      const before = store.toJSON();

      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
      expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'NOTHING_TO_REDO' } });
      expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'q' } }] })).toMatchObject({ ok: true });
      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
      expect(store.toJSON()).toEqual(before);
    });

    it('keeps the newest steps up to the step limit, so undo stops at the oldest kept one', async () => {
      const { store, serializer, session } = open();
      const extra = 5;

      for (let index = 0; index < AGENT_HISTORY_LIMITS.steps + extra; index++) {
        await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', with: `T${index}` } }] });
      }
      for (let index = 0; index < AGENT_HISTORY_LIMITS.steps; index++) {
        expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
      }
      expect(textOf(store, serializer, 'p')).toEqual([{ text: `T${extra - 1}` }]);
      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    });

    it('drops the redo step once the agent writes again', async () => {
      const { session } = open();

      await session.execute({ commands: [{ name: 'block.delete', args: { id: 'q' } }] });
      await session.execute({ commands: [{ name: 'history.undo', args: {} }] });
      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', with: 'Other' } }] });

      expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'NOTHING_TO_REDO' } });
    });

    it('puts a moved block back where it was', async () => {
      const { store, session } = open();

      expect(await session.execute({ commands: [{ name: 'block.move', args: { id: 'q', position: { before: 'p' } } }] }))
        .toMatchObject({ ok: true });
      expect(store.orderedIds()).toEqual(['q', 'p']);
      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
      expect(store.orderedIds()).toEqual(['p', 'q']);
      expect(await session.execute({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: true });
      expect(store.orderedIds()).toEqual(['q', 'p']);
    });

    it("keeps a peer's edits to other blocks when it undoes", async () => {
      const { store, serializer, session } = open();
      const { peer, write } = joinPeer(store, serializer);

      await session.execute({ commands: [{ name: 'text.replace', args: { id: 'p', with: 'Agent' } }] });
      write(() => {
        peer.updateBlockData('q', 'text', [{ text: 'Peer' }]);
        peer.transact(() => {
          peer.addBlockAt({ id: 'r', type: 'paragraph', data: { text: [{ text: 'Peer block' }] } }, { parentId: null, afterId: 'q' });
        }, 'local');
      });

      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
      expect(textOf(store, serializer, 'p')).toEqual([{ text: 'P' }]);
      expect(textOf(store, serializer, 'q')).toEqual([{ text: 'Peer' }]);
      expect(store.orderedIds()).toEqual(['p', 'q', 'r']);
    });

    it('refuses with CONFLICT when a peer wrote inside a block the step would take away', async () => {
      const { store, serializer, session } = open();
      const { peer, write } = joinPeer(store, serializer);
      const inserted = await session.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Agent' }, position: 'end' } }] });

      if (!inserted.ok) {
        throw new Error(inserted.error.message);
      }
      const created = inserted.results[0];
      const id = typeof created === 'object' && created !== null && 'id' in created && typeof created.id === 'string' ? created.id : '';

      write(() => {
        peer.updateBlockData(id, 'text', [{ text: 'Peer typed here' }]);
      });
      const before = store.toJSON();
      const refused = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

      expect(refused).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(store.toJSON()).toEqual(before);
    });

    it('refuses with CONFLICT when a peer moved a block the step moved', async () => {
      const { store, serializer, session } = open([
        ...initial(),
        { ...originalStamp, id: 'r', type: 'paragraph', data: { text: [{ text: 'R' }] } },
      ]);
      const { peer, write } = joinPeer(store, serializer);

      await session.execute({ commands: [{ name: 'block.move', args: { id: 'r', position: { before: 'p' } } }] });
      write(() => {
        peer.moveBlockTo('r', { parentId: null, afterId: 'q' });
      });
      const before = store.toJSON();

      expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] }))
        .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(store.toJSON()).toEqual(before);
    });
  });

  it('rejects a revision made stale by a native store edit and accepts the current revision', async () => {
    const { store, session } = open();
    const old = (await session.read()).revision;

    store.updateBlockData('p', 'text', [{ text: 'Peer', marks: { italic: true } }]);
    const current = await session.read();
    const retained = store.toJSON();
    const stale = await session.execute({
      expectRevision: old, commands: [{ name: 'block.delete', args: { id: 'p' } }],
    });

    expect(stale).toMatchObject({
      ok: false, revision: current.revision,
      error: {
        code: 'STALE', retryable: true,
        details: { revision: current.revision, current: [{ id: 'p', type: 'paragraph', text: 'Peer' }] },
      },
    });
    expect(current.revision).not.toBe(old);
    expect(store.toJSON()).toEqual(retained);
    const accepted = await session.execute({
      expectRevision: current.revision, commands: [{ name: 'block.delete', args: { id: 'p' } }],
    });

    expect(store.orderedIds()).toEqual(['q']);
    expect(accepted).toMatchObject({ ok: true, changed: { removed: ['p'] } });
    expect(accepted.revision).not.toBe(current.revision);
    expect((await session.read()).revision).toBe(accepted.revision);
  });

  it('retains partial native writes after APPLY_FAILED and refuses later writes while reads work', async () => {
    const { store, serializer, session } = open();
    const remove = vi.spyOn(store, 'removeBlock').mockImplementation(() => {
      throw new Error('boom');
    });
    const failed = await session.execute({ commands: [
      { name: 'text.replace', args: { id: 'p', with: 'Partial' } },
      { name: 'doc.setTitle', args: { title: 'Partly applied' } },
      { name: 'block.delete', args: { id: 'p' } },
      { name: 'doc.setTitle', args: { title: 'Must not be written' } },
    ] });

    remove.mockRestore();

    expect(serializer.toRichSegments(storedBlock(store, 'p').data.text)).toEqual([{ text: 'Partial' }]);
    expect(store.page.get('title')).toBe('Partly applied');
    expect(store.orderedIds()).toEqual(['p', 'q']);
    expect(failed).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED', retryable: false } });
    if (failed.ok) {
      throw new Error('Expected a failed native apply.');
    }
    expect(failed.error.message).toContain('boom');
    const retained = store.toJSON();
    const blocked = await session.execute({ commands: [
      { name: 'block.delete', args: { id: 'p' } },
      { name: 'doc.setTitle', args: { title: 'Blocked' } },
    ] });

    expect(blocked).toMatchObject({ ok: false, error: { code: 'READ_ONLY', retryable: false } });
    expect(store.toJSON()).toEqual(retained);
    expect(store.page.get('title')).toBe('Partly applied');
    const view = await session.read({ ids: ['p'], detail: 'full' });

    expect(view).toMatchObject({
      revision: failed.revision, page: { title: 'Partly applied' },
      blocks: [{ id: 'p', data: { text: [{ text: 'Partial' }] } }],
    });
    expect(await session.execute({ commands: [{ name: 'doc.read', args: { ids: ['p'] } }] }))
      .toMatchObject({ ok: true, revision: view.revision, results: [{ blocks: [{ id: 'p', text: 'Partial' }] }] });
    expect(store.toJSON()).toEqual(retained);
  });

  it('validates typed convenience reads and reads current rich data and page fields without logging', async () => {
    const { store, session } = open();
    const before = await session.read();

    store.pageFromJSON({ title: 'Live', icon: { type: 'emoji', value: 'P' } });
    store.updateBlockData('p', 'text', '<i>Updated</i>');
    const retained = store.toJSON();
    const args: ViewArgs = { ids: ['p'], detail: 'full', textLimit: 3 };
    const view: DocumentView = await session.read(args);

    await expect(session.read({ limit: 0 })).rejects.toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(session.log()).toEqual([]);
    expect(view.blocks).toEqual([{
      id: 'p', type: 'paragraph', depth: 0, text: 'Upd…', truncated: true,
      data: { text: [{ text: 'Updated', marks: { italic: true } }] },
      meta: { lastEditedAt: '1970-01-01T00:00:00.007Z', lastEditedBy: { id: 'human-1' } },
    }]);
    expect(view.rootId).toBeNull();
    expect(view.page).toEqual({ title: 'Live', icon: { type: 'emoji', value: 'P' } });
    expect(view.revision).not.toBe(before.revision);
    expect(store.toJSON()).toEqual(retained);
    expect(store.page.get('title')).toBe('Live');
  });

  it('retains separate command-log snapshots with batch order, results, errors and actor attribution', async () => {
    const { session } = open();

    await session.read();
    expect(await session.execute({ commands: [
      { name: 'doc.read', args: { ids: ['p'] } },
      { name: 'doc.read', args: { ids: ['q'] } },
    ] })).toMatchObject({ ok: true });
    const firstLog = session.log();

    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'missing' } }] }))
      .toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND' } });
    expect(firstLog).toHaveLength(2);
    expect(session.log()).toHaveLength(3);
    expect(session.log()).toMatchObject([
      {
        batch: 1, index: 0, name: 'doc.read', args: { ids: ['p'] }, actorId: actor.id,
        result: { blocks: [{ id: 'p', text: 'P' }] },
      },
      {
        batch: 1, index: 1, name: 'doc.read', args: { ids: ['q'] }, actorId: actor.id,
        result: { blocks: [{ id: 'q', text: 'Q' }] },
      },
      {
        batch: 2, index: 0, name: 'block.delete', args: { id: 'missing' }, actorId: actor.id,
        error: { code: 'BLOCK_NOT_FOUND' },
      },
    ]);
  });

  it('closes idempotently, detaches its revision observer and leaves the caller-owned store subscribed', async () => {
    const { store, serializer, session } = open();
    const revision = (await session.read()).revision;
    const origins: unknown[] = [];
    const unsubscribe = store.onAnyUpdate((_update, origin) => origins.push(origin));

    try {
      await Promise.resolve(session.close());
      await Promise.resolve(session.close());
      store.updateBlockData('p', 'text', [{ text: 'Owner still writes' }]);
      const view = await session.read({ ids: ['p'] });

      expect(origins).toEqual(['local']);
      expect(view.revision).toBe(revision);
      expect(view.blocks).toMatchObject([{ id: 'p', text: 'Owner still writes' }]);
      expect(serializer.toRichSegments(storedBlock(store, 'p').data.text)).toEqual([{ text: 'Owner still writes' }]);
    } finally {
      await Promise.resolve(unsubscribe());
    }
  });

  it('creates a native table with complete cell ids that stay stable through another normalization', async () => {
    const { store, session } = open();
    const untouched = store.toJSON();

    // A table owns its cells, so a bare block.insert is refused (01 Task 8 Step 7).
    expect(await session.execute({ commands: [{ name: 'block.insert', args: { type: 'table' } }] })).toMatchObject({
      ok: false, error: { code: 'INVALID_ARGS', details: { use: 'table.create' } },
    });

    const inserted = await session.execute({ commands: [{ name: 'table.create', args: { rows: 2, cols: 2 } }] });

    if (!inserted.ok) {
      throw new Error(`Expected table.create to succeed: ${inserted.error.message}`);
    }
    const created = inserted.results[0];

    if (typeof created !== 'object' || created === null || !('id' in created) || typeof created.id !== 'string' ||
      !('childIds' in created) || !Array.isArray(created.childIds)) {
      throw new Error('Expected a table id and its cell block ids.');
    }
    const tableId = created.id;
    const childIds: unknown[] = created.childIds;
    const written = storedBlock(store, tableId);
    const content = written.data.content;

    if (!Array.isArray(content)) {
      throw new Error('Expected native table rows.');
    }
    const rows: unknown[] = content;
    const cells = rows.flatMap((row): unknown[] => Array.isArray(row) ? row : []);

    if (!cells.every((cell): cell is { id: string; rowId: string } =>
      typeof cell === 'object' && cell !== null &&
      'id' in cell && typeof cell.id === 'string' && cell.id.length > 0 &&
      'rowId' in cell && typeof cell.rowId === 'string' && cell.rowId.length > 0
    )) {
      throw new Error('Expected complete cell ids.');
    }
    const [topLeft, topRight, bottomLeft] = cells;

    if (topLeft === undefined || topRight === undefined || bottomLeft === undefined || cells.length !== 4) {
      throw new Error('Expected four native table cells.');
    }

    expect(content).toEqual([
      [{ blocks: [childIds[0]], id: topLeft.id, rowId: topLeft.rowId }, { blocks: [childIds[1]], id: topRight.id, rowId: topLeft.rowId }],
      [{ blocks: [childIds[2]], id: topLeft.id, rowId: bottomLeft.rowId }, { blocks: [childIds[3]], id: topRight.id, rowId: bottomLeft.rowId }],
    ]);
    expect(topLeft.id).not.toBe(topRight.id);
    expect(topLeft.rowId).not.toBe(bottomLeft.rowId);
    expect(written).toMatchObject({
      id: tableId, type: 'table', lastEditedBy: actor.id, content: childIds,
      data: { withHeadings: false, withHeadingColumn: false },
    });
    expect(written).not.toHaveProperty('parent');
    childIds.forEach(childId => {
      expect(storedBlock(store, String(childId))).toMatchObject({ type: 'paragraph', parent: tableId, lastEditedBy: actor.id });
    });
    expect(inserted).toMatchObject({ changed: { created: [tableId, ...childIds] } });

    const updated = await session.execute({
      commands: [{ name: 'block.update', args: { id: tableId, data: { withHeadings: true, colWidths: [160, 180] } } }],
    });
    const renormalized = storedBlock(store, tableId);

    expect(renormalized.data.content).toEqual(content);
    expect(renormalized.data).toMatchObject({ withHeadings: true, withHeadingColumn: false, colWidths: [160, 180] });
    expect(renormalized.content).toEqual(childIds);
    expect(store.orderedIds()).toEqual(['p', 'q', tableId, ...childIds]);
    expect(store.toJSON().slice(0, 2)).toEqual(untouched);
    expect(renormalized).not.toHaveProperty('parent');
    expect(updated).toMatchObject({ ok: true, changed: { updated: [tableId] } });
  });
});
