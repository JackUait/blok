/**
 * Block types that are not page content: a database row's comment threads.
 * The editor reads each tool's `isAnnotation` static instead. This list is for
 * readers that have only saved data (the HTML view, exports, the C# server),
 * and a drift test keeps it equal to the built-in tools that declare the static.
 */
export const ANNOTATION_BLOCK_TYPES: ReadonlySet<string> = new Set(['database-comment']);

export const isAnnotationType = (type: unknown): boolean =>
  typeof type === 'string' && ANNOTATION_BLOCK_TYPES.has(type);

interface FlatBlock {
  id?: string;
  type?: string;
  tool?: string;
  parent?: string | null;
  parentId?: string | null;
}

/**
 * The blocks minus every annotation and everything under one. A reply hangs
 * off its thread, so dropping only the type would promote replies to the top.
 * @param blocks - a flat block list whose items name their parent
 */
export const withoutAnnotations = <T extends FlatBlock>(blocks: readonly T[]): T[] => {
  const byId = new Map<string, T>();

  for (const block of blocks) {
    if (typeof block.id === 'string') byId.set(block.id, block);
  }

  const dropped = (block: T | undefined, seen: Set<string>): boolean => {
    if (block === undefined) return false;
    if (isAnnotationType(block.type ?? block.tool)) return true;
    const parentId = block.parent ?? block.parentId ?? null;

    if (parentId === null || seen.has(parentId)) return false;

    return dropped(byId.get(parentId), seen.add(parentId));
  };

  return blocks.filter((block) => !dropped(block, new Set(typeof block.id === 'string' ? [block.id] : [])));
};
