import { surfaceError } from './errors';
import { MAX_JSON_DEPTH, textNestsDeeperThan, wellFormed } from './wire-json';

/*
 * The files source's pure rules (src/mcp/sources/files.ts): which ids it accepts, how it lists,
 * how it reads a file's text and the bytes it writes. The disk work stays with the host.
 */

// Never starts with ".", so ".", ".." and dotfiles never match; no "/" or "\" can appear.
// "-" and "_" may lead: nanoid page and document ids use them.
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
// Windows opens a device for these names whatever the extension, so "nul.json" would drop every save.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export const isSafeId = (id: string): boolean => SAFE_ID.test(id) && !WINDOWS_DEVICE.test(id);

/** Throws the refusal for an id the files source cannot store. */
export const assertSafeId = (id: string): void => {
  if (!isSafeId(id)) {
    throw surfaceError('INVALID_ARGS', 'With the files source, a document id uses letters, digits, ".", "_" and "-" only (max 200), and is not a Windows device name such as CON or NUL.');
  }
};

/** The document ids of a folder listing, sorted by UTF-16 code units. */
export const listedIds = (names: readonly string[]): string[] => names
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .filter(isSafeId)
  .sort();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A file's listed title: its non-empty `title`, else null. Text that is not JSON has none. */
export const titleOfText = (text: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(text);

    return isRecord(parsed) && typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title : null;
  } catch {
    return null;
  }
};

/** One page of listed documents, in id order. */
export const listPage = (
  titled: ReadonlyArray<{ id: string; title: string | null }>,
  request: { query?: string; cursor?: string; limit: number },
): { documents: Array<{ id: string; title: string | null }>; nextCursor: string | null } => {
  const needle = request.query?.toLowerCase();
  const matching = titled.filter((doc) => needle === undefined
    || doc.id.toLowerCase().includes(needle) || (doc.title ?? '').toLowerCase().includes(needle));
  const cursor = request.cursor;
  const start = cursor === undefined ? 0 : matching.findIndex((doc) => doc.id > cursor);
  const page = start === -1 ? [] : matching.slice(start, start + request.limit);
  const more = start !== -1 && start + request.limit < matching.length;

  return { documents: page.map(doc => ({ ...doc })), nextCursor: more ? page[page.length - 1].id : null };
};

/** Throws unless the value is shaped like a stored Blok document. */
export const assertDocumentShape = (value: unknown, where: string): void => {
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    throw surfaceError('SOURCE_UNAVAILABLE', `${where} is not a Blok document: expected an object with a "blocks" array.`);
  }
};

/** A stored file's document, from its UTF-8 text. */
export const parseDocumentText = (id: string, text: string): unknown => {
  // Before parsing: the ports' JSON.parse refuses past 64 levels as invalid JSON.
  if (textNestsDeeperThan(text, MAX_JSON_DEPTH)) {
    throw surfaceError('SOURCE_UNAVAILABLE', `${id}.json nests deeper than ${MAX_JSON_DEPTH} levels of objects and arrays.`);
  }
  const raw: unknown = (() => {
    try {
      const parsed: unknown = JSON.parse(text);

      return wellFormed(parsed);
    } catch {
      throw surfaceError('SOURCE_UNAVAILABLE', `${id}.json is not valid JSON.`);
    }
  })();

  assertDocumentShape(raw, `${id}.json`);

  return raw;
};

/** The bytes the files source writes; its version is their SHA-256. */
export const savedFileText = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;
