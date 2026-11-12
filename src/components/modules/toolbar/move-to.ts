import type { PageSearchResult } from '../../../tools/page/types';

/** What the "Move to" picker reads from a block. */
export interface MoveToBlock {
  id: string;
  name: string;
  parentId: string | null;
  preservedData: Record<string, unknown>;
  lastEditedAt?: number;
}

interface MoveToRules<B extends MoveToBlock> {
  /** Core's placement check: false when `root` may not go under `rowId`. */
  canMoveInto: (root: B, rowId: string) => boolean;
  isReadOnly: (block: B) => boolean;
}

const ROW = 'database-row';

const rowTitle = (row: MoveToBlock, database: MoveToBlock | undefined): string | undefined => {
  const { title, properties } = row.preservedData;

  if (typeof title === 'string') {
    return title;
  }
  // Rows saved before the top-level title keep it under the title property.
  const schema = database?.preservedData.schema;
  const titleProperty = Array.isArray(schema)
    ? schema.find((property: unknown) => typeof property === 'object' && property !== null && (property as { type?: unknown }).type === 'title') as { id?: unknown } | undefined
    : undefined;
  const value = typeof properties === 'object' && properties !== null && typeof titleProperty?.id === 'string'
    ? (properties as Record<string, unknown>)[titleProperty.id]
    : undefined;

  return typeof value === 'string' ? value : undefined;
};

/**
 * The pages "Move to" can put `roots` in: database rows whose body is their
 * child blocks in this document. A row with a `pageId` keeps its body in
 * another document, which no public hook can write as one undo step.
 * The most recently edited page comes first; an edit in its body counts.
 * @param blocks - every block, in document order
 * @param roots - the blocks to move, without their descendants
 * @param rules - core's placement and read-only checks
 */
export const listMoveTargets = <B extends MoveToBlock>(blocks: readonly B[], roots: readonly B[], rules: MoveToRules<B>): PageSearchResult[] => {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const rows = blocks.filter((block) => {
    const { pageId } = block.preservedData;

    return block.name === ROW && (typeof pageId !== 'string' || pageId === '');
  });
  const rowIds = new Set(rows.map((row) => row.id));
  const recency = new Map<string, number>();

  blocks.forEach((block) => {
    const seen = new Set<string>();
    const cursor: { id: string | null } = { id: block.id };

    while (cursor.id !== null && !seen.has(cursor.id)) {
      const id = cursor.id;

      seen.add(id);
      if (rowIds.has(id)) {
        recency.set(id, Math.max(recency.get(id) ?? 0, block.lastEditedAt ?? 0));
      }
      cursor.id = byId.get(id)?.parentId ?? null;
    }
  });

  return rows
    .filter((row) => !rules.isReadOnly(row)
      && !roots.every((root) => root.parentId === row.id)
      && roots.every((root) => rules.canMoveInto(root, row.id)))
    .map((row, index) => ({ row, index }))
    // Stable: equal recency keeps document order.
    .sort((left, right) => (recency.get(right.row.id) ?? 0) - (recency.get(left.row.id) ?? 0) || left.index - right.index)
    .map(({ row }) => {
      const database = row.parentId === null ? undefined : byId.get(row.parentId);
      const title = rowTitle(row, database);
      const { icon } = row.preservedData;
      const databaseTitle = database?.preservedData.title;

      return {
        pageId: row.id,
        ...(title === undefined ? {} : { title }),
        ...(typeof icon === 'string' && icon !== '' ? { icon: { type: 'emoji' as const, value: icon } } : {}),
        ...(typeof databaseTitle === 'string' && databaseTitle !== '' ? { path: [databaseTitle] } : {}),
      };
    });
};

/**
 * The pages whose shown title holds `query`, ignoring case.
 * @param targets - the pages
 * @param query - what the user typed
 * @param untitled - the title shown for a page without one
 */
export const filterMoveTargets = <T extends { title?: string }>(targets: readonly T[], query: string, untitled: string): T[] => {
  const needle = query.trim().toLowerCase();

  return needle === '' ? [...targets] : targets.filter((target) => (target.title || untitled).toLowerCase().includes(needle));
};
