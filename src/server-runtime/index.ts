import type { LooseOutputData } from '../../types/data-formats/output-data';
import { markdownToBlocks } from '../markdown';
import { blocksToHtml, blocksToPlainText } from '../view';

type RuntimeOperation = 'markdownToBlocks' | 'blocksToHtml' | 'blocksToPlainText';

const parseRecord = (inputJson: string): Record<string, unknown> => {
  const input: unknown = JSON.parse(inputJson);

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Blok runtime input must be a JSON object.');
  }

  return input as Record<string, unknown>;
};

const parseMarkdown = (inputJson: string): string => {
  const input = parseRecord(inputJson);

  if (typeof input.markdown !== 'string') {
    throw new TypeError('markdownToBlocks input requires a `markdown` string.');
  }

  return input.markdown;
};

const parseDocument = (inputJson: string): LooseOutputData => {
  const input = parseRecord(inputJson);

  if (!Array.isArray(input.blocks)) {
    throw new TypeError('Document input requires a `blocks` array.');
  }

  return input as unknown as LooseOutputData;
};

export const invoke = async (operation: string, inputJson: string): Promise<string> => {
  switch (operation as RuntimeOperation) {
    case 'markdownToBlocks': {
      const blocks = await markdownToBlocks(parseMarkdown(inputJson));

      return JSON.stringify({ blocks });
    }
    case 'blocksToHtml':
      return blocksToHtml(parseDocument(inputJson));
    case 'blocksToPlainText':
      return blocksToPlainText(parseDocument(inputJson));
    default:
      throw new TypeError(`Unsupported Blok runtime operation: ${operation}`);
  }
};

declare global {
  var blokServerInvoke: typeof invoke;
}

globalThis.blokServerInvoke = invoke;
