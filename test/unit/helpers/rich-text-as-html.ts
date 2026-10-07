import type { OutputBlockData } from '../../../types';
import { outputBlocksToHtml } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';

const fieldsOf = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

/**
 * Importer output with its rich fields read back as HTML, for tests that pin
 * structure in HTML spelling. Throws on a rich field that is still a string,
 * so every such assertion also proves the importer emitted segments.
 * @param blocks - blocks an importer returned
 */
export const richTextAsHtml = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const html = blocks.flatMap(block => fieldsOf(block.type)
    .map((field): [string, unknown] => [`${block.type}.${field}`, (block.data as Record<string, unknown> | undefined)?.[field]])
    .filter(([, value]) => typeof value === 'string'));

  if (html.length > 0) {
    throw new Error(`Rich fields are HTML strings, expected segments: ${JSON.stringify(html)}`);
  }

  return outputBlocksToHtml(blocks, fieldsOf);
};
