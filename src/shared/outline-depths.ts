/**
 * Indent depth for each heading of a table of contents.
 *
 * A heading nests under the nearest earlier heading of a higher level, so a
 * skipped level (H1 then H3) is one step, not two. DOM-free, so the editor
 * tool and a renderer of saved documents can share it.
 * @param levels - heading levels in reading order
 * @returns one depth per heading, 0 at the margin
 */
export const outlineDepths = (levels: readonly number[]): number[] => {
  const open: number[] = [];

  return levels.map((level) => {
    while (open.length > 0 && open[open.length - 1] >= level) {
      open.pop();
    }

    const depth = open.length;

    open.push(level);

    return depth;
  });
};

/**
 * Containers whose headings still count as the page's own, as in Notion.
 * A heading inside anything else (toggle, list, quote, a toggle heading's
 * section) is folded content and stays out of a table of contents.
 * `columns` is the legacy name of `column_list`.
 */
export const OUTLINE_CONTAINERS: ReadonlySet<string> = new Set(['column_list', 'columns', 'column', 'callout']);
