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
      model.childrenOf(block.id).forEach(visit);
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  model.topLevel.forEach(visit);

  return outline;
};
