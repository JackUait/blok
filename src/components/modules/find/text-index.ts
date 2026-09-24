/**
 * Turns the editor's DOM into searchable text and maps matches back to Ranges.
 *
 * Text is read from the DOM, not from block data or `block.inputs`: read-only
 * tools render their content with contenteditable="false", and some content
 * (database views, file names) never lives in an input at all.
 */
import { DATA_ATTR } from '../../constants/data-attributes';
import type { FindOptions } from './match-text';
import { findTextMatches } from './match-text';

/**
 * Elements whose text forms one searchable run. A match never crosses from one
 * run into another, so it never spans two blocks or two table cells.
 */
const UNIT_SELECTOR = [
  '[contenteditable]',
  'div', 'p', 'li', 'ul', 'ol', 'td', 'th', 'tr', 'table',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'blockquote', 'figure', 'figcaption', 'summary', 'details', 'dt', 'dd', 'label', 'section',
].join(', ');

const SKIPPED_SELECTOR = [
  `[${DATA_ATTR.chrome}]`,
  'script', 'style', 'template', 'noscript', 'textarea', 'input', 'select', 'svg',
].join(', ');

interface Segment {
  /** Null for a line break, which reads as a space. */
  node: Text | null;
  start: number;
  end: number;
}

interface TextUnit {
  element: Element;
  text: string;
  segments: Segment[];
}

const collectUnits = (root: Element): TextUnit[] => {
  const units: TextUnit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof Element) {
        return node.matches(SKIPPED_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Node[] = [];

  while (walker.nextNode() !== null) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((node) => {
    const isBreak = node instanceof HTMLBRElement;

    if (!isBreak && !(node instanceof Text)) {
      return;
    }

    const piece = isBreak ? '\n' : (node).data;
    const element = (isBreak ? node as Element : node.parentElement)?.closest(UNIT_SELECTOR) ?? root;

    if (piece === '') {
      return;
    }

    const last = units[units.length - 1];
    const unit = last?.element === element ? last : { element, text: '', segments: [] };

    if (unit !== last) {
      units.push(unit);
    }

    unit.segments.push({
      node: isBreak ? null : node,
      start: unit.text.length,
      end: unit.text.length + piece.length,
    });
    unit.text += piece;
  });

  return units;
};

/**
 * DOM position of a start offset: the first text segment that extends past it.
 * @param segments - the unit's segments
 * @param offset - offset in the unit's text
 */
const startPoint = (segments: Segment[], offset: number): [Text, number] | null => {
  const segment = segments.find((s) => s.node !== null && s.end > offset);

  return segment?.node ? [segment.node, Math.max(0, offset - segment.start)] : null;
};

/**
 * DOM position of an end offset: the last text segment that starts before it.
 * @param segments - the unit's segments
 * @param offset - offset in the unit's text
 */
const endPoint = (segments: Segment[], offset: number): [Text, number] | null => {
  const segment = [...segments].reverse().find((s) => s.node !== null && s.start < offset);

  return segment?.node ? [segment.node, Math.min(segment.node.length, offset - segment.start)] : null;
};

/**
 * Every match of `query` under `root`, as Ranges in document order.
 * @param root - element to search, usually the redactor
 * @param query - what the user typed
 * @param options - case and whole-word switches
 */
export const findRanges = (root: Element, query: string, options: FindOptions = {}): Range[] => {
  if (query.trim() === '') {
    return [];
  }

  return collectUnits(root).flatMap((unit) =>
    findTextMatches(unit.text, query, options).flatMap(({ start, end }) => {
      const from = startPoint(unit.segments, start);
      const to = endPoint(unit.segments, end);

      if (from === null || to === null) {
        return [];
      }

      const range = document.createRange();

      range.setStart(...from);
      range.setEnd(...to);

      return [range];
    })
  );
};
