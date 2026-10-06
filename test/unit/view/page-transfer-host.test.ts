import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executePageTransfer, undoPageTransfer } from '../../../src/view';
import type { OutputData } from '../../../types';
import type {
  PageTransferHost,
  PageTransferReceipt,
  PageTransferRequest,
  PageTransferUndoHost,
} from '../../../src/view/page-transfer-host';
import { MemoryTransferHost } from './page-transfer-host-fixture';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const moveRequest: PageTransferRequest = {
  kind: 'move-blocks',
  operationId: 'move-1',
  sourcePageId: 'source',
  targetPageId: 'target',
  rootIds: ['text'],
  place: { parentId: null, afterId: null },
};

const receipt: PageTransferReceipt = {
  operationId: 'move-1',
  kind: 'move-blocks',
  sourcePageId: 'source',
  targetPageId: 'target',
  rootIds: ['text'],
  undoToken: 'undo-move-1',
  durability: { kind: 'transaction', transactionId: 'tx-1' },
};

const duplicateRequest: PageTransferRequest = {
  kind: 'duplicate-page',
  operationId: 'duplicate-three-levels',
  sourcePageId: 'source',
  targetPageId: 'target',
  pointerId: 'owner',
  place: { parentId: null, afterId: null },
};

const seedThreeLevelTree = (): MemoryTransferHost => {
  const host = new MemoryTransferHost();

  host.replaceSource({ blocks: [
    { id: 'owner', type: 'page', data: { pageId: 'root' } },
  ] });
  host.setDocument('root', { blocks: [
    { id: 'root-text', type: 'paragraph', data: { text: '<a data-blok-page-id="child">Page</a>' } },
    { id: 'child-owner', type: 'page', data: { pageId: 'child' } },
  ] });
  host.setDocument('child', { blocks: [
    { id: 'grandchild-owner', type: 'page', data: { pageId: 'grandchild' } },
  ] });
  host.setDocument('grandchild', { blocks: [
    { id: 'deep-text', type: 'paragraph', data: { text: 'Deep body' } },
  ] });
  host.addOwningEdge('source', 'root');
  host.addOwningEdge('root', 'child');
  host.addOwningEdge('child', 'grandchild');

  return host;
};

const ownedPageId = (document: OutputData): string => {
  const pointers = document.blocks.filter((block) => block.type === 'page');
  const pageId = pointers[0]?.data.pageId;

  if (pointers.length !== 1 || typeof pageId !== 'string') {
    throw new Error('Expected one owning page pointer');
  }

  return pageId;
};

describe('executePageTransfer', () => {
  it('refuses a saved-document adapter during collaboration before calling it', async () => {
    const run = vi.fn();
    const host: PageTransferHost = { mode: 'saved-transaction', run };

    await expect(executePageTransfer(host, moveRequest, { collaboration: true }))
      .rejects.toThrow(/durable live document/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a bare HTTP 204 rather than treating it as a transaction receipt', async () => {
    const run = vi.fn().mockResolvedValue({ status: 204 });
    const host: PageTransferHost = { mode: 'live-transaction', run };

    await expect(executePageTransfer(host, moveRequest, { collaboration: true }))
      .rejects.toThrow(/receipt/i);
  });

  it('returns a matching durable receipt', async () => {
    const run = vi.fn().mockResolvedValue(receipt);
    const host: PageTransferHost = { mode: 'saved-transaction', run };

    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .resolves.toEqual(receipt);
    expect(run).toHaveBeenCalledWith(moveRequest);
  });

  it.each([
    ['operation ID', { ...receipt, operationId: 'other' }],
    ['kind', { ...receipt, kind: 'duplicate-page' }],
    ['source', { ...receipt, sourcePageId: 'other' }],
    ['target', { ...receipt, targetPageId: 'other' }],
    ['roots', { ...receipt, rootIds: ['other'] }],
    ['undo token', { ...receipt, undoToken: '' }],
    ['transaction ID', { ...receipt, durability: { kind: 'transaction', transactionId: '' } }],
  ])('refuses a receipt with a mismatched %s', async (_label, invalid) => {
    const host: PageTransferHost = {
      mode: 'live-transaction',
      run: vi.fn().mockResolvedValue(invalid),
    };

    await expect(executePageTransfer(host, moveRequest, { collaboration: true }))
      .rejects.toThrow(/receipt/i);
  });

  it('refuses a sparse root list in a host receipt', async () => {
    const host: PageTransferHost = {
      mode: 'saved-transaction',
      run: vi.fn().mockResolvedValue({ ...receipt, rootIds: new Array<string>(1) }),
    };

    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .rejects.toThrow(/receipt/i);
  });

  it('checks the original request if the host mutates its input', async () => {
    const request: PageTransferRequest = structuredClone(moveRequest);
    const host: PageTransferHost = {
      mode: 'saved-transaction',
      run: async (input) => {
        Object.assign(input, { targetPageId: 'other' });

        return receipt;
      },
    };

    await expect(executePageTransfer(host, request, { collaboration: false }))
      .resolves.toEqual(receipt);
    expect(request.targetPageId).toBe('target');
  });

  it('rejects an empty operation ID without calling the host', async () => {
    const run = vi.fn();
    const host: PageTransferHost = { mode: 'live-transaction', run };

    await expect(executePageTransfer(host, { ...moveRequest, operationId: '' }, { collaboration: true }))
      .rejects.toThrow(/operation/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the source after a pre-commit failure', async () => {
    const host = new MemoryTransferHost();

    host.failOnce = 'beforeCommit';
    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .rejects.toThrow(/before-commit/i);
    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('target').blocks).toEqual([]);
  });

  it('returns the same receipt after a lost response without duplicating the block', async () => {
    const host = new MemoryTransferHost();

    host.failOnce = 'afterCommitBeforeResponse';
    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .rejects.toThrow(/response loss/i);
    const committed = await executePageTransfer(host, moveRequest, { collaboration: false });

    expect(host.document('target').blocks.filter((block) => block.id === 'text')).toHaveLength(1);
    expect(host.document('source').blocks.some((block) => block.id === 'text')).toBe(false);
    expect(committed.operationId).toBe('move-1');
  });

  it('moves the latest authoritative source edit', async () => {
    const host = new MemoryTransferHost();

    host.editSource('text', 'Newest');
    await executePageTransfer(host, moveRequest, { collaboration: false });

    expect(host.document('target').blocks[0]?.data.text).toBe('Newest');
  });

  it.each(['source', 'target'])('keeps the source when %s access is denied', async (pageId) => {
    const host = new MemoryTransferHost();

    host.deny(pageId);
    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .rejects.toThrow(/denied/i);
    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('target').blocks).toEqual([]);
  });

  it('rejects a destination below the moved owning pointer', async () => {
    const host = new MemoryTransferHost();
    const request: PageTransferRequest = {
      ...moveRequest,
      rootIds: ['pointer'],
    };

    host.replaceSource({ blocks: [
      { id: 'pointer', type: 'page', data: { pageId: 'child' } },
    ] });
    host.addOwningEdge('child', 'target');

    await expect(executePageTransfer(host, request, { collaboration: false }))
      .rejects.toThrow(/cycle/i);
    expect(host.document('source').blocks[0]?.id).toBe('pointer');
    expect(host.document('target').blocks).toEqual([]);
  });

  it('rejects a cycle through a page pointer nested in a moved container', async () => {
    const host = new MemoryTransferHost();
    const request: PageTransferRequest = { ...moveRequest, rootIds: ['container'] };

    host.replaceSource({ blocks: [
      { id: 'container', type: 'toggle', data: {}, content: ['pointer'] },
      { id: 'pointer', type: 'page', parent: 'container', data: { pageId: 'child' } },
    ] });
    host.addOwningEdge('child', 'target');

    const error = await executePageTransfer(host, request, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['container', 'pointer']);
    expect(host.document('target').blocks).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/cycle/i) });
  });

  it('uses committed ownership when checking a later reparent for cycles', async () => {
    const host = new MemoryTransferHost();

    host.replaceSource({ blocks: [
      { id: 'to-child', type: 'page', data: { pageId: 'child' } },
      { id: 'to-target', type: 'page', data: { pageId: 'target' } },
    ] });
    const first: PageTransferRequest = {
      ...moveRequest,
      kind: 'reparent-page',
      operationId: 'move-child',
      rootIds: ['to-child'],
    };

    await executePageTransfer(host, first, { collaboration: false });
    const second: PageTransferRequest = {
      ...first,
      operationId: 'move-target',
      targetPageId: 'child',
      rootIds: ['to-target'],
    };

    await expect(executePageTransfer(host, second, { collaboration: false }))
      .rejects.toThrow(/cycle/i);
    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['to-target']);
    expect(host.document('child').blocks).toEqual([]);
  });

  it('rejects a second owning pointer to the same page', async () => {
    const host = new MemoryTransferHost();
    const request: PageTransferRequest = { ...moveRequest, rootIds: ['pointer'] };

    host.replaceSource({ blocks: [
      { id: 'pointer', type: 'page', data: { pageId: 'child' } },
    ] });
    host.replaceTarget({ blocks: [
      { id: 'existing', type: 'page', data: { pageId: 'child' } },
    ] });

    const error = await executePageTransfer(host, request, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['pointer']);
    expect(host.document('target').blocks.map((block) => block.id)).toEqual(['existing']);
    expect(error).toMatchObject({ message: expect.stringMatching(/owner/i) });
  });

  it('does not count empty page IDs as duplicate owners', async () => {
    const host = new MemoryTransferHost();

    host.replaceSource({ blocks: [
      { id: 'text', type: 'paragraph', data: { text: 'Original' } },
      { id: 'unresolved-source', type: 'page', data: { pageId: '' } },
    ] });
    host.replaceTarget({ blocks: [
      { id: 'unresolved-target', type: 'page', data: { pageId: '' } },
    ] });

    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .resolves.toMatchObject({ rootIds: ['text'] });
    expect(host.document('target').blocks.map((block) => block.id))
      .toEqual(['text', 'unresolved-target']);
  });

  it('rejects a destination that cannot contain the moved tool', async () => {
    const host = new MemoryTransferHost();
    const request: PageTransferRequest = {
      ...moveRequest,
      place: { parentId: 'columns', afterId: null },
    };

    host.replaceTarget({ blocks: [
      { id: 'columns', type: 'column_list', data: {}, content: [] },
    ] });
    const error = await executePageTransfer(host, request, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('target').blocks[0]?.content).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/child|column/i) });
  });

  it.each([
    { parentType: 'page-link', parentData: { pageId: 'child' } },
    { parentType: 'table', parentData: { content: [] } },
  ])('rejects moving a paragraph under a $parentType parent before committing', async ({ parentType, parentData }) => {
    const host = new MemoryTransferHost();
    const sourceBefore = host.document('source');

    host.replaceTarget({ blocks: [
      { id: 'parent', type: parentType, data: parentData, content: [] },
    ] });
    const targetBefore = host.document('target');

    await expect(executePageTransfer(host, {
      ...moveRequest,
      place: { parentId: 'parent', afterId: null },
    }, { collaboration: false })).rejects.toThrow(/child|contain|destination|parent|table/i);
    expect(host.document('source')).toEqual(sourceBefore);
    expect(host.document('target')).toEqual(targetBefore);
  });

  it('refuses reparent-page for a block that is not an owning page pointer', async () => {
    const host = new MemoryTransferHost();
    const request: PageTransferRequest = { ...moveRequest, kind: 'reparent-page' };

    const error = await executePageTransfer(host, request, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('source').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('target').blocks).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/page pointer/i) });
  });

  it('accepts a retry whose request properties were constructed in a different order', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });
    const retry: PageTransferRequest = {
      targetPageId: 'target',
      sourcePageId: 'source',
      place: { afterId: null, parentId: null },
      rootIds: ['text'],
      operationId: 'move-1',
      kind: 'move-blocks',
    };

    await expect(executePageTransfer(host, retry, { collaboration: false }))
      .resolves.toEqual(first);
    expect(host.document('target').blocks.filter((block) => block.id === 'text')).toHaveLength(1);
  });

  it('does not let a caller mutate the stored receipt used by retries', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });

    first.rootIds[0] = 'other';

    await expect(executePageTransfer(host, moveRequest, { collaboration: false }))
      .resolves.toMatchObject({ rootIds: ['text'] });
    expect(host.document('target').blocks.filter((block) => block.id === 'text')).toHaveLength(1);
  });

  it('rejects reuse of one operation ID with a different request', async () => {
    const host = new MemoryTransferHost();

    await executePageTransfer(host, moveRequest, { collaboration: false });
    await expect(executePageTransfer(host, {
      ...moveRequest,
      place: { parentId: null, afterId: 'different' },
    }, { collaboration: false })).rejects.toThrow(/conflict/i);
    expect(host.document('target').blocks.filter((block) => block.id === 'text')).toHaveLength(1);
  });
});

describe('duplicate-page host transaction', () => {
  it('copies three permitted levels with fresh IDs and one owner per copied page', async () => {
    const host = seedThreeLevelTree();
    const beforeIds = host.documentIds();

    const receipt = await executePageTransfer(host, duplicateRequest, { collaboration: false });
    const target = host.document('target');
    const copiedRootId = ownedPageId(target);
    const copiedRoot = host.document(copiedRootId);
    const copiedChildId = ownedPageId(copiedRoot);
    const copiedChild = host.document(copiedChildId);
    const copiedGrandchildId = ownedPageId(copiedChild);
    const copiedGrandchild = host.document(copiedGrandchildId);
    const copiedDocuments = [target, copiedRoot, copiedChild, copiedGrandchild];
    const copiedBlocks = copiedDocuments.flatMap((document) => document.blocks);

    for (const pageId of [copiedRootId, copiedChildId, copiedGrandchildId]) {
      expect(copiedBlocks.filter((block) => block.type === 'page' && block.data.pageId === pageId))
        .toHaveLength(1);
    }
    expect(host.documentIds()).toHaveLength(beforeIds.length + 3);
    expect(receipt.rootIds).toEqual([target.blocks[0]?.id]);
    expect(new Set([copiedRootId, copiedChildId, copiedGrandchildId]).size).toBe(3);
    expect([copiedRootId, copiedChildId, copiedGrandchildId])
      .not.toContain('root');
    expect([copiedRootId, copiedChildId, copiedGrandchildId])
      .not.toContain('child');
    expect([copiedRootId, copiedChildId, copiedGrandchildId])
      .not.toContain('grandchild');
    expect(copiedBlocks.every((block) => ![
      'owner', 'root-text', 'child-owner', 'grandchild-owner', 'deep-text',
    ].includes(block.id ?? ''))).toBe(true);
    expect(copiedRoot.blocks.find((block) => block.type === 'paragraph')?.data.text)
      .toContain(`data-blok-page-id="${copiedChildId}"`);
    expect(copiedGrandchild.blocks[0]?.data.text).toBe('Deep body');
    expect(host.document('source').blocks[0]?.data.pageId).toBe('root');
  });

  it('refuses deep duplication under a page link without changing either document', async () => {
    const host = seedThreeLevelTree();

    host.replaceTarget({ blocks: [
      { id: 'link', type: 'page-link', data: { pageId: 'child' } },
    ] });
    const sourceBefore = host.document('source');
    const targetBefore = host.document('target');
    const documentIdsBefore = host.documentIds();

    await expect(executePageTransfer(host, {
      ...duplicateRequest,
      place: { parentId: 'link', afterId: null },
    }, { collaboration: false })).rejects.toThrow(/page.link|contain|child/i);
    expect(host.document('source')).toEqual(sourceBefore);
    expect(host.document('target')).toEqual(targetBefore);
    expect(host.documentIds()).toEqual(documentIdsBefore);
  });

  it('copies a migrated database row body with a fresh page and block ID', async () => {
    const host = new MemoryTransferHost();

    host.replaceSource({ blocks: [
      { id: 'owner', type: 'page', data: { pageId: 'root' } },
    ] });
    host.setDocument('root', { blocks: [
      { id: 'database', type: 'database', data: { schema: [], views: [], activeViewId: 'v1' }, content: ['row'] },
      { id: 'row', type: 'database-row', parent: 'database', data: {
        pageId: 'row-body', properties: { status: 'Ready' }, position: 'a0', title: 'Ship it',
      } },
    ] });
    host.setDocument('row-body', { blocks: [
      { id: 'row-text', type: 'paragraph', data: { text: 'Row body' } },
    ] });
    host.addOwningEdge('source', 'root');
    host.addOwningEdge('root', 'row-body');
    const originalRowBody = host.document('row-body');
    const beforeIds = host.documentIds();

    await executePageTransfer(host, duplicateRequest, { collaboration: false });
    const copiedRoot = host.document(ownedPageId(host.document('target')));
    const copiedRowPageId = copiedRoot.blocks.find((block) => block.type === 'database-row')?.data.pageId;

    expect(typeof copiedRowPageId === 'string' && copiedRowPageId !== 'row-body').toBe(true);
    if (typeof copiedRowPageId !== 'string') {
      throw new Error('Copied row page ID is missing');
    }

    const copiedRowBody = host.document(copiedRowPageId);

    expect(host.documentIds()).toHaveLength(beforeIds.length + 2);
    expect(copiedRowBody.blocks[0]?.id).not.toBe('row-text');
    expect(copiedRowBody.blocks[0]?.data.text).toBe('Row body');
    expect(host.document('row-body')).toEqual(originalRowBody);
  });

  it('leaves no visible copy when the second descendant write fails', async () => {
    const host = seedThreeLevelTree();
    const beforeIds = host.documentIds();

    host.failOnce = 'secondDescendant';
    const error = await executePageTransfer(host, duplicateRequest, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks).toEqual([]);
    expect(host.documentIds()).toEqual(beforeIds);
    expect(host.document('source').blocks[0]?.data.pageId).toBe('root');
    expect(error).toMatchObject({ message: expect.stringMatching(/descendant/i) });
  });

  it('refuses an unreadable descendant without exposing a copy', async () => {
    const host = seedThreeLevelTree();
    const beforeIds = host.documentIds();

    host.deny('grandchild');
    const error = await executePageTransfer(host, duplicateRequest, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks).toEqual([]);
    expect(host.documentIds()).toEqual(beforeIds);
    expect(error).toMatchObject({ message: expect.stringMatching(/denied/i) });
  });

  it('retries a lost response without allocating another copy', async () => {
    const host = seedThreeLevelTree();

    host.failOnce = 'afterCommitBeforeResponse';
    await expect(executePageTransfer(host, duplicateRequest, { collaboration: false }))
      .rejects.toThrow(/response loss/i);
    const committedTarget = host.document('target');
    const committedIds = host.documentIds();
    const first = await executePageTransfer(host, duplicateRequest, { collaboration: false });
    const second = await executePageTransfer(host, duplicateRequest, { collaboration: false });

    expect(host.document('target')).toEqual(committedTarget);
    expect(host.documentIds()).toEqual(committedIds);
    expect(first).toEqual(second);
    expect(host.document('target').blocks).toHaveLength(1);
  });

  it('refuses a cyclic or multiply owned source subtree', async () => {
    const cyclic = seedThreeLevelTree();

    cyclic.setDocument('child', { blocks: [
      { id: 'back', type: 'page', data: { pageId: 'root' } },
    ] });
    const cycleError = await executePageTransfer(cyclic, duplicateRequest, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);
    expect(cyclic.document('target').blocks).toEqual([]);
    expect(cycleError).toMatchObject({ message: expect.stringMatching(/cycle/i) });

    const duplicate = seedThreeLevelTree();

    duplicate.setDocument('root', { blocks: [
      { id: 'first', type: 'page', data: { pageId: 'child' } },
      { id: 'second', type: 'page', data: { pageId: 'child' } },
    ] });
    const duplicateError = await executePageTransfer(duplicate, duplicateRequest, { collaboration: false })
      .then(() => null, (caught: unknown) => caught);
    expect(duplicate.document('target').blocks).toEqual([]);
    expect(duplicateError).toMatchObject({ message: expect.stringMatching(/owner/i) });
  });
});

describe('deep duplicate Undo', () => {
  it('retires every copied body and owner with its pointer', async () => {
    const host = seedThreeLevelTree();
    const beforeIds = host.documentIds();
    const sourceBefore = host.document('source');
    const original = await executePageTransfer(host, duplicateRequest, { collaboration: false });
    const copiedPageIds = host.documentIds().filter((id) => !beforeIds.includes(id));
    const request = { operationId: 'undo-deep-copy', undoOf: original };

    const undone = await undoPageTransfer(host, request, { collaboration: false });

    expect(host.documentIds()).toEqual(beforeIds);
    expect(host.document('target').blocks).toEqual([]);
    for (const pageId of copiedPageIds) {
      expect(host.ownersOf(pageId)).toEqual([]);
    }
    expect(host.document('source')).toEqual(sourceBefore);
    expect(undone.undoOfOperationId).toBe(original.operationId);
    await expect(undoPageTransfer(host, request, { collaboration: false }))
      .resolves.toEqual(undone);
  });

  it('preserves the whole copy after an edited descendant is restored', async () => {
    const host = seedThreeLevelTree();
    const original = await executePageTransfer(host, duplicateRequest, { collaboration: false });
    const targetBefore = host.document('target');
    const copiedRoot = host.document(ownedPageId(targetBefore));
    const copiedChild = host.document(ownedPageId(copiedRoot));
    const copiedGrandchildId = ownedPageId(copiedChild);
    const copiedGrandchild = host.document(copiedGrandchildId);
    const textId = copiedGrandchild.blocks[0]?.id;

    if (typeof textId !== 'string') {
      throw new Error('Copied descendant is missing');
    }

    host.edit(copiedGrandchildId, textId, 'Peer draft');
    host.edit(copiedGrandchildId, textId, 'Deep body');
    const idsBefore = host.documentIds();
    const error = await undoPageTransfer(host, {
      operationId: 'undo-edited-deep-copy', undoOf: original,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('target')).toEqual(targetBefore);
    expect(host.documentIds()).toEqual(idsBefore);
    expect(host.document(copiedGrandchildId).blocks[0]?.data.text).toBe('Deep body');
    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
  });

  it('refuses deep duplicate Undo after a peer reparents its pointer within the target', async () => {
    const host = seedThreeLevelTree();

    host.replaceTarget({ blocks: [
      { id: 'container', type: 'toggle', data: {}, content: [] },
    ] });
    const beforeIds = host.documentIds();
    const original = await executePageTransfer(host, {
      ...duplicateRequest,
      place: { parentId: null, afterId: 'container' },
    }, { collaboration: false });
    const pointerId = original.rootIds[0];
    const target = host.document('target');
    const container = target.blocks.find((block) => block.id === 'container');
    const pointer = target.blocks.find((block) => block.id === pointerId);

    if (!pointerId || !container || !pointer) {
      throw new Error('Copied pointer or container is missing');
    }

    container.content = [pointerId];
    pointer.parent = 'container';
    host.replaceTarget(target);
    const copiedBodies = host.documentIds()
      .filter((pageId) => !beforeIds.includes(pageId))
      .map((pageId) => ({ pageId, body: host.document(pageId) }));
    const idsBeforeUndo = host.documentIds();
    const error = await undoPageTransfer(host, {
      operationId: 'undo-reparented-deep-copy', undoOf: original,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
    expect(host.document('target')).toEqual(target);
    expect(host.documentIds()).toEqual(idsBeforeUndo);
    for (const { pageId, body } of copiedBodies) {
      expect(host.document(pageId)).toEqual(body);
    }
  });
});

describe('undoPageTransfer', () => {
  it('moves the current subtree back without losing a peer edit', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });

    host.edit('target', 'text', 'Peer revision');
    const undone = await undoPageTransfer(host, {
      operationId: 'undo-1',
      undoOf: first,
    }, { collaboration: false });

    expect(host.document('source').blocks.find((block) => block.id === 'text')?.data.text)
      .toBe('Peer revision');
    expect(host.document('target').blocks).toEqual([]);
    expect(undone).toMatchObject({
      operationId: 'undo-1',
      undoOfOperationId: first.operationId,
      undoToken: first.undoToken,
    });
  });

  it('refuses to undo a root displaced by a peer', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });

    host.moveRoot('text', 'child');
    const error = await undoPageTransfer(host, {
      operationId: 'undo-displaced',
      undoOf: first,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('child').blocks.find((block) => block.id === 'text')?.data.text)
      .toBe('Original');
    expect(host.document('source').blocks).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
  });

  it('refuses a receipt that does not name the committed roots', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });
    const error = await undoPageTransfer(host, {
      operationId: 'undo-forged',
      undoOf: { ...first, rootIds: ['other'] },
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('source').blocks).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/receipt|conflict/i) });
  });

  it('returns one Undo receipt on retry and rejects a changed request digest', async () => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });
    const request = { operationId: 'undo-1', undoOf: first };

    host.undoFailOnce = 'afterCommitBeforeResponse';
    await expect(undoPageTransfer(host, request, { collaboration: false }))
      .rejects.toThrow(/response loss/i);
    const retry = await undoPageTransfer(host, request, { collaboration: false });
    const repeated = await undoPageTransfer(host, request, { collaboration: false });
    const error = await undoPageTransfer(host, {
      operationId: 'undo-1',
      undoOf: { ...first, targetPageId: 'child' },
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('source').blocks.filter((block) => block.id === 'text')).toHaveLength(1);
    expect(host.document('target').blocks).toEqual([]);
    expect(repeated).toEqual(retry);
    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
  });

  it.each(['source', 'target'])('refuses Undo after %s access is revoked', async (pageId) => {
    const host = new MemoryTransferHost();
    const first = await executePageTransfer(host, moveRequest, { collaboration: false });

    host.deny(pageId);
    const error = await undoPageTransfer(host, {
      operationId: 'undo-revoked',
      undoOf: first,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks.map((block) => block.id)).toEqual(['text']);
    expect(host.document('source').blocks).toEqual([]);
    expect(error).toMatchObject({ message: expect.stringMatching(/denied/i) });
  });

  it('refuses to delete a duplicate after a peer edits the copy', async () => {
    const host = new MemoryTransferHost();
    const first = host.seedDuplicate();

    host.edit('target', 'copy', 'Peer revision');
    const error = await undoPageTransfer(host, {
      operationId: 'undo-duplicate',
      undoOf: first,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks.find((block) => block.id === 'copy')?.data.text)
      .toBe('Peer revision');
    expect(host.document('source').blocks[0]?.data.text).toBe('Original');
    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
  });

  it('refuses to delete a duplicate after a peer edits and restores a child', async () => {
    const host = new MemoryTransferHost();
    const first = host.seedDuplicate();

    host.edit('target', 'copy-child', 'Peer draft');
    host.edit('target', 'copy-child', 'Child original');
    const error = await undoPageTransfer(host, {
      operationId: 'undo-duplicate-child',
      undoOf: first,
    }, { collaboration: false }).then(() => null, (caught: unknown) => caught);

    expect(host.document('target').blocks.find((block) => block.id === 'copy-child')?.data.text)
      .toBe('Child original');
    expect(host.document('target').blocks.some((block) => block.id === 'copy')).toBe(true);
    expect(error).toMatchObject({ message: expect.stringMatching(/conflict/i) });
  });

  it('refuses a saved-document Undo adapter during collaboration', async () => {
    const undo = vi.fn();
    const host: PageTransferUndoHost = {
      mode: 'saved-transaction',
      run: vi.fn(),
      undo,
    };
    const error = await undoPageTransfer(host, {
      operationId: 'undo-gated',
      undoOf: receipt,
    }, { collaboration: true }).then(() => null, (caught: unknown) => caught);

    expect(undo).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: expect.stringMatching(/durable live document/i) });
  });

  it.each([
    ['Undo token', { ...receipt, undoToken: '' }],
    ['transaction ID', { ...receipt, durability: { kind: 'transaction' as const, transactionId: '' } }],
  ])('refuses an original receipt without a %s', async (_field, invalid) => {
    const undo = vi.fn();
    const host: PageTransferUndoHost = {
      mode: 'live-transaction',
      run: vi.fn(),
      undo,
    };
    const error = await undoPageTransfer(host, {
      operationId: 'undo-invalid',
      undoOf: invalid,
    }, { collaboration: true }).then(() => null, (caught: unknown) => caught);

    expect(undo).not.toHaveBeenCalled();
    expect(error).toMatchObject({ message: expect.stringMatching(/receipt/i) });
  });

  it.each([
    ['Undo operation ID', { operationId: 'other', undoOfOperationId: 'move-1', undoToken: 'undo-move-1', durability: { kind: 'transaction', transactionId: 'tx-undo' } }],
    ['original operation ID', { operationId: 'undo-receipt', undoOfOperationId: 'other', undoToken: 'undo-move-1', durability: { kind: 'transaction', transactionId: 'tx-undo' } }],
    ['Undo token', { operationId: 'undo-receipt', undoOfOperationId: 'move-1', undoToken: 'other', durability: { kind: 'transaction', transactionId: 'tx-undo' } }],
    ['transaction ID', { operationId: 'undo-receipt', undoOfOperationId: 'move-1', undoToken: 'undo-move-1', durability: { kind: 'transaction', transactionId: '' } }],
  ])('refuses an Undo receipt with a mismatched %s', async (_field, invalid) => {
    const host: PageTransferUndoHost = {
      mode: 'live-transaction',
      run: vi.fn(),
      undo: vi.fn().mockResolvedValue(invalid),
    };

    await expect(undoPageTransfer(host, {
      operationId: 'undo-receipt',
      undoOf: receipt,
    }, { collaboration: true })).rejects.toThrow(/receipt/i);
  });
});
