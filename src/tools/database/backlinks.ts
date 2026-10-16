import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PAGE_REFERENCE_ATTR } from '../../shared/page-reference';

/** A block as the scan needs it. */
export interface BacklinkBlock {
  id: string;
  name: string;
  parentId: string | null;
}

/** A page that mentions the row: another row (`rowId`), or the document (`null`). */
export interface BacklinkSource {
  rowId: string | null;
  /** The block holding the page's first mention. */
  blockId: string;
}

export interface BacklinkScan {
  /** The editor wrapper. Mentions inside a nested editor are not this document's. */
  root: HTMLElement;
  rowId: string;
  /** Ids a mention of the row may carry. The host picks it: the row id or the row's page id. */
  ids: readonly string[];
  block(id: string): BacklinkBlock | undefined;
}

/** Property values draw inside these blocks; a mention there is not page content. */
const PROPERTY_HOSTS = new Set(['database', 'database-row']);

const nearestRow = (scan: BacklinkScan, block: BacklinkBlock | undefined, seen = new Set<string>()): string | null => {
  if (block === undefined || seen.has(block.id)) return null;
  if (block.name === 'database-row') return block.id;
  seen.add(block.id);

  return nearestRow(scan, block.parentId === null ? undefined : scan.block(block.parentId), seen);
};

/** The pages that mention the row, in document order, once each. Reads the DOM, so it runs only for an open row page. */
export const scanBacklinkSources = (scan: BacklinkScan): BacklinkSource[] => {
  const ids = new Set(scan.ids);
  const sources = new Map<string | null, BacklinkSource>();
  const editorSelector = `[${DATA_ATTR.editor}]`;

  for (const anchor of scan.root.querySelectorAll<HTMLElement>(`a[${PAGE_REFERENCE_ATTR}]`)) {
    const blockId = anchor.closest(`[${DATA_ATTR.id}]`)?.getAttribute(DATA_ATTR.id);
    const block = blockId === null || blockId === undefined ? undefined : scan.block(blockId);

    if (!ids.has(anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? '') || block === undefined || PROPERTY_HOSTS.has(block.name)
      || anchor.closest(editorSelector) !== scan.root || anchor.closest(`[${DATA_ATTR.annotation}]`) !== null) continue;
    const rowId = nearestRow(scan, block);

    if (rowId !== scan.rowId && !sources.has(rowId)) sources.set(rowId, { rowId, blockId: block.id });
  }

  return [...sources.values()];
};
