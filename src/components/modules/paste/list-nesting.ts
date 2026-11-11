/**
 * One pasted block, as the list nesting pass sees it.
 */
export interface ListNestingItem {
  /** The list item's depth, or null when the block is not a list item. */
  depth: number | null;
  /** The parent the block already has. Items nest only under a list item with the same one. */
  scope: unknown;
}

/**
 * The index of the list item each pasted list item sits under, read from the
 * depths a degraded clipboard keeps (html `aria-level`, Markdown indent).
 * An item nests only under the nearest earlier item one level up in an
 * unbroken run of list items. A skipped level, or any other block in between,
 * leaves it flat: a list parent would make the list tool reconcile its depth
 * to the tree and move its indent.
 * @param items - the pasted blocks in document order
 * @returns one parent index per item, undefined when it stays where it is
 */
export const listParentIndices = (items: ListNestingItem[]): Array<number | undefined> => {
  const run: Array<{ index: number; depth: number; scope: unknown }> = [];

  return items.map(({ depth, scope }, index) => {
    if (depth === null || (run.length > 0 && run[run.length - 1].scope !== scope)) {
      run.length = 0;
    }

    if (depth === null) {
      return undefined;
    }

    while (run.length > 0 && run[run.length - 1].depth >= depth) {
      run.pop();
    }

    const parent = run[run.length - 1];
    const nests = parent !== undefined && parent.depth === depth - 1;

    if (depth === 0 || nests) {
      run.push({ index, depth, scope });
    }

    return nests ? parent.index : undefined;
  });
};
