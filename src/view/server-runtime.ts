import type { LooseOutputBlockData, LooseOutputData } from '../../types/data-formats/output-data';
// Imported by file rather than through `src/components/utils`: the barrel
// reaches the DOM, this module does not.
import { getBlokVersion } from '../components/utils/version';
import { markdownToBlocksWithReport } from '../markdown';
import { blocksToHtml } from './blocks-to-html';
import type { MarkdownDegradation } from './blocks-to-markdown';
import { blocksToMarkdownWithReport } from './blocks-to-markdown';
import type { BlocksToPlainTextOptions } from './blocks-to-plain-text';
import { blocksToPlainText } from './blocks-to-plain-text';
import { blokDocumentSchema } from './document-schema';
import type { DocumentTextsOptions } from './document-texts';
import { extractTexts, injectTexts } from './document-texts';

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

  return {
    type: block.type,
    ...(block.data === undefined ? {} : { data: block.data }),
    ...(block.id === undefined ? {} : { id: block.id }),
    ...(parent === undefined ? {} : { parent }),
  };
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

  return { document: { blocks }, skipped: input.blocks.length - blocks.length };
};

/**
 * Parse a document envelope.
 * @param inputJson - the serialized envelope
 */
const parseDocument = (inputJson: string): ParsedDocument => readDocument(parseRecord(inputJson));

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
 * routed through `parseDocument`: it drops a block it cannot read, and
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
    options: { includeCode: input.includeCode === true },
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
  options: BlocksToPlainTextOptions;
} => {
  const input = parseRecord(inputJson);
  const wrapped = !Array.isArray(input.blocks) && isRecord(input.document) ? input.document : input;

  return {
    /** Still through `readDocument`: a read-only operation drops a block it cannot read. */
    document: readDocument(wrapped).document,
    options: { includeHiddenText: input.includeHiddenText === true },
  };
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

export const invoke = async (operation: string, inputJson: string): Promise<string> => {
  switch (operation) {
    case 'markdownToBlocks':
      return JSON.stringify(await markdownToBlocksWithReport(parseMarkdown(inputJson)));
    case 'blocksToHtml':
      return blocksToHtml(parseDocument(inputJson).document);
    /**
     * Returns JSON rather than a bare string: a consumer handing Markdown to
     * something that cannot ask a follow-up question needs to know which
     * constructs degraded on the way out.
     */
    case 'blocksToMarkdown': {
      const { document, skipped } = parseDocument(inputJson);
      const report = blocksToMarkdownWithReport(document);

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
    default:
      throw new TypeError(`Unsupported Blok runtime operation: ${operation}`);
  }
};

Reflect.set(globalThis, 'blokServerInvoke', invoke);
