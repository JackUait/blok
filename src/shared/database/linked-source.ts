/**
 * A linked database names its source database by block id. A copy that
 * carries both must re-point the view at the copied source. A link to a
 * database that is not copied keeps its id.
 *
 * Pure: the server runtime imports it through `src/view/page-document-remap.ts`.
 */

const DATABASE = 'database';

type LocalSource = Record<string, unknown> & { databaseId: string };

/**
 * The `data.source` object of a linked database whose source lives in this
 * document, or undefined. A source with a `documentId` uses another
 * document's ids. Read as `sourceRefOf` in src/tools/database/index.ts reads it.
 * @param type - the block's tool name
 * @param data - the block's data
 */
export const localLinkedSource = (type: string, data: unknown): LocalSource | undefined => {
  if (type !== DATABASE || typeof data !== 'object' || data === null) return undefined;
  const source: unknown = (data as Record<string, unknown>).source;

  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  const { databaseId, documentId } = source as Record<string, unknown>;

  if (typeof databaseId !== 'string' || databaseId === '' || (typeof documentId === 'string' && documentId !== '')) return undefined;

  return source as LocalSource;
};

/**
 * New ids for the copied databases that a copied linked view names. The copy
 * inserts each such database under its new id, so the view's copy can name it
 * whether it lands before or after it.
 * @param copies - each copied block's original id, tool name and data
 * @param mint - makes a new block id
 */
export const mintLinkedSourceIds = (
  copies: ReadonlyArray<{ id: string; type: string; data: unknown }>,
  mint: () => string
): Map<string, string> => {
  const databases = new Set(copies.filter((copy) => copy.type === DATABASE).map((copy) => copy.id));
  const minted = new Map<string, string>();

  for (const copy of copies) {
    const sourceId = localLinkedSource(copy.type, copy.data)?.databaseId;

    if (sourceId !== undefined && databases.has(sourceId) && !minted.has(sourceId)) {
      minted.set(sourceId, mint());
    }
  }

  return minted;
};

/**
 * `data` with its local linked source re-pointed through `ids`. The same
 * object when nothing maps.
 * @param type - the block's tool name
 * @param data - the block's data
 * @param ids - old block id to new block id
 */
export const remapLinkedSource = <T>(type: string, data: T, ids: ReadonlyMap<string, string>): T => {
  const source = localLinkedSource(type, data);
  const next = source === undefined ? undefined : ids.get(source.databaseId);

  return next === undefined ? data : { ...data, source: { ...source, databaseId: next } };
};
