/**
 * block-tree.ts — a tiny, dependency-free walker over a Blok document.
 *
 * In Blok, *everything is a block*: pages, database rows, even the database
 * itself. Containment is expressed with `parentId` / `contentIds`, so a whole
 * document is just a flat list of blocks plus the edges between them. This file
 * shows how a handful of pure functions turn that flat list back into a tree
 * you can fold, search, and pretty-print.
 */

export type BlockId = string;

export interface Block<Data = Record<string, unknown>> {
  readonly id: BlockId;
  readonly type: string;
  readonly data: Data;
  /** Children, in document order. Empty for leaf blocks. */
  readonly contentIds: readonly BlockId[];
  readonly parentId: BlockId | null;
}

export type BlockMap = ReadonlyMap<BlockId, Block>;

/** Index a flat block list by id so lookups are O(1) instead of O(n). */
export function indexBlocks(blocks: readonly Block[]): BlockMap {
  return new Map(blocks.map((block) => [block.id, block]));
}

/** Depth-first walk from `rootId`, yielding each block with its depth. */
export function* walk(
  map: BlockMap,
  rootId: BlockId,
  depth = 0,
): Generator<{ block: Block; depth: number }> {
  const block = map.get(rootId);
  if (block === undefined) {
    return; // dangling edge — skip rather than throw
  }

  yield { block, depth };

  for (const childId of block.contentIds) {
    yield* walk(map, childId, depth + 1);
  }
}

/** Collect every block whose `type` matches, anywhere under `rootId`. */
export function findByType(map: BlockMap, rootId: BlockId, type: string): Block[] {
  const matches: Block[] = [];
  for (const { block } of walk(map, rootId)) {
    if (block.type === type) {
      matches.push(block);
    }
  }

  return matches;
}

/** Total descendant count (excluding the root itself, which walk() also yields). */
export function countDescendants(map: BlockMap, rootId: BlockId): number {
  return Math.max(0, [...walk(map, rootId)].length - 1);
}

/** Render the subtree as an indented outline — handy for snapshots and logs. */
export function outline(map: BlockMap, rootId: BlockId): string {
  const lines: string[] = [];
  for (const { block, depth } of walk(map, rootId)) {
    const title = typeof block.data.text === 'string' ? block.data.text : `<${block.type}>`;
    lines.push(`${'  '.repeat(depth)}• ${title}`);
  }

  return lines.join('\n');
}

// --- example -------------------------------------------------------------

const doc: Block[] = [
  { id: 'page', type: 'page', data: { text: 'Roadmap' }, parentId: null, contentIds: ['h1', 'db'] },
  { id: 'h1', type: 'header', data: { text: 'Q3 goals' }, parentId: 'page', contentIds: [] },
  { id: 'db', type: 'database', data: { text: 'Tasks' }, parentId: 'page', contentIds: ['r1', 'r2'] },
  { id: 'r1', type: 'database-row', data: { text: 'Ship inline preview' }, parentId: 'db', contentIds: [] },
  { id: 'r2', type: 'database-row', data: { text: 'Polish empty states' }, parentId: 'db', contentIds: [] },
];

const map = indexBlocks(doc);

console.log(outline(map, 'page'));
console.log(`rows: ${findByType(map, 'page', 'database-row').length}`);
console.log(`descendants: ${countDescendants(map, 'page')}`);
