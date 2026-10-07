import type { OutputBlockData, OutputData } from '../../../types';
import type { RichText } from '../../../types/rich-text';
import { outputBlocksToHtml } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { richTextToHtml } from '../../../src/migrate';

const builtInFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

/**
 * Saved blocks with the built-in tools' rich fields read back as HTML, the
 * way a host that still wants HTML reads a save.
 * @param blocks - blocks from a host save
 */
export const blocksAsHtml = (blocks: OutputBlockData[]): OutputBlockData[] => outputBlocksToHtml(blocks, builtInFields);

/**
 * A host save with its rich fields read back as HTML.
 * @param saved - a host save
 */
export function savedAsHtml(saved: OutputData): OutputData;
export function savedAsHtml(saved: OutputData | undefined): OutputData | undefined;
export function savedAsHtml(saved: OutputData | undefined): OutputData | undefined {
  return saved === undefined ? saved : { ...saved, blocks: blocksAsHtml(saved.blocks) };
}

/**
 * One saved rich field as HTML. Strings (collaboration, legacy output) pass through.
 * @param value - a saved rich field
 */
export const htmlOf = (value: unknown): unknown =>
  (Array.isArray(value) ? richTextToHtml(value as RichText) : value);
