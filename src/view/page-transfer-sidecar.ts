import type { OutputBlockData, OutputData } from '../../types';
import { isPagePointer } from '../shared/page-pointer';
import { movePageBlocks, turnBlocksIntoPage, turnPageIntoBlocks } from './page-transfer';
import type { PageBlockPlacement } from './page-transfer';
import type {
  PageTransferReceipt,
  PageTransferRequest,
  PageTransferSagaStep,
  PageTransferUndoHost,
  PageTransferUndoReceipt,
  PageTransferUndoRequest,
} from './page-transfer-host';

export interface SidecarDocHead {
  lineage: string;
  sequence: string;
}

export interface SidecarEditBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  lastEditedAt?: number;
  lastEditedBy?: string;
}

export type SidecarEditOp =
  | { op: 'insert'; id: string; block: SidecarEditBlock; parent: string | null; after: string | null }
  | { op: 'remove'; id: string };

export interface SidecarRootPlacement extends PageBlockPlacement {
  rootId: string;
}

/** A block as the transfer expects to find it before the source removal. */
export interface SidecarExpectedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  parent: string | null;
  content: string[];
}

/** The exact edits of one operation. Written once and never rebuilt under the same operation ID. */
export interface SidecarTransferPlan {
  copyDoc: string;
  copyHead: SidecarDocHead;
  copyChunks: SidecarEditOp[][];
  originDoc: string;
  originHead: SidecarDocHead;
  /** The one destructive edit. */
  originOps: SidecarEditOp[];
  /** The removed blocks as planned. The removal runs only while they still look like this. */
  originExpected: SidecarExpectedBlock[];
  /** IDs the removal inserts, so they must not exist yet (the turn-into-page pointer). */
  originAbsent: string[];
  rootIds: string[];
  restore?: SidecarRootPlacement[];
  destination?: PageBlockPlacement;
}

export interface SidecarTransferRecord {
  version: 1;
  operationId: string;
  digest: string;
  plan: SidecarTransferPlan;
  receipt?: PageTransferReceipt;
  undoReceipt?: PageTransferUndoReceipt;
}

export interface SidecarTransferLog {
  get(operationId: string): SidecarTransferRecord | undefined | Promise<SidecarTransferRecord | undefined>;
  put(record: SidecarTransferRecord): void | Promise<void>;
}

export interface SidecarFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type SidecarFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
) => Promise<SidecarFetchResponse>;

export interface SidecarTransferHostOptions {
  /** The prefix the sidecar routes are mapped under, e.g. `https://example.com/api/blok`. */
  baseUrl: string;
  /** A pass for one document. `write` is true for edits and false for state reads. */
  ticketFor(doc: string, access: { write: boolean }): string | Promise<string>;
  log: SidecarTransferLog;
  fetch?: SidecarFetch;
  /** The server's `CollabMaxMessageBytes`. */
  maxEditBytes?: number;
  /** How many times to send the source removal when peers keep editing elsewhere in the source. */
  maxAttempts?: number;
}

// Matches BlokServerOptions.CollabMaxMessageBytes (1 << 20); /edit refuses a larger body with 413.
const DEFAULT_MAX_EDIT_BYTES = 1 << 20;
const DEFAULT_MAX_ATTEMPTS = 3;
// Bytes of `{"ops":[]}`.
const EDIT_ENVELOPE_BYTES = 10;
const CARRIED_FIELDS = new Set(['id', 'type', 'data', 'tunes', 'lastEditedAt', 'lastEditedBy', 'parent', 'content']);

class Refused {
  public constructor(public readonly status: number, public readonly head: SidecarDocHead | null) {}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const formatHead = (head: SidecarDocHead): string => `"${head.lineage}:${head.sequence}"`;

const readHead = (response: SidecarFetchResponse): SidecarDocHead | null => {
  const lineage = response.headers.get('Blok-Doc-Lineage');
  const sequence = response.headers.get('Blok-Doc-Sequence');

  return lineage && sequence ? { lineage, sequence } : null;
};

const lineageChanged = (doc: string): Error =>
  new Error(`The lineage of "${doc}" changed between attempts; the transfer outcome is unknown and was not re-applied`);

const noJournal = (doc: string): Error =>
  new Error(`"${doc}" gave no durable head; the sidecar must run with an operation journal (--collab-journal)`);

const keptBoth = (copyDoc: string, why: string): Error =>
  new Error(`${why}. The source was kept, and the copy stays in "${copyDoc}"`);

const editBlock = (block: OutputBlockData): SidecarEditBlock => {
  const id = block.id;

  if (!id) {
    throw new Error('Missing block ID');
  }
  for (const key of Object.keys(block)) {
    if (!CARRIED_FIELDS.has(key) && !(key === 'indent' && !block.indent)) {
      throw new Error(`Block "${id}" has a "${key}" field the sidecar edit cannot carry`);
    }
  }

  const result: SidecarEditBlock = { id, type: block.type, data: { ...block.data } };

  if (block.tunes) {
    result.tunes = { ...block.tunes };
  }
  if (typeof block.lastEditedAt === 'number') {
    result.lastEditedAt = block.lastEditedAt;
  }
  if (typeof block.lastEditedBy === 'string') {
    result.lastEditedBy = block.lastEditedBy;
  }

  return result;
};

const siblingsOf = (document: OutputData, parentId: string | null): string[] => parentId === null
  ? document.blocks.filter((block) => !block.parent).map((block) => block.id ?? '')
  : document.blocks.find((block) => block.id === parentId)?.content ?? [];

const placementOf = (document: OutputData, id: string): PageBlockPlacement => {
  const block = document.blocks.find((entry) => entry.id === id);

  if (!block) {
    throw new Error(`Block "${id}" missing`);
  }
  const parentId = block.parent ?? null;
  const siblings = siblingsOf(document, parentId);

  return { parentId, afterId: siblings[siblings.indexOf(id) - 1] ?? null };
};

/** Inserts that rebuild `ids` as they sit in `document`; a parent or left sibling always goes first. */
const insertOps = (document: OutputData, ids: readonly string[]): SidecarEditOp[] => {
  const wanted = new Set(ids);
  const placed = new Set<string>();
  const pending = [...ids];
  const ops: SidecarEditOp[] = [];

  while (pending.length > 0) {
    const index = pending.findIndex((id) => {
      const place = placementOf(document, id);

      return [place.parentId, place.afterId].every((dependency) =>
        dependency === null || !wanted.has(dependency) || placed.has(dependency));
    });
    const id = index < 0 ? undefined : pending.splice(index, 1)[0];
    const block = document.blocks.find((entry) => entry.id === id);

    if (id === undefined || !block) {
      throw new Error('Moved blocks have no insert order');
    }
    const place = placementOf(document, id);

    ops.push({ op: 'insert', id, block: editBlock(block), parent: place.parentId, after: place.afterId });
    placed.add(id);
  }

  return ops;
};

const removeOps = (ids: readonly string[]): SidecarEditOp[] => ids.map((id) => ({ op: 'remove', id }));

const chunk = (ops: SidecarEditOp[], maxBytes: number): SidecarEditOp[][] => {
  const chunks: SidecarEditOp[][] = [];
  const open: { ops: SidecarEditOp[]; bytes: number } = { ops: [], bytes: EDIT_ENVELOPE_BYTES };

  for (const op of ops) {
    const size = byteLength(JSON.stringify(op));
    const next = open.bytes + size + (open.ops.length > 0 ? 1 : 0);

    if (EDIT_ENVELOPE_BYTES + size > maxBytes) {
      throw new Error(`Block "${op.id}" is too large for one sidecar edit (${maxBytes} bytes)`);
    }
    if (next > maxBytes) {
      chunks.push(open.ops);
      open.ops = [op];
      open.bytes = EDIT_ENVELOPE_BYTES + size;
    } else {
      open.ops.push(op);
      open.bytes = next;
    }
  }
  if (open.ops.length > 0) {
    chunks.push(open.ops);
  }

  return chunks;
};

type InsertOp = Extract<SidecarEditOp, { op: 'insert' }>;

const expectedOf = (block: OutputBlockData): SidecarExpectedBlock => {
  const expected: SidecarExpectedBlock = {
    id: block.id ?? '',
    type: block.type,
    data: block.data,
    parent: block.parent ?? null,
    content: block.content ?? [],
  };

  if (block.tunes) {
    expected.tunes = block.tunes;
  }

  return expected;
};

/** Every block in the subtrees of `rootIds`, as it is now. */
const subtreeOf = (document: OutputData, rootIds: readonly string[]): SidecarExpectedBlock[] => {
  const byId = new Map(document.blocks.map((block) => [block.id ?? '', block]));
  const visit = (id: string): SidecarExpectedBlock[] => {
    const block = byId.get(id);

    if (!block) {
      throw new Error(`Block "${id}" missing`);
    }

    return [expectedOf(block), ...(block.content ?? []).flatMap(visit)];
  };

  return rootIds.flatMap(visit);
};

/** The copy as its inserts build it: data, parent and the exact child list. */
const copyExpectedOf = (chunks: SidecarEditOp[][]): SidecarExpectedBlock[] => {
  const inserts = chunks.flat().filter((op): op is InsertOp => op.op === 'insert');

  return inserts.map((op) => {
    const expected: SidecarExpectedBlock = {
      id: op.id,
      type: op.block.type,
      data: op.block.data,
      parent: op.parent,
      content: inserts.filter((child) => child.parent === op.id).map((child) => child.id),
    };

    if (op.block.tunes) {
      expected.tunes = op.block.tunes;
    }

    return expected;
  });
};

const looksAsPlanned = (document: OutputData, expected: SidecarExpectedBlock[]): boolean => {
  const byId = new Map(document.blocks.map((block) => [block.id ?? '', block]));

  return expected.every((want) => {
    const block = byId.get(want.id);

    return block !== undefined && same(expectedOf(block), want);
  });
};

interface DocState {
  data: OutputData;
  head: SidecarDocHead;
}

interface SagaIo {
  maxAttempts: number;
  readState(doc: string): Promise<DocState>;
  edit(doc: string, key: string, ops: SidecarEditOp[], ifMatch: SidecarDocHead | null): Promise<PageTransferSagaStep | Refused>;
  key(operationId: string, role: string, index: number): Promise<string>;
}

const sameLineage = (found: { lineage: string }, head: SidecarDocHead, doc: string): void => {
  if (found.lineage !== head.lineage) {
    throw lineageChanged(doc);
  }
};

/**
 * Runs one logged plan. The source removal is the only destructive edit, and
 * it runs only after a fresh read shows the whole copy as planned and the
 * source blocks unchanged. Nothing ever deletes a copy. Keys depend only on
 * the operation ID, so an overlapping run either replays the same bodies
 * (deduplicated) or meets 409 for a different body and stops.
 */
class Saga {
  public constructor(
    private readonly io: SagaIo,
    private readonly record: SidecarTransferRecord
  ) {}

  public async drive(resumed: boolean): Promise<PageTransferSagaStep[]> {
    const { plan } = this.record;

    if (resumed) {
      const [copy, origin] = await Promise.all([this.io.readState(plan.copyDoc), this.io.readState(plan.originDoc)]);

      sameLineage(copy.head, plan.copyHead, plan.copyDoc);
      sameLineage(origin.head, plan.originHead, plan.originDoc);
    }
    const steps: PageTransferSagaStep[] = [];

    for (const [index, ops] of plan.copyChunks.entries()) {
      steps.push(await this.copy(index, ops));
    }

    return [...steps, await this.removeOrigin(0)];
  }

  private async copy(index: number, ops: SidecarEditOp[]): Promise<PageTransferSagaStep> {
    const { plan, operationId } = this.record;
    const outcome = await this.io.edit(plan.copyDoc, await this.io.key(operationId, 'copy', index), ops, null);

    if (outcome instanceof Refused) {
      const why = outcome.status === 409
        ? `Another run wrote a different plan under operation ID "${operationId}"; use a new operation ID`
        : `Copy into "${plan.copyDoc}" stopped at part ${index + 1} of ${plan.copyChunks.length} (HTTP ${outcome.status}); ` +
          'a partial copy may be there. Retry with the same operation ID to resume';

      throw keptBoth(plan.copyDoc, why);
    }
    sameLineage(outcome, plan.copyHead, plan.copyDoc);

    return outcome;
  }

  private async removeOrigin(tries: number): Promise<PageTransferSagaStep> {
    const { plan, operationId } = this.record;
    const key = await this.io.key(operationId, 'origin', 0);
    const origin = await this.io.readState(plan.originDoc);

    sameLineage(origin.head, plan.originHead, plan.originDoc);
    const present = new Set(origin.data.blocks.map((block) => block.id));

    if (!looksAsPlanned(origin.data, plan.originExpected) || plan.originAbsent.some((id) => present.has(id))) {
      // A removal this operation already committed answers with its first
      // receipt. Otherwise the stale head makes the server refuse: the doc
      // moved, or it would still look as planned.
      return this.confirmed(await this.io.edit(plan.originDoc, key, plan.originOps, plan.originHead),
        `"${plan.originDoc}" changed the blocks being moved`);
    }
    const copy = plan.copyDoc === plan.originDoc ? origin : await this.io.readState(plan.copyDoc);

    sameLineage(copy.head, plan.copyHead, plan.copyDoc);
    if (!looksAsPlanned(copy.data, copyExpectedOf(plan.copyChunks))) {
      throw keptBoth(plan.copyDoc, `The copy in "${plan.copyDoc}" is incomplete or changed`);
    }
    const outcome = await this.io.edit(plan.originDoc, key, plan.originOps, origin.head);

    if (outcome instanceof Refused && outcome.status === 412 && tries + 1 < this.io.maxAttempts) {
      return this.removeOrigin(tries + 1);
    }

    return this.confirmed(outcome, `"${plan.originDoc}" refused the removal (HTTP ${outcome instanceof Refused ? outcome.status : 204})`);
  }

  private confirmed(outcome: PageTransferSagaStep | Refused, why: string): PageTransferSagaStep {
    const { plan } = this.record;

    if (outcome instanceof Refused) {
      throw keptBoth(plan.copyDoc, why);
    }
    sameLineage(outcome, plan.originHead, plan.originDoc);

    return outcome;
  }
}

const assertReparent = (request: PageTransferRequest, source: OutputData): void => {
  const rootIds = 'rootIds' in request ? request.rootIds : [];
  const pointer = source.blocks.find((block) => block.id === rootIds[0]);

  if (rootIds.length !== 1 || !pointer || !isPagePointer(pointer.type, pointer.data)) {
    throw new Error('Reparent requires one owning page pointer');
  }
  if (pointer.data.pageId === request.targetPageId) {
    throw new Error('Owning page cycle');
  }
};

const rootsOf = (document: OutputData): string[] => siblingsOf(document, null);

export function createSidecarTransferHost(options: SidecarTransferHostOptions): PageTransferUndoHost {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const send: SidecarFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const { log } = options;
  const maxEditBytes = options.maxEditBytes ?? DEFAULT_MAX_EDIT_BYTES;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const url = (doc: string, route: 'edit' | 'state'): string =>
    `${baseUrl}/sync/${encodeURIComponent(doc)}/${route}`;

  const readState = async (doc: string): Promise<DocState> => {
    const ticket = await options.ticketFor(doc, { write: false });
    const response = await send(url(doc, 'state'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${ticket}` },
    });

    if (response.status !== 200) {
      throw new Error(`Reading "${doc}" failed with HTTP ${response.status}`);
    }
    const body = await response.json();

    if (!isRecord(body) || !Array.isArray(body.blocks)) {
      throw new Error(`"${doc}" state is not a document`);
    }
    const head = readHead(response);

    if (!head) {
      throw noJournal(doc);
    }
    const blocks: OutputBlockData[] = [];

    for (const block of body.blocks) {
      if (!isRecord(block) || typeof block.id !== 'string' || typeof block.type !== 'string' ||
          !isRecord(block.data) ||
          (block.parent !== undefined && typeof block.parent !== 'string') ||
          (block.content !== undefined && !(Array.isArray(block.content) &&
            block.content.every((id: unknown) => typeof id === 'string')))) {
        throw new Error(`"${doc}" state has a malformed block`);
      }
      blocks.push({ ...block, id: block.id, type: block.type, data: block.data });
    }

    return { data: { blocks }, head };
  };

  const key = async (operationId: string, role: string, index: number): Promise<string> => {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical([operationId, role, index]))
    );

    return `blok-transfer-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  };

  /** A durable receipt, or a definite refusal (4xx: nothing applied). Anything else throws: the outcome is unknown. */
  const edit = async (
    doc: string,
    idempotencyKey: string,
    ops: SidecarEditOp[],
    ifMatch: SidecarDocHead | null
  ): Promise<PageTransferSagaStep | Refused> => {
    const ticket = await options.ticketFor(doc, { write: true });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ticket}`,
      'Content-Type': 'application/json',
      'Blok-Idempotency-Key': idempotencyKey,
    };

    if (ifMatch) {
      headers['If-Match'] = formatHead(ifMatch);
    }
    const response = await send(url(doc, 'edit'), { method: 'POST', headers, body: JSON.stringify({ ops }) });
    const head = readHead(response);

    if (response.status === 204) {
      if (!head) {
        throw new Error(`"${doc}" accepted an edit without a durable receipt; the sidecar must run with --collab-journal`);
      }

      return { doc, ...head };
    }
    if (response.status === 428) {
      throw noJournal(doc);
    }
    if (response.status >= 400 && response.status < 500) {
      return new Refused(response.status, head);
    }

    throw new Error(`Editing "${doc}" failed with HTTP ${response.status}; retry with the same operation ID`);
  };

  const saga = (record: SidecarTransferRecord): Saga =>
    new Saga({ maxAttempts, readState, edit, key }, record);

  const open = async (
    operationId: string,
    digest: string,
    build: () => Promise<SidecarTransferPlan>
  ): Promise<{ record: SidecarTransferRecord; resumed: boolean }> => {
    const stored = await log.get(operationId);

    if (stored !== undefined) {
      if (!isRecord(stored) || stored.version !== 1 || stored.operationId !== operationId) {
        throw new Error(`The log record for "${operationId}" is not a sidecar transfer record`);
      }
      if (stored.digest !== digest) {
        throw new Error('Operation ID was already used for a different request');
      }

      return { record: stored, resumed: true };
    }

    const record: SidecarTransferRecord = {
      version: 1,
      operationId,
      digest,
      plan: await build(),
    };

    await log.put(record);

    return { record, resumed: false };
  };

  const finishPlan = (
    plan: Omit<SidecarTransferPlan, 'copyChunks'> & { copyOps: SidecarEditOp[] }
  ): SidecarTransferPlan => {
    const { copyOps, ...rest } = plan;

    if (byteLength(JSON.stringify({ ops: plan.originOps })) > maxEditBytes) {
      throw new Error(`The source edit is too large for one sidecar edit (${maxEditBytes} bytes)`);
    }

    return { ...rest, copyChunks: chunk(copyOps, maxEditBytes) };
  };

  const buildRunPlan = async (request: PageTransferRequest): Promise<SidecarTransferPlan> => {
    const [source, target] = await Promise.all([readState(request.sourcePageId), readState(request.targetPageId)]);

    switch (request.kind) {
      case 'move-blocks':
      case 'reparent-page': {
        if (request.kind === 'reparent-page') {
          assertReparent(request, source.data);
        }
        const moved = movePageBlocks(source.data, target.data, request.rootIds, request.place);

        return finishPlan({
          copyDoc: request.targetPageId,
          copyHead: target.head,
          copyOps: insertOps(moved.target, moved.movedIds),
          originDoc: request.sourcePageId,
          originHead: source.head,
          originOps: removeOps(request.rootIds),
          originExpected: subtreeOf(source.data, request.rootIds),
          originAbsent: [],
          rootIds: [...request.rootIds],
          restore: request.rootIds.map((rootId) => ({ rootId, ...placementOf(source.data, rootId) })),
          destination: { ...request.place },
        });
      }
      case 'turn-into-page': {
        if (target.data.blocks.length > 0) {
          throw new Error('Turn into page needs an empty new page');
        }
        const turned = turnBlocksIntoPage(source.data, request.rootIds, {
          pageId: request.targetPageId,
          pointerId: request.pointerId,
        });

        return finishPlan({
          copyDoc: request.targetPageId,
          copyHead: target.head,
          copyOps: insertOps(turned.pageBody, turned.pageBody.blocks.map((block) => block.id ?? '')),
          originDoc: request.sourcePageId,
          originHead: source.head,
          originOps: [...removeOps(request.rootIds), ...insertOps(turned.source, [request.pointerId])],
          originExpected: subtreeOf(source.data, request.rootIds),
          originAbsent: [request.pointerId],
          rootIds: [...request.rootIds],
        });
      }
      case 'turn-into-blocks': {
        // The source is the page being turned back; the target holds its pointer.
        // The blocks land next to the pointer, and removing the pointer is the
        // one destructive edit. The page body is left for the host to retire.
        const turned = turnPageIntoBlocks(target.data, request.pointerId, {
          pageId: request.sourcePageId,
          body: source.data,
        });

        return finishPlan({
          copyDoc: request.targetPageId,
          copyHead: target.head,
          copyOps: insertOps(turned.source, turned.movedIds),
          originDoc: request.targetPageId,
          originHead: target.head,
          originOps: removeOps([request.pointerId]),
          originExpected: subtreeOf(target.data, [request.pointerId]),
          originAbsent: [],
          rootIds: rootsOf(source.data),
        });
      }
      case 'duplicate-page':
        throw new Error('duplicate-page needs every copied body in one transaction; the sidecar adapter refuses it');
    }
  };

  const buildUndoPlan = async (original: SidecarTransferRecord, undoOf: PageTransferReceipt): Promise<SidecarTransferPlan> => {
    const { restore, destination } = original.plan;

    if (!restore || !destination) {
      throw new Error('The operation log has no placements to undo');
    }
    const [source, target] = await Promise.all([readState(undoOf.sourcePageId), readState(undoOf.targetPageId)]);
    const siblings = siblingsOf(target.data, destination.parentId);
    const start = destination.afterId === null ? 0 : siblings.indexOf(destination.afterId) + 1;

    if ((destination.afterId !== null && start === 0) ||
        undoOf.rootIds.some((id, index) => siblings[start + index] !== id)) {
      throw new Error('The moved blocks are no longer at the destination; Undo was refused');
    }

    const pending = [...restore];
    const movedIds: string[] = [];
    const moving = { source: source.data, target: target.data };

    while (pending.length > 0) {
      const index = pending.findIndex((item) => !pending.some((other) => other.rootId === item.afterId));
      const placement = index < 0 ? undefined : pending.splice(index, 1)[0];

      if (!placement) {
        throw new Error('Original root placement conflict');
      }
      try {
        const moved = movePageBlocks(moving.target, moving.source, [placement.rootId], placement);

        moving.target = moved.source;
        moving.source = moved.target;
        movedIds.push(...moved.movedIds);
      } catch {
        throw new Error('Original root placement conflict');
      }
    }

    return finishPlan({
      copyDoc: undoOf.sourcePageId,
      copyHead: source.head,
      copyOps: insertOps(moving.source, movedIds),
      originDoc: undoOf.targetPageId,
      originHead: target.head,
      originOps: removeOps(undoOf.rootIds),
      originExpected: subtreeOf(target.data, undoOf.rootIds),
      originAbsent: [],
      rootIds: [...undoOf.rootIds],
    });
  };

  return {
    mode: 'live-saga',

    async run(request: PageTransferRequest): Promise<PageTransferReceipt> {
      if (request.kind === 'duplicate-page') {
        throw new Error('duplicate-page needs every copied body in one transaction; the sidecar adapter refuses it');
      }
      const build = (): Promise<SidecarTransferPlan> => buildRunPlan(request);
      const { record, resumed } = await open(request.operationId, canonical(['run', request]), build);

      if (record.receipt) {
        return record.receipt;
      }
      const steps = await saga(record).drive(resumed);
      const receipt: PageTransferReceipt = {
        operationId: request.operationId,
        kind: request.kind,
        sourcePageId: request.sourcePageId,
        targetPageId: request.targetPageId,
        rootIds: [...record.plan.rootIds],
        undoToken: `sidecar-undo:${request.operationId}`,
        durability: { kind: 'saga', steps },
      };

      record.receipt = receipt;
      await log.put(record);

      return receipt;
    },

    async undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt> {
      const { undoOf } = request;
      const original = await log.get(undoOf.operationId);

      if (!original?.receipt || !same(original.receipt, undoOf)) {
        throw new Error('The Undo receipt does not match the operation log');
      }
      if (undoOf.kind !== 'move-blocks' && undoOf.kind !== 'reparent-page') {
        throw new Error(`The sidecar adapter cannot undo ${undoOf.kind}; run the inverse transfer instead`);
      }
      const build = (): Promise<SidecarTransferPlan> => buildUndoPlan(original, undoOf);
      const { record, resumed } = await open(request.operationId, canonical(['undo', request]), build);

      if (record.undoReceipt) {
        return record.undoReceipt;
      }
      const steps = await saga(record).drive(resumed);
      const receipt: PageTransferUndoReceipt = {
        operationId: request.operationId,
        undoOfOperationId: undoOf.operationId,
        undoToken: undoOf.undoToken,
        durability: { kind: 'saga', steps },
      };

      record.undoReceipt = receipt;
      await log.put(record);

      return receipt;
    },
  };
}
