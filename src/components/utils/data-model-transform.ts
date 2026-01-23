/**
 * Data Model Transformation Utilities
 *
 * Handles conversion between legacy nested format and hierarchical flat-with-references format.
 * Used for automatic detection and transformation when dataModel config is 'auto'.
 */
import type { OutputBlockData, BlockId } from '../../../types';
import { generateBlockId } from '../utils';

/**
 * Legacy list item as object with content property
 */
interface LegacyListItemObject {
  content: string;
  checked?: boolean;
  items?: LegacyListItem[];
}

/**
 * Old checklist item format (uses 'text' instead of 'content')
 */
interface OldChecklistItem {
  text: string;
  checked?: boolean;
}

/**
 * Legacy list item structure for data model transformation.
 * Can be: object with content, object with text (old checklist), or plain string.
 */
type LegacyListItem = LegacyListItemObject | OldChecklistItem | string;

/**
 * Legacy list data structure for data model transformation.
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
 * Check if item is old checklist format (has 'text' instead of 'content')
 */
const isOldChecklistItem = (item: LegacyListItem): item is OldChecklistItem => {
  return typeof item === 'object' && 'text' in item && !('content' in item);
};

/**
 * Normalize a legacy list item to object format
 */
const normalizeListItem = (item: LegacyListItem): LegacyListItemObject => {
  if (typeof item === 'string') {
    return { content: item };
  }

  if (isOldChecklistItem(item)) {
    return { content: item.text, checked: item.checked };
  }

  return item;
};

/**
 * Recursively check if any list item has nested items (for hasHierarchy flag)
 */
const hasNestedListItems = (items: LegacyListItem[]): boolean => {
  return items.some(item => {
    const normalized = normalizeListItem(item);

    return normalized.items !== undefined && normalized.items.length > 0;
  });
};

/**
 * Type guard for object with text property
 */
const isObjectWithText = (data: unknown): data is { text: string } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'text' in data && typeof (data as { text: unknown }).text === 'string';
};

/**
 * Type guard for object with checked property
 */
const isObjectWithChecked = (data: unknown): data is { checked: boolean } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'checked' in data && typeof (data as { checked: unknown }).checked === 'boolean';
};

/**
 * Type guard for object with style property
 */
const isObjectWithStyle = (data: unknown): data is { style: string } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'style' in data && typeof (data as { style: unknown }).style === 'string';
};

/**
 * Type guard for object with start property
 */
const isObjectWithStart = (data: unknown): data is { start: number } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'start' in data && typeof (data as { start: unknown }).start === 'number';
};

/**
 * Type guard for object with items property
 */
const isObjectWithItems = (data: unknown): data is { items: unknown } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'items' in data;
};

/**
 * Type guard for legacy list data structure
 */
const isLegacyListData = (data: unknown): data is LegacyListData => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'style' in data &&
    'items' in data &&
    Array.isArray((data as LegacyListData).items)
  );
};

/**
 * Check if a block is in legacy list format (has items[] array with content field)
 * Legacy format: { items: [{ content: "text" }], style: "unordered" }
 * Flat format: { text: "text", style: "unordered" }
 */
const isLegacyListBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyListData> => {
  return block.type === 'list' && isLegacyListData(block.data);
};

/**
 * Check if a block contains nested hierarchy in its items
 */
const hasNestedItems = (block: OutputBlockData): boolean => {
  if (!isLegacyListBlock(block)) {
    return false;
  }

  // Type guard narrows block.data to LegacyListData
  // Extract items explicitly to avoid type widening
  const items: LegacyListItem[] = block.data.items;
  return hasNestedListItems(items);
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

  // Check if any block uses legacy list format (items[] array)
  const foundLegacyList = blocks.some(isLegacyListBlock);

  if (foundLegacyList) {
    // Check if there's actual nesting for the hasHierarchy flag
    const hasNesting = blocks.some(hasNestedItems);

    return { format: 'legacy', hasHierarchy: hasNesting };
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

  items.forEach((rawItem, index) => {
    // Normalize item to handle both string and object formats
    const item = normalizeListItem(rawItem);
    const itemId = generateBlockId();

    childIds.push(itemId);

    // Determine if we should include start (only for first root item of ordered lists)
    const includeStart = style === 'ordered' && depth === 0 && index === 0 && start !== undefined && start !== 1;

    // Check if there are nested items (we'll get their IDs after pushing the parent)
    const hasChildren = item.items && item.items.length > 0;

    // Create the list block (flat model - each item is a separate 'list' block)
    // We'll update with content IDs after processing children
    const itemBlock: OutputBlockData = {
      id: itemId,
      type: 'list',
      data: {
        text: item.content,
        checked: item.checked,
        style,
        ...(depth > 0 ? { depth } : {}),
        ...(includeStart ? { start } : {}),
      },
      ...(tunes !== undefined ? { tunes } : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
    };

    // Push parent block first to maintain correct order (parent before children)
    blocks.push(itemBlock);

    // Now recursively expand nested items (they will be added after the parent)
    if (!hasChildren || !item.items) {
      return;
    }

    const nestedChildIds = expandListItems(item.items, itemId, depth + 1, style, undefined, tunes, blocks);

    // Update the parent block with content IDs (only if children exist)
    if (nestedChildIds.length > 0) {
      itemBlock.content = nestedChildIds;
    }
  });

  return childIds;
};

/**
 * Expand a List block with nested items into flat list blocks
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
    if (isLegacyListBlock(block)) {
      // Expand List tool nested items to flat blocks
      // Type guard narrows block.data to LegacyListData
      const expanded = expandListToHierarchical(block.data, block.tunes);

      expandedBlocks.push(...expanded);
    } else {
      // Non-list blocks pass through unchanged (with guaranteed ID)
      expandedBlocks.push({
        ...block,
        id: block.id ?? generateBlockId(),
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
    const isListItem = childBlock && childBlock.type === 'list';

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

  // Extract text and checked properties with proper type narrowing
  const data: unknown = block.data;
  const text = isObjectWithText(data) ? data.text : '';
  const checked = isObjectWithChecked(data) ? data.checked : undefined;

  const item: LegacyListItem = {
    content: text,
    checked,
  };

  // Recursively process children
  const content = block.content;
  const hasChildren = content !== undefined && content.length > 0;

  if (hasChildren) {
    item.items = collectChildItems(content, blockMap, processedIds);
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
 * Process a root list block (flat model) and convert to a legacy List block
 */
const processRootListItem = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData => {
  const listItems = collectListItems(block, blockMap, processedIds);

  // Extract style and start properties with proper type narrowing
  const data: unknown = block.data;
  const style = isObjectWithStyle(data) ? data.style : 'unordered';
  const start = isObjectWithStart(data) ? data.start : undefined;

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
 * Check if a block is a flat-model list block (has 'text' field instead of 'items')
 */
const isFlatModelListBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'list') {
    return false;
  }

  const data: unknown = block.data;
  const hasText = isObjectWithText(data);
  const hasItems = isObjectWithItems(data);

  return hasText && !hasItems;
};

/**
 * Collapse hierarchical flat-with-references format back to legacy nested format
 * @param blocks - array of flat blocks with parent/content references
 * @returns collapsed array with nested structures
 */
export const collapseToLegacy = (blocks: OutputBlockData[]): OutputBlockData[] => {
  // Build a map of blocks by ID for quick lookup
  const blockMap = new Map<BlockId, OutputBlockData>();

  for (const block of blocks) {
    if (block.id) {
      blockMap.set(block.id, block);
    }
  }

  // If no flat-model list blocks, just strip hierarchy fields and return
  const hasFlatListBlocks = blocks.some(isFlatModelListBlock);

  if (!hasFlatListBlocks) {
    return blocks.map(stripHierarchyFields);
  }

  // Process blocks, converting root flat-model list blocks to legacy List blocks
  const result: OutputBlockData[] = [];
  const processedIds = new Set<BlockId>();

  for (const block of blocks) {
    const alreadyProcessed = block.id && processedIds.has(block.id);

    if (alreadyProcessed) {
      continue;
    }

    const isFlatListBlock = isFlatModelListBlock(block);
    const isRootListItem = isFlatListBlock && !block.parent;
    const isNonListItem = !isFlatListBlock;

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
  // Always expand legacy format - each list item becomes a separate block
  // This is required for the flat List tool model to render all items
  if (detectedFormat === 'legacy') {
    return dataModelConfig !== 'legacy';
  }

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
