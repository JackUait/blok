/**
 * Tints search matches in a database view with the CSS Custom Highlight API.
 * Wrapping matches in spans would change the DOM that cell editing reads, so
 * the view's DOM is never touched.
 */

/** Must match the `::highlight()` rule in database.css. */
const MATCH = 'blok-database-search-match';

/** Chrome around the rows: the title, tabs, toolbar and chip bar are not searched. */
const SKIP = '[data-blok-database-title-row], [data-blok-database-view-bar], [data-blok-database-filter-bar]';

/** `CSS.highlights` is document-global; each database keeps its own ranges. */
const paints = new Map<unknown, Range[]>();

const supported = (): boolean =>
  typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight === 'function';

const repaint = (): void => {
  if (!supported()) return;
  const ranges = [...paints.values()].flat();

  if (ranges.length === 0) {
    CSS.highlights.delete(MATCH);

    return;
  }
  CSS.highlights.set(MATCH, new Highlight(...ranges));
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesIn = (root: HTMLElement, query: string): Range[] => {
  const needle = query.trim().toLowerCase();
  const ranges: Range[] = [];

  if (needle === '') return ranges;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode() !== null) {
    if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const text = node.data;
    const haystack = text.toLowerCase();

    // Lowercasing can change a string's length; such a node's offsets would be wrong.
    if (node.parentElement?.closest(SKIP) != null || haystack.length !== text.length) continue;
    const starts = [...haystack.matchAll(new RegExp(escapeRegExp(needle), 'g'))].map((match) => match.index);

    for (const at of starts) {
      const range = document.createRange();

      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }

  return ranges;
};

/** Paints `query`'s matches under `root` for `owner`, replacing its earlier paint. */
export const paintSearchMatches = (owner: unknown, root: HTMLElement | null, query: string): void => {
  if (!supported()) return;
  const ranges = root === null ? [] : matchesIn(root, query);

  if (ranges.length === 0) {
    if (paints.delete(owner)) repaint();

    return;
  }
  paints.set(owner, ranges);
  repaint();
};

export const clearSearchMatches = (owner: unknown): void => {
  if (paints.delete(owner)) repaint();
};
