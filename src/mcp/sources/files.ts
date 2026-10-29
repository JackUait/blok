import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs';
import { chmod, lstat, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { surfaceError } from '../errors';

import type { DocumentSource } from './types';
import { assertDocumentShape, isRecord } from './types';

// Never starts with ".", so ".", ".." and dotfiles never match; no "/" or "\" can appear.
// "-" and "_" may lead: nanoid page and document ids use them.
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
// Windows opens a device for these names whatever the extension, so "nul.json" would drop every save.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const isSafeId = (id: string): boolean => SAFE_ID.test(id) && !WINDOWS_DEVICE.test(id);

// Only the native realpath reports the on-disk case of a name.
const nativeRealpath = promisify(realpath.native);

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const isMissing = (thrown: unknown): boolean => isRecord(thrown) && thrown.code === 'ENOENT';
const isTaken = (thrown: unknown): boolean => isRecord(thrown) && thrown.code === 'EEXIST';

// A save holds the lock for one read, one small write and one rename, so a lock this old was left by a dead process.
const LOCK_STALE_MS = 30_000;
// Kept short: an agent waiting longer than this is better told to retry.
const LOCK_WAIT_MS = 2_000;
const LOCK_RETRY_MS = 25;

// Makes the rename durable. Best effort: some platforms refuse to open or sync a directory.
const syncDir = async (path: string): Promise<void> => {
  try {
    const handle = await open(path, 'r');

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Ignored on purpose, see above.
  }
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// Agent-facing messages name only `<id>.json`; the full path goes to stderr (stdout is the MCP protocol).
const unavailable = (message: string, path: string, thrown: unknown): Error => {
  console.error(`blok-mcp files source: ${message} (${path}):`, thrown);

  return surfaceError('SOURCE_UNAVAILABLE', message);
};

/**
 * Saves of one document run one at a time: a promise chain inside this process,
 * then a lock file across processes, so the hash check and the rename cannot interleave.
 */
export const createFilesSource = (dir: string): DocumentSource => {
  const tails = new Map<string, Promise<unknown>>();

  const serialized = <T>(documentId: string, run: () => Promise<T>): Promise<T> => {
    const previous = tails.get(documentId) ?? Promise.resolve();
    const result = previous.then(run, run);
    const tail = result.catch(() => undefined);

    tails.set(documentId, tail);
    void tail.then(() => {
      if (tails.get(documentId) === tail) {
        tails.delete(documentId);
      }
    });

    return result;
  };

  // Takes the lock or throws; the caller must release it.
  const lock = async (documentId: string, target: string): Promise<string> => {
    const path = join(dirname(target), `.${basename(target).toLowerCase()}.lock`);
    const deadline = Date.now() + LOCK_WAIT_MS;

    const tryCreate = async (): Promise<boolean> => {
      try {
        await (await open(path, 'wx')).close();

        return true;
      } catch (thrown) {
        if (isTaken(thrown)) {
          return false;
        }
        throw unavailable(`Cannot write ${documentId}.json.`, path, thrown);
      }
    };

    while (!await tryCreate()) {
      const held = await stat(path).catch(() => null);

      // Not atomic: two waiters may both judge one lock stale. Rare, as it needs a crashed holder.
      if (held !== null && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw unavailable(`${documentId}.json is being saved by another process. Retry shortly.`, path, 'lock held');
      }
      await pause(LOCK_RETRY_MS);
    }

    return path;
  };

  const pathOf = (documentId: string): string => {
    if (!isSafeId(documentId)) {
      throw surfaceError('INVALID_ARGS', 'With the files source, a document id uses letters, digits, ".", "_" and "-" only (max 200), and is not a Windows device name such as CON or NUL.');
    }

    return join(dir, `${documentId}.json`);
  };

  /**
   * On a case-insensitive disk `SECRET` would open `secret.json` and slip past
   * an authorize hook that names `secret`. Run after the read, so a file that
   * appears in between is still checked. realpath gives the on-disk name; a
   * mismatch is either a case alias or a symlink, and only a listing tells them apart.
   * Known limit: on such a disk, two ids that differ only by case cannot both exist.
   */
  const assertExactName = async (documentId: string, path: string): Promise<void> => {
    const name = `${documentId}.json`;
    const real = await nativeRealpath(path).catch(() => null);

    // For a link, realpath names the target, so a matching name proves nothing.
    if (real === null || (basename(real) === name && (await lstat(path).catch(() => null))?.isSymbolicLink() !== true)) {
      return;
    }
    const names = await readdir(dir).catch((thrown: unknown) => {
      throw unavailable('Cannot list the documents directory.', dir, thrown);
    });

    if (names.includes(name)) {
      return;
    }
    // Named from the listing, not realpath: that would name a symlink's target.
    const taken = names.find((entry) => entry.toLowerCase() === name.toLowerCase());

    throw surfaceError('INVALID_ARGS', taken === undefined
      ? 'Document ids are case-sensitive. Use the id exactly as listed.'
      : `${taken} already uses this name with different letter case. This disk ignores case, so the two ids cannot both exist.`);
  };

  const readBytes = async (documentId: string, path: string): Promise<Buffer | null> => {
    try {
      return await readFile(path);
    } catch (thrown) {
      if (isMissing(thrown)) {
        return null;
      }
      throw unavailable(`Cannot read ${documentId}.json.`, path, thrown);
    }
  };

  const modeOf = async (path: string): Promise<number | null> => {
    try {
      return (await stat(path)).mode & 0o7777;
    } catch {
      return null;
    }
  };

  const titleOf = async (id: string): Promise<string | null> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf-8'));

      return isRecord(parsed) && typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title : null;
    } catch {
      return null;
    }
  };

  /**
   * The file a save replaces, fully resolved so every spelling of one file
   * gives one path. A symlinked document is written through to its target,
   * so the link survives; a link to a missing file is refused, not replaced.
   */
  const writeTargetOf = async (documentId: string, path: string): Promise<string> => {
    const entry = await lstat(path).catch((thrown: unknown) => {
      if (isMissing(thrown)) {
        return null;
      }
      throw unavailable(`Cannot read ${documentId}.json.`, path, thrown);
    });

    if (entry === null) {
      return join(await nativeRealpath(dir).catch(() => dir), basename(path));
    }

    return nativeRealpath(path).catch((thrown: unknown) => {
      if (!entry.isSymbolicLink()) {
        return path;
      }
      throw unavailable(`${documentId}.json is a link to a missing file.`, path, thrown);
    });
  };

  // Lower case: on a case-insensitive disk `doc` and `DOC` are one file.
  const sameFileKey = (target: string): string => target.toLowerCase();

  const saveLocked = async (
    documentId: string,
    path: string,
    target: string,
    document: unknown,
    ifVersion: string | null,
  ): Promise<{ version: string }> => {
    // The target was resolved before the wait; a link pointed elsewhere since then would be checked against one file and written to another.
    if (sameFileKey(await writeTargetOf(documentId, path)) !== sameFileKey(target)) {
      throw surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.');
    }
    const current = await readBytes(documentId, path);

    if (current !== null) {
      await assertExactName(documentId, path);
    }
    if ((current === null ? null : hash(current)) !== ifVersion) {
      throw surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.');
    }
    const text = `${JSON.stringify(document, null, 2)}\n`;
    // Same directory as the target, so the rename stays on one filesystem and is atomic.
    const temp = join(dirname(target), `.${documentId}.${randomBytes(6).toString('hex')}.tmp`);
    const mode = await modeOf(target);

    try {
      const handle = await open(temp, 'wx');

      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // The umask filters a create mode, so set the original mode explicitly.
      if (mode !== null) {
        await chmod(temp, mode);
      }
      await rename(temp, target);
    } catch (thrown) {
      await rm(temp, { force: true });
      throw unavailable(`Cannot write ${documentId}.json.`, path, thrown);
    }
    await syncDir(dirname(target));

    return { version: hash(text) };
  };

  return {
    kind: 'files',
    load: async (documentId) => {
      const path = pathOf(documentId);
      const bytes = await readBytes(documentId, path);

      if (bytes === null) {
        // Throws for a link to a missing file, which a save would refuse.
        await writeTargetOf(documentId, path);

        return { raw: { blocks: [] }, version: null, missing: true };
      }
      await assertExactName(documentId, path);
      const raw: unknown = (() => {
        try {
          const parsed: unknown = JSON.parse(bytes.toString('utf-8'));

          return parsed;
        } catch {
          throw surfaceError('SOURCE_UNAVAILABLE', `${documentId}.json is not valid JSON.`);
        }
      })();

      assertDocumentShape(raw, `${documentId}.json`);

      return { raw, version: hash(bytes) };
    },
    // Keyed on the file written, so a link and its target share one queue and one lock.
    save: async (documentId, document, { ifVersion }) => {
      const path = pathOf(documentId);
      const target = await writeTargetOf(documentId, path);

      return serialized(sameFileKey(target), async () => {
        const held = await lock(documentId, target);

        try {
          return await saveLocked(documentId, path, target, document, ifVersion);
        } finally {
          await rm(held, { force: true });
        }
      });
    },
    sameDocument: async (first, second) => {
      const keyOf = async (documentId: string): Promise<string | null> => {
        try {
          return sameFileKey(await writeTargetOf(documentId, pathOf(documentId)));
        } catch {
          return null;
        }
      };
      const [a, b] = await Promise.all([keyOf(first), keyOf(second)]);

      return a !== null && a === b;
    },
    list: async ({ query, cursor, limit }) => {
      const names = await readdir(dir).catch((thrown: unknown) => {
        throw unavailable('Cannot list the documents directory.', dir, thrown);
      });
      const ids = names
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter(isSafeId)
        .sort();
      const titled = await Promise.all(ids.map(async (id) => ({ id, title: await titleOf(id) })));
      const needle = query?.toLowerCase();
      const matching = titled.filter((doc) => needle === undefined
        || doc.id.toLowerCase().includes(needle) || (doc.title ?? '').toLowerCase().includes(needle));
      const start = cursor === undefined ? 0 : matching.findIndex((doc) => doc.id > cursor);
      const page = start === -1 ? [] : matching.slice(start, start + limit);
      const more = start !== -1 && start + limit < matching.length;

      return { documents: page, nextCursor: more ? page[page.length - 1].id : null };
    },
  };
};
