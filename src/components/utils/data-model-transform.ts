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
 * Legacy toggle list data structure for data model transformation.
 * Old format: { title: string, isExpanded?: boolean, body: { blocks: [], time, version }, titleVariant?: number }
 */
interface LegacyToggleListData {
  title: string;
  isExpanded?: boolean;
  titleVariant?: number;
  body?: {
    time?: number;
    blocks?: OutputBlockData[];
    version?: string;
  };
}

/**
 * Legacy callout data structure for data model transformation.
 * Old format: { title?: string, body: { blocks: [] } | null, variant, emoji, isEmojiVisible }
 */
interface LegacyCalloutData {
  title?: string;
  body?: {
    blocks?: OutputBlockData[];
  } | null;
  variant?: string;
  emoji?: string | null;
  isEmojiVisible?: boolean;
}

/**
 * Map legacy callout variant to backgroundColor preset name
 */
const VARIANT_TO_BG_PRESET: Record<string, string | null> = {
  general: null,
  note: 'blue',
  important: 'purple',
  warning: 'orange',
  additional: 'yellow',
  recommendation: 'green',
  caution: 'red',
};

/**
 * Map backgroundColor preset name back to legacy variant
 */
const BG_PRESET_TO_VARIANT: Record<string, string> = {
  blue: 'note',
  purple: 'important',
  orange: 'warning',
  yellow: 'additional',
  green: 'recommendation',
  red: 'caution',
};

/**
 * Default emoji for callout blocks
 */
const CALLOUT_DEFAULT_EMOJI = '💡';

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
 * Check if a block is in legacy toggleList format
 * Legacy format: { type: "toggleList", data: { title: "...", body: { blocks: [...] } } }
 */
const isLegacyToggleListBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyToggleListData> => {
  if (block.type !== 'toggleList') {
    return false;
  }

  const data = block.data as Record<string, unknown>;

  return typeof data === 'object' && data !== null && 'title' in data;
};

/**
 * Check if a block is in legacy callout format
 * Legacy format: { type: "callout", data: { body: { blocks: [...] }, variant, emoji, isEmojiVisible } }
 * New format has textColor/backgroundColor instead of variant/body
 */
const isLegacyCalloutBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyCalloutData> => {
  if (block.type !== 'callout') {
    return false;
  }

  const data = block.data as Record<string, unknown>;

  return typeof data === 'object' && data !== null && 'body' in data;
};

/**
 * Check if a block is in legacy image format
 * Legacy editor.js shape: { type: "image", data: { file: { url: "..." }, caption?, withBorder?, withBackground?, stretched? } }
 * New shape: { type: "image", data: { url, caption?, ... } }
 */
const isLegacyImageBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'image') {
    return false;
  }

  const data = block.data as Record<string, unknown> | null | undefined;

  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const file = (data as { file?: unknown }).file;

  if (typeof file !== 'object' || file === null) {
    return false;
  }

  return typeof (file as { url?: unknown }).url === 'string';
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

  // Check if any block uses legacy list format (items[] array)
  const foundLegacyList = blocks.some(isLegacyListBlock);

  // Check if any block uses legacy toggleList format
  const foundLegacyToggle = blocks.some(isLegacyToggleListBlock);

  // Check if any block uses legacy callout format (has body field)
  const foundLegacyCallout = blocks.some(isLegacyCalloutBlock);

  // Check if any block uses legacy image format (has data.file.url)
  const foundLegacyImage = blocks.some(isLegacyImageBlock);

  const hasLegacyBlocks = foundLegacyList || foundLegacyToggle || foundLegacyCallout || foundLegacyImage;

  if (foundHierarchicalRefs && !hasLegacyBlocks) {
    return { format: 'hierarchical', hasHierarchy: true };
  }

  if (hasLegacyBlocks) {
    // Check if there's actual nesting for the hasHierarchy flag
    const hasNesting = foundHierarchicalRefs || blocks.some(hasNestedItems) || blocks.some(block =>
      isLegacyToggleListBlock(block) && block.data.body?.blocks !== undefined && block.data.body.blocks.length > 0
    ) || blocks.some(block =>
      isLegacyCalloutBlock(block) && block.data.body?.blocks !== undefined && block.data.body.blocks.length > 0
    );

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
 * Recursively expand a list of legacy body blocks into hierarchical flat blocks.
 * Each body block is routed through expandToHierarchical so that nested legacy
 * toggleList/callout/list structures are fully flattened instead of passing
 * through with their legacy type (which would hit Renderer's "unknown tool"
 * fallback and render as a stub).
 *
 * Returns both the direct-child IDs (for the parent's `content` array) and
 * the flattened descendant blocks in document order.
 * @param bodyBlocks - legacy body blocks to expand
 * @param parentId - id of the parent block (toggle/callout) that owns them
 */
/**
 * Route one emitted block into the accumulator. Root-level blocks (no parent)
 * become direct children of the legacy container; descendants keep their
 * existing parent refs assigned during recursive expansion.
 */
const appendEmittedBlock = (
  emitted: OutputBlockData,
  parentId: BlockId,
  childIds: BlockId[],
  childBlocks: OutputBlockData[]
): void => {
  if (emitted.parent !== undefined) {
    childBlocks.push(emitted);

    return;
  }

  const childId = emitted.id ?? generateBlockId();

  childIds.push(childId);
  childBlocks.push({ ...emitted, id: childId, parent: parentId });
};

const expandLegacyBodyBlocks = (
  bodyBlocks: OutputBlockData[],
  parentId: BlockId
): { childIds: BlockId[]; childBlocks: OutputBlockData[] } => {
  const childIds: BlockId[] = [];
  const childBlocks: OutputBlockData[] = [];

  for (const childBlock of bodyBlocks) {
    const expanded = expandToHierarchical([childBlock]);

    // A single legacy block may expand into N root-level siblings (e.g. a list
    // with N items). Every parent-less root becomes a direct child here so
    // multi-item lists inside callout/toggle bodies aren't orphaned.
    for (const emitted of expanded) {
      appendEmittedBlock(emitted, parentId, childIds, childBlocks);
    }
  }

  // Invariant: every emitted block must either carry a parent ref (descendant
  // assigned during its own recursive expansion) or appear in childIds (root
  // we just re-parented). If this ever trips, some expansion path is leaking
  // orphans — exactly the regression this assertion exists to catch.
  for (const block of childBlocks) {
    const hasParent = block.parent !== undefined;
    const hasId = block.id !== undefined;
    const isDirectChild = hasId && childIds.includes(block.id as BlockId);

    if (!hasParent && !isDirectChild) {
      throw new Error(
        `expandLegacyBodyBlocks: orphaned block emitted (type=${block.type}, id=${block.id ?? '<none>'}). ` +
        `Every root-level expansion must be re-parented to ${parentId}.`
      );
    }
  }

  return { childIds, childBlocks };
};

/**
 * Expand a legacy toggleList block into flat toggle block + child blocks
 */
const expandToggleListToHierarchical = (
  block: OutputBlockData<string, LegacyToggleListData>
): OutputBlockData[] => {
  const blocks: OutputBlockData[] = [];
  const toggleId = block.id ?? generateBlockId();
  const bodyBlocks = block.data.body?.blocks ?? [];

  const { childIds, childBlocks } = expandLegacyBodyBlocks(bodyBlocks, toggleId);

  const sharedFields = {
    id: toggleId,
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  };

  const isOpenField = typeof block.data.isExpanded === 'boolean' ? { isOpen: block.data.isExpanded } : {};

  // When titleVariant is set, produce a toggle heading (header with isToggleable)
  if (typeof block.data.titleVariant === 'number') {
    blocks.push({
      ...sharedFields,
      type: 'header',
      data: {
        text: block.data.title,
        level: block.data.titleVariant,
        isToggleable: true,
        ...isOpenField,
      },
    });
  } else {
    blocks.push({
      ...sharedFields,
      type: 'toggle',
      data: {
        text: block.data.title,
        ...isOpenField,
      },
    });
  }

  blocks.push(...childBlocks);

  return blocks;
};

/**
 * Expand a legacy callout block into flat callout block + child blocks
 */
const expandCalloutToHierarchical = (
  block: OutputBlockData<string, LegacyCalloutData>
): OutputBlockData[] => {
  const blocks: OutputBlockData[] = [];
  const calloutId = block.id ?? generateBlockId();
  const bodyBlocks = block.data.body?.blocks ?? [];

  const { childIds, childBlocks } = expandLegacyBodyBlocks(bodyBlocks, calloutId);

  // Map variant → backgroundColor preset
  const variant = block.data.variant ?? 'general';
  const backgroundColor = variant in VARIANT_TO_BG_PRESET ? VARIANT_TO_BG_PRESET[variant] : null;

  // Map emoji + isEmojiVisible → emoji string
  const emoji: string = block.data.isEmojiVisible === false
    ? ''
    : (block.data.emoji ?? CALLOUT_DEFAULT_EMOJI);

  blocks.push({
    id: calloutId,
    type: 'callout',
    data: {
      emoji,
      textColor: null,
      backgroundColor,
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  });

  blocks.push(...childBlocks);

  return blocks;
};

/**
 * Expand a legacy image block (editor.js shape with `data.file.url`) into
 * the new flat image shape understood by Blok's ImageTool (see
 * types/tools/image.d.ts). Moves `data.file.url` to `data.url`, drops the
 * `file` wrapper, and maps legacy editor.js flags to ImageData fields:
 *
 *   - `withBorder: true`  → `frame: 'border'` (false: drop, default is 'none')
 *   - `withBackground`    → drop entirely (no Blok equivalent)
 *   - `stretched: true`   → `size: 'full'`   (false: drop)
 *
 * All other unknown fields pass through untouched so future editor.js data
 * can't silently lose information.
 */
const expandImageToHierarchical = (block: OutputBlockData): OutputBlockData => {
  const rawData = (block.data ?? {}) as Record<string, unknown>;
  const {
    file,
    withBorder,
    withBackground: _withBackground,
    stretched,
    ...rest
  } = rawData;
  const fileUrl = typeof file === 'object' && file !== null
    ? (file as { url?: unknown }).url
    : undefined;
  const url = typeof fileUrl === 'string' ? fileUrl : '';

  return {
    ...block,
    id: block.id ?? generateBlockId(),
    data: {
      url,
      ...rest,
      ...(withBorder === true ? { frame: 'border' } : {}),
      ...(stretched === true ? { size: 'full' } : {}),
    },
  };
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
    } else if (isLegacyToggleListBlock(block)) {
      // Expand toggleList to flat toggle + child blocks
      const expanded = expandToggleListToHierarchical(block);

      expandedBlocks.push(...expanded);
    } else if (isLegacyCalloutBlock(block)) {
      // Expand legacy callout to flat callout + child blocks
      const expanded = expandCalloutToHierarchical(block);

      expandedBlocks.push(...expanded);
    } else if (isLegacyImageBlock(block)) {
      // Expand legacy image (data.file.url → data.url) to new flat image shape
      expandedBlocks.push(expandImageToHierarchical(block));
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
 * Recursively collapse a container's body: routes each direct child through the
 * appropriate processRoot* helper based on its type so that grandchildren land in
 * the correct nested legacy shape instead of being ejected to the document root.
 */
function collapseBodyBlocks(
  contentIds: BlockId[],
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData[] {
  const result: OutputBlockData[] = [];

  for (const childId of contentIds) {
    if (processedIds.has(childId)) {
      continue;
    }
    const childBlock = blockMap.get(childId);

    if (childBlock === undefined) {
      continue;
    }

    if (isFlatModelListBlock(childBlock)) {
      result.push(processRootListItem(childBlock, blockMap, processedIds));
      continue;
    }
    if (isFlatModelToggleBlock(childBlock)) {
      result.push(processRootToggleItem(childBlock, blockMap, processedIds));
      continue;
    }
    if (isToggleableHeaderBlock(childBlock)) {
      result.push(processRootToggleableHeader(childBlock, blockMap, processedIds));
      continue;
    }
    if (isFlatModelCalloutBlock(childBlock)) {
      result.push(processRootCalloutItem(childBlock, blockMap, processedIds));
      continue;
    }

    markBlockAsProcessed(childBlock.id, processedIds);
    result.push(stripHierarchyFields(childBlock));
  }

  return result;
}

/**
 * Process a root toggle block and convert to a legacy toggleList block
 */
const processRootToggleItem = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData => {
  markBlockAsProcessed(block.id, processedIds);

  const data: unknown = block.data;
  const text = isObjectWithText(data) ? data.text : '';
  const isOpen = typeof (data as Record<string, unknown>)?.isOpen === 'boolean'
    ? (data as Record<string, unknown>).isOpen as boolean
    : undefined;

  const contentIds = block.content ?? [];
  const childBlocks = collapseBodyBlocks(contentIds, blockMap, processedIds);

  const legacyBlock: OutputBlockData = {
    id: block.id,
    type: 'toggleList',
    data: {
      title: text,
      ...(isOpen !== undefined ? { isExpanded: isOpen } : {}),
      ...(childBlocks.length > 0 ? {
        body: {
          blocks: childBlocks,
        },
      } : {}),
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
  };

  return legacyBlock;
};

/**
 * Check if a block is a flat-model toggle block
 */
const isFlatModelToggleBlock = (block: OutputBlockData): boolean => {
  return block.type === 'toggle';
};

/**
 * Check if a block is a toggleable header (header with isToggleable: true)
 */
const isToggleableHeaderBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'header') {
    return false;
  }

  const data: unknown = block.data;

  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).isToggleable === true;
};

/**
 * Process a root toggleable header block and convert to a legacy toggleList block with titleVariant
 */
const processRootToggleableHeader = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData => {
  markBlockAsProcessed(block.id, processedIds);

  const data: unknown = block.data;
  const text = isObjectWithText(data) ? data.text : '';
  const level = typeof (data as Record<string, unknown>)?.level === 'number'
    ? (data as Record<string, unknown>).level as number
    : undefined;
  const isOpen = typeof (data as Record<string, unknown>)?.isOpen === 'boolean'
    ? (data as Record<string, unknown>).isOpen as boolean
    : undefined;

  const contentIds = block.content ?? [];
  const childBlocks = collapseBodyBlocks(contentIds, blockMap, processedIds);

  const legacyBlock: OutputBlockData = {
    id: block.id,
    type: 'toggleList',
    data: {
      title: text,
      ...(level !== undefined ? { titleVariant: level } : {}),
      ...(isOpen !== undefined ? { isExpanded: isOpen } : {}),
      ...(childBlocks.length > 0 ? { body: { blocks: childBlocks } } : {}),
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
  };

  return legacyBlock;
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
 * Check if a block is a flat-model callout block (has no 'body' field)
 */
const isFlatModelCalloutBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'callout') {
    return false;
  }

  const data = block.data as Record<string, unknown>;

  return typeof data === 'object' && data !== null && !('body' in data);
};

/**
 * Process a root callout block (flat model) and convert to a legacy callout block
 */
const processRootCalloutItem = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): OutputBlockData => {
  markBlockAsProcessed(block.id, processedIds);

  const data = block.data as Record<string, unknown>;

  // Map backgroundColor preset → variant
  const backgroundColor = data.backgroundColor as string | null | undefined;
  const variant = backgroundColor !== null && backgroundColor !== undefined
    ? (BG_PRESET_TO_VARIANT[backgroundColor] ?? 'general')
    : 'general';

  // Map emoji string → isEmojiVisible + emoji
  const emojiValue = data.emoji as string | undefined;
  const isEmojiVisible = typeof emojiValue === 'string' && emojiValue.length > 0;
  const emoji = isEmojiVisible ? emojiValue : null;

  const contentIds = block.content ?? [];
  const childBlocks = collapseBodyBlocks(contentIds, blockMap, processedIds);

  const legacyBlock: OutputBlockData = {
    id: block.id,
    type: 'callout',
    data: {
      title: '',
      variant,
      emoji,
      isEmojiVisible,
      ...(childBlocks.length > 0 ? { body: { blocks: childBlocks } } : {}),
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
  };

  return legacyBlock;
};

/**
 * Collapse hierarchical flat-with-references format back to legacy nested format
 * @param blocks - array of flat blocks with parent/content references
 * @returns collapsed array with nested structures
 */
/**
 * Groups one block under its parent in the derived-content map if it has a
 * valid parent reference. Helper extracted for collapseToLegacy reconciliation.
 */
const appendChildToDerivedContent = (
  block: OutputBlockData,
  blockById: Map<BlockId, OutputBlockData>,
  derivedContent: Map<BlockId, BlockId[]>
): void => {
  if (!block.id || !block.parent || !blockById.has(block.parent)) {
    return;
  }
  const siblings = derivedContent.get(block.parent);

  if (siblings === undefined) {
    derivedContent.set(block.parent, [block.id]);

    return;
  }
  siblings.push(block.id);
};

/**
 * Merges live (parent-derived) ids into the existing content[] preserving its
 * order, dropping any dead ids that don't resolve to a block in the input.
 */
const mergeContentIds = (
  existingContent: BlockId[] | undefined,
  derivedIds: BlockId[],
  blockById: Map<BlockId, OutputBlockData>
): BlockId[] => {
  const existing = Array.isArray(existingContent) ? existingContent : [];
  const merged = existing.filter((id) => blockById.has(id));

  for (const id of derivedIds) {
    if (!merged.includes(id)) {
      merged.push(id);
    }
  }

  return merged;
};

export const collapseToLegacy = (blocks: OutputBlockData[]): OutputBlockData[] => {
  // Defense-in-depth: reconcile each parent's content[] from children's parent
  // fields before processing. Saver is the primary source of truth for content[]
  // (see src/components/modules/saver.ts#doSave), but this pass guarantees the
  // invariant `child.parent === X ⇒ X.content.includes(child.id)` even when
  // OutputBlockData originates from a path that bypassed the saver — migrations,
  // external JSON, tests, 3rd-party consumers. Without this, stale content[]
  // causes processRootCalloutItem to eject real children as root siblings.
  const reconciledBlocks = blocks.map((block) => ({ ...block }));
  const reconciledById = new Map<BlockId, OutputBlockData>();

  for (const block of reconciledBlocks) {
    if (block.id) {
      reconciledById.set(block.id, block);
    }
  }

  const derivedContent = new Map<BlockId, BlockId[]>();

  for (const block of reconciledBlocks) {
    appendChildToDerivedContent(block, reconciledById, derivedContent);
  }

  for (const [parentId, derivedIds] of derivedContent) {
    const parent = reconciledById.get(parentId);

    if (parent === undefined) {
      continue;
    }
    parent.content = mergeContentIds(parent.content, derivedIds, reconciledById);
  }

  // Build a map of blocks by ID for quick lookup
  const blockMap = new Map<BlockId, OutputBlockData>();

  for (const block of reconciledBlocks) {
    if (block.id) {
      blockMap.set(block.id, block);
    }
  }

  // If no flat-model list, toggle, or callout blocks, just strip hierarchy fields and return
  const hasFlatListBlocks = reconciledBlocks.some(isFlatModelListBlock);
  const hasFlatToggleBlocks = reconciledBlocks.some(isFlatModelToggleBlock);
  const hasFlatToggleableHeaders = reconciledBlocks.some(b => isToggleableHeaderBlock(b) && !b.parent);
  const hasFlatCalloutBlocks = reconciledBlocks.some(isFlatModelCalloutBlock);

  if (!hasFlatListBlocks && !hasFlatToggleBlocks && !hasFlatToggleableHeaders && !hasFlatCalloutBlocks) {
    return reconciledBlocks.map(stripHierarchyFields);
  }

  // Process blocks, converting root flat-model list blocks to legacy List blocks
  const result: OutputBlockData[] = [];
  const processedIds = new Set<BlockId>();

  for (const block of reconciledBlocks) {
    const alreadyProcessed = block.id && processedIds.has(block.id);

    if (alreadyProcessed) {
      continue;
    }

    const isFlatListBlock = isFlatModelListBlock(block);
    const isRootListItem = isFlatListBlock && !block.parent;
    const isFlatToggleBlock = isFlatModelToggleBlock(block);
    const isRootToggleItem = isFlatToggleBlock && !block.parent;
    const isToggleableHeader = isToggleableHeaderBlock(block);
    const isRootToggleableHeader = isToggleableHeader && !block.parent;
    const isFlatCallout = isFlatModelCalloutBlock(block);
    const isRootCallout = isFlatCallout && !block.parent;
    const isNonListItem = !isFlatListBlock && !isFlatToggleBlock && !isToggleableHeader && !isFlatCallout;

    if (isRootListItem) {
      const listBlock = processRootListItem(block, blockMap, processedIds);

      result.push(listBlock);
    }

    if (isRootToggleItem) {
      const toggleBlock = processRootToggleItem(block, blockMap, processedIds);

      result.push(toggleBlock);
    }

    if (isRootToggleableHeader) {
      const legacyBlock = processRootToggleableHeader(block, blockMap, processedIds);

      result.push(legacyBlock);
    }

    if (isRootCallout) {
      const calloutBlock = processRootCalloutItem(block, blockMap, processedIds);

      result.push(calloutBlock);
    }

    if (isNonListItem) {
      result.push(stripHierarchyFields(block));
      markBlockAsProcessed(block.id, processedIds);
    }
  }

  return result;
};

/**
 * A table cell that references its content blocks by id.
 * Tables persist their child blocks via `data.content[row][col].blocks = [<id>, ...]`
 * rather than nesting block payloads inline, so the parent/content relationship
 * is implicit in the table data instead of explicit on each child block.
 */
interface CellWithBlockRefs {
  blocks: string[];
}

const isCellWithBlockRefs = (cell: unknown): cell is CellWithBlockRefs => {
  return (
    typeof cell === 'object' &&
    cell !== null &&
    Array.isArray((cell as { blocks?: unknown }).blocks)
  );
};

interface TableDataShape {
  content?: unknown;
}

const getTableContentRows = (data: unknown): unknown[][] | null => {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const content = (data as TableDataShape).content;

  if (!Array.isArray(content)) {
    return null;
  }
  return content as unknown[][];
};

/**
 * When a flat block array contains `table` blocks that reference child blocks
 * via `data.content[row][col].blocks = [<id>, ...]`, ensure each referenced
 * child carries `parent: <tableId>`. This makes the parent/content invariant
 * explicit even for externally-authored data shapes that omit the `parent`
 * field on children.
 *
 * Without this normalization, downstream readers that key on parentId
 * (`mountCellBlocksReadOnly`'s cross-table guard, the table saver's
 * own-child filter, hierarchy queries, drag-and-drop) skip those children
 * and leak them out of the table, rendering them at the bottom of the page
 * instead of inside the cells.
 *
 * The function is idempotent, never mutates the input array, and leaves
 * pre-existing `parent` fields unchanged. Children referenced by multiple
 * tables get assigned to the first table that lists them (first-writer-wins);
 * corrupted cross-table references are preserved as-is so defensive guards
 * downstream can still reject them.
 * @param blocks - flat block array potentially containing tables with cell refs
 */
const collectCellChildRefs = (
  cell: unknown,
  tableId: BlockId,
  childToTable: Map<BlockId, BlockId>
): void => {
  if (!isCellWithBlockRefs(cell)) {
    return;
  }
  for (const childId of cell.blocks) {
    if (typeof childId !== 'string' || childToTable.has(childId)) {
      continue;
    }
    childToTable.set(childId, tableId);
  }
};

const collectRowChildRefs = (
  row: unknown,
  tableId: BlockId,
  childToTable: Map<BlockId, BlockId>
): void => {
  if (!Array.isArray(row)) {
    return;
  }
  row.forEach(cell => collectCellChildRefs(cell, tableId, childToTable));
};

const collectTableChildRefs = (
  tableBlock: OutputBlockData,
  childToTable: Map<BlockId, BlockId>
): void => {
  if (tableBlock.id === undefined || tableBlock.id === null) {
    return;
  }
  const rows = getTableContentRows(tableBlock.data);

  if (rows === null) {
    return;
  }
  const tableId = tableBlock.id;

  rows.forEach(row => collectRowChildRefs(row, tableId, childToTable));
};

export const normalizeTableChildParents = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const childToTable = new Map<BlockId, BlockId>();

  blocks
    .filter(block => block.type === 'table')
    .forEach(tableBlock => collectTableChildRefs(tableBlock, childToTable));

  if (childToTable.size === 0) {
    return blocks;
  }

  return blocks.map(block => {
    if (block.id === undefined || block.id === null) {
      return block;
    }
    const tableId = childToTable.get(block.id);

    if (tableId === undefined) {
      return block;
    }
    if (block.parent !== undefined && block.parent !== null) {
      return block;
    }
    return { ...block, parent: tableId };
  });
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
