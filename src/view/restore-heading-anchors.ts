/**
 * Repair in-document links that lost their target during an import.
 *
 * HTML addresses its own sections by an `id` on the heading — Google Docs writes
 * `<h2 id="h.2y1ok8y7pef0">` and links its table of contents to
 * `#h.2y1ok8y7pef0`. A converter that mints its own block ids and drops the
 * source ones leaves the links pointing at nothing, and the id itself is gone
 * for good: it existed only in the source file.
 *
 * What survives is the link's own text, because that is how a table of contents
 * is written — the link says the heading's name. This pass reads that text back
 * and hands the fragment to the heading it names, as `data.anchor`.
 *
 * It WRITES content, so it guesses far less than a render-time fallback may:
 * only headings with no anchor yet, only an exact text match, and only when
 * exactly one heading and one fragment claim each other. Anything less certain
 * is left alone and reported.
 *
 * Host-called on purpose — a heuristic that rewrites a document belongs in a
 * one-off upgrade the host decides to run, not in every load. Expects a
 * document already in Blok's hierarchical shape (migrate legacy data first).
 *
 * parse5-backed and DOM-free, so it runs in a Node script over stored records.
 */
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

import { normalizeHeadingAnchor } from '../shared/heading-anchor';
import { htmlTextContent } from './html-text';

import type { OutputBlockData, OutputData } from '../../types';

type P5ChildNode = DefaultTreeAdapterMap['childNode'];

/** Why a referenced fragment was left as it was. */
export type HeadingAnchorSkipReason = 'no-match' | 'ambiguous';

/** One fragment handed back to the heading that answers to it. */
export interface RestoredHeadingAnchor {
  /** The fragment, without the leading "#". */
  anchor: string;
  /** Id of the header block it was written onto. */
  blockId: string;
}

/** A fragment the pass refused to place, and why. */
export interface SkippedHeadingAnchor {
  /** The fragment, without the leading "#". */
  anchor: string;
  /** `no-match` — no heading carries that text; `ambiguous` — more than one candidate. */
  reason: HeadingAnchorSkipReason;
}

/** What one pass did, for a host that wants to log or gate on it. */
export interface HeadingAnchorReport {
  /** Fragments placed onto a heading, in the order they were referenced. */
  restored: RestoredHeadingAnchor[];
  /** Dead fragments left alone, in the order they were referenced. */
  skipped: SkippedHeadingAnchor[];
}

/** The repaired document plus the report for the pass that produced it. */
export interface HeadingAnchorResult {
  data: OutputData;
  report: HeadingAnchorReport;
}

/**
 * Compare heading text and link text on the only footing they share: their
 * words. Markup, entities and stray whitespace differ freely between the two
 * (`<b>КЛН   управляющего </b>` is the same label as the heading's styled span),
 * but punctuation stays significant — this pass writes data, so it should fail
 * to match rather than match something else.
 * @param text - plain text from a heading or a link
 * @returns a comparable label, '' when there is no text at all
 */
const normalizeLabel = (text: string): string =>
  text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Decode a fragment, tolerating a malformed percent-sequence.
 * @param raw - the fragment, without the leading "#"
 */
const decodeFragment = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** One in-document link: the fragment it points at and the label it shows. */
interface FragmentLink {
  anchor: string;
  label: string;
}

/**
 * Collect every same-document link in an HTML fragment.
 * @param html - fragment markup
 * @param found - accumulator, in document order
 */
const linkFromNode = (node: P5ChildNode): FragmentLink | null => {
  if (node.nodeName !== 'a' || !('attrs' in node)) {
    return null;
  }

  const href = node.attrs.find((attr) => attr.name === 'href')?.value ?? '';

  // A bare "#" addresses nothing.
  if (!href.startsWith('#') || href.length === 1) {
    return null;
  }

  return {
    anchor: decodeFragment(href.slice(1)),
    label: normalizeLabel(elementText(node)),
  };
};

const collectLinks = (nodes: P5ChildNode[], found: FragmentLink[]): void => {
  for (const node of nodes) {
    const link = linkFromNode(node);

    if (link !== null) {
      found.push(link);
    }

    if ('childNodes' in node) {
      collectLinks(node.childNodes, found);
    }
  }
};

/**
 * Plain text of a parse5 element, reusing the view's own extraction so entities
 * and `<br>` read the same way they do everywhere else.
 * @param node - element whose text is wanted
 */
const elementText = (node: P5ChildNode): string => {
  if (!('childNodes' in node)) {
    return '';
  }

  const text: string[] = [];

  const walk = (nodes: P5ChildNode[]): void => {
    for (const child of nodes) {
      if (child.nodeName === '#text') {
        text.push((child as DefaultTreeAdapterMap['textNode']).value);
      } else if ('childNodes' in child) {
        walk(child.childNodes);
      }
    }
  };

  walk(node.childNodes);

  return text.join('');
};

/**
 * Walk every string a block's data holds, wherever it is nested.
 *
 * Links live in a paragraph's `text`, a list item's `text`, a table's nested
 * cell arrays — a per-type field registry would miss whichever shape is added
 * next, and walking strings costs the same.
 * @param value - any value from a block's data
 * @param found - accumulator, in document order
 */
const collectFromValue = (value: unknown, found: FragmentLink[]): void => {
  if (typeof value === 'string') {
    if (value.includes('#')) {
      collectLinks(parseFragment(value).childNodes, found);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectFromValue(item, found));

    return;
  }

  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => collectFromValue(item, found));
  }
};

/** Whether a block is a heading with usable text and no anchor of its own. */
const isRepairableHeading = (block: OutputBlockData): boolean =>
  block.type === 'header' &&
  block.id !== undefined &&
  normalizeHeadingAnchor(block.data.anchor) === undefined;

/**
 * Hand every dead in-document fragment back to the heading its link names.
 *
 * @param data - a saved document in Blok's hierarchical shape
 * @returns a new document with anchors filled in, and what the pass decided
 */
export const restoreHeadingAnchors = (data: OutputData): HeadingAnchorResult => {
  const blocks = data.blocks ?? [];

  /**
   * A fragment is live when something already answers to it — a heading's own
   * anchor, or a block id, which is the other namespace a Blok deep link uses.
   */
  const live = new Set<string>();

  blocks.forEach((block) => {
    const anchor = block.type === 'header' ? normalizeHeadingAnchor(block.data.anchor) : undefined;

    if (anchor !== undefined) {
      live.add(anchor);
    }

    if (block.id !== undefined) {
      live.add(block.id);
    }
  });

  const links: FragmentLink[] = [];

  blocks.forEach((block) => collectFromValue(block.data, links));

  /** Candidate headings by label; a label claimed twice can never be resolved. */
  const byLabel = new Map<string, string[]>();

  blocks.forEach((block) => {
    if (!isRepairableHeading(block)) {
      return;
    }

    const text = block.data.text;
    const key = typeof text === 'string' ? normalizeLabel(htmlTextContent(text)) : '';

    if (key === '') {
      return;
    }

    byLabel.set(key, [...(byLabel.get(key) ?? []), String(block.id)]);
  });

  const restored: RestoredHeadingAnchor[] = [];
  const skipped: SkippedHeadingAnchor[] = [];
  const seen = new Set<string>();
  /** Fragments that resolved to the same heading cancel each other out. */
  const claimsByBlock = new Map<string, string[]>();

  links.forEach(({ anchor, label: linkLabel }) => {
    const normalized = normalizeHeadingAnchor(anchor);

    if (normalized === undefined || live.has(normalized) || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);

    const candidates = byLabel.get(linkLabel) ?? [];

    if (candidates.length === 0) {
      skipped.push({ anchor: normalized, reason: 'no-match' });

      return;
    }

    if (candidates.length > 1) {
      skipped.push({ anchor: normalized, reason: 'ambiguous' });

      return;
    }

    const blockId = String(candidates[0]);

    claimsByBlock.set(blockId, [...(claimsByBlock.get(blockId) ?? []), normalized]);
  });

  const placed = new Map<string, string>();

  claimsByBlock.forEach((anchors, blockId) => {
    if (anchors.length > 1) {
      anchors.forEach((anchor) => skipped.push({ anchor, reason: 'ambiguous' }));

      return;
    }

    const anchor = String(anchors[0]);

    placed.set(blockId, anchor);
    restored.push({ anchor, blockId });
  });

  return {
    data: {
      ...data,
      blocks: blocks.map((block) => {
        const anchor = block.id === undefined ? undefined : placed.get(block.id);

        return anchor === undefined
          ? block
          : { ...block, data: { ...block.data, anchor } };
      }),
    },
    report: { restored, skipped },
  };
};
