import { serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { OutputBlockData, OutputData } from '../../types';
import { parseInlineFragment } from './html-text';
import { cloneJson } from './json-clone';

type P5ChildNode = DefaultTreeAdapterMap['childNode'];
type P5Element = DefaultTreeAdapterMap['element'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type PageDocumentIds = {
  blockIds: ReadonlyMap<string, string>;
  pageIds: ReadonlyMap<string, string>;
};

const INLINE_HTML_FIELDS: Record<string, readonly string[]> = {
  paragraph: ['text'],
  header: ['text'],
  list: ['text'],
  quote: ['text', 'caption'],
  toggle: ['text'],
};

const decodeFragment = (fragment: string): string => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // A malformed escape is a literal lookup key.
    return fragment;
  }
};

const rewriteAnchorAttrs = (element: P5Element, ids: PageDocumentIds): boolean => {
  const attrs = element.attrs;

  return attrs.reduce((changed, attr, index) => {
    const pageId = attr.name === 'data-blok-page-id'
      ? ids.pageIds.get(attr.value)
      : undefined;
    const blockId = attr.name === 'href' && attr.value.startsWith('#')
      ? ids.blockIds.get(decodeFragment(attr.value.slice(1)))
      : undefined;
    const nextValue = pageId ?? (blockId === undefined ? undefined : `#${encodeURIComponent(blockId)}`);

    if (nextValue === undefined) {
      return changed;
    }

    attrs[index] = { ...attr, value: nextValue };

    return true;
  }, false);
};

const rewriteInlineLinks = (html: string, ids: PageDocumentIds): string => {
  const fragment = parseInlineFragment(html);
  const visit = (nodes: P5ChildNode[]): boolean => nodes.reduce((changed, node) => {
    if (!('tagName' in node)) {
      return changed;
    }

    const ownChanged = node.tagName === 'a' && rewriteAnchorAttrs(node, ids);
    const childChanged = visit(node.childNodes);

    return changed || ownChanged || childChanged;
  }, false);

  return visit(fragment.childNodes) ? serialize(fragment) : html;
};

type SlotKind = 'blockId' | 'blockRef' | 'pageId' | 'html';

/** One place in a document that holds an id or inline HTML. */
interface Slot {
  kind: SlotKind;
  value: unknown;
  write: (value: string) => void;
}

const PAGE_ID_TYPES = new Set(['page', 'page-link', 'database-row']);

/**
 * Legacy fields that `buildDocumentModel` turns into text blocks, so `pageIndex`
 * reads refs in them. Keep in step with `legacyChildren` in document-model.ts.
 */
const LEGACY_HTML_FIELDS: Record<string, readonly string[]> = {
  callout: ['title'],
  toggleList: ['title'],
  warning: ['title', 'message'],
};

/** Same sets as document-model.ts: `data.body.blocks[]` and `data.items[]`. */
const LEGACY_BODY_TYPES = new Set(['callout', 'toggleList']);
const LEGACY_ITEM_TYPES = new Set(['list', 'checklist']);

/** Own keys only: a block typed `constructor` would otherwise read a prototype function. */
const fieldsOf = (table: Record<string, readonly string[]>, type: string): readonly string[] =>
  Object.prototype.hasOwnProperty.call(table, type) ? table[type] : [];

const fieldSlot = (kind: SlotKind, holder: Record<string, unknown>, key: string): Slot => ({
  kind,
  value: holder[key],
  write: (value) => {
    Reflect.set(holder, key, value);
  },
});

const itemSlot = (kind: SlotKind, holder: unknown[], index: number): Slot => ({
  kind,
  value: holder[index],
  write: (value) => {
    Reflect.set(holder, index, value);
  },
});

const stringFieldSlots = (holder: Record<string, unknown>, fields: readonly string[]): Slot[] =>
  fields.filter((field) => typeof holder[field] === 'string').map((field) => fieldSlot('html', holder, field));

const tableSlots = (content: unknown): Slot[] => (Array.isArray(content) ? content : []).flatMap((row: unknown) =>
  (Array.isArray(row) ? row : []).flatMap((cell: unknown, index, cells: unknown[]): Slot[] => {
    if (typeof cell === 'string') {
      return [itemSlot('html', cells, index)];
    }
    if (!isRecord(cell)) {
      return [];
    }

    const blocks: unknown[] = Array.isArray(cell.blocks) ? cell.blocks : [];

    return [
      ...blocks.flatMap((id, at) => typeof id === 'string' ? [itemSlot('blockRef', blocks, at)] : []),
      ...stringFieldSlots(cell, ['text', 'leadingText']),
    ];
  }));

/** Legacy list items: a bare string, or `{ content | text, items[] }`. */
const itemsSlots = (items: unknown): Slot[] => (Array.isArray(items) ? items : []).flatMap((item: unknown, index, all: unknown[]) => {
  if (typeof item === 'string') {
    return [itemSlot('html', all, index)];
  }

  return isRecord(item) ? [...stringFieldSlots(item, ['content', 'text']), ...itemsSlots(item.items)] : [];
});

/**
 * Every id and inline-HTML slot in one block, including the child blocks a
 * legacy block nests in its own data. Legacy children are often id-less, so
 * only a top-level block must carry an id.
 */
const blockSlots = (block: unknown, nested: boolean): Slot[] => {
  if (!isRecord(block)) {
    return [];
  }

  const slots: Slot[] = [];

  if (!nested || (typeof block.id === 'string' && block.id !== '')) {
    slots.push(fieldSlot('blockId', block, 'id'));
  }
  if (block.parent !== undefined) {
    slots.push(fieldSlot('blockRef', block, 'parent'));
  }
  if (Array.isArray(block.content)) {
    const content: unknown[] = block.content;

    slots.push(...content.map((_, index) => itemSlot('blockRef', content, index)));
  }

  const data = block.data;
  const type = block.type;

  if (!isRecord(data) || typeof type !== 'string') {
    return slots;
  }
  if (PAGE_ID_TYPES.has(type) && typeof data.pageId === 'string') {
    slots.push(fieldSlot('pageId', data, 'pageId'));
  }
  if (type === 'table') {
    slots.push(...tableSlots(data.content));
  }
  slots.push(...stringFieldSlots(data, [...fieldsOf(INLINE_HTML_FIELDS, type), ...fieldsOf(LEGACY_HTML_FIELDS, type)]));

  const body = data.body;
  const cols: unknown[] = type === 'columns' && Array.isArray(data.cols) ? data.cols : [];
  const bodyBlocks: unknown[] = LEGACY_BODY_TYPES.has(type) && isRecord(body) && Array.isArray(body.blocks)
    ? body.blocks
    : [];
  const legacyBlocks: unknown[] = [
    ...bodyBlocks,
    ...cols.flatMap((column): unknown[] => isRecord(column) && Array.isArray(column.blocks) ? column.blocks : []),
  ];

  slots.push(...legacyBlocks.flatMap((child) => blockSlots(child, true)));
  if (LEGACY_ITEM_TYPES.has(type)) {
    slots.push(...itemsSlots(data.items));
  }

  return slots;
};

/** Caller errors in a remap's id maps. */
export interface RemapProblems {
  /** Own, `parent`, `content` and table-cell ids with no (or an empty) mapping. */
  missingBlockIds: string[];
  /** New ids that more than one block would get. */
  duplicateBlockIds: string[];
  /** Top-level blocks with no id. */
  idlessBlocks: number;
}

const documentSlots = (blocks: readonly unknown[]): Slot[] => blocks.flatMap((block) => blockSlots(block, false));

/**
 * Every id problem `remapPageDocument` would refuse, found in one pass.
 * Internal: the server runtime answers with it; not in the public API.
 */
export const findRemapProblems = (data: OutputData, ids: PageDocumentIds): RemapProblems => {
  const missing = new Set<string>();
  const duplicates = new Set<string>();
  const mappedIds = new Set<string>();
  const problems = { idlessBlocks: 0 };

  for (const { kind, value } of documentSlots(data.blocks)) {
    if (kind === 'blockId' && (typeof value !== 'string' || value === '')) {
      problems.idlessBlocks += 1;
      continue;
    }
    if (kind !== 'blockId' && kind !== 'blockRef') {
      continue;
    }

    const mapped = typeof value === 'string' ? ids.blockIds.get(value) : undefined;

    if (!mapped) {
      missing.add(String(value));
    } else if (kind === 'blockId' && mappedIds.has(mapped)) {
      duplicates.add(mapped);
    } else if (kind === 'blockId') {
      mappedIds.add(mapped);
    }
  }

  return { missingBlockIds: [...missing], duplicateBlockIds: [...duplicates], idlessBlocks: problems.idlessBlocks };
};

const describeProblems = ({ missingBlockIds, duplicateBlockIds, idlessBlocks }: RemapProblems): string => [
  missingBlockIds.length > 0 ? `Missing block ID mapping for ${missingBlockIds.map((id) => JSON.stringify(id)).join(', ')}` : '',
  duplicateBlockIds.length > 0 ? `Duplicate mapped block ID ${duplicateBlockIds.map((id) => JSON.stringify(id)).join(', ')}` : '',
  idlessBlocks > 0 ? `${idlessBlocks} block(s) without an ID` : '',
].filter((part) => part !== '').join('; ');

/** Copy one page document, rewriting only known block and page references. */
export const remapPageDocument = (data: OutputData, ids: PageDocumentIds): OutputData => {
  const message = describeProblems(findRemapProblems(data, ids));

  if (message !== '') {
    throw new Error(message);
  }

  const blocks = data.blocks.map((block) => cloneJson(block) as OutputBlockData);

  /** Every block id and ref has a mapping: findRemapProblems found none missing. */
  for (const { kind, value, write } of documentSlots(blocks)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (kind === 'blockId' || kind === 'blockRef') {
      write(ids.blockIds.get(value) ?? value);
    } else {
      write(kind === 'pageId' ? ids.pageIds.get(value) ?? value : rewriteInlineLinks(value, ids));
    }
  }

  return { ...data, blocks };
};
