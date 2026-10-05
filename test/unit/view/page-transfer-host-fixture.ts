import type { OutputData } from '../../../types';
import { movePageBlocks } from '../../../src/view/page-transfer';
import { remapPageDocument } from '../../../src/view/page-document-remap';
import type { PageBlockPlacement } from '../../../src/view/page-transfer';
import type {
  PageTransferReceipt,
  PageTransferRequest,
  PageTransferUndoHost,
  PageTransferUndoReceipt,
  PageTransferUndoRequest,
} from '../../../src/view/page-transfer-host';

interface RootPlacement extends PageBlockPlacement {
  rootId: string;
}

interface TransferRecord {
  digest: string;
  receipt: PageTransferReceipt;
  sourcePlacements?: RootPlacement[];
  targetPlacement?: PageBlockPlacement;
  copySnapshot?: OutputData;
  copiedPageSnapshots?: Map<string, OutputData>;
  copiedRootPageId?: string;
}

const receiptDigest = (receipt: PageTransferReceipt): string => JSON.stringify([
  receipt.operationId,
  receipt.kind,
  receipt.sourcePageId,
  receipt.targetPageId,
  receipt.rootIds,
  receipt.undoToken,
  receipt.durability.kind,
  receipt.durability.transactionId,
]);

export class MemoryTransferHost implements PageTransferUndoHost {
  public readonly mode = 'saved-transaction';
  public failOnce: 'beforeCommit' | 'secondDescendant' | 'afterCommitBeforeResponse' | null = null;
  public undoFailOnce: 'afterCommitBeforeResponse' | null = null;

  private readonly documents = new Map<string, OutputData>([
    ['source', { blocks: [{ id: 'text', type: 'paragraph', data: { text: 'Original' } }] }],
    ['target', { blocks: [] }],
    ['child', { blocks: [] }],
  ]);
  private readonly records = new Map<string, TransferRecord>();
  private readonly undoRecords = new Map<string, { digest: string; receipt: PageTransferUndoReceipt }>();
  private readonly rootProvenance = new Map<string, string>();
  private readonly editedCopies = new Set<string>();
  private readonly denied = new Set<string>();
  private readonly owningEdges = new Map<string, Set<string>>();

  public document(pageId: string): OutputData {
    const document = this.documents.get(pageId);

    if (!document) {
      throw new Error('Document missing');
    }

    return structuredClone(document);
  }

  public replaceSource(source: OutputData): void {
    this.documents.set('source', structuredClone(source));
  }

  public replaceTarget(target: OutputData): void {
    this.documents.set('target', structuredClone(target));
  }

  public setDocument(pageId: string, document: OutputData): void {
    this.documents.set(pageId, structuredClone(document));
  }

  public documentIds(): string[] {
    return [...this.documents.keys()];
  }

  public ownersOf(pageId: string): string[] {
    return [...this.owningEdges]
      .filter(([, children]) => children.has(pageId))
      .map(([owner]) => owner);
  }

  public editSource(blockId: string, text: string): void {
    this.edit('source', blockId, text);
  }

  public edit(pageId: string, blockId: string, text: string): void {
    const document = this.document(pageId);
    const block = document.blocks.find((entry) => entry.id === blockId);

    if (!block) {
      throw new Error('Block missing');
    }

    block.data.text = text;
    this.documents.set(pageId, document);

    let currentId: string | undefined = block.id;

    while (currentId) {
      const origin = this.rootProvenance.get(currentId);

      if (origin && this.records.get(origin)?.receipt.kind === 'duplicate-page') {
        this.editedCopies.add(origin);

        return;
      }

      currentId = document.blocks.find((entry) => entry.id === currentId)?.parent;
    }
  }

  public moveRoot(blockId: string, destinationPageId: string): void {
    const moved = movePageBlocks(
      this.document('target'),
      this.document(destinationPageId),
      [blockId],
      { parentId: null, afterId: null }
    );

    this.documents.set('target', moved.source);
    this.documents.set(destinationPageId, moved.target);
    this.rootProvenance.delete(blockId);
  }

  public seedDuplicate(): PageTransferReceipt {
    const receipt: PageTransferReceipt = {
      operationId: 'duplicate-1',
      kind: 'duplicate-page',
      sourcePageId: 'source',
      targetPageId: 'target',
      rootIds: ['copy'],
      undoToken: 'undo-duplicate-1',
      durability: { kind: 'transaction', transactionId: 'tx-duplicate-1' },
    };

    this.documents.set('target', {
      blocks: [
        { id: 'copy', type: 'toggle', data: { text: 'Original' }, content: ['copy-child'] },
        { id: 'copy-child', type: 'paragraph', parent: 'copy', data: { text: 'Child original' } },
      ],
    });
    this.records.set(receipt.operationId, {
      digest: 'seeded-duplicate',
      receipt,
      copySnapshot: this.document('target'),
    });
    this.rootProvenance.set('copy', receipt.operationId);

    return structuredClone(receipt);
  }

  public deny(pageId: string): void {
    this.denied.add(pageId);
  }

  public addOwningEdge(parent: string, child: string): void {
    const children = this.owningEdges.get(parent) ?? new Set<string>();

    children.add(child);
    this.owningEdges.set(parent, children);
  }

  private siblings(document: OutputData, parentId: string | null): string[] {
    if (parentId !== null) {
      return document.blocks.find((block) => block.id === parentId)?.content ?? [];
    }

    return document.blocks
      .filter((block) => !block.parent)
      .map((block) => block.id)
      .filter((id): id is string => typeof id === 'string');
  }

  public async run(request: PageTransferRequest): Promise<PageTransferReceipt> {
    const digest = JSON.stringify([
      request.kind,
      request.operationId,
      request.sourcePageId,
      request.targetPageId,
      'rootIds' in request ? request.rootIds : null,
      'pointerId' in request ? request.pointerId : null,
      'place' in request ? [request.place.parentId, request.place.afterId] : null,
    ]);
    const prior = this.records.get(request.operationId);

    if (prior) {
      if (prior.digest !== digest) {
        throw new Error('Operation ID conflicts with a different request');
      }

      return structuredClone(prior.receipt);
    }

    if (this.denied.has(request.sourcePageId) || this.denied.has(request.targetPageId)) {
      throw new Error('Page access denied');
    }

    if (request.kind === 'duplicate-page') {
      return this.duplicatePage(request, digest);
    }
    if (request.kind !== 'move-blocks' && request.kind !== 'reparent-page') {
      throw new Error('Fixture supports only moves');
    }

    const source = this.document(request.sourcePageId);
    const target = this.document(request.targetPageId);

    if (request.kind === 'reparent-page') {
      const pointer = source.blocks.find((block) => block.id === request.rootIds[0]);

      if (request.rootIds.length !== 1 || pointer?.type !== 'page' ||
          typeof pointer.data.pageId !== 'string' || !pointer.data.pageId) {
        throw new Error('Reparent requires one owning page pointer');
      }
    }

    const parent = target.blocks.find((block) => block.id === request.place.parentId);

    if (parent?.type === 'page-link' || parent?.type === 'table') {
      throw new Error('Target parent cannot contain moved blocks');
    }
    if (parent?.type === 'column_list' && request.rootIds.some((id) =>
      source.blocks.find((block) => block.id === id)?.type !== 'column')) {
      throw new Error('A column list can only contain column children');
    }

    const moved = movePageBlocks(source, target, request.rootIds, request.place);
    const sourcePlacements = request.rootIds.map((rootId): RootPlacement => {
      const root = source.blocks.find((block) => block.id === rootId);

      if (!root) {
        throw new Error('Moved root missing');
      }

      const parentId = root.parent ?? null;
      const siblings = this.siblings(source, parentId);
      const index = siblings.indexOf(rootId);

      if (index < 0) {
        throw new Error('Moved root placement missing');
      }

      return { rootId, parentId, afterId: siblings[index - 1] ?? null };
    });
    const movedIds = new Set(moved.movedIds);
    const movedPageIds: string[] = [];
    const owners = new Set<string>();

    for (const block of [...moved.source.blocks, ...moved.target.blocks]) {
      if (block.type !== 'page' || typeof block.data.pageId !== 'string' || !block.data.pageId) {
        continue;
      }
      if (owners.has(block.data.pageId)) {
        throw new Error('Duplicate page owner');
      }
      owners.add(block.data.pageId);
      if (!movedIds.has(block.id ?? '')) {
        continue;
      }
      if (this.isDescendant(block.data.pageId, request.targetPageId)) {
        throw new Error('Owning page cycle');
      }
      movedPageIds.push(block.data.pageId);
    }

    if (this.failOnce === 'beforeCommit') {
      this.failOnce = null;
      throw new Error('Injected before-commit failure');
    }

    const receipt: PageTransferReceipt = {
      operationId: request.operationId,
      kind: request.kind,
      sourcePageId: request.sourcePageId,
      targetPageId: request.targetPageId,
      rootIds: [...request.rootIds],
      undoToken: `undo-${request.operationId}`,
      durability: { kind: 'transaction', transactionId: `tx-${request.operationId}` },
    };

    this.documents.set(request.sourcePageId, moved.source);
    this.documents.set(request.targetPageId, moved.target);
    for (const pageId of movedPageIds) {
      this.owningEdges.get(request.sourcePageId)?.delete(pageId);
      this.addOwningEdge(request.targetPageId, pageId);
    }
    this.records.set(request.operationId, {
      digest,
      receipt,
      sourcePlacements,
      targetPlacement: structuredClone(request.place),
    });
    for (const rootId of request.rootIds) {
      this.rootProvenance.set(rootId, request.operationId);
    }

    if (this.failOnce === 'afterCommitBeforeResponse') {
      this.failOnce = null;
      throw new Error('Injected response loss');
    }

    return structuredClone(receipt);
  }

  private duplicatePage(
    request: Extract<PageTransferRequest, { kind: 'duplicate-page' }>,
    digest: string
  ): PageTransferReceipt {
    const source = this.document(request.sourcePageId);
    const target = this.document(request.targetPageId);
    const pointer = source.blocks.find((block) => block.id === request.pointerId);
    const rootPageId = pointer?.data.pageId;

    if (pointer?.type !== 'page' || typeof rootPageId !== 'string' || !rootPageId) {
      throw new Error('Duplicate requires one owning page pointer');
    }

    const orderedPages: string[] = [];
    const bodies = new Map<string, OutputData>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (pageId: string): void => {
      if (visiting.has(pageId)) {
        throw new Error('Owning page cycle');
      }
      if (visited.has(pageId)) {
        throw new Error('Duplicate page owner');
      }
      if (this.denied.has(pageId)) {
        throw new Error('Page access denied');
      }

      const body = this.document(pageId);

      visiting.add(pageId);
      orderedPages.push(pageId);
      bodies.set(pageId, body);
      for (const block of body.blocks) {
        if (block.type !== 'page' && block.type !== 'database-row') {
          continue;
        }

        const childPageId = block.data.pageId;

        if (block.type === 'database-row' && (typeof childPageId !== 'string' || !childPageId)) {
          continue;
        }
        if (typeof childPageId !== 'string' || !childPageId) {
          throw new Error('Owning page pointer is missing its page ID');
        }
        visit(childPageId);
      }
      visiting.delete(pageId);
      visited.add(pageId);
    };

    visit(rootPageId);

    const ownerCounts = new Map<string, number>();

    for (const block of [...this.documents.values()].flatMap((document) => document.blocks)) {
      const pageId = block.type === 'page' || block.type === 'database-row'
        ? block.data.pageId
        : undefined;

      if (typeof pageId === 'string' && pageId) {
        ownerCounts.set(pageId, (ownerCounts.get(pageId) ?? 0) + 1);
      }
    }
    if (orderedPages.some((pageId) => ownerCounts.get(pageId) !== 1)) {
      throw new Error('Duplicate page owner');
    }

    const takenPageIds = new Set(this.documents.keys());
    const takenBlockIds = new Set([...this.documents.values()]
      .flatMap((document) => document.blocks.map((block) => block.id))
      .filter((id): id is string => typeof id === 'string'));
    const mint = (kind: 'page' | 'block', oldId: string, taken: Set<string>): string => {
      const base = `${request.operationId}-${kind}-${oldId}`;
      let candidate = base;
      let suffix = 2;

      while (taken.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      taken.add(candidate);

      return candidate;
    };
    const pageIds = new Map(orderedPages.map((pageId) => [
      pageId,
      mint('page', pageId, takenPageIds),
    ]));
    const copiedBodies = new Map<string, OutputData>();

    for (const [index, pageId] of orderedPages.entries()) {
      const body = bodies.get(pageId);
      const copiedPageId = pageIds.get(pageId);

      if (!body || !copiedPageId) {
        throw new Error('Page body missing');
      }

      const blockIds = new Map(body.blocks.map((block) => [
        block.id ?? '',
        mint('block', block.id ?? '', takenBlockIds),
      ]));

      copiedBodies.set(copiedPageId, remapPageDocument(body, { blockIds, pageIds }));
      if (index === 2 && this.failOnce === 'secondDescendant') {
        this.failOnce = null;
        throw new Error('Injected second-descendant write failure');
      }
    }

    const copiedRootId = pageIds.get(rootPageId);

    if (!copiedRootId) {
      throw new Error('Copied page ID missing');
    }

    const copiedPointerId = mint('block', request.pointerId, takenBlockIds);
    const pointerDoc: OutputData = { blocks: [
      { id: copiedPointerId, type: 'page', data: { pageId: copiedRootId } },
    ] };
    const targetParent = target.blocks.find((block) => block.id === request.place.parentId);

    if (targetParent?.type === 'table' || targetParent?.type === 'column_list') {
      throw new Error('Target parent cannot contain a page pointer');
    }

    const placed = movePageBlocks(pointerDoc, target, [copiedPointerId], request.place);

    if (this.failOnce === 'beforeCommit') {
      this.failOnce = null;
      throw new Error('Injected before-commit failure');
    }

    const receipt: PageTransferReceipt = {
      operationId: request.operationId,
      kind: request.kind,
      sourcePageId: request.sourcePageId,
      targetPageId: request.targetPageId,
      rootIds: [copiedPointerId],
      undoToken: `undo-${request.operationId}`,
      durability: { kind: 'transaction', transactionId: `tx-${request.operationId}` },
    };

    this.documents.set(request.targetPageId, placed.target);
    for (const [pageId, body] of copiedBodies) {
      this.documents.set(pageId, body);
    }
    this.addOwningEdge(request.targetPageId, copiedRootId);
    for (const pageId of orderedPages) {
      const copiedPageId = pageIds.get(pageId);
      const body = bodies.get(pageId);

      if (!copiedPageId || !body) {
        continue;
      }
      body.blocks.forEach((block) => {
        const childPageId = block.type === 'page' || block.type === 'database-row'
          ? block.data.pageId
          : undefined;
        const copiedChildId = typeof childPageId === 'string' ? pageIds.get(childPageId) : undefined;

        if (copiedChildId) {
          this.addOwningEdge(copiedPageId, copiedChildId);
        }
      });
    }
    this.records.set(request.operationId, {
      digest,
      receipt,
      targetPlacement: structuredClone(request.place),
      copySnapshot: pointerDoc,
      copiedPageSnapshots: new Map([...copiedBodies]
        .map(([pageId, body]) => [pageId, structuredClone(body)])),
      copiedRootPageId: copiedRootId,
    });
    this.rootProvenance.set(copiedPointerId, request.operationId);
    for (const block of [...copiedBodies.values()].flatMap((body) => body.blocks)) {
      if (block.id) {
        this.rootProvenance.set(block.id, request.operationId);
      }
    }

    if (this.failOnce === 'afterCommitBeforeResponse') {
      this.failOnce = null;
      throw new Error('Injected response loss');
    }

    return structuredClone(receipt);
  }

  public async undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt> {
    const digest = JSON.stringify([request.operationId, receiptDigest(request.undoOf)]);
    const prior = this.undoRecords.get(request.operationId);

    if (prior) {
      if (prior.digest !== digest) {
        throw new Error('Undo operation ID conflicts with a different request');
      }

      return structuredClone(prior.receipt);
    }

    const original = this.records.get(request.undoOf.operationId);

    if (!original || receiptDigest(original.receipt) !== receiptDigest(request.undoOf)) {
      throw new Error('Original transfer receipt conflicts with the operation record');
    }
    if (this.denied.has(request.undoOf.sourcePageId) ||
        this.denied.has(request.undoOf.targetPageId)) {
      throw new Error('Page access denied');
    }

    const source = this.document(request.undoOf.sourcePageId);
    const target = this.document(request.undoOf.targetPageId);
    let nextSource = source;
    let nextTarget = target;
    const movedPageIds: string[] = [];

    if (request.undoOf.kind === 'duplicate-page') {
      if (!original.copySnapshot || this.editedCopies.has(request.undoOf.operationId) ||
          request.undoOf.rootIds.some((id) => this.rootProvenance.get(id) !== request.undoOf.operationId)) {
        throw new Error('Duplicate Undo conflicts with peer work');
      }
      const copyChanged = [...original.copiedPageSnapshots ?? []].some(([pageId, snapshot]) => {
        const current = this.documents.get(pageId);

        return !current || JSON.stringify(current) !== JSON.stringify(snapshot);
      });

      const originalParentId = original.targetPlacement?.parentId;
      const pointerMoved = originalParentId !== undefined && request.undoOf.rootIds.some((id) =>
        (target.blocks.find((block) => block.id === id)?.parent ?? null) !== originalParentId);

      if (copyChanged || pointerMoved) {
        throw new Error('Duplicate Undo conflicts with peer work');
      }

      nextTarget = this.removeDuplicateCopy(target, request.undoOf.rootIds, original.copySnapshot);
    } else if (request.undoOf.kind === 'move-blocks' ||
               request.undoOf.kind === 'reparent-page') {
      const restored = this.restoreMovedRoots(original, request.undoOf, source, target);

      nextSource = restored.source;
      nextTarget = restored.target;
      movedPageIds.push(...restored.movedPageIds);
    } else {
      throw new Error('Fixture supports only move and duplicate Undo');
    }

    const receipt: PageTransferUndoReceipt = {
      operationId: request.operationId,
      undoOfOperationId: request.undoOf.operationId,
      undoToken: request.undoOf.undoToken,
      durability: { kind: 'transaction', transactionId: `tx-${request.operationId}` },
    };

    this.documents.set(request.undoOf.sourcePageId, nextSource);
    this.documents.set(request.undoOf.targetPageId, nextTarget);
    if (request.undoOf.kind === 'duplicate-page' && original.copiedPageSnapshots) {
      if (original.copiedRootPageId) {
        this.owningEdges.get(request.undoOf.targetPageId)?.delete(original.copiedRootPageId);
      }
      for (const [pageId, snapshot] of original.copiedPageSnapshots) {
        this.documents.delete(pageId);
        this.owningEdges.delete(pageId);
        snapshot.blocks.forEach((block) => {
          if (block.id) {
            this.rootProvenance.delete(block.id);
          }
        });
      }
    }
    for (const pageId of movedPageIds) {
      this.owningEdges.get(request.undoOf.targetPageId)?.delete(pageId);
      this.addOwningEdge(request.undoOf.sourcePageId, pageId);
    }
    for (const rootId of request.undoOf.rootIds) {
      this.rootProvenance.delete(rootId);
    }
    this.undoRecords.set(request.operationId, { digest, receipt });

    if (this.undoFailOnce === 'afterCommitBeforeResponse') {
      this.undoFailOnce = null;
      throw new Error('Injected Undo response loss');
    }

    return structuredClone(receipt);
  }

  private removeDuplicateCopy(target: OutputData, rootIds: string[], snapshot: OutputData): OutputData {
    try {
      const removed = movePageBlocks(target, { blocks: [] }, rootIds, {
        parentId: null,
        afterId: null,
      });

      if (JSON.stringify(removed.target.blocks) !== JSON.stringify(snapshot.blocks)) {
        throw new Error('Duplicate copy changed');
      }

      return removed.source;
    } catch {
      throw new Error('Duplicate Undo conflicts with peer work');
    }
  }

  private restoreMovedRoots(
    original: TransferRecord,
    receipt: PageTransferReceipt,
    source: OutputData,
    target: OutputData
  ): { source: OutputData; target: OutputData; movedPageIds: string[] } {
    const place = original.targetPlacement;
    const placements = original.sourcePlacements;

    if (!place || !placements ||
        receipt.rootIds.some((id) => this.rootProvenance.get(id) !== receipt.operationId)) {
      throw new Error('Moved root provenance conflict');
    }

    const siblings = this.siblings(target, place.parentId);
    const start = place.afterId === null ? 0 : siblings.indexOf(place.afterId) + 1;

    if ((place.afterId !== null && start === 0) ||
        receipt.rootIds.some((id, index) => siblings[start + index] !== id)) {
      throw new Error('Moved root placement conflict');
    }

    const pending = [...placements];
    const movedIds = new Set<string>();
    let nextSource = source;
    let nextTarget = target;

    while (pending.length > 0) {
      const index = pending.findIndex((item) =>
        !pending.some((other) => other.rootId === item.afterId));
      const placement = index < 0 ? undefined : pending.splice(index, 1)[0];

      if (!placement) {
        throw new Error('Original root placement conflict');
      }

      let moved: ReturnType<typeof movePageBlocks>;

      try {
        moved = movePageBlocks(nextTarget, nextSource, [placement.rootId], placement);
      } catch {
        throw new Error('Original root placement conflict');
      }

      nextTarget = moved.source;
      nextSource = moved.target;
      for (const id of moved.movedIds) {
        movedIds.add(id);
      }
    }

    const owners = new Set<string>();
    const movedPageIds: string[] = [];

    for (const block of [...nextSource.blocks, ...nextTarget.blocks]) {
      const pageId = block.type === 'page' ? block.data.pageId : undefined;

      if (typeof pageId !== 'string' || !pageId) {
        continue;
      }
      if (owners.has(pageId)) {
        throw new Error('Duplicate page owner conflict');
      }
      owners.add(pageId);
      if (!movedIds.has(block.id ?? '')) {
        continue;
      }
      if (this.isDescendant(pageId, receipt.sourcePageId)) {
        throw new Error('Owning page cycle conflict');
      }
      movedPageIds.push(pageId);
    }

    return { source: nextSource, target: nextTarget, movedPageIds };
  }

  private isDescendant(ancestor: string, candidate: string): boolean {
    const seen = new Set<string>();
    const pending = [ancestor];

    while (pending.length > 0) {
      const current = pending.pop();

      if (current === candidate) {
        return true;
      }
      if (current === undefined || seen.has(current)) {
        continue;
      }

      seen.add(current);
      pending.push(...this.owningEdges.get(current) ?? []);
    }

    return false;
  }
}
