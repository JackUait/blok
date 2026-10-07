import type { OutputBlockData } from '../../../types';
import { isRichText, readRichTextLeniently } from './guards';
import { segmentsToHtml } from './segments-to-html';
import { canonicalizeSegments } from './html-to-segments';
import type { RichText } from '../../../types/rich-text';

import { LEGACY_BODY_TYPES, LEGACY_ITEM_TYPES } from './fields';

export { richTextFieldsFor } from './fields';

export type FieldsResolver = (type: string) => string[];

type Convert = (value: unknown) => unknown;

export interface ConvertOptions {
  /** Walk `properties.*.blocks`. Only database-row stores documents there; a custom tool's nested data is not ours to rewrite. */
  nestedDocuments?: boolean;
  /** The block's type, to walk its legacy `items[]` / `body.blocks`. Only readers of stored documents set it. */
  legacyType?: string;
}

type OptionsFor = (type: string) => ConvertOptions;

/** The nested-document gate for a block or tool of this type. */
export const nestedDocumentsFor: OptionsFor = type => ({ nestedDocuments: type === 'database-row' });

/**
 * {@link nestedDocumentsFor} plus the legacy containers, for readers of stored
 * documents and for editor input (a host may insert a legacy shape from a legacy
 * save). Editor OUTPUT does not need it: it converts before collapsing.
 */
export const legacyNestingFor: OptionsFor = type => ({ ...nestedDocumentsFor(type), legacyType: type });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNestedDocument = (value: unknown): value is { blocks: OutputBlockData[] } =>
  isRecord(value) && Array.isArray(value.blocks);

/**
 * Legacy list items: `content` (old checklist: `text`) and nested `items`. A bare
 * item (string or segments) is its own text. The same array when nothing changed.
 */
const convertItems = (items: unknown[], convertField: Convert): unknown[] => {
  const next = items.map((item) => {
    if (!isRecord(item)) {
      return typeof item === 'string' || Array.isArray(item) ? convertField(item) : item;
    }

    const key = 'content' in item ? 'content' : 'text';
    const changes: Record<string, unknown> = {};

    if (key in item) {
      const value = convertField(item[key]);

      if (value !== item[key]) {
        changes[key] = value;
      }
    }

    if (Array.isArray(item.items)) {
      const nested = convertItems(item.items, convertField);

      if (nested !== item.items) {
        changes.items = nested;
      }
    }

    return Object.keys(changes).length === 0 ? item : { ...item, ...changes };
  });

  return next.every((item, index) => item === items[index]) ? items : next;
};

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

  const legacyType = options.legacyType;

  if (legacyType !== undefined && LEGACY_ITEM_TYPES.has(legacyType) && Array.isArray(data.items)) {
    const items = convertItems(data.items, convertField);

    if (items !== data.items) {
      changes.items = items;
    }
  }

  const body = data.body;

  if (legacyType !== undefined && LEGACY_BODY_TYPES.has(legacyType) && isNestedDocument(body)) {
    const blocks = convertBlocks(body.blocks);

    if (blocks !== body.blocks) {
      changes.body = { ...body, blocks };
    }
  }

  return Object.keys(changes).length === 0 ? data : { ...data, ...changes };
};

/** The same array when no block's data changed. */
const mapBlockData = (
  blocks: OutputBlockData[],
  convert: (block: OutputBlockData, data: Record<string, unknown>) => Record<string, unknown>
): OutputBlockData[] => {
  const next = blocks.map((block: unknown) => {
    // Stored and peer documents can hold anything; what is not a block with record data is not ours to convert.
    if (!isRecord(block) || (block.data !== undefined && block.data !== null && !isRecord(block.data))) {
      return block as OutputBlockData;
    }

    const data = block.data ?? {};
    const converted = convert(block as unknown as OutputBlockData, data);

    return converted === data ? block as unknown as OutputBlockData : { ...block, data: converted } as OutputBlockData;
  });

  return next.every((block, index) => block === blocks[index]) ? blocks : next;
};

export const outputBlocksToHtml = (
  blocks: OutputBlockData[],
  resolve: FieldsResolver,
  optionsFor: OptionsFor = nestedDocumentsFor
): OutputBlockData[] =>
  mapBlockData(blocks, (block, data) => blockDataToHtml(data, resolve(block.type), resolve, optionsFor(block.type)));

export const outputBlocksToSegments = (
  blocks: OutputBlockData[],
  resolve: FieldsResolver,
  read: (html: string) => RichText,
  optionsFor: OptionsFor = nestedDocumentsFor
): OutputBlockData[] =>
  mapBlockData(blocks, (block, data) => blockDataToSegments(data, resolve(block.type), resolve, read, optionsFor(block.type)));

/** Nested blocks keep walking legacy containers when their parent did. */
const nestedOptionsFor = (options: ConvertOptions): OptionsFor =>
  options.legacyType !== undefined ? legacyNestingFor : nestedDocumentsFor;

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
    blocks => outputBlocksToHtml(blocks, resolve, nestedOptionsFor(options)),
    options
  );
}

const toSegmentsBy = (
  data: Record<string, unknown>,
  fields: string[],
  resolve: FieldsResolver,
  convertField: Convert,
  options: ConvertOptions
): Record<string, unknown> => convertData(
  data,
  fields,
  convertField,
  blocks => mapBlockData(blocks, (block, nested) =>
    toSegmentsBy(nested, resolve(block.type), resolve, convertField, nestedOptionsFor(options)(block.type))),
  options
);

/** HTML string fields → segments. Segment arrays and non-rich values pass through. */
export function blockDataToSegments(
  data: Record<string, unknown>,
  fields: string[],
  resolve: FieldsResolver,
  read: (html: string) => RichText,
  options: ConvertOptions = {}
): Record<string, unknown> {
  return toSegmentsBy(data, fields, resolve, value => (typeof value === 'string' ? read(value) : value), options);
}

/**
 * {@link outputBlocksToSegments}, plus segment arrays canonicalized: equal
 * content in any spelling compares equal. Copies every array it meets, so it
 * is for comparing, not for output (callers rely on unchanged identity there).
 */
export const outputBlocksToCanonicalSegments = (
  blocks: OutputBlockData[],
  resolve: FieldsResolver,
  read: (html: string) => RichText
): OutputBlockData[] => {
  const convertField: Convert = (value) => {
    if (typeof value === 'string') {
      return read(value);
    }

    return Array.isArray(value) ? canonicalizeSegments(isRichText(value) ? value : readRichTextLeniently(value)) : value;
  };

  return mapBlockData(blocks, (block, data) => toSegmentsBy(data, resolve(block.type), resolve, convertField, nestedDocumentsFor(block.type)));
};
