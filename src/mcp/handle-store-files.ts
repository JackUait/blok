import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { McpConfigError } from './config';
import type { BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore } from './options';

/*
 * `--handle-store files:<dir>`: the reference handle store, for tests and for several blok-mcp
 * processes on one machine (or one shared disk with working renames). Interoperation with the C#,
 * Go and Rust file stores is NOT required: each port keeps the record format (BlokMcpHandleRecord,
 * `v: 1`) and this lock protocol, but nobody points two languages at one directory. The layout:
 *
 *   <handle>.record.json   the record, as JSON text.
 *   <handle>.meta.json     {"v":1,"principal":"<principal>","lastUsedMs":<epoch ms>}: who owns it and
 *                          when its last lease ended. The handle exists while this file exists.
 *   <handle>.lease         a lock: held while the file exists. Its text is the holder's random token.
 *   principal-<sha256 hex of the principal, UTF-8>.lock
 *                          a lock held while tryAdd counts and adds for that principal.
 *
 * A handle is only ever a file name if it is 1-128 characters of [A-Za-z0-9_-] (Blok mints 22);
 * any other handle is unknown before a file is touched, so a client cannot name another path.
 *
 * Writes: every JSON file is written to `.<name>.<12 hex>.tmp` in the same directory, then renamed
 * over the target, so a reader sees the old or the new file, never half of one.
 *
 * Locks: create the lock file exclusively (O_CREAT|O_EXCL) and write the token. When it exists:
 *   - mtime older than leaseStaleMs (30 s): its holder died. Take `<lock>.break` exclusively (one
 *     breaker at a time; a `.break` older than leaseStaleMs is removed), read the lock again, and
 *     delete it only if it still has the token and the old mtime seen before. Then create again.
 *   - else poll every 25 ms until the caller's timeout.
 * A lease holder touches its lock's mtime every heartbeatMs (5 s), so a lease outlives slow calls.
 * Leases are time-limited: a holder that cannot touch its lock for leaseStaleMs (a paused process)
 * loses it. save and remove check the token first and throw once it is gone, so a holder that knows
 * it lost the lease never writes. The check and the write are two steps, so a holder paused between
 * them can still write once; the source's version check (409) is what keeps that from losing a save.
 *
 * Expiry: a handle expires when it is not leased and now - lastUsedMs > idleMs. acquire deletes an
 * expired handle under its lease; count deletes the asking principal's ones and sweep every one,
 * each only when its lease is free. release writes lastUsedMs.
 * tryAdd writes the record, then the meta file, so a crash leaves at most an unreferenced record.
 * remove deletes the meta file, then the record. sweep also deletes crash leftovers older than
 * leaseStaleMs: temp files, `.break` files, records without meta, and leases without meta.
 *
 * Privacy: records hold document text, undo steps and principals. On Windows the store refuses to
 * start: these POSIX checks cannot be made there (it is a reference and test store; use your own).
 * Elsewhere, at start, once: resolve the path (a trailing slash would make lstat follow a link),
 * create the directory if missing (recursive, mode 0700), then lstat it and refuse to start (exit 2)
 * unless it is a directory, not a symlink, has no group or world bits (mode & 0o077 == 0), and its
 * owner uid is the process's effective uid. Root runs as uid 0, so it refuses a directory another
 * user owns too; a chmod probe would not, since root can chmod anything. Nothing creates it again later: a store whose directory
 * went away fails each write. Every file (record, meta, lease, lock, temp) is opened with mode 0600.
 */

const HANDLE = /^[A-Za-z0-9_-]{1,128}$/;
const RECORD = '.record.json';
const META = '.meta.json';
const LEASE = '.lease';
const LEASE_STALE_MS = 30_000;
const HEARTBEAT_MS = 5_000;
const POLL_MS = 25;
// tryAdd's principal lock is held for one directory scan and two small writes.
const PRINCIPAL_WAIT_MS = 10_000;

export interface FilesHandleStoreOptions {
  leaseStaleMs?: number;
  heartbeatMs?: number;
  /** For tests: the platform and effective uid the start checks use. */
  platform?: NodeJS.Platform;
  effectiveUid?: () => number | undefined;
}

interface Meta { v: 1; principal: string; lastUsedMs: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const code = (thrown: unknown): unknown => (isRecord(thrown) ? thrown.code : undefined);

const pause = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const token = (): string => randomBytes(16).toString('hex');

const lost = (handle: string): Error => new Error(`blok-mcp handle store: the lease on ${handle} was lost`);

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch (thrown) {
    if (code(thrown) === 'ENOENT') {
      return null;
    }
    throw thrown;
  }
};

const parseMeta = (text: string | null): Meta | null => {
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);

    return isRecord(value) && typeof value.principal === 'string' && typeof value.lastUsedMs === 'number'
      ? { v: 1, principal: value.principal, lastUsedMs: value.lastUsedMs }
      : null;
  } catch {
    return null;
  }
};

const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;

// Another user who can read here sees documents; one who can write here could plant a record and take over a handle.
const prepareDirectory = (dir: string, effectiveUid: () => number | undefined): void => {
  try {
    mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR });
  } catch (thrown) {
    // A file in the way is refused below; anything else means the directory cannot be made.
    if (code(thrown) !== 'EEXIST') {
      throw new McpConfigError(`--handle-store cannot create ${dir}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }
  }
  const found = lstatSync(dir);
  const owner = effectiveUid();

  if (found.isSymbolicLink() || !found.isDirectory() || (found.mode & 0o077) !== 0 || (owner !== undefined && found.uid !== owner)) {
    throw new McpConfigError(`--handle-store directory ${dir} must be a directory (not a link) owned by this user, with no group or world access (chmod 700)`);
  }
};

export const createFilesHandleStore = (given: string, options: FilesHandleStoreOptions = {}): BlokMcpHandleStore => {
  // lstat on a path that ends in a slash follows a link, so the path is normalised first.
  const dir = resolve(given);

  if ((options.platform ?? process.platform) === 'win32') {
    throw new McpConfigError('--handle-store files: is not supported on Windows; use your own store');
  }
  prepareDirectory(dir, options.effectiveUid ?? (() => process.geteuid?.()));
  const leaseStaleMs = options.leaseStaleMs ?? LEASE_STALE_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const paths = (handle: string): { record: string; meta: string; lease: string } => ({
    record: join(dir, `${handle}${RECORD}`),
    meta: join(dir, `${handle}${META}`),
    lease: join(dir, `${handle}${LEASE}`),
  });
  const principalLock = (principal: string): string =>
    join(dir, `principal-${createHash('sha256').update(principal, 'utf8').digest('hex')}.lock`);

  const writeAtomic = async (path: string, text: string): Promise<void> => {
    const temp = join(dir, `.${path.slice(dir.length + 1)}.${randomBytes(6).toString('hex')}.tmp`);

    try {
      const file = await open(temp, 'wx', PRIVATE_FILE);

      try {
        await file.writeFile(text);
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } catch (thrown) {
      await rm(temp, { force: true });
      throw thrown;
    }
  };

  const tryCreate = async (path: string, mine: string): Promise<boolean> => {
    try {
      const file = await open(path, 'wx', PRIVATE_FILE);

      try {
        await file.writeFile(mine);
      } finally {
        await file.close();
      }

      return true;
    } catch (thrown) {
      if (code(thrown) === 'EEXIST') {
        return false;
      }
      throw thrown;
    }
  };

  const fresh = (mtimeMs: number): boolean => Date.now() - mtimeMs <= leaseStaleMs;

  // One breaker at a time, and it deletes only the lock it saw go stale, never one taken since.
  const breakStale = async (path: string, seen: string | null): Promise<boolean> => {
    const guard = `${path}.break`;
    const mine = token();

    if (!await tryCreate(guard, mine)) {
      const held = await stat(guard).catch(() => null);

      if (held !== null && !fresh(held.mtimeMs)) {
        await rm(guard, { force: true });
      }

      return false;
    }
    try {
      const now = await stat(path).catch(() => null);

      if (now === null) {
        return true;
      }
      if (fresh(now.mtimeMs) || await readText(path) !== seen) {
        return false;
      }
      await rm(path, { force: true });

      return true;
    } finally {
      if (await readText(guard) === mine) {
        await rm(guard, { force: true });
      }
    }
  };

  const takeLock = async (path: string, mine: string, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (await tryCreate(path, mine)) {
        return true;
      }
      const seen = await readText(path);
      const held = await stat(path).catch(() => null);

      if (held !== null && !fresh(held.mtimeMs) && await breakStale(path, seen)) {
        continue;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await pause(POLL_MS);
    }
  };

  const owns = async (path: string, mine: string): Promise<boolean> => (await readText(path)) === mine;

  const dropLock = async (path: string, mine: string): Promise<void> => {
    if (await owns(path, mine)) {
      await rm(path, { force: true });
    }
  };

  const forget = async (handle: string): Promise<void> => {
    const at = paths(handle);

    await rm(at.meta, { force: true });
    await rm(at.record, { force: true });
  };

  const expired = (meta: Meta, idleMs: number): boolean => Date.now() - meta.lastUsedMs > idleMs;

  const leaseFor = (handle: string, mine: string, record: BlokMcpHandleRecord): BlokMcpHandleLease => {
    const at = paths(handle);
    const state = { released: false };
    const beat = setInterval(() => {
      void owns(at.lease, mine).then((still) => {
        if (still) {
          const now = new Date();

          return utimes(at.lease, now, now);
        }

        return undefined;
      }).catch(() => undefined);
    }, heartbeatMs);

    beat.unref();

    const end = (): void => {
      state.released = true;
      clearInterval(beat);
    };
    const holds = async (): Promise<boolean> => !state.released && await owns(at.lease, mine);

    return {
      record,
      save: async (next) => {
        if (!await holds()) {
          throw lost(handle);
        }
        await writeAtomic(at.record, JSON.stringify(next));
      },
      release: async () => {
        if (!await holds()) {
          end();

          return;
        }
        end();
        const meta = parseMeta(await readText(at.meta));

        if (meta !== null) {
          await writeAtomic(at.meta, JSON.stringify({ ...meta, lastUsedMs: Date.now() }));
        }
        await rm(at.lease, { force: true });
      },
      remove: async () => {
        if (!await holds()) {
          throw lost(handle);
        }
        end();
        await forget(handle);
        await dropLock(at.lease, mine);
      },
    };
  };

  const acquire = async (handle: string, idleMs: number, timeoutMs: number): Promise<BlokMcpHandleLease | 'unknown' | 'busy'> => {
    if (!HANDLE.test(handle)) {
      return 'unknown';
    }
    const at = paths(handle);

    // No waiting on a handle that does not exist.
    if (await readText(at.meta) === null) {
      return 'unknown';
    }
    const mine = token();

    if (!await takeLock(at.lease, mine, timeoutMs)) {
      return 'busy';
    }
    try {
      const meta = parseMeta(await readText(at.meta));
      const text = meta === null ? null : await readText(at.record);

      if (meta === null || text === null || expired(meta, idleMs)) {
        await forget(handle);
        await dropLock(at.lease, mine);

        return 'unknown';
      }

      return leaseFor(handle, mine, JSON.parse(text) as BlokMcpHandleRecord);
    } catch (thrown) {
      await dropLock(at.lease, mine);
      throw thrown;
    }
  };

  // An expired handle goes only when nobody leases it; a free lease taken here is given back at once.
  const reap = async (handle: string, idleMs: number): Promise<boolean> => {
    const at = paths(handle);
    const mine = token();

    if (!await takeLock(at.lease, mine, 0)) {
      return false;
    }
    try {
      const meta = parseMeta(await readText(at.meta));

      if (meta !== null && !expired(meta, idleMs)) {
        return false;
      }
      await forget(handle);

      return true;
    } finally {
      await dropLock(at.lease, mine);
    }
  };

  const names = (): Promise<string[]> => readdir(dir).catch((thrown: unknown) => {
    if (code(thrown) === 'ENOENT') {
      return [];
    }
    throw thrown;
  });
  const handlesIn = (listed: string[]): string[] =>
    listed.filter((name) => name.endsWith(META)).map((name) => name.slice(0, -META.length)).filter((name) => HANDLE.test(name));

  const count = async (principal: string, idleMs: number): Promise<number> => {
    const owned = await Promise.all(handlesIn(await names()).map(async (handle) => {
      const meta = parseMeta(await readText(paths(handle).meta));

      if (meta === null || meta.principal !== principal) {
        return false;
      }

      return !expired(meta, idleMs) || !await reap(handle, idleMs);
    }));

    return owned.filter(Boolean).length;
  };

  // What a crash leaves: nothing refers to these once they are older than a lease can be.
  const leftover = (name: string, listed: Set<string>): boolean => {
    if (name.endsWith('.tmp') || name.endsWith('.break')) {
      return true;
    }
    const owner = [RECORD, LEASE].find((suffix) => name.endsWith(suffix));

    return owner !== undefined && !listed.has(`${name.slice(0, -owner.length)}${META}`);
  };

  const sweep = async (idleMs: number): Promise<void> => {
    const listed = await names();
    const present = new Set(listed);

    await Promise.all(handlesIn(listed).map(async (handle) => {
      const meta = parseMeta(await readText(paths(handle).meta));

      if (meta === null || expired(meta, idleMs)) {
        await reap(handle, idleMs);
      }
    }));
    await Promise.all(listed.filter((name) => leftover(name, present)).map(async (name) => {
      const found = await stat(join(dir, name)).catch(() => null);

      if (found !== null && !fresh(found.mtimeMs)) {
        await rm(join(dir, name), { force: true });
      }
    }));
  };

  return {
    count,
    tryAdd: async (handle, record, maxPerPrincipal, idleMs) => {
      if (!HANDLE.test(handle)) {
        throw new Error(`blok-mcp handle store: "${handle}" is not a handle`);
      }
      const lock = principalLock(record.principal);
      const mine = token();

      if (!await takeLock(lock, mine, PRINCIPAL_WAIT_MS)) {
        throw new Error('blok-mcp handle store: another process holds the principal lock');
      }
      try {
        const at = paths(handle);

        if (await readText(at.meta) !== null) {
          throw new Error(`blok-mcp handle store: handle ${handle} is taken`);
        }
        if (maxPerPrincipal <= 0 || await count(record.principal, idleMs) >= maxPerPrincipal) {
          return false;
        }
        await writeAtomic(at.record, JSON.stringify(record));
        await writeAtomic(at.meta, JSON.stringify({ v: 1, principal: record.principal, lastUsedMs: Date.now() }));

        return true;
      } finally {
        await dropLock(lock, mine);
      }
    },
    acquire,
    sweep,
  };
};
