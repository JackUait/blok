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

/** Copy one page document, rewriting only known block and page references. */
export const remapPageDocument = (data: OutputData, ids: PageDocumentIds): OutputData => {
  const mappedIds = new Set<string>();
  const mappedBlockId = (id: string | undefined): string => {
    const mapped = id === undefined ? undefined : ids.blockIds.get(id);

    if (!mapped) {
      throw new Error('Missing block ID mapping');
    }

    return mapped;
  };

  const rewriteTableCell = (cell: unknown): unknown => {
    if (typeof cell === 'string') {
      return rewriteInlineLinks(cell, ids);
    }
    if (!isRecord(cell)) {
      return cell;
    }

    const copy = { ...cell };

    if (Array.isArray(cell.blocks)) {
      const blocks: unknown[] = cell.blocks;

      copy.blocks = blocks.map((id) => typeof id === 'string' ? mappedBlockId(id) : id);
    }
    if (typeof cell.text === 'string') {
      copy.text = rewriteInlineLinks(cell.text, ids);
    }
    if (typeof cell.leadingText === 'string') {
      copy.leadingText = rewriteInlineLinks(cell.leadingText, ids);
    }

    return copy;
  };

  const rewriteTableRow = (row: unknown): unknown => {
    if (!Array.isArray(row)) {
      return row;
    }

    const cells: unknown[] = row;

    return cells.map(rewriteTableCell);
  };

  for (const block of data.blocks) {
    const mapped = mappedBlockId(block.id);

    if (mappedIds.has(mapped)) {
      throw new Error('Duplicate mapped block ID');
    }
    mappedIds.add(mapped);
  }

  const blocks: OutputBlockData[] = data.blocks.map((block) => {
    const copy: OutputBlockData = {
      ...(cloneJson(block) as OutputBlockData),
      id: mappedBlockId(block.id),
    };

    if (block.parent !== undefined) {
      copy.parent = mappedBlockId(block.parent);
    }
    if (block.content !== undefined) {
      copy.content = block.content.map(mappedBlockId);
    }

    if (block.type === 'page' || block.type === 'page-link' || block.type === 'database-row') {
      const pageId = block.data.pageId;

      if (typeof pageId === 'string') {
        copy.data.pageId = ids.pageIds.get(pageId) ?? pageId;
      }
    }

    if (block.type === 'table' && Array.isArray(block.data.content)) {
      const rows: unknown[] = block.data.content;

      copy.data.content = rows.map(rewriteTableRow);
    }

    for (const field of INLINE_HTML_FIELDS[block.type] ?? []) {
      const value = block.data[field];

      if (typeof value === 'string') {
        copy.data[field] = rewriteInlineLinks(value, ids);
      }
    }

    return copy;
  });

  return { ...data, blocks };
};
