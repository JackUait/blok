import type { DefaultTreeAdapterMap } from 'parse5';
import type { LooseOutputData, OutputData } from '../../types';
import { isPagePointer } from '../shared/page-pointer';
import { PAGE_REFERENCE_ATTR } from '../shared/page-reference';

import { collectPageIndexBlocks, referencedCellIds } from './blocks-to-plain-text';
import { buildDocumentModel } from './document-model';
import type { ViewBlock } from './document-model';
import { parseInlineFragment } from './html-text';
import { claimedCellTexts, leadingCellText, repairedTableRows, sourceCellsInDisplayOrder } from './table-grid';

/** An owning page pointer in one saved document. */
export interface PageOwnerEdge {
  pageId: string;
  sourceBlockId: string;
  order: number;
}

/** Searchable text attributed to a visible block. */
export interface PageTextEntry {
  blockId: string | null;
  order: number;
  text: string;
}

/** A non-owning reference to a page in one saved document. */
export interface PageReference {
  pageId: string;
  sourceBlockId: string | null;
  order: number;
}

/** Document facts for a host-owned page catalog. */
export interface PageIndex {
  owners: PageOwnerEdge[];
  text: PageTextEntry[];
  references: PageReference[];
}

const INLINE_REFERENCE_TYPES = new Set(['paragraph', 'header', 'toggle', 'list', 'quote']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const inlinePageIds = (value: unknown): string[] => {
  if (typeof value !== 'string') {
    return [];
  }

  const ids: string[] = [];
  const visit = (nodes: DefaultTreeAdapterMap['childNode'][]): void => {
    for (const node of nodes) {
      if (!('tagName' in node)) {
        continue;
      }
      const pageId = node.tagName === 'a'
        ? node.attrs.find(attr => attr.name === PAGE_REFERENCE_ATTR)?.value
        : undefined;

      if (pageId) {
        ids.push(pageId);
      }
      visit(node.childNodes);
    }
  };

  visit(parseInlineFragment(value).childNodes);

  return ids;
};

/** Extract page ownership, text and references without a DOM or workspace state. */
export const pageIndex = (data: OutputData | LooseOutputData | null | undefined): PageIndex => {
  const owners: PageOwnerEdge[] = [];
  const text: PageTextEntry[] = [];
  const references: PageReference[] = [];
  const model = buildDocumentModel(data);
  const sourceId = (block: ViewBlock): string | null =>
    block.id !== undefined && !model.syntheticIds.has(block.id) ? block.id : null;
  const addHtml = (value: unknown, blockId: string | null, order: number): void => {
    for (const pageId of inlinePageIds(value)) {
      references.push({ pageId, sourceBlockId: blockId, order });
    }
  };
  const addBlock = (block: ViewBlock, order: number): void => {
    const blockId = sourceId(block);
    const pageId = block.data.pageId;

    if (block.type === 'page-link' && typeof pageId === 'string' && pageId !== '') {
      references.push({ pageId, sourceBlockId: blockId, order });
    }
    if (INLINE_REFERENCE_TYPES.has(block.type)) {
      addHtml(block.data.text, blockId, order);
    }
    if (block.type === 'quote') {
      addHtml(block.data.caption, blockId, order);
    }
  };
  const addTable = (table: ViewBlock, order: number, seen = new Set<string>()): void => {
    if (table.id !== undefined) {
      seen.add(table.id);
    }

    const rows = repairedTableRows(table.data.content);
    const addChild = (child: ViewBlock): void => {
      if (child.id !== undefined && seen.has(child.id)) {
        return;
      }
      if (child.id !== undefined) {
        seen.add(child.id);
      }

      if (child.type === 'table') {
        addTable(child, order, seen);
      } else {
        addBlock(child, order);
      }
      if (isPagePointer(child.type, child.data) || child.type === 'page-link') {
        return;
      }

      const referenced = child.type === 'table' ? referencedCellIds(child) : undefined;

      model.childrenOf(child.id)
        .filter((descendant) => referenced === undefined || descendant.id === undefined || !referenced.has(descendant.id))
        .forEach(addChild);
    };

    rows.forEach((_, rowIndex) => {
      for (const { shown: cell } of sourceCellsInDisplayOrder(rows, rowIndex)) {
        if (isRecord(cell) && cell.mergedInto !== undefined) {
          continue;
        }
        if (typeof cell === 'string') {
          addHtml(cell, sourceId(table), order);

          continue;
        }
        if (!isRecord(cell)) {
          continue;
        }

        const ids = Array.isArray(cell.blocks)
          ? cell.blocks.filter((id): id is string => typeof id === 'string')
          : [];
        const children = ids.flatMap(id => {
          const child = model.byId.get(id);

          return child === undefined ? [] : [child];
        });

        if (children.length === 0) {
          addHtml(cell.text, sourceId(table), order);
        } else {
          addHtml(leadingCellText(cell), sourceId(table), order);
          children.forEach(addChild);
        }
        claimedCellTexts(cell).forEach(value => addHtml(value, sourceId(table), order));
      }
    });
  };

  for (const { block, sourceBlockId, ownText, order, inTable } of collectPageIndexBlocks(data)) {
    const pageId = block.data.pageId;
    const pointer = isPagePointer(block.type, block.data)
      && typeof pageId === 'string' && pageId !== '';

    if (pointer && sourceBlockId !== null) {
      owners.push({ pageId, sourceBlockId, order });
    }
    if (inTable) {
      continue;
    }

    text.push({ blockId: sourceBlockId, order, text: isPagePointer(block.type, block.data) ? '' : ownText });
    if (block.type === 'table') {
      addTable(block, order);
    } else {
      addBlock(block, order);
    }
  }

  return { owners, text, references };
};
