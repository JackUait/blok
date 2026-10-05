import type { OutputBlockData, OutputData } from '../../../types';

/**
 * A strict in-memory model of the collab sidecar's /edit and /state routes,
 * with an optional operation journal. Client bugs must fail here, so it
 * checks the If-Match format, key length, key reuse and op shape.
 */

interface FakeDoc {
  blocks: OutputBlockData[];
  lineage: string;
  sequence: number;
}

interface CommittedKey {
  digest: string;
  lineage: string;
  sequence: number;
}

export interface FakeEditRequest {
  doc: string;
  key: string;
  ifMatch: string | null;
  ops: unknown[];
  authorization: string | null;
}

type EditHook = (request: FakeEditRequest) => 'drop' | 'lose-response' | 'commit-then-504' | { refuse: number } | void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const headerValue = (headers: unknown, name: string): string | null => {
  if (!isRecord(headers)) {
    return null;
  }
  const value = headers[name];

  return typeof value === 'string' ? value : null;
};

class Refusal extends Error {}

export class FakeSidecar {
  public journal = true;
  public readonly edits: FakeEditRequest[] = [];
  public readonly appliedEdits: FakeEditRequest[] = [];
  public stateReads = 0;
  private readonly docs = new Map<string, FakeDoc>();
  private readonly keys = new Map<string, CommittedKey>();
  private readonly hooks: EditHook[] = [];
  private lineageCounter = 0;

  public seed(doc: string, blocks: OutputBlockData[]): void {
    this.docs.set(doc, { blocks: structuredClone(blocks), lineage: this.mintLineage(), sequence: 1 });
  }

  public document(doc: string): OutputData {
    return { blocks: structuredClone(this.room(doc).blocks) };
  }

  public ids(doc: string): string[] {
    return this.room(doc).blocks.map((block) => block.id ?? '');
  }

  public onEdit(hook: EditHook): void {
    this.hooks.push(hook);
  }

  public peerEdit(doc: string, blockId: string, text: string): void {
    const room = this.room(doc);
    const block = room.blocks.find((entry) => entry.id === blockId);

    if (!block) {
      throw new Error('Block missing');
    }
    block.data = { ...block.data, text };
    room.sequence += 1;
  }

  public peerInsertChild(doc: string, parentId: string, child: OutputBlockData): void {
    const room = this.room(doc);

    room.blocks = this.apply(room.blocks, [{
      op: 'insert',
      id: child.id,
      block: { id: child.id, type: child.type, data: child.data },
      parent: parentId,
      after: null,
    }]);
    room.sequence += 1;
  }

  public peerInsertRoot(doc: string, block: OutputBlockData): void {
    const room = this.room(doc);

    room.blocks = this.apply(room.blocks, [{
      op: 'insert',
      id: block.id,
      block: { id: block.id, type: block.type, data: block.data },
      parent: null,
      after: null,
    }]);
    room.sequence += 1;
  }

  public peerRemove(doc: string, blockId: string): void {
    const room = this.room(doc);

    room.blocks = this.apply(room.blocks, [{ op: 'remove', id: blockId }]);
    room.sequence += 1;
  }

  /** The journal was replaced: a new lineage and no memory of old keys. */
  public resetLineage(doc: string): void {
    const room = this.room(doc);

    room.lineage = this.mintLineage();
    room.sequence = 1;
    for (const key of [...this.keys.keys()]) {
      if (key.startsWith(`${doc}\n`)) {
        this.keys.delete(key);
      }
    }
  }

  public readonly fetch = async (url: string, init: { method: string; headers?: unknown; body?: string }): Promise<Response> => {
    const match = /^https:\/\/sidecar\.test\/api\/blok\/sync\/([^/]+)\/(edit|state)$/.exec(url);

    if (!match) {
      return new Response('not found\n', { status: 404 });
    }
    const doc = decodeURIComponent(match[1]);
    const authorization = headerValue(init.headers, 'Authorization');

    if (authorization !== `Bearer ticket:${doc}:${match[2] === 'edit' ? 'write' : 'read'}`) {
      return new Response('missing pass\n', { status: 401 });
    }

    if (match[2] === 'state') {
      if (init.method !== 'GET') {
        return new Response('method\n', { status: 405 });
      }

      return this.state(doc);
    }
    if (init.method !== 'POST') {
      return new Response('method\n', { status: 405 });
    }

    return this.edit(doc, init.headers, init.body ?? '', authorization);
  };

  private state(doc: string): Response {
    this.stateReads += 1;
    const room = this.room(doc);
    const headers = new Headers({ 'Content-Type': 'application/json' });

    if (this.journal) {
      headers.set('Blok-Doc-Lineage', room.lineage);
      headers.set('Blok-Doc-Sequence', String(room.sequence));
      headers.set('ETag', `"${room.lineage}:${room.sequence}"`);
    }

    return new Response(JSON.stringify({ time: 1, blocks: room.blocks }), { status: 200, headers });
  }

  private edit(doc: string, headers: unknown, body: string, authorization: string): Response {
    const key = headerValue(headers, 'Blok-Idempotency-Key');
    const ifMatch = headerValue(headers, 'If-Match');

    if (key === null || key.length < 1 || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
      return new Response('a valid Blok-Idempotency-Key header is required\n', { status: 400 });
    }

    let ops: unknown[];

    try {
      const parsed: unknown = JSON.parse(body);

      if (!isRecord(parsed) || !Array.isArray(parsed.ops) || parsed.ops.length === 0) {
        throw new Refusal('ops');
      }
      ops = parsed.ops;
    } catch {
      return new Response('bad body\n', { status: 422 });
    }

    const request: FakeEditRequest = { doc, key, ifMatch, ops, authorization };
    const outcome = this.hooks.map((hook) => hook(request)).find((result) => result !== undefined);

    this.edits.push(request);
    if (outcome === 'drop') {
      throw new TypeError('fetch failed');
    }
    if (isRecord(outcome)) {
      return new Response('refused\n', { status: outcome.refuse });
    }

    const response = this.commit(doc, request, body);

    if (outcome === 'lose-response') {
      throw new TypeError('fetch failed');
    }
    if (outcome === 'commit-then-504') {
      return new Response('gateway timeout\n', { status: 504 });
    }

    return response;
  }

  private commit(doc: string, request: FakeEditRequest, body: string): Response {
    const room = this.room(doc);
    const journalKey = `${doc}\n${request.key}`;
    // Like EditEndpoint: the tag shape is checked before the journal lookup, the head after it.
    const head = request.ifMatch === null ? null : /^"([0-9a-z]+):(\d+)"$/.exec(request.ifMatch);

    if (request.ifMatch !== null && !head) {
      return new Response('malformed If-Match\n', { status: 400 });
    }
    const prior = this.journal ? this.keys.get(journalKey) : undefined;

    if (prior) {
      if (prior.digest !== body) {
        return new Response('the idempotency key was already used for a different edit\n', { status: 409 });
      }

      return this.receipt(prior.lineage, prior.sequence);
    }

    if (head) {
      if (!this.journal) {
        return new Response('precondition needs a journal\n', { status: 428 });
      }
      if (head[1] !== room.lineage || Number(head[2]) !== room.sequence) {
        return new Response('precondition failed\n', {
          status: 412,
          headers: { 'Blok-Doc-Lineage': room.lineage, 'Blok-Doc-Sequence': String(room.sequence) },
        });
      }
    }

    try {
      room.blocks = this.apply(room.blocks, request.ops);
    } catch (error) {
      return new Response(`${error instanceof Error ? error.message : 'invalid'}\n`, { status: 422 });
    }
    room.sequence += 1;
    this.appliedEdits.push(request);

    if (!this.journal) {
      return new Response(null, { status: 204 });
    }
    this.keys.set(journalKey, { digest: body, lineage: room.lineage, sequence: room.sequence });

    return this.receipt(room.lineage, room.sequence);
  }

  private receipt(lineage: string, sequence: number): Response {
    return new Response(null, {
      status: 204,
      headers: { 'Blok-Doc-Lineage': lineage, 'Blok-Doc-Sequence': String(sequence) },
    });
  }

  private apply(current: OutputBlockData[], ops: unknown[]): OutputBlockData[] {
    const blocks = structuredClone(current);

    for (const op of ops) {
      if (!isRecord(op)) {
        throw new Refusal('op must be an object');
      }
      if (op.op === 'remove' && typeof op.id === 'string' && Object.keys(op).length === 2) {
        this.remove(blocks, op.id);
      } else if (op.op === 'insert') {
        this.insert(blocks, op);
      } else {
        throw new Refusal('unknown op');
      }
    }

    return blocks;
  }

  private remove(blocks: OutputBlockData[], id: string): void {
    const index = blocks.findIndex((block) => block.id === id);
    const block = blocks[index];

    if (!block) {
      throw new Refusal(`no block ${id}`);
    }
    for (const childId of block.content ?? []) {
      this.remove(blocks, childId);
    }
    blocks.splice(blocks.findIndex((entry) => entry.id === id), 1);
    const parent = blocks.find((entry) => entry.id === block.parent);

    if (parent?.content) {
      parent.content = parent.content.filter((childId) => childId !== id);
    }
  }

  private insert(blocks: OutputBlockData[], op: Record<string, unknown>): void {
    const allowed = new Set(['op', 'id', 'block', 'after', 'parent']);
    const blockAllowed = new Set(['id', 'type', 'data', 'tunes', 'lastEditedAt', 'lastEditedBy']);
    const { id, block, after, parent } = op;

    if (Object.keys(op).some((key) => !allowed.has(key)) ||
        typeof id !== 'string' || !isRecord(block) ||
        Object.keys(block).some((key) => !blockAllowed.has(key)) ||
        (block.id !== undefined && block.id !== id) ||
        typeof block.type !== 'string' || !isRecord(block.data) ||
        (after !== null && after !== undefined && typeof after !== 'string') ||
        (parent !== null && parent !== undefined && typeof parent !== 'string')) {
      throw new Refusal('bad insert');
    }
    if (blocks.some((entry) => entry.id === id)) {
      throw new Refusal(`block ${id} exists`);
    }

    const created: OutputBlockData = { id, type: block.type, data: block.data };

    if (isRecord(block.tunes)) {
      created.tunes = block.tunes;
    }
    const afterId = typeof after === 'string' ? after : null;

    if (typeof parent === 'string') {
      const owner = blocks.find((entry) => entry.id === parent);

      if (!owner) {
        throw new Refusal('parent missing');
      }
      const content = owner.content ?? [];
      const at = afterId === null ? 0 : content.indexOf(afterId) + 1;

      if (afterId !== null && at === 0) {
        throw new Refusal('after is not a child');
      }
      created.parent = parent;
      owner.content = [...content.slice(0, at), id, ...content.slice(at)];
      blocks.push(created);

      return;
    }

    if (afterId === null) {
      blocks.unshift(created);

      return;
    }
    const sibling = blocks.findIndex((entry) => entry.id === afterId && !entry.parent);

    if (sibling < 0) {
      throw new Refusal('after is not a root');
    }
    blocks.splice(sibling + 1, 0, created);
  }

  private room(doc: string): FakeDoc {
    const existing = this.docs.get(doc);

    if (existing) {
      return existing;
    }
    const created: FakeDoc = { blocks: [], lineage: this.mintLineage(), sequence: 1 };

    this.docs.set(doc, created);

    return created;
  }

  private mintLineage(): string {
    this.lineageCounter += 1;

    return `lineage${this.lineageCounter}`;
  }
}
