/**
 * Data Model Transformation Utilities
 *
 * Handles conversion between legacy nested format and hierarchical flat-with-references format.
 * Used for automatic detection and transformation when dataModel config is 'auto'.
 */
import type { OutputBlockData, BlockId } from '../../../types';
import { generateBlockId } from '../utils';

/**
 * Legacy list item structure for data model transformation.
 * Used internally for transforming legacy nested list data to the hierarchical model.
 */
interface LegacyListItem {
  content: string;
  checked?: boolean;
  items?: LegacyListItem[];
}

/**
 * Legacy list data structure for data model transformation.
 * Used internally for transforming legacy nested list data to the hierarchical model.
 */
interface LegacyListData {
  style: 'unordered' | 'ordered' | 'checklist';
  items: LegacyListItem[];
  start?: number;
}

/**
 * Result of analyzing the input data format
 */
export interface DataFormatAnalysis {
  /**
   * Detected format: 'legacy' if any block has nested items, 'hierarchical' if any block has parent/content
   */
  format: 'legacy' | 'hierarchical' | 'flat';
  /**
   * Whether the data contains any hierarchical relationships
   */
  hasHierarchy: boolean;
}

/**
 * Recursively check if any list item has nested items
 */
const hasNestedListItems = (items: LegacyListItem[]): boolean => {
  return items.some(item => item.items !== undefined && item.items.length > 0);
};

/**
 * Check if a block contains legacy nested items structure
 * Currently supports: List tool with nested items[]
 */
const hasNestedItems = (block: OutputBlockData): boolean => {
  const isListWithItems = block.type === 'list' && block.data?.items;

  if (!isListWithItems) {
    return false;
  }

  return hasNestedListItems(block.data.items as LegacyListItem[]);
};

/**
 * Check if block has hierarchical references
 */
const hasHierarchicalRefs = (block: OutputBlockData): boolean => {
  return block.parent !== undefined || (block.content !== undefined && block.content.length > 0);
};

/**
 * Analyze the input data to detect its format
 * @param blocks - array of output block data
 * @returns analysis result with detected format
 */
export const analyzeDataFormat = (blocks: OutputBlockData[]): DataFormatAnalysis => {
  const foundHierarchicalRefs = blocks.some(hasHierarchicalRefs);

  if (foundHierarchicalRefs) {
    return { format: 'hierarchical', hasHierarchy: true };
  }

  const foundLegacyNested = blocks.some(hasNestedItems);

  if (foundLegacyNested) {
    return { format: 'legacy', hasHierarchy: true };
  }

  return { format: 'flat', hasHierarchy: false };
};

/**
 * Expand list items recursively, collecting child IDs
 */
const expandListItems = (
  items: LegacyListItem[],
  parentId: BlockId | undefined,
  depth: number,
  style: string,
  start: number | undefined,
  tunes: OutputBlockData['tunes'],
  blocks: OutputBlockData[]
): BlockId[] => {
  const childIds: BlockId[] = [];

  items.forEach((item, index) => {
    const itemId = generateBlockId();

    childIds.push(itemId);

    // Recursively expand nested items first to get their IDs
    const nestedChildIds = item.items && item.items.length > 0
      ? expandListItems(item.items, itemId, depth + 1, style, undefined, tunes, blocks)
      : [];

    // Determine if we should include start (only for first root item of ordered lists)
    const includeStart = style === 'ordered' && depth === 0 && index === 0 && start !== undefined && start !== 1;

    // Create the list_item block
    const itemBlock: OutputBlockData = {
      id: itemId,
      type: 'list_item',
      data: {
        text: item.content,
        checked: item.checked,
        style,
        ...(includeStart ? { start } : {}),
      },
      ...(tunes !== undefined ? { tunes } : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
      ...(nestedChildIds.length > 0 ? { content: nestedChildIds } : {}),
    };

    blocks.push(itemBlock);
  });

  return childIds;
};

/**
 * Expand a List block with nested items into flat list_item blocks
 */
const expandListToHierarchical = (
  listData: LegacyListData,
  tunes?: OutputBlockData['tunes']
): OutputBlockData[] => {
  const blocks: OutputBlockData[] = [];
  const style = listData.style;
  const start = listData.start;

  // Start expansion from root items (no parent)
  expandListItems(listData.items, undefined, 0, style, start, tunes, blocks);

  return blocks;
};

/**
 * Expand legacy nested format to hierarchical flat-with-references format
 * @param blocks - array of blocks potentially containing nested structures
 * @returns expanded array of flat blocks with parent/content references
 */
export const expandToHierarchical = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const expandedBlocks: OutputBlockData[] = [];

  for (const block of blocks) {
    // Ensure block has an ID
    const blockId = block.id ?? generateBlockId();

    const isListBlock = block.type === 'list' && block.data?.items;

    if (isListBlock) {
      // Expand List tool nested items to flat blocks
      const listData = block.data as LegacyListData;
      const expanded = expandListToHierarchical(listData, block.tunes);

      expandedBlocks.push(...expanded);
    } else {
      // Non-list blocks pass through unchanged (with guaranteed ID)
      expandedBlocks.push({
        ...block,
        id: blockId,
      });
    }
  }

  return expandedBlocks;
};

/**
 * Mark a block ID as processed if it exists
 */
const markBlockAsProcessed = (id: BlockId | undefined, processedIds: Set<BlockId>): void => {
  if (id) {
    processedIds.add(id);
  }
};

/**
 * Remove hierarchy fields from a block, returning a clean copy
 */
const stripHierarchyFields = (block: OutputBlockData): OutputBlockData => {
  const { parent: _parent, content: _content, ...rest } = block;

  return rest;
};

/**
 * Collect child items from content IDs
 */
const collectChildItems = (
  contentIds: BlockId[],
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): LegacyListItem[] => {
  const childItems: LegacyListItem[] = [];

  for (const childId of contentIds) {
    const childBlock = blockMap.get(childId);
    const isListItem = childBlock && childBlock.type === 'list_item';

    if (isListItem) {
      const items = collectListItems(childBlock, blockMap, processedIds);

      childItems.push(...items);
    }
  }

  return childItems;
};

/**
 * Recursively collect list items and their nested children into ListItem structure
 */
const collectListItems = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): LegacyListItem[] => {
  const items: LegacyListItem[] = [];

  // Mark this block as processed
  if (block.id) {
    processedIds.add(block.id);
  }

  const item: LegacyListItem = {
    content: block.data?.text || '',
    checked: block.data?.checked,
  };

  // Recursively process children
  const hasChildren = block.content && block.content.length > 0;

  if (hasChildren) {
    item.items = collectChildItems(block.content!, blockMap, processedIds);
  }

  // Clean up empty items array
  const shouldRemoveItems = item.items !== undefined && item.items.length === 0;

  if (shouldRemoveItems) {
    delete item.items;
  }

  items.push(item);

  return items;
};

/**
 * Process a root list_item block and convert to a legacy List block
 */
const processRootListItem = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData => {
  const listItems = collectListItems(block, blockMap, processedIds);
  const style = block.data?.style || 'unordered';
  const start = block.data?.start;

  const listBlock: OutputBlockData = {
    id: block.id,
    type: 'list',
    data: {
      style,
      items: listItems,
      ...(style === 'ordered' && start !== undefined && start !== 1 ? { start } : {}),
    } as LegacyListData,
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
  };

  return listBlock;
};

/**
 * Collapse hierarchical flat-with-references format back to legacy nested format
 * @param blocks - array of flat blocks with parent/content references
 * @returns collapsed array with nested structures
 */
export const collapseToLegacy = (blocks: OutputBlockData[]): OutputBlockData[] => {
  // Build a map of blocks by ID for quick lookup
  const blockMap = new Map<BlockId, OutputBlockData>();
  const listItemBlocks: OutputBlockData[] = [];

  for (const block of blocks) {
    if (block.id) {
      blockMap.set(block.id, block);
    }

    if (block.type === 'list_item') {
      listItemBlocks.push(block);
    }
  }

  // If no list_item blocks, just strip hierarchy fields and return
  if (listItemBlocks.length === 0) {
    return blocks.map(stripHierarchyFields);
  }

  // Process blocks, converting root list_items to List blocks
  const result: OutputBlockData[] = [];
  const processedIds = new Set<BlockId>();

  for (const block of blocks) {
    const alreadyProcessed = block.id && processedIds.has(block.id);

    if (alreadyProcessed) {
      continue;
    }

    const isRootListItem = block.type === 'list_item' && !block.parent;
    const isNonListItem = block.type !== 'list_item';

    if (isRootListItem) {
      const listBlock = processRootListItem(block, blockMap, processedIds);

      result.push(listBlock);
    }

    if (isNonListItem) {
      result.push(stripHierarchyFields(block));
      markBlockAsProcessed(block.id, processedIds);
    }
  }

  return result;
};

/**
 * Check if transformation is needed based on config and detected format
 */
export const shouldExpandToHierarchical = (
  dataModelConfig: 'legacy' | 'hierarchical' | 'auto',
  detectedFormat: DataFormatAnalysis['format']
): boolean => {
  if (dataModelConfig === 'hierarchical') {
    return detectedFormat === 'legacy';
  }

  // For 'auto' and 'legacy', don't expand
  return false;
};

/**
 * Check if transformation is needed for output based on config and detected format
 */
export const shouldCollapseToLegacy = (
  dataModelConfig: 'legacy' | 'hierarchical' | 'auto',
  inputFormat: DataFormatAnalysis['format']
): boolean => {
  if (dataModelConfig === 'legacy') {
    return true;
  }

  if (dataModelConfig === 'auto' && inputFormat === 'legacy') {
    return true;
  }

  return false;
};
