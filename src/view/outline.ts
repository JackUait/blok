/**
 * `outlineFromOutputData` — synchronous, DOM-free extraction of a saved Blok
 * document's heading outline, for building a table of contents. Walks the
 * document in reading order (top-level blocks, then structural children), picks
 * `header` blocks, and reduces each heading's inline HTML to plain text via
 * `htmlTextContent` — so consumers no longer hand-roll a DOMParser strip (which
 * needs a DOM and drops the block ids a ToC needs for anchor links).
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import { buildDocumentModel } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { htmlTextContent } from './html-text';

import type { LooseOutputData, OutputData } from '../../types';
import { isPagePointer } from '../shared/page-pointer';
import { normalizeHeadingAnchor } from '../shared/heading-anchor';
import { OUTLINE_CONTAINERS, outlineDepths } from '../shared/outline-depths';

/**
 * One entry in a document outline.
 */
export interface OutlineItem {
  /**
   * The heading block's id, for anchor links / scroll targets. Absent when the
   * heading block carries no id.
   */
  id?: string;
  /** Heading level (the header block's `level`, clamped to 1–6). */
  level: number;
  /** Plain-text heading label (inline HTML entity-decoded, tags stripped). */
  text: string;
}

/** Clamp a raw header `level` to the 1–6 range, defaulting to 1. */
const clampLevel = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(6, Math.max(1, Math.trunc(value)));
};

/**
 * Extract the heading outline of a saved Blok document, synchronously and
 * DOM-free. Headings with empty (or whitespace-only) text are skipped — they
 * carry no label for a table of contents.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns the outline items in document reading order (empty for heading-less/malformed documents)
 */
export const outlineFromOutputData = (
  data: OutputData | LooseOutputData | null | undefined
): OutlineItem[] => {
  const model: DocumentModel = buildDocumentModel(data);
  const outline: OutlineItem[] = [];

  /** Ids currently on the walk stack — breaks parent-reference cycles. */
  const active = new Set<string>();

  /** Append an outline item for a header block with non-empty text. */
  const collectHeader = (block: ViewBlock): void => {
    if (block.type !== 'header') {
      return;
    }

    const text = htmlTextContent(typeof block.data.text === 'string' ? block.data.text : '');

    if (text.trim() === '') {
      return;
    }

    outline.push({
      ...(block.id !== undefined ? { id: block.id } : {}),
      level: clampLevel(block.data.level),
      text,
    });
  };

  const visit = (block: ViewBlock): void => {
    if (block.id !== undefined && active.has(block.id)) {
      return;
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      collectHeader(block);

      /** A page's body lives in another document; children here are malformed. */
      if (!isPagePointer(block.type, block.data)) {
        model.childrenOf(block.id).forEach(visit);
      }
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  model.topLevel.forEach(visit);

  return outline;
};

/** One entry of a rendered table of contents. */
export interface TocEntry {
  /** The heading block. */
  block: ViewBlock;
  /** The fragment the entry links to: the heading's anchor, else its block id. */
  target: string;
  /** Indent depth, 0 at the margin. */
  depth: number;
  /** Plain-text label, whitespace collapsed. */
  text: string;
}

/**
 * The table of contents of a saved document, by the editor tool's rule: only
 * headings on a path of {@link OUTLINE_CONTAINERS} count, and an empty or
 * unaddressable heading is skipped.
 * @param model - document model
 * @returns null when the document has no table_of_contents block, else its entries
 */
export const tableOfContents = (model: DocumentModel): TocEntry[] | null => {
  const candidates: Array<{ block: ViewBlock; target: string }> = [];
  const active = new Set<string>();
  const tocBlocks: ViewBlock[] = [];

  const visit = (block: ViewBlock, onOutline: boolean): void => {
    if (block.id !== undefined && active.has(block.id)) {
      return;
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      if (block.type === 'table_of_contents') {
        tocBlocks.push(block);
      }

      const target = normalizeHeadingAnchor(block.data.anchor) ?? block.id;

      if (onOutline && block.type === 'header' && target !== undefined) {
        candidates.push({ block, target });
      }

      if (!isPagePointer(block.type, block.data)) {
        const childrenOnOutline = onOutline && OUTLINE_CONTAINERS.has(block.type);

        model.childrenOf(block.id).forEach((child) => visit(child, childrenOnOutline));
      }
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  model.topLevel.forEach((block) => visit(block, true));

  if (tocBlocks.length === 0) {
    return null;
  }

  const headings = candidates
    .map((candidate) => ({
      ...candidate,
      text: htmlTextContent(typeof candidate.block.data.text === 'string' ? candidate.block.data.text : '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((heading) => heading.text !== '');
  // Same clamp as the header emitter, so the depth follows the rendered tag.
  const depths = outlineDepths(headings.map(({ block }) => Math.min(Math.max(Number(block.data.level) || 1, 1), 6)));

  return headings.map((heading, index) => ({ ...heading, depth: depths[index] }));
};
