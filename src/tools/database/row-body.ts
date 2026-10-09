import type { BlockToolData, OutputData } from '../../../types';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from './types';

/** A body block as the gallery reads it: legacy OutputData or a child block's data. */
export interface BodyBlock {
  type: string;
  data: unknown;
}

const hasBody = (value: PropertyValue | undefined): value is OutputData =>
  value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
  && Array.isArray(value.blocks) && value.blocks.length > 0;

/**
 * A row's legacy body (the richText "Card details" column). The drawer and
 * the gallery preview must read it the same way, so both call this.
 */
export const rowDescription = (
  row: DatabaseRow,
  schema: PropertyDefinition[],
  descriptionPropertyId: string | undefined
): OutputData | undefined => {
  const designated = schema.find((property) => property.id === descriptionPropertyId);
  const designatedValue = descriptionPropertyId === undefined ? undefined : row.properties[descriptionPropertyId];

  // An explicit empty body must not revive an older body column.
  if (designatedValue !== undefined) {
    return designatedValue === null ? undefined : designatedValue as OutputData;
  }

  // Peers can create duplicate body columns with the same name.
  for (const property of schema) {
    const value = row.properties[property.id];

    if (property.type === 'richText' && property.name === designated?.name && hasBody(value)) {
      return value;
    }
  }

  // A backend-omitted column can still hold the row's saved body.
  // New edits append a property key, so the latest orphan comes first.
  for (const [propertyId, value] of Object.entries(row.properties).reverse()) {
    if (!schema.some((property) => property.id === propertyId) && hasBody(value)) {
      return value;
    }
  }

  return descriptionPropertyId === undefined ? undefined : row.properties[descriptionPropertyId] as OutputData | undefined;
};

const field = (data: unknown, key: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined;

/** Never parsed into the live DOM: HTML goes through an inert template, segments are read as text. */
const textOf = (data: unknown): string => {
  const text = field(data, 'text');

  if (typeof text === 'string') {
    return htmlToPlainText(text).trim();
  }

  if (Array.isArray(text)) {
    return text.map((segment) => (typeof field(segment, 'text') === 'string' ? field(segment, 'text') : '')).join('').trim();
  }

  return '';
};

const imageOf = (block: BodyBlock): string | undefined => {
  const url = block.type === 'image' ? field(block.data, 'url') : undefined;

  return typeof url === 'string' && url !== '' ? safeImageSrc(url) ?? undefined : undefined;
};

export type PreviewLineLevel = 'h1' | 'h2' | 'h3' | 'text';

export interface PageContentPreview {
  image?: string;
  lines: Array<{ level: PreviewLineLevel; text: string }>;
}

/** The card is 146px tall at most, so more lines would never show. */
const MAX_PREVIEW_LINES = 8;

const levelOf = (block: BodyBlock): PreviewLineLevel => {
  const level = field(block.data, 'level');

  if (block.type !== 'header' || typeof level !== 'number') {
    return 'text';
  }

  if (level <= 1) {
    return 'h1';
  }

  return level === 2 ? 'h2' : 'h3';
};

/** Notion's "Page content" preview: an image when the body starts with one, else its first lines (H-galleries). */
export const pageContentPreview = (blocks: BodyBlock[]): PageContentPreview => {
  const first = blocks[0];
  const image = first === undefined ? undefined : imageOf(first);

  if (image !== undefined) {
    return { image, lines: [] };
  }

  const lines = blocks
    .map((block) => ({ level: levelOf(block), text: textOf(block.data) }))
    .filter((line) => line.text !== '')
    .slice(0, MAX_PREVIEW_LINES);

  return { lines };
};

/** Rows have no cover field yet; the first image in the body stands in for one. */
export const coverImageOf = (blocks: BodyBlock[]): string | undefined => {
  for (const block of blocks) {
    const image = imageOf(block);

    if (image !== undefined) {
      return image;
    }
  }

  return undefined;
};

/** The legacy body column as body blocks. A malformed value reads as no body. */
export const pageContentSourceBlocks = (
  row: DatabaseRow,
  schema: PropertyDefinition[],
  descriptionPropertyId: string | undefined
): BodyBlock[] => {
  const blocks: unknown = rowDescription(row, schema, descriptionPropertyId)?.blocks;

  return Array.isArray(blocks)
    ? blocks.flatMap((block: unknown) => {
      const type = field(block, 'type');

      return typeof type === 'string' ? [{ type, data: field(block, 'data') }] : [];
    })
    : [];
};

export interface BodyBlockInsert {
  id: string;
  type: string;
  data: BlockToolData;
  /** The new id of its parent, or null for a top-level body block. */
  parentId: string | null;
}

/**
 * The child blocks a legacy body turns into, parents first. Ids derive from
 * the row id and the blob index, so two peers converting the same row at once
 * write the same blocks instead of two copies. Blob ids are never reused: a
 * duplicated row carries the same blob, and its blocks would clash.
 * @param rowId - the row the body belongs to
 * @param body - the legacy body
 */
export const legacyBodyInserts = (rowId: string, body: OutputData): BodyBlockInsert[] => {
  const blocks = body.blocks.filter((block) => typeof block.type === 'string' && block.type !== '');
  const idOf = new Map(blocks.map((block, index) => [block.id ?? `#${index}`, `${rowId}-body-${index}`]));
  const keyOf = (index: number): string => blocks[index].id ?? `#${index}`;
  const inserts = blocks.map((block, index): BodyBlockInsert => {
    const parent = typeof block.parent === 'string' ? idOf.get(block.parent) : undefined;

    return { id: idOf.get(keyOf(index)) ?? `${rowId}-body-${index}`, type: block.type, data: block.data ?? {}, parentId: parent ?? null };
  });
  const placed = new Set<string>();
  const ordered: BodyBlockInsert[] = [];
  const place = (insert: BodyBlockInsert, seen: Set<string>): void => {
    if (placed.has(insert.id) || seen.has(insert.id)) {
      return;
    }
    const parent = inserts.find((candidate) => candidate.id === insert.parentId);

    if (parent !== undefined) {
      place(parent, seen.add(insert.id));
    }
    placed.add(insert.id);
    ordered.push(parent === undefined ? { ...insert, parentId: null } : insert);
  };

  inserts.forEach((insert) => place(insert, new Set()));

  return ordered;
};
