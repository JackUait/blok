import type { OutputBlockData } from '../../../types';
import { isRichText, readRichTextLeniently } from './guards';
import { segmentsToHtml } from './segments-to-html';
import type { RichText } from '../../../types/rich-text';

export { richTextFieldsFor } from './fields';

export type FieldsResolver = (type: string) => string[];

type Convert = (value: unknown) => unknown;

export interface ConvertOptions {
  /** Walk `properties.*.blocks`. Only database-row stores documents there; a custom tool's nested data is not ours to rewrite. */
  nestedDocuments?: boolean;
}

/** The nested-document gate for a block or tool of this type. */
export const nestedDocumentsFor = (type: string): ConvertOptions => ({ nestedDocuments: type === 'database-row' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNestedDocument = (value: unknown): value is { blocks: OutputBlockData[] } =>
  isRecord(value) && Array.isArray(value.blocks);

/**
 * Returns `data` itself when nothing converted, so callers can skip the copy
 * (the renderer's `data === block.data` shortcut relies on it).
 */
const convertData = (
  data: Record<string, unknown>,
  fields: string[],
  convertField: Convert,
  convertBlocks: (blocks: OutputBlockData[]) => OutputBlockData[],
  options: ConvertOptions
): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};

  for (const field of fields.filter(name => name in data)) {
    const value = convertField(data[field]);

    if (value !== data[field]) {
      changes[field] = value;
    }
  }

  // database-row: a richText property is a whole nested document.
  const properties = data.properties;

  if (options.nestedDocuments === true && isRecord(properties)) {
    const entries = Object.entries(properties).map(([key, value]): [string, unknown] => {
      if (!isNestedDocument(value)) {
        return [key, value];
      }

      const blocks = convertBlocks(value.blocks);

      return [key, blocks === value.blocks ? value : { ...value, blocks }];
    });

    if (entries.some(([key, value]) => value !== properties[key])) {
      changes.properties = Object.fromEntries(entries);
    }
  }

  return Object.keys(changes).length === 0 ? data : { ...data, ...changes };
};

/** The same array when no block's data changed. */
const mapBlockData = (
  blocks: OutputBlockData[],
  convert: (block: OutputBlockData, data: Record<string, unknown>) => Record<string, unknown>
): OutputBlockData[] => {
  const next = blocks.map((block) => {
    const data = block.data ?? {};
    const converted = convert(block, data);

    return converted === data ? block : { ...block, data: converted };
  });

  return next.every((block, index) => block === blocks[index]) ? blocks : next;
};

export const outputBlocksToHtml = (blocks: OutputBlockData[], resolve: FieldsResolver): OutputBlockData[] =>
  mapBlockData(blocks, (block, data) => blockDataToHtml(data, resolve(block.type), resolve, nestedDocumentsFor(block.type)));

export const outputBlocksToSegments = (
  blocks: OutputBlockData[],
  resolve: FieldsResolver,
  read: (html: string) => RichText
): OutputBlockData[] =>
  mapBlockData(blocks, (block, data) => blockDataToSegments(data, resolve(block.type), resolve, read, nestedDocumentsFor(block.type)));

/**
 * Segment fields → HTML strings. HTML strings and non-array values pass through.
 * An array that is not segments is read leniently: a tool never gets a raw array.
 */
export function blockDataToHtml(
  data: Record<string, unknown>,
  fields: string[],
  resolve: FieldsResolver,
  options: ConvertOptions = {}
): Record<string, unknown> {
  return convertData(
    data,
    fields,
    value => (Array.isArray(value) ? segmentsToHtml(isRichText(value) ? value : readRichTextLeniently(value)) : value),
    blocks => outputBlocksToHtml(blocks, resolve),
    options
  );
}

/** HTML string fields → segments. Segment arrays and non-rich values pass through. */
export function blockDataToSegments(
  data: Record<string, unknown>,
  fields: string[],
  resolve: FieldsResolver,
  read: (html: string) => RichText,
  options: ConvertOptions = {}
): Record<string, unknown> {
  return convertData(
    data,
    fields,
    value => (typeof value === 'string' ? read(value) : value),
    blocks => outputBlocksToSegments(blocks, resolve, read),
    options
  );
}
