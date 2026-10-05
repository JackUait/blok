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

export interface SidecarTransferPlan {
  copyDoc: string;
  copyHead: SidecarDocHead;
  copyChunks: SidecarEditOp[][];
  originDoc: string;
  originHead: SidecarDocHead;
  originOps: SidecarEditOp[];
  /** Ops that put back what the copy step removed (the pointer of turn-into-blocks). */
  restoreOps: SidecarEditOp[];
  rootIds: string[];
  restore?: SidecarRootPlacement[];
  destination?: PageBlockPlacement;
}

export interface SidecarTransferRecord {
  version: 1;
  operationId: string;
  digest: string;
  attempt: number;
  compensationTry: number;
  plan: SidecarTransferPlan;
  copySteps: PageTransferSagaStep[];
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
  /** How many fresh attempts to make when a peer edits the source mid-transfer. */
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

const copyLeft = (doc: string): Error =>
  new Error(`The copy in "${doc}" was left in place: it changed or could not be removed. Both pages keep the blocks`);

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

/** True while every inserted block still present is exactly what this transfer wrote, with no foreign children. */
const isIntactCopy = (inserted: InsertOp[], current: Map<string, OutputBlockData>): boolean =>
  inserted.filter((op) => current.has(op.id)).every((op) => {
    const block = current.get(op.id);
    const children = inserted
      .filter((child) => child.parent === op.id && current.has(child.id))
      .map((child) => child.id);

    return block !== undefined &&
      block.type === op.block.type &&
      same(block.data, op.block.data) &&
      same(block.tunes ?? null, op.block.tunes ?? null) &&
      (block.parent ?? null) === op.parent &&
      same(block.content ?? [], children);
  });

interface DocState {
  data: OutputData;
  head: SidecarDocHead;
}

interface SagaIo {
  log: SidecarTransferLog;
  maxAttempts: number;
  readState(doc: string): Promise<DocState>;
  edit(doc: string, key: string, ops: SidecarEditOp[], ifMatch: SidecarDocHead | null): Promise<PageTransferSagaStep | Refused>;
  key(record: SidecarTransferRecord, role: string, index: number): Promise<string>;
}

const sameLineage = (found: { lineage: string }, head: SidecarDocHead, doc: string): void => {
  if (found.lineage !== head.lineage) {
    throw lineageChanged(doc);
  }
};

/**
 * Drives one logged record. A resumed record is replayed with its stored
 * bodies and keys until the server gives a definite answer; only a definite
 * 412 rebuilds the plan. Rebuilding on resume would compensate a copy whose
 * source removal may already have committed — deleting the only copy.
 */
class Saga {
  public constructor(
    private readonly io: SagaIo,
    private readonly record: SidecarTransferRecord,
    private readonly build: () => Promise<SidecarTransferPlan>
  ) {}

  public async drive(resumed: boolean): Promise<PageTransferSagaStep[]> {
    if (resumed) {
      const { plan } = this.record;
      const [copy, origin] = await Promise.all([this.io.readState(plan.copyDoc), this.io.readState(plan.originDoc)]);

      sameLineage(copy.head, plan.copyHead, plan.copyDoc);
      sameLineage(origin.head, plan.originHead, plan.originDoc);
    }

    return this.attempt();
  }

  private async attempt(): Promise<PageTransferSagaStep[]> {
    const { record } = this;
    const { plan } = record;

    if (!await this.copy()) {
      await this.nextAttempt(plan.copyDoc);

      return this.attempt();
    }
    if (plan.originOps.length === 0) {
      return [...record.copySteps];
    }
    const outcome = await this.io.edit(plan.originDoc, await this.io.key(record, 'origin', 0), plan.originOps, plan.originHead);

    if (!(outcome instanceof Refused)) {
      sameLineage(outcome, plan.originHead, plan.originDoc);

      return [...record.copySteps, outcome];
    }
    if (outcome.head) {
      sameLineage(outcome.head, plan.originHead, plan.originDoc);
    }
    await this.compensate();
    if (outcome.status !== 412) {
      throw new Error(`"${plan.originDoc}" refused the removal with HTTP ${outcome.status}; it was left intact`);
    }
    await this.nextAttempt(plan.originDoc);

    return this.attempt();
  }

  /** False when the first chunk met a stale head, so nothing was applied. */
  private async copy(): Promise<boolean> {
    const { record } = this;
    const { plan } = record;
    const pending = plan.copyChunks
      .map((ops, index) => ({ ops, index }))
      .slice(record.copySteps.length);

    for (const { ops, index } of pending) {
      const outcome = await this.io.edit(
        plan.copyDoc,
        await this.io.key(record, 'copy', index),
        ops,
        index === 0 ? plan.copyHead : null
      );

      if (outcome instanceof Refused) {
        return this.copyRefused(outcome, index);
      }
      sameLineage(outcome, plan.copyHead, plan.copyDoc);
      record.copySteps.push(outcome);
      await this.io.log.put(record);
    }

    return true;
  }

  private async copyRefused(outcome: Refused, index: number): Promise<false> {
    const { plan } = this.record;

    if (outcome.head) {
      sameLineage(outcome.head, plan.copyHead, plan.copyDoc);
    }
    if (index === 0 && outcome.status === 412) {
      return false;
    }
    if (index > 0) {
      await this.compensate();
    }
    throw new Error(`"${plan.copyDoc}" refused the copy with HTTP ${outcome.status}; the source was left intact`);
  }

  /** Removes the copy only while it is exactly what this transfer inserted. */
  private async compensate(): Promise<void> {
    const { record } = this;
    const { plan } = record;

    if (record.compensationTry >= this.io.maxAttempts) {
      throw copyLeft(plan.copyDoc);
    }
    await this.io.log.put(record);
    const state = await this.io.readState(plan.copyDoc);

    sameLineage(state.head, plan.copyHead, plan.copyDoc);
    const inserted = plan.copyChunks.flat().filter((op): op is InsertOp => op.op === 'insert');
    const insertedIds = new Set(inserted.map((op) => op.id));
    const current = new Map(state.data.blocks.map((block) => [block.id ?? '', block]));

    if (!isIntactCopy(inserted, current)) {
      throw copyLeft(plan.copyDoc);
    }
    const roots = inserted
      .filter((op) => current.has(op.id) && (op.parent === null || !insertedIds.has(op.parent)))
      .map((op) => op.id);
    const ops = [...removeOps(roots), ...plan.restoreOps.filter((op) => !current.has(op.id))];

    if (ops.length === 0) {
      return;
    }
    const outcome = await this.io.edit(plan.copyDoc, await this.io.key(record, 'compensate', record.compensationTry), ops, state.head);

    if (!(outcome instanceof Refused)) {
      return;
    }
    if (outcome.status !== 412) {
      throw copyLeft(plan.copyDoc);
    }
    record.compensationTry += 1;

    return this.compensate();
  }

  private async nextAttempt(changedDoc: string): Promise<void> {
    const { record } = this;

    if (record.attempt >= this.io.maxAttempts) {
      throw new Error(`The source was left intact: "${changedDoc}" changed during the transfer on every attempt`);
    }
    record.plan = await this.build();
    record.attempt += 1;
    record.compensationTry = 0;
    record.copySteps = [];
    await this.io.log.put(record);
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

  const key = async (record: SidecarTransferRecord, role: string, index: number): Promise<string> => {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical([record.operationId, record.attempt, role, index]))
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

  const saga = (record: SidecarTransferRecord, build: () => Promise<SidecarTransferPlan>): Saga =>
    new Saga({ log, maxAttempts, readState, edit, key }, record, build);

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
      attempt: 1,
      compensationTry: 0,
      plan: await build(),
      copySteps: [],
    };

    await log.put(record);

    return { record, resumed: false };
  };

  const finishPlan = (
    plan: Omit<SidecarTransferPlan, 'copyChunks'> & { copyOps: SidecarEditOp[] }
  ): SidecarTransferPlan => {
    const { copyOps, ...rest } = plan;

    if (byteLength(JSON.stringify({ ops: plan.originOps })) > maxEditBytes ||
        byteLength(JSON.stringify({ ops: [...removeOps(plan.rootIds), ...plan.restoreOps] })) > maxEditBytes) {
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
          restoreOps: [],
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
          restoreOps: [],
          rootIds: [...request.rootIds],
        });
      }
      case 'turn-into-blocks': {
        // The source is the page being emptied; the target holds its pointer.
        const turned = turnPageIntoBlocks(target.data, request.pointerId, {
          pageId: request.sourcePageId,
          body: source.data,
        });
        const roots = rootsOf(source.data);

        return finishPlan({
          copyDoc: request.targetPageId,
          copyHead: target.head,
          copyOps: [...removeOps([request.pointerId]), ...insertOps(turned.source, turned.movedIds)],
          originDoc: request.sourcePageId,
          originHead: source.head,
          originOps: removeOps(roots),
          restoreOps: insertOps(target.data, [request.pointerId]),
          rootIds: roots,
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
      restoreOps: [],
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
      const steps = await saga(record, build).drive(resumed);
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
      const steps = await saga(record, build).drive(resumed);
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
