/**
 * `blocksToPlainText` — synchronous, DOM-free extraction of a saved Blok
 * document's readable text. Separators: blank line between top-level blocks,
 * single newline between list items, single newline between the several fields
 * of one block, tab between table cells within a row.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import { databaseRowTitle, inRowOrder, titlePropertyIdOf } from '../shared/database-rows';
import { buildDocumentModel } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { createHtmlRenderer } from './blocks-to-html';
import type { BlocksToHtmlOptions } from './blocks-to-html';
import { blokDocumentSchema } from './document-schema';
import { htmlTextContent } from './html-text';
import { claimedCellTexts, isSyntheticCell, leadingCellText, repairedTableRows } from './table-grid';

import type { LooseOutputData, OutputData } from '../../types';
import { ownEntry } from '../shared/own-entry';
import { isPagePointer } from '../shared/page-pointer';
import { PAGE_REFERENCE_FALLBACK } from '../shared/page-reference';

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

interface IndexBlockVisit {
  block: ViewBlock;
  sourceBlockId: string | null;
  ownText: string;
  order: number;
  inTable: boolean;
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

/** Every block id named by a table cell, including covered cells. */
export const referencedCellIds = (block: ViewBlock): Set<string> => {
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
 * Read one document for plain text and, optionally, block-level index facts.
 * @param data - saved document
 * @param options - plain-text options
 * @param onBlock - receives blocks in reading order
 */
const readPlainText = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToPlainTextOptions,
  onBlock?: (visit: IndexBlockVisit) => void
): PlainTextResult => {
  const model: DocumentModel = buildDocumentModel(data);
  const sourceBlockId = (block: ViewBlock): string | null =>
    block.id !== undefined && !model.syntheticIds.has(block.id) ? block.id : null;
  const renderers = options.renderers ?? {};
  const htmlRenderer = createHtmlRenderer(model, options);
  const includeHidden = options.includeHiddenText === true;
  const inlineText = (value: unknown): string => htmlTextContent(
    typeof value === 'string' ? value : '',
    (pageId) => {
      const info = options.pageInfo?.(pageId);

      return info !== null && info !== undefined && info.access !== 'none' && typeof info.title === 'string' && info.title.trim() !== ''
        ? info.title
        : PAGE_REFERENCE_FALLBACK;
    }
  );

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
    if (KNOWN_BLOCK_TYPES.has(block.type) || ownEntry(renderers, block.type) !== undefined) {
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
  /** Title property id of each row's database, filled as the walk enters a database. */
  const rowTitleIds = new Map<string, string>();
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
      /** A tab title is plain text, so it is read raw rather than as HTML. */
      case 'tab':
        return typeof block.data.title === 'string' ? block.data.title : '';
      case 'database':
        return typeof block.data.title === 'string' ? block.data.title : '';
      case 'database-row':
        return databaseRowTitle(block, block.id === undefined ? undefined : rowTitleIds.get(block.id));
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
      case 'page':
      case 'page-link': {
        if (block.type === 'page' && !isPagePointer(block.type, block.data)) {
          return '';
        }
        const pageId = block.data.pageId;
        const info = typeof pageId === 'string' && pageId !== '' ? options.pageInfo?.(pageId) : undefined;

        if (info === null) {
          return 'Page not found';
        }
        if (info === undefined) {
          return 'Page';
        }
        if (info.access === 'none') {
          return 'No access';
        }

        return typeof info.title === 'string' && info.title !== '' ? info.title : 'New page';
      }
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
  const indexedTablePointers = new Set<string>();
  const deepText = (block: ViewBlock, tableOrder: number): string => {
    if (block.id !== undefined && active.has(block.id)) {
      return '';
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      noteUnreadable(block);

      const pointer = isPagePointer(block.type, block.data) || block.type === 'page-link';
      const text = block.type === 'table' ? tableText(block, tableOrder) : ownText(block);
      const displayedText = pointer && onBlock !== undefined ? '' : text;

      if (pointer && onBlock !== undefined && block.id !== undefined && !indexedTablePointers.has(block.id)) {
        indexedTablePointers.add(block.id);
        onBlock({ block, sourceBlockId: sourceBlockId(block), ownText: displayedText, order: tableOrder, inTable: true });
      }

      const referenced = block.type === 'table' ? referencedCellIds(block) : undefined;
      const children = pointer ? [] : model.childrenOf(block.id)
        .filter((child) => referenced === undefined || child.id === undefined || !referenced.has(child.id));
      const parts = [displayedText, ...children.map((child) => deepText(child, tableOrder))];

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
  const tableText = (block: ViewBlock, order: number): string => {
    const rows = repairedTableRows(block.data.content);

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

      const leading = leadingCellText(cell);
      const own = kids.length > 0
        ? [...(leading === undefined ? [] : [inlineText(leading)]), ...kids.map((kid) => deepText(kid, order))]
        : [inlineText(cell.text)];

      return [...own, ...claimedCellTexts(cell).map(inlineText)].filter((part) => part !== '').join('\n');
    };

    return rows
      .map((row) => {
        const visible = row.filter((cell) => !(isRecord(cell) && cell.mergedInto !== undefined));

        while (visible.length > 0 && isSyntheticCell(visible[visible.length - 1])) {
          visible.pop();
        }

        return visible.map(cellText).join('\t');
      })
      .filter((row) => row.replace(/\t/g, '') !== '')
      .join('\n');
  };

  /**
   * The block's own segments (no children). Empty texts produce no segment,
   * so contentless blocks add no stray separators.
   * @param block - block to read
   */
  const ownSegments = (block: ViewBlock, order: number): Segment[] => {
    const custom = ownEntry(renderers, block.type);

    if (custom !== undefined) {
      const text = htmlTextContent(custom(block.data, htmlRenderer.ctxFor(block)));

      return text === '' ? [] : [{ text, isList: false }];
    }

    noteUnreadable(block);

    const text = block.type === 'table' ? tableText(block, order) : ownText(block);

    return text === '' ? [] : [{ text, isList: block.type === 'list' }];
  };

  /**
   * Walk one block into segments (its own text, then its children's).
   * @param block - block to walk
   * @param segments - accumulator
   */
  const order = { value: 0 };
  /** A database reads its rows in their manual order, each titled from the database's title property. */
  const childrenInReadingOrder = (block: ViewBlock): ViewBlock[] => {
    const children = model.childrenOf(block.id);

    if (block.type !== 'database') {
      return children;
    }
    const titleId = titlePropertyIdOf(block.data);
    const rows = inRowOrder(children.filter((child) => child.type === 'database-row'));

    rows.forEach((row) => {
      if (row.id !== undefined && titleId !== undefined) {
        rowTitleIds.set(row.id, titleId);
      }
    });

    return [...rows, ...children.filter((child) => child.type !== 'database-row')];
  };
  const visit = (block: ViewBlock, segments: Segment[]): void => {
    if (block.id !== undefined && active.has(block.id)) {
      return;
    }

    if (block.id !== undefined) {
      active.add(block.id);
    }

    try {
      const blockOrder = order.value++;
      const own = ownSegments(block, blockOrder);

      segments.push(...own);
      onBlock?.({ block, sourceBlockId: sourceBlockId(block), ownText: own[0]?.text ?? '', order: blockOrder, inTable: false });

      /**
       * A table's cells already emitted the children they name, so those are
       * not re-emitted. A child no cell names is emitted here instead of being
       * dropped — silently indexing as nothing makes content unfindable.
       */
      const referenced = block.type === 'table' && ownEntry(renderers, block.type) === undefined
        ? referencedCellIds(block)
        : undefined;

      if ((isPagePointer(block.type, block.data) || block.type === 'page-link') && ownEntry(renderers, block.type) === undefined) {
        return;
      }

      childrenInReadingOrder(block)
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
 * Extract readable text and report blocks the reader could not read.
 * @param data - saved document
 * @param options - plain-text options
 */
export const blocksToPlainTextWithReport = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToPlainTextOptions = {}
): PlainTextResult => {
  const result = readPlainText(data, options);
  const title = options.title === true ? data?.title : undefined;

  if (typeof title !== 'string' || title.trim() === '') {
    return result;
  }

  return { ...result, text: result.text === '' ? title : `${title}\n\n${result.text}` };
};

/** Block facts for the internal page index, using the same text walk. */
export const collectPageIndexBlocks = (
  data: OutputData | LooseOutputData | null | undefined
): IndexBlockVisit[] => {
  const visits: IndexBlockVisit[] = [];

  readPlainText(data, {}, (visit) => visits.push(visit));

  return visits;
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
