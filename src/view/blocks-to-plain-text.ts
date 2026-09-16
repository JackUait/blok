/**
 * `blocksToPlainText` — synchronous, DOM-free extraction of a saved Blok
 * document's readable text. Separators: blank line between top-level blocks,
 * single newline between list items, single newline between the several fields
 * of one block, tab between table cells within a row.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import { buildDocumentModel } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { createHtmlRenderer } from './blocks-to-html';
import type { BlocksToHtmlOptions } from './blocks-to-html';
import { blokDocumentSchema } from './document-schema';
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

/**
 * Every non-empty string among the given data fields, in the given order.
 * @param data - block data
 * @param keys - field names in emission order
 */
const everyString = (data: Record<string, unknown>, keys: string[]): string[] =>
  keys
    .map((key) => data[key])
    .filter((value): value is string => typeof value === 'string' && value !== '');

/**
 * Every block type this reader is meant to know: the ones the saved-document
 * schema describes, plus the legacy names imports still carry. Derived from the
 * schema rather than listed again, so a tool added there cannot be reported as
 * unrecognised here.
 *
 * Membership means "recognised", NOT "has text": a divider, a spacer and a
 * callout are all in here and all read as ''. That is exactly the distinction
 * the report exists to draw — a caller has to be able to tell a document that
 * genuinely holds no text from one this reader could make nothing of.
 */
const KNOWN_BLOCK_TYPES = new Set<string>([
  ...Object.keys(blokDocumentSchema.$defs),
  /** Editor.js's name for `divider`. */
  'delimiter',
  /** Legacy aliases, the same two `blocks-to-markdown-core.ts` accepts. */
  'toggleList',
  'columns',
]);

/** A construct the plain-text reader could not carry across as-is. */
export interface PlainTextDegradation {
  /** What degraded: the block tool's name. */
  construct: string;
  /** `dropped` — nothing was emitted; `degraded` — emitted, but lossy. */
  action: 'dropped' | 'degraded';
  /** Plain-language explanation of what was lost. */
  detail: string;
}

/** A document's readable text, and everything the reader could not read. */
export interface PlainTextResult {
  /** The extracted text. */
  text: string;
  /** Blocks that were read as nothing, in document order. */
  warnings: PlainTextDegradation[];
}

/** A rendered text segment; `isList` drives the single-newline separator. */
interface Segment {
  text: string;
  isList: boolean;
}

/** Everything `blocksToHtml` takes, plus what the default reader leaves out. */
export interface BlocksToPlainTextOptions extends BlocksToHtmlOptions {
  /**
   * Also emit the media fields the default reader drops because the editor
   * paints them as an attribute, or not at all. Exactly these, appended after
   * the block's displayed label and separated by single newlines:
   *
   * - `image`: `alt`
   * - `video`: `url`
   * - `embed`: `source`
   * - `audio`: `title`, `artist`, `url`
   * - `file`: `fileName`, `url`
   * - `bookmark`: `description`, `url`
   *
   * Default `false`. "Hidden" is relative to the DEFAULT reader, which emits
   * only the first non-empty label per block: an audio `title`, a file
   * `fileName` and a bookmark `url` are painted on screen whenever the field
   * ahead of them is empty, and are dropped whenever it is not.
   *
   * Opt-in because it emits text the live editor's `textContent` cannot
   * contain, which is what the golden harness compares this reader against.
   * Made for a search index; a preview wants the default.
   */
  includeHiddenText?: boolean;
}

/**
 * Extract the readable text of a saved Blok document AND report every block the
 * reader could make nothing of, synchronously and DOM-free.
 *
 * The text is identical to what {@link blocksToPlainText} returns; only the
 * report is new. Reach for this whenever `''` has to mean something — an empty
 * result alone cannot say whether the document holds no text or holds nothing
 * this reader understands.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - `blocksToHtml`'s options (custom renderers are rendered to HTML, then stripped), plus `includeHiddenText`
 * @returns the text and its degradations
 */
export const blocksToPlainTextWithReport = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToPlainTextOptions = {}
): PlainTextResult => {
  const model: DocumentModel = buildDocumentModel(data);
  const renderers = options.renderers ?? {};
  const htmlRenderer = createHtmlRenderer(model, options);
  const includeHidden = options.includeHiddenText === true;

  /** Ids currently on the walk stack — breaks parent-reference cycles. */
  const active = new Set<string>();

  const warnings: PlainTextDegradation[] = [];

  /**
   * Record a block whose type has no case in this reader and no renderer from
   * the caller, so it contributed nothing. Called once per block, wherever the
   * block's own text is read — including inside a table cell, which the segment
   * walk never reaches.
   * @param block - the block that was read as nothing
   */
  const noteUnreadable = (block: ViewBlock): void => {
    if (KNOWN_BLOCK_TYPES.has(block.type) || renderers[block.type] !== undefined) {
      return;
    }

    warnings.push({
      construct: block.type,
      action: 'dropped',
      detail: `\`${block.type}\` is not a block type this reader knows, so none of its own text was read`,
    });
  };

  /**
   * A media block's label. By default the first non-empty `label` field, which
   * is what the editor paints. Under `includeHiddenText`, every non-empty `all`
   * field instead.
   *
   * Media captions/titles are PLAIN TEXT, not HTML: the live caption editors
   * read/write them via `textContent` (golden-harness-proven), so they are
   * returned raw rather than entity-decoded/tag-stripped.
   * @param data - block data
   * @param label - displayed fields, in preference order
   * @param all - every field to emit under the flag, in document order
   */
  const mediaText = (data: Record<string, unknown>, label: string[], all: string[]): string =>
    (includeHidden ? everyString(data, all).join('\n') : firstString(data, label));

  /**
   * The block's own text line (no children).
   * @param block - block to read
   */
  const ownText = (block: ViewBlock): string => {
    switch (block.type) {
      case 'paragraph':
      case 'header':
      case 'toggle':
      case 'list':
        return inlineText(block.data.text);
      /**
       * A legacy quote keeps its attribution in `caption`, which the renderer
       * paints as a `<cite>`. Displayed text, so it is never behind the flag.
       */
      case 'quote':
        return [inlineText(block.data.text), inlineText(block.data.caption)]
          .filter((part) => part !== '')
          .join('\n');
      case 'code':
        return typeof block.data.code === 'string' ? block.data.code : '';
      case 'image':
        return mediaText(block.data, ['caption'], ['caption', 'alt']);
      case 'video':
        return mediaText(block.data, ['caption'], ['caption', 'url']);
      case 'embed':
        return mediaText(block.data, ['caption'], ['caption', 'source']);
      case 'audio':
        return mediaText(block.data, ['caption', 'title'], ['caption', 'title', 'artist', 'url']);
      case 'file':
        return mediaText(block.data, ['caption', 'fileName'], ['caption', 'fileName', 'url']);
      case 'bookmark':
        return mediaText(block.data, ['title', 'url'], ['title', 'description', 'url']);
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
      noteUnreadable(block);

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
   * Every block id named by any cell of a table.
   * @param block - table block
   */
  const referencedCellIds = (block: ViewBlock): Set<string> => {
    const content = Array.isArray(block.data.content) ? block.data.content : [];
    const rows = content.filter((row): row is unknown[] => Array.isArray(row));

    const cellIds = (cell: unknown): string[] => {
      if (!isRecord(cell) || !Array.isArray(cell.blocks)) {
        return [];
      }

      return cell.blocks.filter((id): id is string => typeof id === 'string');
    };

    return new Set(rows.flat().flatMap(cellIds));
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

    noteUnreadable(block);

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

      /**
       * A table's cells already emitted the children they name, so those are
       * not re-emitted. A child no cell names is emitted here instead of being
       * dropped — silently indexing as nothing makes content unfindable.
       */
      const referenced = block.type === 'table' && renderers[block.type] === undefined
        ? referencedCellIds(block)
        : undefined;

      model.childrenOf(block.id)
        .filter((child) => referenced === undefined || child.id === undefined || !referenced.has(child.id))
        .forEach((child) => visit(child, segments));
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

  /**
   * Collected then joined once. Concatenating onto an accumulator instead
   * re-allocates the whole document per block, which is quadratic: a long
   * article allocates tens of megabytes and trips the server runtime's
   * per-conversion memory limit outright.
   */
  const parts: string[] = [];

  segments.forEach((segment, index) => {
    if (index > 0) {
      parts.push(segment.isList && segments[index - 1].isList ? '\n' : '\n\n');
    }

    parts.push(segment.text);
  });

  return { text: parts.join(''), warnings };
};

/**
 * Extract the readable text of a saved Blok document, synchronously and
 * DOM-free.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - `blocksToHtml`'s options (custom renderers are rendered to HTML, then stripped), plus `includeHiddenText`
 * @returns plain text ('' for empty/malformed documents)
 */
export const blocksToPlainText = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToPlainTextOptions = {}
): string => blocksToPlainTextWithReport(data, options).text;
