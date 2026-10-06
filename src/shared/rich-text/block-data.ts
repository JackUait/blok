import type { OutputBlockData } from '../../../types';
import { isRichText } from './guards';
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

const convertData = (
  data: Record<string, unknown>,
  fields: string[],
  convertField: Convert,
  convertBlocks: (blocks: OutputBlockData[]) => OutputBlockData[],
  options: ConvertOptions
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...data };

  for (const field of fields) {
    if (field in next) {
      next[field] = convertField(next[field]);
    }
  }

  // database-row: a richText property is a whole nested document.
  if (options.nestedDocuments === true && isRecord(next.properties)) {
    next.properties = Object.fromEntries(Object.entries(next.properties).map(([key, value]) => [
      key,
      isNestedDocument(value) ? { ...value, blocks: convertBlocks(value.blocks) } : value,
    ]));
  }

  return next;
};

export const outputBlocksToHtml = (blocks: OutputBlockData[], resolve: FieldsResolver): OutputBlockData[] =>
  blocks.map(block => ({ ...block, data: blockDataToHtml(block.data ?? {}, resolve(block.type), resolve, nestedDocumentsFor(block.type)) }));

export const outputBlocksToSegments = (
  blocks: OutputBlockData[],
  resolve: FieldsResolver,
  read: (html: string) => RichText
): OutputBlockData[] =>
  blocks.map(block => ({
    ...block,
    data: blockDataToSegments(block.data ?? {}, resolve(block.type), resolve, read, nestedDocumentsFor(block.type)),
  }));

/** Segment fields → HTML strings. HTML strings and non-rich values pass through. */
export function blockDataToHtml(
  data: Record<string, unknown>,
  fields: string[],
  resolve: FieldsResolver,
  options: ConvertOptions = {}
): Record<string, unknown> {
  return convertData(
    data,
    fields,
    value => (isRichText(value) ? segmentsToHtml(value) : value),
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
