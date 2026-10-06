// @vitest-environment node
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSidecarTransferHost } from '../../../src/view';
import type {
  PageTransferReceipt,
  PageTransferRequest,
  SidecarFetch,
  SidecarTransferLog,
  SidecarTransferRecord,
} from '../../../src/view';
import type { OutputBlockData } from '../../../types';
import { FakeSidecar } from './page-transfer-sidecar-fixture';

/**
 * Seeded interleavings of transfers, retries, overlapping runs, faults and
 * peer edits. Invariant: every block ever seen, and every peer edit token, is
 * still in some page. Peers never delete, and never touch a page body being
 * turned into blocks, inside the documented window (a page read whose write
 * has not landed yet).
 */
beforeEach(() => {
  vi.clearAllMocks();
  // WebCrypto resolves on a thread pool, so its timing would reorder the
  // interleavings. The same hash, resolved as a microtask, keeps seeds stable.
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation((_algorithm, data) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const digest = createHash('sha256').update(bytes).digest();

    return Promise.resolve(digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength));
  });
});
afterEach(() => vi.restoreAllMocks());

const DOCS = ['source', 'target', 'other', 'np', 'parent', 'child'];

const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;

    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/** A consistent log, or one that sometimes serves an older version or nothing. */
const makeLog = (stale: boolean, random: () => number): SidecarTransferLog => {
  const history = new Map<string, SidecarTransferRecord[]>();

  return {
    get: (operationId) => {
      const versions = history.get(operationId) ?? [];
      const pick = stale && random() < 0.5
        ? Math.floor(random() * (versions.length + 1))
        : versions.length - 1;
      const version = versions[pick];

      return version === undefined ? undefined : structuredClone(version);
    },
    put: (record) => {
      history.set(record.operationId, [...history.get(record.operationId) ?? [], structuredClone(record)]);
    },
  };
};

interface World {
  server: FakeSidecar;
  random: () => number;
  ids: Set<string>;
  tokens: Array<{ id: string; token: string }>;
  /** A fresh number for each peer action. */
  next: () => number;
  deleted: Set<string>;
  /** Per host instance: its last request, while a read has not been followed by a write. */
  last: Map<string, string>;
  deletes: boolean;
  tib: boolean;
}

/** turn-into-blocks removed the pointer: the host retires the page body. */
const retired = (world: World): boolean => world.tib && !world.server.ids('parent').includes('ptr');

const textOf = (value: unknown): string => typeof value === 'string' ? value : '';

/** Marks what a peer deletion removed from every page, so the check does not blame the transfer. */
const recordDeletion = (world: World, before: OutputBlockData[], doomed: string[]): void => {
  const after = DOCS.flatMap((name) => world.server.document(name).blocks);
  const tokensOf = (id: string): string[] => textOf(before.find((entry) => entry.id === id)?.data.text).split('|');
  const survives = (id: string, token: string): boolean =>
    after.some((entry) => entry.id === id && textOf(entry.data.text).split('|').includes(token));

  doomed.filter((id) => !after.some((entry) => entry.id === id)).forEach((id) => world.deleted.add(id));
  doomed.forEach((id) => tokensOf(id)
    .filter((token) => !survives(id, token))
    .forEach((token) => world.deleted.add(`${id}|${token}`)));
};

const peerAct = (world: World): void => {
  const doc = DOCS[Math.floor(world.random() * DOCS.length)] ?? 'source';
  const present = world.server.document(doc).blocks;
  const roll = world.random();
  const windowOpen = [...world.last.values()].includes(`GET ${doc}`);

  const counter = world.next();

  // A body inside its window, or retired once its pointer is gone, takes no peer writes.
  if (doc === 'child' && (windowOpen || retired(world))) {
    return;
  }
  if (world.deletes && roll < 0.12 && present.length > 0 && !windowOpen) {
    const block = present[Math.floor(world.random() * present.length)];

    // Deleting a page pointer is a page deletion, which the host owns.
    if (block?.type === 'page') {
      return;
    }
    const subtree = (id: string): string[] =>
      [id, ...(present.find((entry) => entry.id === id)?.content ?? []).flatMap(subtree)];
    const doomed = subtree(block?.id ?? '');

    world.server.peerRemove(doc, block?.id ?? '');
    recordDeletion(world, present, doomed);

    return;
  }
  const target = present[Math.floor(world.random() * present.length)];

  if (roll < 0.6 && target && target.type !== 'page') {
    const token = `T${counter}`;

    world.server.peerEdit(doc, target.id ?? '', `${textOf(target.data.text)}|${token}`);
    world.tokens.push({ id: target.id ?? '', token });
  } else if (roll < 0.8 && target && target.type !== 'page') {
    const id = `p${counter}`;

    world.server.peerInsertChild(doc, target.id ?? '', { id, type: 'paragraph', data: { text: id } });
    world.ids.add(id);
  } else if (roll >= 0.8) {
    const id = `p${counter}`;

    world.server.peerInsertRoot(doc, { id, type: 'paragraph', data: { text: id } });
    world.ids.add(id);
  }
};

/** Problems not explained by a peer deletion. A retired body is dropped by the host. */
const check = (world: World): string[] => {
  const all = DOCS.filter((doc) => doc !== 'child' || !retired(world)).flatMap((doc) => world.server.document(doc).blocks);
  const problems: string[] = [];

  for (const id of world.ids) {
    if (!world.deleted.has(id) && !all.some((block) => block.id === id)) {
      problems.push(`block ${id} is gone`);
    }
  }
  for (const { id, token } of world.tokens) {
    if (!world.deleted.has(id) && !world.deleted.has(`${id}|${token}`) &&
        !all.some((block) => block.id === id && textOf(block.data.text).split('|').includes(token))) {
      problems.push(`edit ${token} on ${id} is gone`);
    }
  }

  return problems;
};

const KINDS = ['move', 'move', 'move2', 'tip', 'tib', 'undo'] as const;
const FAULTS = ['drop', 'lose-response', 'commit-then-504', 403, 412, 413, 422, 503] as const;

const forwardRequest = (kind: typeof KINDS[number]): PageTransferRequest => {
  if (kind === 'tip') {
    return { kind: 'turn-into-page', operationId: 'op', sourcePageId: 'source', targetPageId: 'np', rootIds: ['a'], pointerId: 'pp' };
  }
  if (kind === 'tib') {
    return { kind: 'turn-into-blocks', operationId: 'op', sourcePageId: 'child', targetPageId: 'parent', pointerId: 'ptr' };
  }

  return {
    kind: 'move-blocks',
    operationId: 'op',
    sourcePageId: 'source',
    targetPageId: 'target',
    rootIds: kind === 'move2' ? ['a', 'b'] : ['a'],
    place: { parentId: null, afterId: 't' },
  };
};

const runSeed = async (seed: number, deletes: boolean): Promise<{ problems: string[]; scenario: string }> => {
  const random = rng(seed);
  const server = new FakeSidecar();
  const kind = KINDS[Math.floor(random() * KINDS.length)] ?? 'move';
  const counter = { value: 0 };
  const world: World = {
    server,
    random,
    ids: new Set(),
    tokens: [],
    next: () => {
      counter.value += 1;

      return counter.value;
    },
    deleted: new Set(),
    last: new Map(),
    deletes,
    tib: kind === 'tib',
  };
  const stale = random() < 0.5;
  const separate = random() < 0.3;
  const sharedLog = makeLog(stale, random);
  const pending: Array<Promise<unknown>> = [];
  const extra: Array<() => Promise<unknown>> = [];
  let extraStarts = 2;
  let faultBudget = 3;
  let instances = 0;

  server.seed('source', [
    { id: 'a', type: 'toggle', data: { text: 'A' }, content: ['a1'] },
    { id: 'a1', type: 'paragraph', parent: 'a', data: { text: 'A1' } },
    { id: 'b', type: 'paragraph', data: { text: 'B' } },
  ]);
  server.seed('target', [{ id: 't', type: 'paragraph', data: { text: 'T' } }]);
  server.seed('other', [{ id: 'o', type: 'paragraph', data: { text: 'O' } }]);
  server.seed('np', []);
  server.seed('parent', [
    { id: 'x', type: 'paragraph', data: { text: 'X' } },
    { id: 'ptr', type: 'page', data: { pageId: 'child' } },
  ]);
  server.seed('child', [
    { id: 'c1', type: 'toggle', data: { text: 'C1' }, content: ['c2'] },
    { id: 'c2', type: 'paragraph', parent: 'c1', data: { text: 'C2' } },
  ]);
  ['a', 'a1', 'b', 't', 'o', 'x', 'c1', 'c2'].forEach((id) => world.ids.add(id));

  server.onEdit(() => {
    if (faultBudget > 0 && random() < 0.15) {
      faultBudget -= 1;
      const fault = FAULTS[Math.floor(random() * FAULTS.length)] ?? 403;

      return typeof fault === 'number' ? { refuse: fault } : fault;
    }

    return undefined;
  });

  const forward = forwardRequest(kind);
  const maxEditBytes = random() < 0.3 ? 300 : undefined;

  const host = (base: string, log: SidecarTransferLog): ReturnType<typeof createSidecarTransferHost> => {
    instances += 1;
    const label = `${base}${instances}`;
    const fetch: SidecarFetch = async (url, init) => {
      for (let wait = Math.floor(random() * 3); wait > 0; wait -= 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (base !== 'pre' && random() < 0.35) {
        peerAct(world);
      }
      const start = extra[Math.floor(random() * extra.length)];

      if (extraStarts > 0 && start && random() < 0.15) {
        extraStarts -= 1;
        pending.push(start());
      }
      world.last.set(label, `${init.method} ${decodeURIComponent(url.replace(/^.*sync\//, '').split('/')[0] ?? '')}`);
      try {
        return await server.fetch(url, init);
      } finally {
        if (init.method === 'POST') {
          world.last.delete(label);
        }
      }
    };
    const made = createSidecarTransferHost({
      baseUrl: 'https://sidecar.test/api/blok',
      ticketFor: (doc, access) => `ticket:${doc}:${access.write ? 'write' : 'read'}`,
      log,
      fetch,
      maxEditBytes,
    });

    return {
      mode: made.mode,
      run: (request) => made.run(request).finally(() => world.last.delete(label)),
      undo: (request) => made.undo(request).finally(() => world.last.delete(label)),
    };
  };
  const settle = (promise: Promise<unknown>): Promise<unknown> => promise.catch(() => undefined);

  if (kind === 'undo') {
    faultBudget = 0;
    const receipt = await host('pre', sharedLog).run(forward).catch(() => undefined);

    if (!receipt) {
      return { problems: check(world), scenario: 'undo-pre-failed' };
    }
    faultBudget = 3;
    const undo = { operationId: 'undo-1', undoOf: receipt };
    const rival: PageTransferRequest = random() < 0.5
      ? { kind: 'move-blocks', operationId: 'rival', sourcePageId: 'target', targetPageId: 'other', rootIds: ['a'], place: { parentId: null, afterId: 'o' } }
      : { kind: 'move-blocks', operationId: 'rival', sourcePageId: 'target', targetPageId: 'source', rootIds: ['a'], place: { parentId: null, afterId: 'b' } };

    extra.push(() => settle(host('B', separate ? makeLog(stale, random) : sharedLog).undo(undo)));
    extra.push(() => settle(host('R', sharedLog).run(rival)));
    await settle(host('A', sharedLog).undo(undo));
    for (let retry = 0; retry < 3; retry += 1) {
      await settle(host('U', sharedLog).undo(undo));
    }
  } else {
    extra.push(() => settle(host('B', separate ? makeLog(stale, random) : sharedLog).run(forward)));
    await settle(host('A', sharedLog).run(forward));
    for (let retry = 0; retry < 3; retry += 1) {
      await settle(host('Z', sharedLog).run(forward));
    }
  }
  while (pending.length > 0) {
    await Promise.all(pending.splice(0));
  }

  return {
    problems: check(world),
    scenario: `${kind} stale=${String(stale)} separate=${String(separate)} chunks=${String(maxEditBytes ?? 'big')}`,
  };
};

const sweep = async (from: number, to: number, deletes: boolean): Promise<string[]> => {
  const failures: string[] = [];

  for (let seed = from; seed <= to; seed += 1) {
    const { problems, scenario } = await runSeed(seed, deletes);

    if (problems.length > 0) {
      failures.push(`seed ${seed} [${scenario}]: ${problems.join('; ')}`);
    }
  }

  return failures;
};

describe('sidecar transfer fuzz', () => {
  it('loses nothing over 300 seeds without peer deletions', async () => {
    expect(await sweep(1, 300, false)).toEqual([]);
  }, 60_000);

  it('loses nothing outside the window over 300 seeds with peer deletions', async () => {
    expect(await sweep(301, 600, true)).toEqual([]);
  }, 60_000);
});

export type { PageTransferReceipt };
