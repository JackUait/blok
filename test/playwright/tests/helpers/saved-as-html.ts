import type { OutputBlockData, OutputData } from '../../../../types';
import type { RichText } from '../../../../types/rich-text';
import { outputBlocksToHtml } from '../../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../../src/shared/rich-text/fields';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';

const builtInFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

/**
 * Saved blocks with the built-in tools' rich fields read back as HTML.
 * @param blocks - blocks from a host save
 */
export const blocksAsHtml = <T extends OutputBlockData>(blocks: T[]): T[] =>
  outputBlocksToHtml(blocks, builtInFields) as T[];

/**
 * A host save with its rich fields read back as HTML.
 * @param saved - a host save
 */
export const savedAsHtml = <T extends OutputData>(saved: T): T => ({ ...saved, blocks: blocksAsHtml(saved.blocks) });

/**
 * One saved rich field as HTML. Strings (collaboration, legacy output) pass through.
 * @param value - a saved rich field
 */
export const htmlOf = (value: unknown): unknown =>
  (Array.isArray(value) ? segmentsToHtml(value as RichText) : value);
