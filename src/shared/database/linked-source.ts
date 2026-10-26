/**
 * A database block names other blocks by id: its linked source, its Tabbed
 * layout's tabs block, view data sources and dashboard widget databases. A
 * copy that carries both must re-point the reference at the copy. A reference
 * to a block that is not copied keeps its id.
 *
 * Pure: the server runtime imports it through `src/view/page-document-remap.ts`.
 */

import { cloneRecord } from '../agent/snapshot';

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
 * Where a linked view's rows live, as the editor's `dataId` reads it: its
 * source database in this document; undefined when the block is not a linked
 * view. A source in another document, or one that is not a plain database
 * here, gives a refusal: the editor shows no rows to add to there either.
 * @param block - the database block
 * @param lookup - reads another block of this document
 */
export const linkedRowHome = (
  block: { id: string; type: string; data: unknown },
  lookup: (id: string) => { type: string; data: unknown } | null | undefined
): { databaseId: string } | { refusal: string } | undefined => {
  const raw: unknown = block.type === DATABASE && typeof block.data === 'object' && block.data !== null
    ? (block.data as Record<string, unknown>).source
    : undefined;

  if (raw === undefined || raw === null) return undefined;
  const remote = typeof raw === 'object' && typeof (raw as Record<string, unknown>).documentId === 'string' && (raw as Record<string, unknown>).documentId !== '';

  if (remote) {
    return { refusal: `Database ${block.id} is a linked view of a database in another document, so its rows are read-only here, as they are for a person in the editor. Edit them in the document that holds the source database.` };
  }
  const source = localLinkedSource(block.type, block.data);
  const found = source === undefined || source.databaseId === block.id ? undefined : lookup(source.databaseId);

  if (source === undefined || found === null || found === undefined || found.type !== DATABASE
    || (typeof found.data === 'object' && found.data !== null && (found.data as Record<string, unknown>).source !== undefined)) {
    return { refusal: `Database ${block.id} is a linked view whose source is not a database of this document (deleted, or not a database), so it has no rows to change.` };
  }

  return { databaseId: source.databaseId };
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
  const next = cloneRecord(data as Record<string, unknown>) as T;

  for (const { holder, key } of databaseBlockRefs(type, next)) {
    const mapped = ids.get(holder[key] as string);

    if (mapped !== undefined) holder[key] = mapped;
  }

  return next;
};

/**
 * New view ids for each copied database, by its original block id. Personal
 * view state and `#view-<id>` links are keyed by view id, so a copy that kept
 * them would share both with the original. View ids repeat across blocks, so
 * each database gets its own map.
 * @param copies - each copied block's original id, tool name and data
 * @param mint - makes a new view id
 */
export const mintDatabaseViewIds = (
  copies: ReadonlyArray<{ id: string; type: string; data: unknown }>,
  mint: () => string
): Map<string, Map<string, string>> => new Map(copies
  .filter((copy) => copy.type === DATABASE && isFields(copy.data))
  .map((copy) => [copy.id, new Map(fieldsIn((copy.data as Fields).views)
    .filter((view) => typeof view.id === 'string')
    .map((view) => [view.id as string, mint()]))]));

/**
 * `data` with its view ids, active view, automation scopes and dashboard
 * widgets re-pointed through `viewIds`. Must run before `remapDatabaseRefs`:
 * a widget's `databaseId` still names the original block here.
 * @param type - the block's tool name
 * @param id - the block's original id
 * @param data - the block's data
 * @param viewIds - original database block id to old view id to new view id
 */
export const remapDatabaseViewIds = <T>(type: string, id: string, data: T, viewIds: ReadonlyMap<string, ReadonlyMap<string, string>>): T => {
  if (type !== DATABASE || !isFields(data)) return data;
  const next = cloneRecord(data) as Fields;
  const own = viewIds.get(id);
  const refs: Array<BlockRef & { owner: ReadonlyMap<string, string> | undefined }> = [{ holder: next, key: 'activeViewId', owner: own }];

  for (const view of fieldsIn(next.views)) {
    refs.push({ holder: view, key: 'id', owner: own });
    const rows = isFields(view.dashboard) ? fieldsIn(view.dashboard.rows) : [];

    for (const widget of rows.flatMap((row) => fieldsIn(row.widgets))) {
      const owner = typeof widget.databaseId === 'string' && widget.databaseId !== '' ? widget.databaseId : id;

      refs.push({ holder: widget, key: 'viewId', owner: viewIds.get(owner) });
    }
  }
  const automations = isFields(next.automations) ? fieldsIn(next.automations.definitions) : [];

  automations.map((automation) => automation.scope).filter(isFields).forEach((scope) => refs.push({ holder: scope, key: 'viewId', owner: own }));
  for (const { holder, key, owner } of refs) {
    const mapped = typeof holder[key] === 'string' ? owner?.get(holder[key]) : undefined;

    if (mapped !== undefined) holder[key] = mapped;
  }

  return next as T;
};
