/**
 * `blocksToPlainText` — synchronous, DOM-free extraction of a saved Blok
 * document's readable text. Separators: blank line between top-level blocks,
 * single newline between list items, tab between table cells within a row.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import { buildDocumentModel } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { createHtmlRenderer } from './blocks-to-html';
import type { BlocksToHtmlOptions } from './blocks-to-html';
import { htmlTextContent } from './html-text';

import type { LooseOutputData, OutputData } from '../../types';

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Plain text of an inline-HTML block-data field.
 * @param value - raw field value
 */
const inlineText = (value: unknown): string => htmlTextContent(typeof value === 'string' ? value : '');

/**
 * First non-empty string among the given data fields.
 * @param data - block data
 * @param keys - field names in preference order
 */
const firstString = (data: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = data[key];

    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }

  return '';
};

/** A rendered text segment; `isList` drives the single-newline separator. */
interface Segment {
  text: string;
  isList: boolean;
}

/**
 * Extract the readable text of a saved Blok document, synchronously and
 * DOM-free.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - same options as `blocksToHtml` (custom renderers are rendered to HTML, then stripped)
 * @returns plain text ('' for empty/malformed documents)
 */
export const blocksToPlainText = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToHtmlOptions = {}
): string => {
  const model: DocumentModel = buildDocumentModel(data);
  const renderers = options.renderers ?? {};
  const htmlRenderer = createHtmlRenderer(model, options);

  /** Ids currently on the walk stack — breaks parent-reference cycles. */
  const active = new Set<string>();

  /**
   * The block's own text line (no children). Mirrors the label logic of the
   * markdown serializer for media blocks, minus URL fallbacks (plain text is
   * for previews; a bare URL is noise).
   * @param block - block to read
   */
  const ownText = (block: ViewBlock): string => {
    switch (block.type) {
      case 'paragraph':
      case 'header':
      case 'quote':
      case 'toggle':
      case 'list':
        return inlineText(block.data.text);
      case 'code':
        return typeof block.data.code === 'string' ? block.data.code : '';
      /**
       * Media captions/titles are PLAIN TEXT, not HTML: the live caption
       * editors read/write them via `textContent` (golden-harness-proven),
       * so they are returned raw rather than entity-decoded/tag-stripped.
       */
      case 'image':
      case 'video':
      case 'embed':
        return firstString(block.data, ['caption']);
      case 'audio':
        return firstString(block.data, ['caption', 'title']);
      case 'file':
        return firstString(block.data, ['caption', 'fileName']);
      case 'bookmark':
        return firstString(block.data, ['title', 'url']);
      default:
        /** divider, spacer, columns, database, unknown tools… carry no own text. */
        return '';
    }
  };

  /**
   * Deep text of one block and its descendants, joined with single newlines —
   * used for table cell content.
   * @param block - block to read
   */
  const deepText = (block: ViewBlock): string => {
    if (block.id !== undefined && active.has(block.id)) {
      return '';
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      const parts = [ownText(block), ...model.childrenOf(block.id).map(deepText)];

      return parts.filter((part) => part !== '').join('\n');
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  /**
   * Table text: rows joined with newlines, cells with tabs. Cell content is
   * either legacy inline HTML or child blocks resolved by id.
   * @param block - table block
   */
  const tableText = (block: ViewBlock): string => {
    const content = Array.isArray(block.data.content) ? block.data.content : [];
    const rows = content.filter((row): row is unknown[] => Array.isArray(row));

    const cellText = (cell: unknown): string => {
      if (typeof cell === 'string') {
        return inlineText(cell);
      }

      if (!isRecord(cell)) {
        return '';
      }

      if (cell.mergedInto !== undefined) {
        return '';
      }

      const ids = Array.isArray(cell.blocks) ? cell.blocks.filter((id): id is string => typeof id === 'string') : [];
      const kids = ids.flatMap((id) => {
        const child = model.byId.get(id);

        return child === undefined ? [] : [child];
      });

      if (kids.length > 0) {
        return kids.map(deepText).filter((part) => part !== '').join('\n');
      }

      return inlineText(cell.text);
    };

    return rows
      .map((row) => row
        .filter((cell) => !(isRecord(cell) && cell.mergedInto !== undefined))
        .map(cellText)
        .join('\t'))
      .filter((row) => row.replace(/\t/g, '') !== '')
      .join('\n');
  };

  /**
   * The block's own segments (no children). Empty texts produce no segment,
   * so contentless blocks add no stray separators.
   * @param block - block to read
   */
  const ownSegments = (block: ViewBlock): Segment[] => {
    const custom = renderers[block.type];

    if (custom !== undefined) {
      const text = htmlTextContent(custom(block.data, htmlRenderer.ctxFor(block)));

      return text === '' ? [] : [{ text, isList: false }];
    }

    const text = block.type === 'table' ? tableText(block) : ownText(block);

    return text === '' ? [] : [{ text, isList: block.type === 'list' }];
  };

  /**
   * Walk one block into segments (its own text, then its children's).
   * @param block - block to walk
   * @param segments - accumulator
   */
  const visit = (block: ViewBlock, segments: Segment[]): void => {
    if (block.id !== undefined && active.has(block.id)) {
      return;
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      segments.push(...ownSegments(block));

      /** Table children live inside the grid — never re-emitted after it. */
      if (block.type !== 'table' || renderers[block.type] !== undefined) {
        model.childrenOf(block.id).forEach((child) => visit(child, segments));
      }
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  const segments: Segment[] = [];

  for (const block of model.topLevel) {
    visit(block, segments);
  }

  return segments.reduce((out, segment, index) => {
    if (index === 0) {
      return segment.text;
    }

    const separator = segment.isList && segments[index - 1].isList ? '\n' : '\n\n';

    return out + separator + segment.text;
  }, '');
};
