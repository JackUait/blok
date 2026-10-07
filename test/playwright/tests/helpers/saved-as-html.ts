import type { OutputBlockData, OutputData } from '../../../../types';
import type { RichText } from '../../../../types/rich-text';
import { outputBlocksToHtml } from '../../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../../src/shared/rich-text/fields';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';

export interface HtmlReadOptions {
  /**
   * Accept HTML strings in built-in rich fields. Only for output that is
   * still HTML on purpose: collaboration, legacy output, the internal Yjs doc.
   * Without it a string throws, so a regression back to HTML output fails.
   */
  allowHtml?: boolean;
}

const builtInFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const refuseHtml = (where: string): never => {
  throw new Error(`${where} is an HTML string; a host save must hold segments. Pass { allowHtml: true } only for collaboration, legacy output or internal data.`);
};

/**
 * Saved blocks with the built-in tools' rich fields read back as HTML, the
 * way a host that still wants HTML reads a save.
 * @param blocks - blocks from a host save
 * @param options - see {@link HtmlReadOptions}
 */
export const blocksAsHtml = <T extends OutputBlockData>(blocks: T[], options: HtmlReadOptions = {}): T[] => {
  const offending = options.allowHtml === true
    ? undefined
    : blocks.flatMap(block => builtInFields(block.type)
      .filter(field => typeof block.data?.[field] === 'string')
      .map(field => `${block.type}.${field} of block ${block.id ?? '?'}`))[0];

  if (offending !== undefined) {
    refuseHtml(offending);
  }

  return outputBlocksToHtml(blocks, builtInFields) as T[];
};

/**
 * A host save with its rich fields read back as HTML.
 * @param saved - a host save
 * @param options - see {@link HtmlReadOptions}
 */
export function savedAsHtml<T extends OutputData>(saved: T, options?: HtmlReadOptions): T;
export function savedAsHtml<T extends OutputData>(saved: T | undefined, options?: HtmlReadOptions): T | undefined;
export function savedAsHtml<T extends OutputData>(saved: T | undefined, options: HtmlReadOptions = {}): T | undefined {
  return saved === undefined ? saved : { ...saved, blocks: blocksAsHtml(saved.blocks, options) };
}

/**
 * One saved built-in rich field as HTML. `undefined` (a missing block) passes through.
 * @param value - a saved rich field
 * @param options - see {@link HtmlReadOptions}
 */
export const htmlOf = (value: unknown, options: HtmlReadOptions = {}): unknown => {
  if (typeof value === 'string' && options.allowHtml !== true) {
    refuseHtml('A rich field');
  }

  return Array.isArray(value) ? segmentsToHtml(value as RichText) : value;
};

/**
 * A block's `text` as HTML, strict only for built-in rich types: other tools
 * (code, custom) keep their string `text` as saved.
 * @param block - a saved block, or undefined
 * @param options - see {@link HtmlReadOptions}
 */
export const blockTextAsHtml = (block: OutputBlockData | undefined, options: HtmlReadOptions = {}): unknown => {
  const text: unknown = block?.data?.text;

  if (block === undefined || !builtInFields(block.type).includes('text')) {
    return text;
  }

  return htmlOf(text, options);
};
