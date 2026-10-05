import { DATA_ATTR } from '../../components/constants/data-attributes';

/**
 * One heading a table of contents links to.
 */
export interface TocHeading {
  /** The heading block's id: the link fragment and the scroll target. */
  id: string;
  /** Heading level, 1–6. */
  level: number;
  /** Plain text, whitespace collapsed. */
  text: string;
}

/**
 * Containers whose headings still count as the page's own, as in Notion.
 * A heading inside anything else (toggle, list, quote, a toggle heading's
 * section) is folded content and stays out.
 */
const OUTLINE_CONTAINERS = new Set(['column_list', 'column', 'callout']);

const HEADER_ROOT = `[${DATA_ATTR.tool}="header"]`;
const HOLDER = `[${DATA_ATTR.element}]`;

const readLevel = (root: Element): number => {
  const level = Number.parseInt(root.getAttribute(DATA_ATTR.headingLevel) ?? '', 10);

  return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1;
};

/** True when every block holder between `holder` and `root` is an outline container. */
const isOnOutlinePath = (holder: Element, root: Element): boolean => {
  const parent = holder.parentElement?.closest(HOLDER) ?? null;

  if (parent === null || !root.contains(parent)) {
    return true;
  }

  return OUTLINE_CONTAINERS.has(parent.getAttribute(DATA_ATTR.component) ?? '') && isOnOutlinePath(parent, root);
};

/**
 * Reads the headings of one editor from its DOM, in reading order.
 *
 * The DOM, not the block store: the store's flat order puts nested children at
 * its tail, while holders are mounted in document order. The header tool stamps
 * its root with the literal `header`, so a host that registers it under
 * another name is still read.
 * @param root - the editor's redactor
 */
export const collectHeadings = (root: Element): TocHeading[] => {
  return Array.from(root.querySelectorAll(HEADER_ROOT)).flatMap((heading): TocHeading[] => {
    const holder = heading.closest(HOLDER);
    const id = holder?.getAttribute(DATA_ATTR.id) ?? '';
    const text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();

    if (holder === null || !root.contains(holder) || id === '' || text === '' || !isOnOutlinePath(holder, root)) {
      return [];
    }

    return [ { id, level: readLevel(heading), text } ];
  });
};
