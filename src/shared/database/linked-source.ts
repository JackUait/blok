/**
 * A database block names other blocks by id: its linked source, its Tabbed
 * layout's tabs block, view data sources and dashboard widget databases. A
 * copy that carries both must re-point the reference at the copy. A reference
 * to a block that is not copied keeps its id.
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

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

const fieldsIn = (value: unknown): Fields[] => (Array.isArray(value) ? value.filter(isFields) : []);

/** One field in a block's data that holds another block's id. */
export interface BlockRef {
  holder: Record<string, unknown>;
  key: string;
}

/**
 * Every field of a database block's data that names a block in this document:
 * the local linked source, the Tabbed layout's tabs block, each view's data
 * source and each dashboard widget's database. Each may name the block itself.
 * @param type - the block's tool name
 * @param data - the block's data
 */
export const databaseBlockRefs = (type: string, data: unknown): BlockRef[] => {
  if (type !== DATABASE || !isFields(data)) return [];
  const refs: BlockRef[] = [];
  const add = (holder: Fields, key: string): void => {
    const value = holder[key];

    if (typeof value === 'string' && value !== '') refs.push({ holder, key });
  };
  const source = localLinkedSource(type, data);

  if (source !== undefined) refs.push({ holder: source, key: 'databaseId' });
  fieldsIn(data.schema).filter((property) => property.type === 'title').forEach((title) => add(title, 'pageLayoutTabsId'));
  for (const view of fieldsIn(data.views)) {
    add(view, 'dataSourceId');
    const rows = isFields(view.dashboard) ? fieldsIn(view.dashboard.rows) : [];

    rows.flatMap((row) => fieldsIn(row.widgets)).forEach((widget) => add(widget, 'databaseId'));
  }

  return refs;
};

/**
 * New ids for the copied blocks that a copied database names. The copy
 * inserts each such block under its new id, so the database's copy can name
 * it whether it lands before or after it. A block not copied keeps its id.
 * @param copies - each copied block's original id, tool name and data
 * @param mint - makes a new block id
 */
export const mintDatabaseRefIds = (
  copies: ReadonlyArray<{ id: string; type: string; data: unknown }>,
  mint: () => string
): Map<string, string> => {
  const copied = new Set(copies.map((copy) => copy.id));
  const minted = new Map<string, string>();

  const named = copies.flatMap((copy) => databaseBlockRefs(copy.type, copy.data).map(({ holder, key }) => holder[key] as string));

  for (const id of named) {
    if (copied.has(id) && !minted.has(id)) minted.set(id, mint());
  }

  return minted;
};

/**
 * `data` with every block id it names re-pointed through `ids`. A copy when
 * anything maps, else the same object.
 * @param type - the block's tool name
 * @param data - the block's data
 * @param ids - old block id to new block id
 */
export const remapDatabaseRefs = <T>(type: string, data: T, ids: ReadonlyMap<string, string>): T => {
  if (!databaseBlockRefs(type, data).some(({ holder, key }) => ids.has(holder[key] as string))) return data;
  // Editor-only: the server runtime has no structuredClone and never calls this.
  const next = structuredClone(data);

  for (const { holder, key } of databaseBlockRefs(type, next)) {
    const mapped = ids.get(holder[key] as string);

    if (mapped !== undefined) holder[key] = mapped;
  }

  return next;
};
