/**
 * Segment rich text → HTML at the door of the view renderer, so every reader
 * below it keeps working on HTML strings.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*).
 */
import type { OutputBlockData } from '../../types';
import { blockDataToHtml, richTextFieldsFor } from '../shared/rich-text/block-data';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Rich-text fields holding segments become HTML strings. Entries that are not
 * a block with record `data` pass through untouched: the view tolerates the
 * loose wire shape and decides itself what to skip.
 * @param blocks - raw `blocks` entries
 */
export const viewBlocksToHtml = (blocks: OutputBlockData[]): OutputBlockData[] =>
  blocks.map((block: unknown) => {
    if (!isRecord(block) || !isRecord(block.data)) {
      return block as OutputBlockData;
    }

    const type = typeof block.type === 'string' ? block.type : '';

    return { ...block, data: blockDataToHtml(block.data, richTextFieldsFor(type), richTextFieldsFor) } as OutputBlockData;
  });
