import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { surfaceError } from '../errors';

import type { DocumentSource } from './types';
import { assertDocumentShape, isRecord } from './types';

// Starts with a letter or digit, so ".", ".." and dotfiles never match; no "/" or "\" can appear.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const isMissing = (thrown: unknown): boolean => isRecord(thrown) && thrown.code === 'ENOENT';

/**
 * Saves compare the file hash, then rename. The window between the two is not
 * locked, so two local writers can still race inside it.
 */
export const createFilesSource = (dir: string): DocumentSource => {
  const pathOf = (documentId: string): string => {
    if (!SAFE_ID.test(documentId)) {
      throw surfaceError('INVALID_ARGS', 'With the files source, a document id uses letters, digits, ".", "_" and "-" only (max 200).');
    }

    return join(dir, `${documentId}.json`);
  };

  const readBytes = async (path: string): Promise<Buffer | null> => {
    try {
      return await readFile(path);
    } catch (thrown) {
      if (isMissing(thrown)) {
        return null;
      }
      throw surfaceError('SOURCE_UNAVAILABLE', `Cannot read ${path}.`);
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
      const bytes = await readBytes(path);

      if (bytes === null) {
        return { raw: { blocks: [] }, version: null };
      }
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
    save: async (documentId, document, { ifVersion }) => {
      const path = pathOf(documentId);
      const current = await readBytes(path);

      if ((current === null ? null : hash(current)) !== ifVersion) {
        throw surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.');
      }
      const text = `${JSON.stringify(document, null, 2)}\n`;
      // Same directory as the target, so the rename stays on one filesystem and is atomic.
      const temp = join(dir, `.${documentId}.${randomBytes(6).toString('hex')}.tmp`);

      try {
        await writeFile(temp, text);
        await rename(temp, path);
      } catch {
        await rm(temp, { force: true });
        throw surfaceError('SOURCE_UNAVAILABLE', `Cannot write ${path}.`);
      }

      return { version: hash(text) };
    },
    list: async ({ query, cursor, limit }) => {
      const names = await readdir(dir).catch(() => {
        throw surfaceError('SOURCE_UNAVAILABLE', `Cannot list ${dir}.`);
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
