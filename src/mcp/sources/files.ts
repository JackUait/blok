import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs';
import { chmod, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { surfaceError } from '../errors';

import type { DocumentSource } from './types';
import { assertDocumentShape, isRecord } from './types';

// Never starts with ".", so ".", ".." and dotfiles never match; no "/" or "\" can appear.
// "-" and "_" may lead: nanoid page and document ids use them.
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

// Only the native realpath reports the on-disk case of a name.
const nativeRealpath = promisify(realpath.native);

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const isMissing = (thrown: unknown): boolean => isRecord(thrown) && thrown.code === 'ENOENT';

// Agent-facing messages name only `<id>.json`; the full path goes to stderr (stdout is the MCP protocol).
const unavailable = (message: string, path: string, thrown: unknown): Error => {
  console.error(`blok-mcp files source: ${message} (${path}):`, thrown);

  return surfaceError('SOURCE_UNAVAILABLE', message);
};

/**
 * Saves of one document run one at a time inside this process, so the hash
 * check and the rename cannot interleave. Other processes are not locked out.
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

  const pathOf = (documentId: string): string => {
    if (!SAFE_ID.test(documentId)) {
      throw surfaceError('INVALID_ARGS', 'With the files source, a document id uses letters, digits, ".", "_" and "-" only (max 200).');
    }

    return join(dir, `${documentId}.json`);
  };

  /**
   * On a case-insensitive disk `SECRET` would open `secret.json` and slip past
   * an authorize hook that names `secret`. Run after the read, so a file that
   * appears in between is still checked. realpath gives the on-disk name; a
   * mismatch is either a case alias or a symlink, and only a listing tells them apart.
   */
  const assertExactName = async (documentId: string, path: string): Promise<void> => {
    const name = `${documentId}.json`;
    const real = await nativeRealpath(path).catch(() => null);

    if (real === null || basename(real) === name) {
      return;
    }
    const names = await readdir(dir).catch((thrown: unknown) => {
      throw unavailable('Cannot list the documents directory.', dir, thrown);
    });

    if (!names.includes(name)) {
      throw surfaceError('INVALID_ARGS', 'Document ids are case-sensitive. Use the id exactly as listed.');
    }
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

  return {
    kind: 'files',
    load: async (documentId) => {
      const path = pathOf(documentId);
      const bytes = await readBytes(documentId, path);

      if (bytes === null) {
        return { raw: { blocks: [] }, version: null };
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
    // Keyed in lower case: on a case-insensitive disk `doc` and `DOC` are one file.
    save: (documentId, document, { ifVersion }) => serialized(documentId.toLowerCase(), async () => {
      const path = pathOf(documentId);
      const current = await readBytes(documentId, path);

      if (current !== null) {
        await assertExactName(documentId, path);
      }
      if ((current === null ? null : hash(current)) !== ifVersion) {
        throw surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.');
      }
      const text = `${JSON.stringify(document, null, 2)}\n`;
      // Same directory as the target, so the rename stays on one filesystem and is atomic.
      // A symlinked document becomes a regular file here; its target is never written.
      const temp = join(dir, `.${documentId}.${randomBytes(6).toString('hex')}.tmp`);
      const mode = await modeOf(path);

      try {
        await writeFile(temp, text);
        // The umask filters a create mode, so set the original mode explicitly.
        if (mode !== null) {
          await chmod(temp, mode);
        }
        await rename(temp, path);
      } catch (thrown) {
        await rm(temp, { force: true });
        throw unavailable(`Cannot write ${documentId}.json.`, path, thrown);
      }

      return { version: hash(text) };
    }),
    list: async ({ query, cursor, limit }) => {
      const names = await readdir(dir).catch((thrown: unknown) => {
        throw unavailable('Cannot list the documents directory.', dir, thrown);
      });
      const ids = names
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((id) => SAFE_ID.test(id))
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
