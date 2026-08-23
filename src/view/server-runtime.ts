import type { LooseOutputBlockData, LooseOutputData } from '../../types/data-formats/output-data';
import { markdownToBlocks } from '../markdown';
import { blocksToHtml } from './blocks-to-html';
import { blocksToPlainText } from './blocks-to-plain-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (inputJson: string): Record<string, unknown> => {
  const input: unknown = JSON.parse(inputJson);

  if (!isRecord(input)) {
    throw new TypeError('Blok runtime input must be a JSON object.');
  }

  return input;
};

const parseBlock = (block: unknown): LooseOutputBlockData => {
  if (!isRecord(block) || typeof block.type !== 'string' || block.type === '') {
    throw new TypeError('Document input requires valid block objects.');
  }

  if (block.data !== undefined && block.data !== null && !isRecord(block.data)) {
    throw new TypeError('Document input requires valid block objects.');
  }

  if (block.id !== undefined && block.id !== null && typeof block.id !== 'string') {
    throw new TypeError('Document input requires valid block objects.');
  }

  if (block.parent !== undefined && block.parent !== null && typeof block.parent !== 'string') {
    throw new TypeError('Document input requires valid block objects.');
  }

  return {
    type: block.type,
    ...(block.data === undefined ? {} : { data: block.data }),
    ...(block.id === undefined ? {} : { id: block.id }),
    ...(block.parent === undefined ? {} : { parent: block.parent }),
  };
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

  return { blocks: input.blocks.map(parseBlock) };
};

export const invoke = async (operation: string, inputJson: string): Promise<string> => {
  switch (operation) {
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

Reflect.set(globalThis, 'blokServerInvoke', invoke);
