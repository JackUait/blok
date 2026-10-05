import { DATA_ATTR } from '../../components/constants/data-attributes';
import { OUTLINE_CONTAINERS } from '../../shared/outline-depths';

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

const HEADER_ROOT = `[${DATA_ATTR.tool}="header"]`;
const HOLDER = `[${DATA_ATTR.element}]`;

const readLevel = (root: Element): number => {
  const level = Number.parseInt(root.getAttribute(DATA_ATTR.headingLevel) ?? '', 10);

  return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1;
};

/** The registered name, or the stamp a tool puts on its root: a host may register callout as `note`. */
const isOutlineContainer = (holder: Element): boolean => {
  const stamp = holder.querySelector(`:scope > [${DATA_ATTR.elementContent}] > [${DATA_ATTR.tool}]`)?.getAttribute(DATA_ATTR.tool);

  return OUTLINE_CONTAINERS.has(holder.getAttribute(DATA_ATTR.component) ?? '') || OUTLINE_CONTAINERS.has(stamp ?? '');
};

/** True when every block holder between `holder` and `root` is an outline container. */
const isOnOutlinePath = (holder: Element, root: Element): boolean => {
  const parent = holder.parentElement?.closest(HOLDER) ?? null;

  if (parent === null || !root.contains(parent)) {
    return true;
  }

  return isOutlineContainer(parent) && isOnOutlinePath(parent, root);
};

/** An inline equation's children are a KaTeX render cache; its source lives in `data-latex`. */
const readText = (heading: Element): string => {
  if (heading.querySelector('[data-latex]') === null) {
    return (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  const copy = heading.cloneNode(true) as Element;

  copy.querySelectorAll('[data-latex]').forEach((equation) => {
    equation.replaceWith(equation.getAttribute('data-latex') ?? '');
  });

  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
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
    const text = readText(heading);

    if (holder === null || !root.contains(holder) || id === '' || text === '' || !isOnOutlinePath(holder, root)) {
      return [];
    }

    return [ { id, level: readLevel(heading), text } ];
  });
};
