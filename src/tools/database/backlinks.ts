import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PAGE_REFERENCE_ATTR } from '../../shared/page-reference';

/** A block as the scan needs it. */
export interface BacklinkBlock {
  id: string;
  name: string;
  parentId: string | null;
  /** The block's last edit (or creation) time: the mention's time, as near as Blok knows it. */
  editedAt?: number;
}

/** A page that mentions the row: another row (`rowId`), or the document (`null`). */
export interface BacklinkSource {
  rowId: string | null;
  /** The block holding the page's newest mention. */
  blockId: string;
  /** Every mention on the page counts: the button reads "7 backlinks" for 6 pages (research/23 §4). */
  mentions: number;
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

/**
 * The pages that mention the row, once each, newest mention first (research/23 §4).
 * A mention's time is its block's edit time; without one, document order
 * decides and a later mention counts as newer. Reads the DOM, so it runs only
 * for an open row page.
 */
export const scanBacklinkSources = (scan: BacklinkScan): BacklinkSource[] => {
  const ids = new Set(scan.ids);
  const editorSelector = `[${DATA_ATTR.editor}]`;
  const mentions = [...scan.root.querySelectorAll<HTMLElement>(`a[${PAGE_REFERENCE_ATTR}]`)].flatMap((anchor, order) => {
    const blockId = anchor.closest(`[${DATA_ATTR.id}]`)?.getAttribute(DATA_ATTR.id);
    const block = blockId === null || blockId === undefined ? undefined : scan.block(blockId);

    if (!ids.has(anchor.getAttribute(PAGE_REFERENCE_ATTR) ?? '') || block === undefined || PROPERTY_HOSTS.has(block.name)
      || anchor.closest(editorSelector) !== scan.root || anchor.closest(`[${DATA_ATTR.annotation}]`) !== null) return [];
    const rowId = nearestRow(scan, block);

    return rowId === scan.rowId ? [] : [{ rowId, blockId: block.id, at: block.editedAt ?? -Infinity, order }];
  });
  const sources = new Map<string | null, BacklinkSource & { at: number; order: number }>();

  for (const mention of mentions) {
    const found = sources.get(mention.rowId);

    if (found === undefined) {
      sources.set(mention.rowId, { ...mention, mentions: 1 });
      continue;
    }
    found.mentions += 1;
    if (mention.at >= found.at) Object.assign(found, { blockId: mention.blockId, at: mention.at, order: mention.order });
  }

  return [...sources.values()]
    .sort((a, b) => (a.at === b.at ? a.order - b.order : b.at - a.at))
    .map(({ rowId, blockId, mentions: count }) => ({ rowId, blockId, mentions: count }));
};
