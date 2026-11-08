// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConfigError } from '../../../src/mcp/config';
import { createFilesHandleStore } from '../../../src/mcp/handle-store-files';
import { createMemoryHandleStore } from '../../../src/mcp/handle-store';
import type { BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore } from '../../../src/mcp/options';

const record = (principal: string, overrides: Partial<BlokMcpHandleRecord> = {}): BlokMcpHandleRecord => ({
  v: 1,
  contractRevision: 'c1',
  principal,
  clientName: 'client',
  scopes: null,
  actor: { id: `agent:${principal}`, name: 'client', kind: 'agent', onBehalfOf: principal },
  documentId: 'doc',
  write: true,
  version: 'v1',
  stale: false,
  document: { blocks: [] },
  history: { past: [], future: [], revision: 'r' },
  ...overrides,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const leaseOf = async (store: BlokMcpHandleStore, handle: string, idleMs = 60_000, timeoutMs = 1_000): Promise<BlokMcpHandleLease> => {
  const lease = await store.acquire(handle, idleMs, timeoutMs);

  if (typeof lease === 'string') {
    throw new Error(`no lease on ${handle}: ${lease}`);
  }

  return lease;
};

interface Flavour {
  name: string;
  /** Two views of one store, as two processes would have. */
  make(): { a: BlokMcpHandleStore; b: BlokMcpHandleStore };
}

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'blok-handle-store-'));

  dirs.push(dir);

  return dir;
};

const flavours: Flavour[] = [
  {
    name: 'memory',
    make: () => {
      const store = createMemoryHandleStore();

      return { a: store, b: store };
    },
  },
  {
    name: 'files',
    make: () => {
      const dir = tempDir();

      return { a: createFilesHandleStore(dir), b: createFilesHandleStore(dir) };
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe.each(flavours)('the $name handle store contract', (flavour) => {
  it('adds a record that the other side leases back as it was', async () => {
    const { a, b } = flavour.make();

    expect(await a.tryAdd('h1', record('alice'), 8, 60_000)).toBe(true);
    const lease = await leaseOf(b, 'h1');

    expect(lease.record).toEqual(record('alice'));
    await lease.release();
  });

  it('counts per principal, and refuses an add at the cap without adding', async () => {
    const { a, b } = flavour.make();

    expect(await a.tryAdd('h1', record('alice'), 2, 60_000)).toBe(true);
    expect(await b.tryAdd('h2', record('alice'), 2, 60_000)).toBe(true);
    expect(await a.tryAdd('h3', record('alice'), 2, 60_000)).toBe(false);
    expect(await b.tryAdd('h4', record('bob'), 2, 60_000)).toBe(true);
    expect(await a.count('alice', 60_000)).toBe(2);
    expect(await b.count('bob', 60_000)).toBe(1);
    expect(await a.acquire('h3', 60_000, 100)).toBe('unknown');
  });

  it('refuses every add when the cap is zero', async () => {
    const { a } = flavour.make();

    expect(await a.tryAdd('h1', record('alice'), 0, 60_000)).toBe(false);
    expect(await a.count('alice', 60_000)).toBe(0);
  });

  it('counts and adds as one step: concurrent adds from both sides never pass the cap', async () => {
    const { a, b } = flavour.make();
    const added = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      (index % 2 === 0 ? a : b).tryAdd(`h${index}`, record('alice'), 3, 60_000)));

    expect(added.filter(Boolean)).toHaveLength(3);
    expect(await a.count('alice', 60_000)).toBe(3);
  });

  it.each([['nope'], [''], ['../escape'], ['a/b'], ['.'], ['x'.repeat(200)]])('answers unknown for the handle %j', async (handle) => {
    const { a } = flavour.make();

    expect(await a.acquire(handle, 60_000, 100)).toBe('unknown');
  });

  it('leases one call at a time across both sides, and says busy at the timeout', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const first = await leaseOf(a, 'h1');

    expect(await b.acquire('h1', 60_000, 150)).toBe('busy');
    const waiting = b.acquire('h1', 60_000, 5_000);

    await sleep(50);
    await first.save(record('alice', { version: 'v2' }));
    await first.release();
    const second = await waiting;

    expect(typeof second).toBe('object');
    expect(typeof second === 'object' && second.record.version).toBe('v2');
    if (typeof second === 'object') {
      await second.release();
    }
  });

  it('keeps a record of several megabytes', async () => {
    const { a, b } = flavour.make();
    const big = record('alice', { history: { past: [{ blocks: [{ id: 'p', type: 'paragraph', data: { text: 'ж'.repeat(3_000_000) } }] }], future: [], revision: 'r' } });

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const lease = await leaseOf(a, 'h1');

    await lease.save(big);
    await lease.release();
    const again = await leaseOf(b, 'h1');

    expect(again.record).toEqual(big);
    await again.release();
  });

  it('expires a handle idle past idleMs: unknown, and no longer counted', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 80);
    await sleep(200);
    expect(await b.count('alice', 80)).toBe(0);
    expect(await b.acquire('h1', 80, 100)).toBe('unknown');
    expect(await a.tryAdd('h2', record('alice'), 1, 80)).toBe(true);
  });

  it('never expires a leased handle, and restarts its idle time at release', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 120);
    const lease = await leaseOf(a, 'h1', 120);

    await sleep(300);
    expect(await b.count('alice', 120)).toBe(1);
    expect(await b.acquire('h1', 120, 50)).toBe('busy');
    await lease.release();
    await sleep(60);
    const again = await leaseOf(b, 'h1', 120);

    await again.release();
  });

  it('forgets a handle its lease removes, and the ended lease no longer saves', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const lease = await leaseOf(a, 'h1');

    await lease.remove();
    await lease.release();
    await expect(lease.save(record('alice', { version: 'v2' }))).rejects.toThrow(/lease/);
    expect(await b.acquire('h1', 60_000, 100)).toBe('unknown');
    expect(await b.count('alice', 60_000)).toBe(0);
  });

  it('refuses a save, and a remove, after the lease was released', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const lease = await leaseOf(a, 'h1');

    await lease.release();
    await expect(lease.save(record('alice', { version: 'v2' }))).rejects.toThrow(/lease/);
    await expect(lease.remove()).rejects.toThrow(/lease/);
    const again = await leaseOf(b, 'h1');

    expect(again.record.version).toBe('v1');
    await again.release();
  });

  it('wakes a waiting acquire when the holder removes the handle', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const lease = await leaseOf(a, 'h1');
    const waiting = b.acquire('h1', 60_000, 5_000);
    const started = Date.now();

    await sleep(50);
    await lease.remove();

    expect(await waiting).toBe('unknown');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('sweeps every idle handle that nobody leases, of every principal, and keeps the rest', async () => {
    const { a, b } = flavour.make();

    await a.tryAdd('idle', record('alice'), 8, 60_000);
    await a.tryAdd('held', record('bob'), 8, 60_000);
    const held = await leaseOf(a, 'held');

    await sleep(200);
    await a.tryAdd('fresh', record('carol'), 8, 60_000);
    await b.sweep(100);

    expect(await b.count('alice', 60_000)).toBe(0);
    expect(await b.count('bob', 60_000)).toBe(1);
    expect(await b.count('carol', 60_000)).toBe(1);
    await held.release();
    expect(await b.acquire('idle', 60_000, 100)).toBe('unknown');
    await (await leaseOf(b, 'fresh')).release();
  });
});

describe('the files handle store', () => {
  it('writes the record as JSON in <handle>.record.json and the owner and idle clock in <handle>.meta.json', async () => {
    const dir = tempDir();
    const store = createFilesHandleStore(dir);

    await store.tryAdd('h1', record('alice'), 8, 60_000);

    expect(JSON.parse(readFileSync(join(dir, 'h1.record.json'), 'utf8'))).toEqual(record('alice'));
    expect(JSON.parse(readFileSync(join(dir, 'h1.meta.json'), 'utf8'))).toEqual({ v: 1, principal: 'alice', lastUsedMs: expect.any(Number) as unknown });
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('makes the directory at start, and does not make it again once it is gone', async () => {
    const dir = join(tempDir(), 'nested', 'handles');
    const store = createFilesHandleStore(dir);

    expect(statSync(dir).isDirectory()).toBe(true);
    expect(await store.tryAdd('h1', record('alice'), 8, 60_000)).toBe(true);
    expect(existsSync(join(dir, 'h1.record.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    await expect(store.tryAdd('h2', record('alice'), 8, 60_000)).rejects.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it('keeps its files private: the directory it makes is 0700 and every file 0600', async () => {
    const dir = join(tempDir(), 'handles');
    const store = createFilesHandleStore(dir);

    await store.tryAdd('h1', record('alice'), 8, 60_000);
    const lease = await leaseOf(store, 'h1');

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const name of ['h1.record.json', 'h1.meta.json', 'h1.lease']) {
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
    }
    await lease.save(record('alice', { version: 'v2' }));
    await lease.release();
    expect(statSync(join(dir, 'h1.record.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'h1.meta.json')).mode & 0o777).toBe(0o600);
  });

  const unsafe = (dir: string): McpConfigError => new McpConfigError(
    `--handle-store directory ${dir} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)`,
  );

  it.skipIf(process.platform === 'win32').each([['group-writable', 0o770], ['world-writable', 0o707], ['group-readable', 0o750], ['world-readable', 0o705]])(
    'refuses to start on a %s directory',
    (_who, mode) => {
      const dir = tempDir();

      chmodSync(dir, mode);
      expect(() => createFilesHandleStore(dir)).toThrow(unsafe(dir));
    },
  );

  it.skipIf(process.platform === 'win32')('refuses to start on a link to a directory, and on a file', () => {
    const target = tempDir();
    const link = join(tempDir(), 'handles');
    const file = join(tempDir(), 'file');

    symlinkSync(target, link);
    writeFileSync(file, '');
    expect(() => createFilesHandleStore(link)).toThrow(unsafe(link));
    expect(() => createFilesHandleStore(file)).toThrow(unsafe(file));
  });

  it('refuses to start on Windows, before it makes the directory', () => {
    const dir = join(tempDir(), 'handles');

    expect(() => createFilesHandleStore(dir, { platform: 'win32' }))
      .toThrow(new McpConfigError('--handle-store files: is not supported on Windows; use your own store'));
    expect(existsSync(dir)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('refuses a directory another user owns, judged by the effective uid', () => {
    const dir = tempDir();
    const owner = statSync(dir).uid;

    expect(() => createFilesHandleStore(dir, { effectiveUid: () => owner + 1 })).toThrow(unsafe(dir));
    expect(() => createFilesHandleStore(dir, { effectiveUid: () => owner })).not.toThrow();
  });

  it('takes over a lease whose holder stopped refreshing it, and the old holder can no longer save', async () => {
    const dir = tempDir();
    const options = { leaseStaleMs: 200, heartbeatMs: 10_000 };
    const a = createFilesHandleStore(dir, options);
    const b = createFilesHandleStore(dir, options);

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const stuck = await leaseOf(a, 'h1');
    const past = new Date(Date.now() - 1_000);

    utimesSync(join(dir, 'h1.lease'), past, past);
    const taken = await leaseOf(b, 'h1', 60_000, 1_000);

    await expect(stuck.save(record('alice', { version: 'lost' }))).rejects.toThrow(/lease/);
    await stuck.release();
    expect(existsSync(join(dir, 'h1.lease'))).toBe(true);
    await taken.release();
    const after = await leaseOf(a, 'h1');

    expect(after.record.version).toBe('v1');
    await after.release();
  });

  it('refuses a remove from a holder whose lease was taken over, so the new holder keeps the handle', async () => {
    const dir = tempDir();
    const options = { leaseStaleMs: 200, heartbeatMs: 60_000 };
    const a = createFilesHandleStore(dir, options);
    const b = createFilesHandleStore(dir, options);

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const paused = await leaseOf(a, 'h1');

    await sleep(300);
    const taken = await leaseOf(b, 'h1');

    await expect(paused.save(record('alice', { version: 'lost' }))).rejects.toThrow(/lease/);
    await expect(paused.remove()).rejects.toThrow(/lease/);
    await taken.save(record('alice', { version: 'v2' }));
    await taken.release();
    const after = await leaseOf(a, 'h1');

    expect(after.record.version).toBe('v2');
    expect(await a.count('alice', 60_000)).toBe(1);
    await after.release();
  });

  it('gives one lease, never two, when several processes find a dead holder\'s lock at once', async () => {
    const dir = tempDir();
    const stores = [0, 1, 2, 3].map(() => createFilesHandleStore(dir));
    const lease = join(dir, 'h1.lease');

    await stores[0].tryAdd('h1', record('alice'), 8, 60_000);
    // Each round races four acquires on a fresh dead lock; one round alone may not interleave.
    for (let round = 0; round < 15; round += 1) {
      writeFileSync(lease, 'dead holder');
      const past = new Date(Date.now() - 60_000);

      utimesSync(lease, past, past);
      const got = await Promise.all(stores.map((store) => store.acquire('h1', 60_000, 300)));
      const leases = got.filter((one): one is BlokMcpHandleLease => typeof one === 'object');

      expect(leases, `round ${round}`).toHaveLength(1);
      await Promise.all(leases.map((one) => one.release()));
    }
  });

  it('sweeps crash leftovers older than the stale time, and keeps young ones', async () => {
    const dir = tempDir();
    const store = createFilesHandleStore(dir, { leaseStaleMs: 1_000 });
    const old = new Date(Date.now() - 60_000);
    const leftovers = ['.h1.record.json.0123456789ab.tmp', 'h2.lease.break', 'h3.record.json', 'h4.lease'];

    for (const name of leftovers) {
      writeFileSync(join(dir, name), 'x');
      utimesSync(join(dir, name), old, old);
      writeFileSync(join(dir, `young-${name}`), 'x');
    }
    await store.tryAdd('kept', record('alice'), 8, 60_000);
    await store.sweep(60_000);

    expect(readdirSync(dir).sort()).toEqual([...leftovers.map((name) => `young-${name}`), 'kept.meta.json', 'kept.record.json'].sort());
  });

  it.skipIf(process.platform === 'win32')('refuses a link to a directory even when the path ends in a slash', () => {
    const link = join(tempDir(), 'handles');

    symlinkSync(tempDir(), link);
    expect(() => createFilesHandleStore(`${link}/`)).toThrow(McpConfigError);
  });

  it('keeps a long lease alive by refreshing it', async () => {
    const dir = tempDir();
    const options = { leaseStaleMs: 300, heartbeatMs: 50 };
    const a = createFilesHandleStore(dir, options);
    const b = createFilesHandleStore(dir, options);

    await a.tryAdd('h1', record('alice'), 8, 60_000);
    const held = await leaseOf(a, 'h1');

    expect(await b.acquire('h1', 60_000, 700)).toBe('busy');
    await held.release();
  });

  it('answers unknown for a meta file without its record, as a crashed add leaves', async () => {
    const dir = tempDir();
    const store = createFilesHandleStore(dir);

    writeFileSync(join(dir, 'h1.meta.json'), JSON.stringify({ v: 1, principal: 'alice', lastUsedMs: Date.now() }));

    expect(await store.acquire('h1', 60_000, 100)).toBe('unknown');
  });
});
