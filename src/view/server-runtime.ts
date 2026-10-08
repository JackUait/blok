import type { LooseOutputBlockData, LooseOutputData, OutputData } from '../../types/data-formats/output-data';
// Imported by file rather than through `src/components/utils`: the barrel
// reaches the DOM, this module does not.
import { getBlokVersion } from '../components/utils/version';
import { markdownToBlocksWithReport } from '../markdown';
import { blocksToHtml } from './blocks-to-html';
import { htmlToBlocksWithReport } from './html-to-blocks';
import type { MarkdownDegradation } from './blocks-to-markdown';
import { blocksToMarkdownWithReport } from './blocks-to-markdown';
import type { BlocksToPlainTextOptions } from './blocks-to-plain-text';
import { blocksToPlainText, blocksToPlainTextWithReport } from './blocks-to-plain-text';
import { blokDocumentSchema } from './document-schema';
import type { DocumentTextsOptions } from './document-texts';
import { extractTexts, injectTexts } from './document-texts';
import { findRemapProblems, remapPageDocument } from './page-document-remap';
import { pageIndex } from './page-index';
import { htmlToSegmentsNode } from './rich-text-parse5';
import type { PageIcon, PageInfo } from '../../types/tools/page';
import type { RichText } from '../../types/rich-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (inputJson: string): Record<string, unknown> => {
  const input: unknown = JSON.parse(inputJson);

  if (!isRecord(input)) {
    throw new TypeError('Blok runtime input must be a JSON object.');
  }

  return input;
};

/**
 * Read one block off the wire, or `undefined` when it is not shaped like a
 * block. A malformed block is skipped rather than thrown on: a caller storing
 * hand-edited documents must not lose a whole article to one bad entry.
 * @param block - the value to read
 */
const readBlock = (block: unknown): LooseOutputBlockData | undefined => {
  if (!isRecord(block) || typeof block.type !== 'string' || block.type === '') {
    return undefined;
  }

  if (block.data !== undefined && block.data !== null && !isRecord(block.data)) {
    return undefined;
  }

  if (block.id !== undefined && block.id !== null && typeof block.id !== 'string') {
    return undefined;
  }

  // The renderer's own wire shape names it `parentId`; a saved document names
  // it `parent`. Both reach this boundary, so both are read.
  const parent = block.parent ?? block.parentId;

  if (parent !== undefined && parent !== null && typeof parent !== 'string') {
    return undefined;
  }

  /**
   * `content[]` is the canonical containment form, and a document may declare
   * containment ONLY that way. Ids that are not strings are left behind rather
   * than costing the whole block — the document model filters them anyway.
   */
  const content = Array.isArray(block.content)
    ? block.content.filter((id): id is string => typeof id === 'string')
    : undefined;

  return {
    type: block.type,
    ...(block.data === undefined ? {} : { data: block.data }),
    ...(block.id === undefined ? {} : { id: block.id }),
    ...(parent === undefined ? {} : { parent }),
    ...(content === undefined ? {} : { content }),
  };
};

/**
 * Read an `htmlToBlocks` request.
 * @param inputJson - the serialized request
 */
const parseHtml = (inputJson: string): string => {
  const input = parseRecord(inputJson);

  if (typeof input.html !== 'string') {
    throw new TypeError('htmlToBlocks input requires an `html` string.');
  }

  return input.html;
};

const parseMarkdown = (inputJson: string): string => {
  const input = parseRecord(inputJson);

  if (typeof input.markdown !== 'string') {
    throw new TypeError('markdownToBlocks input requires a `markdown` string.');
  }

  return input.markdown;
};

/** A parsed document plus the number of blocks that were too malformed to read. */
interface ParsedDocument {
  document: LooseOutputData;
  skipped: number;
}

/**
 * Read a parsed document. Input that is not a document at all still throws —
 * only individual blocks degrade.
 * @param input - the parsed document record
 */
const readDocument = (input: Record<string, unknown>): ParsedDocument => {
  if (!Array.isArray(input.blocks)) {
    throw new TypeError('Document input requires a `blocks` array.');
  }

  const blocks = input.blocks
    .map(readBlock)
    .filter((block): block is LooseOutputBlockData => block !== undefined);

  const icon = readPageIcon(input.icon);

  return {
    document: {
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(icon === undefined ? {} : { icon }),
      blocks,
    },
    skipped: input.blocks.length - blocks.length,
  };
};

/**
 * Read an export request: the BARE document, or `{ document, title }`. A saved
 * document always has a `blocks` key and a wrapper never does. The flag is read
 * only from a wrapper: a bare document's `title` is the title string itself.
 * @param inputJson - the serialized request
 * @param anyWrapper - plain text took a wrapper before the flag existed. The
 *   HTML and Markdown ops take one only when it carries the boolean flag, so a
 *   `{ document, pages }` sent there is still refused.
 */
const parseExportRequest = (
  inputJson: string,
  anyWrapper = false
): ParsedDocument & { input: Record<string, unknown>; title: boolean } => {
  const input = parseRecord(inputJson);
  const flagged = anyWrapper || typeof input.title === 'boolean';
  const inner = flagged && !Array.isArray(input.blocks) && isRecord(input.document) ? input.document : undefined;

  return {
    ...readDocument(inner ?? input),
    input,
    title: inner !== undefined && input.title === true,
  };
};

/**
 * Describe skipped blocks as one degradation, so a report never grows with the
 * size of the damage.
 * @param skipped - how many blocks could not be read
 */
const skippedBlockWarning = (skipped: number): MarkdownDegradation => ({
  construct: 'block',
  action: 'dropped',
  detail: skipped === 1 ? '1 malformed block was skipped' : `${skipped} malformed blocks were skipped`,
});

/**
 * The translation operations carry options and a translation list beside the
 * document, so their input wraps it rather than being it. Deliberately NOT
 * routed through `readDocument`: it drops a block it cannot read, and
 * `injectTexts` returns the document that gets STORED.
 * @param inputJson - the serialized request
 */
const parseTextsRequest = (inputJson: string): {
  document: unknown;
  texts: string[];
  options: DocumentTextsOptions;
} => {
  const input = parseRecord(inputJson);
  const texts = Array.isArray(input.texts) ? input.texts : [];

  if (texts.some((text) => typeof text !== 'string')) {
    throw new TypeError('injectTexts input requires `texts` to be strings.');
  }

  return {
    document: input.document,
    texts: texts as string[],
    options: { includeCode: input.includeCode === true, title: input.title === true },
  };
};

/**
 * Plain text takes either shape: the BARE document every caller sent before
 * options existed, or an envelope carrying them beside it. A saved document
 * always has a `blocks` key and an envelope never does, so the two are told
 * apart without a version flag.
 * @param inputJson - the serialized request
 */
const parsePlainTextRequest = (inputJson: string): {
  document: LooseOutputData;
  skipped: number;
  options: BlocksToPlainTextOptions;
} => {
  /** Still through `readDocument`: a read-only operation drops a block it cannot read. */
  const { document, skipped, input, title } = parseExportRequest(inputJson, true);

  return {
    document,
    skipped,
    options: { includeHiddenText: input.includeHiddenText === true, title },
  };
};

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const readPageIcon = (value: unknown): PageIcon | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === 'emoji' && typeof value.value === 'string') {
    return { type: 'emoji', value: value.value };
  }

  return value.type === 'image' && typeof value.url === 'string' ? { type: 'image', url: value.url } : undefined;
};

/**
 * One `pages` entry: JSON `null` is a missing page, a record is metadata, and
 * anything else is as good as unlisted.
 * @param entry - the raw entry
 */
const readPageInfo = (entry: unknown): PageInfo | null | undefined => {
  if (entry === null) {
    return null;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  const icon = readPageIcon(entry.icon);

  return {
    ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
    ...(icon === undefined ? {} : { icon }),
    ...(entry.access === 'none' ? { access: 'none' as const } : {}),
  };
};

/**
 * The page-aware export operations take ONLY an envelope, and read `pages`
 * only from its root. The shipped `blocksToHtml`/`blocksToMarkdown` stay
 * bare-only, so a document string cannot carry page metadata of its own.
 * @param inputJson - the serialized `{ document, pages }` envelope
 */
const parsePagesRequest = (inputJson: string): ParsedDocument & {
  pageInfo: (pageId: string) => PageInfo | null | undefined;
  pageHref: (pageId: string) => string;
  title: boolean;
} => {
  const input = parseRecord(inputJson);

  if (!isRecord(input.document)) {
    throw new TypeError('Page export input requires a `document` record.');
  }

  const pages = isRecord(input.pages) ? input.pages : {};
  /** Own keys only: `pages.toString` would otherwise answer for an unlisted id. */
  const entry = (pageId: string): unknown => (hasOwn(pages, pageId) ? pages[pageId] : undefined);

  return {
    ...readDocument(input.document),
    title: input.title === true,
    pageInfo: (pageId) => readPageInfo(entry(pageId)),
    pageHref: (pageId) => {
      const raw = entry(pageId);

      return isRecord(raw) && typeof raw.href === 'string' ? raw.href : '';
    },
  };
};

/**
 * The `document` of a page-function envelope, passed on RAW. `readDocument`
 * drops malformed blocks, which would shift every `order` pageIndex reports and
 * lose unknown keys from the document remap returns to be stored.
 * @param input - the parsed envelope
 * @param operation - names the operation in the error
 */
const readRawDocument = (input: Record<string, unknown>, operation: string): LooseOutputData => {
  const document = input.document;

  if (!isRecord(document) || !Array.isArray(document.blocks)) {
    throw new TypeError(`${operation} input requires a \`document\` with a \`blocks\` array.`);
  }

  return document as unknown as LooseOutputData;
};

/**
 * An `{ old: new }` id map. Only own string values count, so a bad value reads
 * as a missing mapping instead of a crash.
 * @param value - the raw map
 * @param name - names the field in the error
 */
const readIdMap = (value: unknown, name: string): Map<string, string> => {
  if (!isRecord(value)) {
    throw new TypeError(`remapPageDocument input requires \`${name}\` to be an object.`);
  }

  return new Map(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
};

/**
 * Bad id maps are the caller's mistake, so they cross the host boundary as
 * data. remapPageDocument would throw a plain Error, which the host reports as
 * an unknown failure.
 * @param inputJson - the serialized `{ document, blockIds, pageIds }` request
 */
const remapPageDocumentResult = (inputJson: string): string => {
  const input = parseRecord(inputJson);
  const document = readRawDocument(input, 'remapPageDocument') as OutputData;
  const ids = { blockIds: readIdMap(input.blockIds, 'blockIds'), pageIds: readIdMap(input.pageIds, 'pageIds') };
  const unmapped = findRemapProblems(document, ids);

  if (unmapped.missingBlockIds.length > 0 || unmapped.duplicateBlockIds.length > 0 || unmapped.idlessBlocks > 0) {
    return JSON.stringify({ unmapped });
  }

  return JSON.stringify({ document: remapPageDocument(document, ids) });
};

/**
 * Wraps its result because the one failure a caller can cause — a translation
 * list that does not match the document — has to cross the host boundary as
 * data. An engine exception would arrive as whatever the host makes of a
 * JavaScript error; a count is a count.
 * @param inputJson - the serialized request
 */
const injectTextsResult = (inputJson: string): string => {
  const { document, texts, options } = parseTextsRequest(inputJson);

  try {
    return JSON.stringify({ document: injectTexts(document, texts, options) });
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }

    return JSON.stringify({
      mismatch: { expected: extractTexts(document, options).length, received: texts.length },
    });
  }
};

interface HtmlField {
  id?: string;
  type: string;
  field: string;
  html: string;
}

/**
 * Read an `htmlFieldsToSegments` batch: a JSON array of fields. Throws on any
 * bad entry rather than skipping it — the server rewrites fields by position,
 * so a dropped entry would shift every later answer onto the wrong field.
 * @param inputJson - the serialized batch
 */
const parseHtmlFields = (inputJson: string): HtmlField[] => {
  const input: unknown = JSON.parse(inputJson);

  if (!Array.isArray(input)) {
    throw new TypeError('htmlFieldsToSegments input must be a JSON array.');
  }

  return input.map((entry: unknown, index): HtmlField => {
    if (
      !isRecord(entry)
      || typeof entry.type !== 'string'
      || typeof entry.field !== 'string'
      || typeof entry.html !== 'string'
      || (entry.id !== undefined && entry.id !== null && typeof entry.id !== 'string')
    ) {
      throw new TypeError(`htmlFieldsToSegments entry ${index} needs string \`type\`, \`field\` and \`html\` (and a string \`id\` if any).`);
    }

    return {
      ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
      type: entry.type,
      field: entry.field,
      html: entry.html,
    };
  });
};

export const invoke = async (operation: string, inputJson: string): Promise<string> => {
  switch (operation) {
    case 'markdownToBlocks':
      return JSON.stringify(await markdownToBlocksWithReport(parseMarkdown(inputJson)));
    /**
     * The inverse of `blocksToHtml`, and the twin of `markdownToBlocks` — same
     * envelope, same warning vocabulary. A caller importing HTML has to be told
     * what did not survive, so the report rides along.
     */
    case 'htmlToBlocks':
      return JSON.stringify(htmlToBlocksWithReport(parseHtml(inputJson)));
    case 'blocksToHtml': {
      const { document, title } = parseExportRequest(inputJson);

      return blocksToHtml(document, { title });
    }
    /**
     * Returns JSON rather than a bare string: a consumer handing Markdown to
     * something that cannot ask a follow-up question needs to know which
     * constructs degraded on the way out.
     */
    case 'blocksToMarkdown': {
      const { document, skipped, title } = parseExportRequest(inputJson);
      const report = blocksToMarkdownWithReport(document, { title });

      if (skipped > 0) {
        report.warnings.push(skippedBlockWarning(skipped));
      }

      return JSON.stringify(report);
    }
    case 'blocksToHtmlWithPages': {
      const { document, pageInfo, pageHref, title } = parsePagesRequest(inputJson);

      return blocksToHtml(document, { pageInfo, pageHref, title });
    }
    case 'blocksToMarkdownWithPages': {
      const { document, skipped, pageInfo, pageHref, title } = parsePagesRequest(inputJson);
      const report = blocksToMarkdownWithReport(document, { pageInfo, pageHref, title });

      if (skipped > 0) {
        report.warnings.push(skippedBlockWarning(skipped));
      }

      return JSON.stringify(report);
    }
    case 'blocksToPlainText': {
      const { document, options } = parsePlainTextRequest(inputJson);

      return blocksToPlainText(document, options);
    }
    /**
     * The same text, plus what the reader could make nothing of — so a caller
     * can tell a document that holds no text from one whose every block is a
     * tool this reader has never heard of. Both read as ''.
     */
    case 'blocksToPlainTextWithReport': {
      const { document, skipped, options } = parsePlainTextRequest(inputJson);
      const report = blocksToPlainTextWithReport(document, options);

      if (skipped > 0) {
        report.warnings.push(skippedBlockWarning(skipped));
      }

      return JSON.stringify(report);
    }
    /**
     * The cheap yes/no question: is this a document, does it hold anything, and
     * did the reader understand it? One walk, and nothing is serialized beyond
     * the text the emptiness test needs.
     */
    case 'inspect': {
      const { document, skipped, options } = parsePlainTextRequest(inputJson);
      const { text, warnings } = blocksToPlainTextWithReport(document, options);

      return JSON.stringify({
        blockCount: document.blocks.length,
        malformedBlockCount: skipped,
        isEmpty: text === '',
        unrecognizedBlockTypes: [...new Set(warnings.map((warning) => warning.construct))],
      });
    }
    /**
     * The version the editor stamps into a saved document. A consumer writing
     * documents outside the browser reads it from here so both sides agree on
     * what a stored document says it is.
     */
    case 'version':
      return getBlokVersion();
    /**
     * The saved format described as JSON Schema, for a caller that has to
     * constrain something else — a model's structured output, an import — to
     * what Blok actually stores.
     */
    case 'schema':
      return JSON.stringify(blokDocumentSchema);
    case 'extractTexts': {
      const { document, options } = parseTextsRequest(inputJson);

      return JSON.stringify(extractTexts(document, options));
    }
    case 'injectTexts':
      return injectTextsResult(inputJson);
    case 'pageIndex':
      return JSON.stringify(pageIndex(readRawDocument(parseRecord(inputJson), 'pageIndex')));
    case 'remapPageDocument':
      return remapPageDocumentResult(inputJson);
    /**
     * Legacy HTML in rich fields → segments, for the C# server, which has no
     * parser of its own that matches this one.
     */
    case 'htmlFieldsToSegments':
      return JSON.stringify(parseHtmlFields(inputJson).map(({ html, ...address }): Omit<HtmlField, 'html'> & { segments: RichText } => ({
        ...address,
        segments: htmlToSegmentsNode(html),
      })));
    default:
      throw new TypeError(`Unsupported Blok runtime operation: ${operation}`);
  }
};

Reflect.set(globalThis, 'blokServerInvoke', invoke);
