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
type LegacyListData = {
  style: 'unordered' | 'ordered' | 'checklist';
  items: LegacyListItem[];
  start?: number;
}

/**
 * Standalone editor.js checklist data structure.
 * Old format: { type: "checklist", data: { items: [{ text, checked }] } }
 * Blok has no dedicated checklist tool — checklist is a style of the List tool —
 * so this is expanded into per-item flat `list` blocks with style 'checklist'.
 */
type LegacyChecklistData = {
  items: LegacyListItem[];
}

/**
 * Editor.js linkTool (the @editorjs/link block) data structure.
 * Old format: { type: "linkTool", data: { link, meta: { title, description, image: { url }, favicon, domain } } }
 * Maps to Blok's flat Bookmark data shape (see types BookmarkMeta).
 */
type LegacyLinkToolData = {
  link: string;
  meta?: {
    title?: string;
    description?: string;
    image?: { url?: string } | string;
    favicon?: string;
    domain?: string;
    site_name?: string;
  };
}

/**
 * Legacy toggle list data structure for data model transformation.
 * Old format: { title: string, isExpanded?: boolean, body: { blocks: [], time, version }, titleVariant?: number }
 */
type LegacyToggleListData = {
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
type LegacyCalloutData = {
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
 * Emit a one-time `console.warn` per (blockType, field) pair during a single
 * migration pass, recording emitted keys in `warned` so the same lossy field
 * isn't reported twice. Lets users SEE what Editor.js data was dropped — the
 * fields themselves are still dropped (no Blok equivalent), this only adds
 * visibility.
 */
const warnLossyField = (
  warned: Set<string>,
  blockType: string,
  field: string,
  verb: 'dropped' | 'ignored'
): void => {
  const key = `${blockType}.${field}`;

  if (warned.has(key)) {
    return;
  }
  warned.add(key);

  console.warn(`[Blok migration] ${blockType} block ${verb} unsupported field "${field}" (no Blok equivalent)`);
};

/**
 * Type guard: object has the given key defined (not undefined).
 */
const hasDefinedField = (data: unknown, key: string): boolean => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  return (data as Record<string, unknown>)[key] !== undefined;
};

/**
 * Warn for the Editor.js quote `alignment` field, which Blok's quote tool
 * (which uses { text, size }) has no equivalent for and drops. The quote
 * `caption` is NOT warned here: it is rescued by expandQuoteToHierarchical into
 * a following paragraph block, so it is migrated rather than lost.
 */
const warnLossyQuoteFields = (block: OutputBlockData, warned: Set<string>): void => {
  if (block.type !== 'quote') {
    return;
  }
  if (hasDefinedField(block.data, 'alignment')) {
    warnLossyField(warned, 'quote', 'alignment', 'ignored');
  }
};

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
 * Check if a block is a standalone editor.js checklist (type "checklist" with items[])
 */
const isLegacyChecklistBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyChecklistData> => {
  return (
    block.type === 'checklist' &&
    typeof block.data === 'object' &&
    block.data !== null &&
    Array.isArray((block.data as { items?: unknown }).items)
  );
};

/**
 * Check if a block is an editor.js linkTool (type "linkTool" with a string link)
 */
const isLegacyLinkToolBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyLinkToolData> => {
  return (
    block.type === 'linkTool' &&
    typeof block.data === 'object' &&
    block.data !== null &&
    typeof (block.data as { link?: unknown }).link === 'string'
  );
};

/**
 * Check if a block is in legacy toggleList format
 * Legacy format: { type: "toggleList", data: { title: "...", body: { blocks: [...] } } }
 */
const isLegacyToggleListBlock = (block: OutputBlockData): block is OutputBlockData<string, LegacyToggleListData> => {
  if (block.type !== 'toggleList') {
    return false;
  }

  const data = block.data;

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

  const data = block.data;

  return typeof data === 'object' && data !== null && 'body' in data;
};

/**
 * Check if a block is an editor.js quote carrying fields Blok's quote tool
 * ({ text, size }) doesn't understand — `caption` and/or `alignment`.
 * Editor.js quote shape: { type: "quote", data: { text, caption, alignment } }.
 * Such quotes are routed through expandQuoteToHierarchical, which strips those
 * fields (migrating a non-empty caption into a following paragraph).
 */
const isLegacyQuoteBlock = (block: OutputBlockData): boolean => {
  return block.type === 'quote' && (hasDefinedField(block.data, 'caption') || hasDefinedField(block.data, 'alignment'));
};

/**
 * Check if a block is in legacy image format. Two editor.js sources qualify:
 *   - @editorjs/image:        { file: { url }, caption?, withBorder?, withBackground?, stretched? }
 *   - @editorjs/simple-image: { url, caption?, withBorder?, withBackground?, stretched? }  (flat url, NO file wrapper)
 * Blok-native shape is also flat ({ url, frame?, size? }), so a flat-url block is
 * only legacy when it still carries an editor.js-only flag (withBorder/
 * withBackground/stretched) — otherwise it is already migrated and left alone.
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

  if (typeof file === 'object' && file !== null && typeof (file as { url?: unknown }).url === 'string') {
    return true;
  }

  // @editorjs/simple-image: flat top-level url + at least one editor.js-only flag.
  const hasFlatUrl = typeof (data as { url?: unknown }).url === 'string';
  const hasLegacyFlag = 'withBorder' in data || 'withBackground' in data || 'stretched' in data;

  return hasFlatUrl && hasLegacyFlag;
};

/**
 * Editor.js @editorjs/table stores cells as HTML strings (`content: string[][]`),
 * whereas Blok's Table references child blocks per cell
 * (`content[r][c] = { blocks: [id] }`, see src/tools/table/types.ts). A table with
 * at least one string cell is legacy and must be rewritten by
 * expandTableToHierarchical; a table already in block-ref shape is Blok-native.
 */
const isLegacyTableBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'table') {
    return false;
  }

  const rows = getTableContentRows(block.data);

  if (rows === null) {
    return false;
  }

  return rows.some(row => Array.isArray(row) && row.some(cell => typeof cell === 'string'));
};

/**
 * Editor.js @editorjs/raw block: `{ html }`. Blok has no raw tool; the HTML is
 * migrated into a code block (source shown verbatim) by expandRawToHierarchical.
 */
const isLegacyRawBlock = (block: OutputBlockData): boolean => {
  return block.type === 'raw' && hasDefinedField(block.data, 'html');
};

/**
 * Editor.js @editorjs/warning block: `{ title, message }`. Blok has no warning
 * tool; it is migrated into a callout (⚠️ + orange) with title/message child
 * paragraphs by expandWarningToHierarchical.
 */
const isLegacyWarningBlock = (block: OutputBlockData): boolean => {
  return block.type === 'warning' && typeof block.data === 'object' && block.data !== null;
};

/**
 * Editor.js @editorjs/attaches block: `{ file: { url, name, size, extension }, title }`.
 * Blok has no attaches tool; the link is migrated into a bookmark by
 * expandAttachesToHierarchical (file metadata is dropped + warned).
 */
const isLegacyAttachesBlock = (block: OutputBlockData): boolean => {
  if (block.type !== 'attaches') {
    return false;
  }

  const data = block.data as Record<string, unknown> | null | undefined;
  const file = typeof data === 'object' && data !== null ? (data as { file?: unknown }).file : undefined;

  return typeof file === 'object' && file !== null && typeof (file as { url?: unknown }).url === 'string';
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

  // Check if any block is a standalone editor.js checklist
  const foundLegacyChecklist = blocks.some(isLegacyChecklistBlock);

  // Check if any block is an editor.js linkTool
  const foundLegacyLinkTool = blocks.some(isLegacyLinkToolBlock);

  // Check if any block is an editor.js quote with caption/alignment to strip
  const foundLegacyQuote = blocks.some(isLegacyQuoteBlock);

  // Check if any block is an editor.js table with HTML-string cells
  const foundLegacyTable = blocks.some(isLegacyTableBlock);

  // Check if any block is an editor.js raw / warning / attaches block (no
  // same-named Blok tool — each is remapped to code / callout / bookmark)
  const foundLegacyRaw = blocks.some(isLegacyRawBlock);
  const foundLegacyWarning = blocks.some(isLegacyWarningBlock);
  const foundLegacyAttaches = blocks.some(isLegacyAttachesBlock);

  const hasLegacyBlocks =
    foundLegacyList || foundLegacyToggle || foundLegacyCallout || foundLegacyImage || foundLegacyChecklist ||
    foundLegacyLinkTool || foundLegacyQuote || foundLegacyTable || foundLegacyRaw || foundLegacyWarning || foundLegacyAttaches;

  if (foundHierarchicalRefs && !hasLegacyBlocks) {
    return { format: 'hierarchical', hasHierarchy: true };
  }

  if (hasLegacyBlocks) {
    // Check if there's actual nesting for the hasHierarchy flag
    const hasNesting = foundHierarchicalRefs || foundLegacyTable || foundLegacyWarning || blocks.some(hasNestedItems) || blocks.some(block =>
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
const expandImageToHierarchical = (block: OutputBlockData, warned: Set<string>): OutputBlockData => {
  const rawData = (block.data ?? {});
  const {
    file,
    url: flatUrl,
    withBorder,
    withBackground,
    stretched,
    ...rest
  } = rawData;

  if (withBackground === true) {
    warnLossyField(warned, 'image', 'withBackground', 'dropped');
  }
  // @editorjs/image nests the url under `file`; @editorjs/simple-image puts it
  // at the top level. Prefer file.url, then fall back to the flat url.
  const fileUrl = typeof file === 'object' && file !== null
    ? (file as { url?: unknown }).url
    : undefined;
  const resolvedUrl = typeof fileUrl === 'string' ? fileUrl : flatUrl;
  const url = typeof resolvedUrl === 'string' ? resolvedUrl : '';

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
 * Expand a standalone editor.js checklist block into per-item flat `list`
 * blocks with style 'checklist'. Blok has no dedicated checklist tool, so the
 * items are routed through the same flattening used for legacy lists (which
 * already normalizes the `{ text, checked }` item shape).
 */
const expandChecklistToHierarchical = (
  data: LegacyChecklistData,
  tunes?: OutputBlockData['tunes']
): OutputBlockData[] => {
  return expandListToHierarchical({ style: 'checklist', items: data.items }, tunes);
};

/**
 * Expand an editor.js linkTool block into a Blok bookmark block. Maps
 * `{ link, meta: { title, description, image: { url }, favicon, domain } }`
 * to the flat bookmark shape `{ url, title?, description?, image?, favicon?, domain? }`.
 * Fields with no Blok equivalent (e.g. meta.site_name) are dropped.
 */
const expandLinkToolToHierarchical = (
  block: OutputBlockData<string, LegacyLinkToolData>,
  warned: Set<string>
): OutputBlockData => {
  const meta = block.data.meta ?? {};
  const image = typeof meta.image === 'object' && meta.image !== null ? meta.image.url : meta.image;

  if (meta.site_name !== undefined) {
    warnLossyField(warned, 'linkTool', 'site_name', 'dropped');
  }

  return {
    ...block,
    id: block.id ?? generateBlockId(),
    type: 'bookmark',
    data: {
      url: block.data.link,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
      ...(typeof image === 'string' ? { image } : {}),
      ...(meta.favicon !== undefined ? { favicon: meta.favicon } : {}),
      ...(meta.domain !== undefined ? { domain: meta.domain } : {}),
    },
  };
};

/**
 * Expand an editor.js quote block that carries a non-empty `caption` into the
 * Blok quote block plus a following `paragraph` sibling holding the caption.
 *
 * Blok's quote tool data is `{ text, size }` — it has no `caption` field — so a
 * caption would otherwise be dropped. The most faithful Blok representation is a
 * separate paragraph immediately after the quote (the caption text is regular
 * rich content). The quote keeps `text`/`size`; `caption` is moved out and
 * `alignment` (no Blok equivalent) is dropped + warned via warnLossyQuoteFields.
 *
 * Mirrors the 1:N expansion contract of expandListToHierarchical /
 * expandChecklistToHierarchical: returns an ordered array (quote first, then the
 * caption paragraph when the caption is non-empty) that the caller spreads into
 * the output. A quote with only `alignment` (or an empty caption) yields just
 * the cleaned quote block — no trailing paragraph.
 */
const expandQuoteToHierarchical = (block: OutputBlockData, warned: Set<string>): OutputBlockData[] => {
  warnLossyQuoteFields(block, warned);

  const rawData = (block.data ?? {});
  const { caption, alignment: _alignment, ...rest } = rawData;

  const quoteBlock: OutputBlockData = {
    ...block,
    id: block.id ?? generateBlockId(),
    data: rest,
  };

  if (typeof caption !== 'string' || caption.length === 0) {
    return [quoteBlock];
  }

  const captionBlock: OutputBlockData = {
    id: generateBlockId(),
    type: 'paragraph',
    data: { text: caption },
  };

  return [quoteBlock, captionBlock];
};

/**
 * Expand an editor.js table (HTML-string cells) into a Blok-native table whose
 * cells reference child paragraph blocks by id, plus those child paragraph
 * blocks. Editor.js shape `{ withHeadings, content: string[][] }` is rewritten so
 * each non-empty cell becomes `{ blocks: [<childId>] }` with a sibling paragraph
 * (`parent === tableId`) holding the cell text; empty cells become `{ blocks: [] }`
 * with no child. Cells already in block-ref shape pass through untouched.
 *
 * Child ids are freshly generated (NOT positional `cell-<r>-<c>`) so multiple
 * migrated tables in one document never collide on cell ids — the parent/content
 * invariant is set explicitly here, so the positional reclaim net
 * (reclaimDetachedTableCells) is not relied upon for this path. Returns
 * [table, ...childParagraphs] in document order (matches the 1:N expansion
 * contract of expandToggleListToHierarchical / expandCalloutToHierarchical).
 */
const expandTableToHierarchical = (block: OutputBlockData): OutputBlockData[] => {
  const tableId = block.id ?? generateBlockId();
  const rawData = (block.data ?? {});
  const { content: _content, withHeadings, withHeadingColumn, stretched, ...restData } = rawData;
  const rows = getTableContentRows(rawData) ?? [];
  const childBlocks: OutputBlockData[] = [];

  const newContent = rows.map(row => {
    if (!Array.isArray(row)) {
      return row;
    }

    return row.map(cell => {
      if (isCellWithBlockRefs(cell)) {
        return cell;
      }

      const text = typeof cell === 'string' ? cell : '';

      if (text.length === 0) {
        return { blocks: [] };
      }

      const cellId = generateBlockId();

      childBlocks.push({
        id: cellId,
        type: 'paragraph',
        data: { text },
        parent: tableId,
      });

      return { blocks: [cellId] };
    });
  });

  const tableBlock: OutputBlockData = {
    ...block,
    id: tableId,
    data: {
      ...restData,
      withHeadings: withHeadings === true,
      withHeadingColumn: withHeadingColumn === true,
      ...(stretched === true ? { stretched: true } : {}),
      content: newContent,
    },
  };

  return [tableBlock, ...childBlocks];
};

/**
 * Expand an editor.js raw block (`{ html }`) into a Blok code block, preserving
 * the raw HTML as the code text (shown verbatim as source). Blok has no raw
 * tool; code is the least-lossy faithful representation. The code tool defaults
 * language/lineNumbers at construction, so emitting `{ code }` alone suffices.
 */
const expandRawToHierarchical = (block: OutputBlockData): OutputBlockData => {
  const html = (block.data as { html?: unknown } | null | undefined)?.html;

  return {
    ...block,
    id: block.id ?? generateBlockId(),
    type: 'code',
    data: { code: typeof html === 'string' ? html : '' },
  };
};

/**
 * Default emoji for callouts migrated from editor.js warning blocks.
 */
const WARNING_EMOJI = '⚠️';

/**
 * Expand an editor.js warning block (`{ title, message }`) into a Blok callout
 * (⚠️ emoji, orange background) whose title and message become child paragraph
 * blocks. Mirrors the flat callout shape produced by expandCalloutToHierarchical
 * (`{ emoji, textColor, backgroundColor }` + `content[]` child refs). Empty
 * title/message fields are skipped (no empty paragraph child).
 */
const expandWarningToHierarchical = (block: OutputBlockData): OutputBlockData[] => {
  const calloutId = block.id ?? generateBlockId();
  const data = (block.data ?? {});
  const title = typeof data.title === 'string' ? data.title : '';
  const message = typeof data.message === 'string' ? data.message : '';

  const childBlocks: OutputBlockData[] = [];

  for (const text of [title, message]) {
    if (text.length === 0) {
      continue;
    }

    childBlocks.push({
      id: generateBlockId(),
      type: 'paragraph',
      data: { text },
      parent: calloutId,
    });
  }

  const childIds = childBlocks.map(child => child.id as BlockId);

  const calloutBlock: OutputBlockData = {
    id: calloutId,
    type: 'callout',
    data: {
      emoji: WARNING_EMOJI,
      textColor: null,
      backgroundColor: 'orange',
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(childIds.length > 0 ? { content: childIds } : {}),
  };

  return [calloutBlock, ...childBlocks];
};

/**
 * Expand an editor.js attaches block
 * (`{ file: { url, name, size, extension }, title }`) into a Blok bookmark
 * (`{ url, title? }`). Blok has no file-attachment tool, so the link is
 * preserved as a bookmark; file metadata (name/size/extension) has no bookmark
 * equivalent and is dropped + warned once per pass.
 */
const expandAttachesToHierarchical = (block: OutputBlockData, warned: Set<string>): OutputBlockData => {
  const data = (block.data ?? {});
  const file = (typeof data.file === 'object' && data.file !== null ? data.file : {}) as Record<string, unknown>;
  const url = typeof file.url === 'string' ? file.url : '';
  const title = typeof data.title === 'string' ? data.title : undefined;

  if (file.name !== undefined || file.size !== undefined || file.extension !== undefined) {
    warnLossyField(warned, 'attaches', 'file metadata', 'dropped');
  }

  return {
    ...block,
    id: block.id ?? generateBlockId(),
    type: 'bookmark',
    data: {
      url,
      ...(title !== undefined ? { title } : {}),
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
  // Dedupe lossy-field warnings to one per (blockType, field) for this pass.
  const warnedFields = new Set<string>();

  for (const block of blocks) {
    if (isLegacyListBlock(block)) {
      // Expand List tool nested items to flat blocks
      // Type guard narrows block.data to LegacyListData
      const expanded = expandListToHierarchical(block.data, block.tunes);

      expandedBlocks.push(...expanded);
    } else if (isLegacyChecklistBlock(block)) {
      // Expand standalone editor.js checklist to flat list blocks (style 'checklist')
      const expanded = expandChecklistToHierarchical(block.data, block.tunes);

      expandedBlocks.push(...expanded);
    } else if (isLegacyLinkToolBlock(block)) {
      // Expand editor.js linkTool to a Blok bookmark block
      expandedBlocks.push(expandLinkToolToHierarchical(block, warnedFields));
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
      expandedBlocks.push(expandImageToHierarchical(block, warnedFields));
    } else if (isLegacyQuoteBlock(block)) {
      // Editor.js quote carries { caption, alignment } Blok's quote tool lacks.
      // Strip them: a non-empty caption becomes a following paragraph sibling,
      // alignment is dropped + warned.
      const expanded = expandQuoteToHierarchical(block, warnedFields);

      expandedBlocks.push(...expanded);
    } else if (isLegacyTableBlock(block)) {
      // Editor.js table HTML-string cells → Blok cell-block-refs + child paragraphs
      expandedBlocks.push(...expandTableToHierarchical(block));
    } else if (isLegacyRawBlock(block)) {
      // Editor.js raw { html } → Blok code block (source shown verbatim)
      expandedBlocks.push(expandRawToHierarchical(block));
    } else if (isLegacyWarningBlock(block)) {
      // Editor.js warning { title, message } → Blok callout + child paragraphs
      expandedBlocks.push(...expandWarningToHierarchical(block));
    } else if (isLegacyAttachesBlock(block)) {
      // Editor.js attaches { file, title } → Blok bookmark (file metadata dropped)
      expandedBlocks.push(expandAttachesToHierarchical(block, warnedFields));
    } else {
      // Other blocks pass through unchanged (with guaranteed ID).
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
 * Decide how to emit a non-list block during legacy collapse.
 *
 * A non-list block nested under a list cannot be folded into the list's legacy
 * items[] (see processRootListItem), so keep it flat WITH its parent ref — the
 * parent list block carries a matching content[] ref, so the nesting survives.
 * Every other non-list block becomes a legacy root block (no parent/content).
 */
const collapseNonListBlock = (
  block: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>
): OutputBlockData => {
  const parentBlock = block.parent !== undefined ? blockMap.get(block.parent) : undefined;

  if (parentBlock !== undefined && parentBlock.type === 'list') {
    const { content: _content, ...keptWithParent } = block;

    return keptWithParent;
  }

  return stripHierarchyFields(block);
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

  // A list block may have NON-list structural children (e.g. a quote/paragraph
  // dragged into the list). Legacy `items[]` can only represent list sub-items,
  // so these children cannot be folded into the list — collectChildItems above
  // deliberately skips them. Preserve the hierarchy by keeping a `content[]` ref
  // to each non-list child (the children themselves stay flat with their
  // `parent` ref, see the isNonListItem branch in collapseToLegacy). Without
  // this, the child's nesting is silently dropped on save.
  const nonListContent = (block.content ?? []).filter((childId) => {
    const child = blockMap.get(childId);

    return child !== undefined && child.type !== 'list';
  });

  const listBlock: OutputBlockData = {
    id: block.id,
    type: 'list',
    data: {
      style,
      items: listItems,
      ...(style === 'ordered' && start !== undefined && start !== 1 ? { start } : {}),
    } as LegacyListData,
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(nonListContent.length > 0 ? { content: nonListContent } : {}),
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

  const data = block.data;

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

  const data = block.data;

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
      result.push(collapseNonListBlock(block, blockMap));
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
 * Positional cell-child id minted by the HTML→blok migration: `cell-<row>-<col>`
 * with 1-based row/col (e.g. `cell-2-1` = row 2, column 1). See the migration
 * system prompt (EditorJsHtmlConversionSystemPrompt) which instructs the model
 * to emit one paragraph per non-empty cell with exactly this id.
 */
const DETACHED_CELL_ID_PATTERN = /^cell-([1-9]\d*)-([1-9]\d*)$/;

interface CellPosition {
  row: number;
  col: number;
}

const parseDetachedCellPosition = (id: BlockId | undefined): CellPosition | null => {
  if (typeof id !== 'string') {
    return null;
  }
  const match = DETACHED_CELL_ID_PATTERN.exec(id);

  if (match === null) {
    return null;
  }
  const row = Number(match[1]) - 1;
  const col = Number(match[2]) - 1;

  if (row < 0 || col < 0) {
    return null;
  }
  return { row, col };
};

const tableCellIsEmptyAt = (tableBlock: OutputBlockData, row: number, col: number): boolean => {
  const rows = getTableContentRows(tableBlock.data);

  if (rows === null) {
    return false;
  }
  const rowCells = rows[row];

  if (!Array.isArray(rowCells)) {
    return false;
  }
  const cell = rowCells[col];

  return isCellWithBlockRefs(cell) && cell.blocks.length === 0;
};

const collectReferencedCellChildIds = (blocks: OutputBlockData[]): Set<string> => {
  const referenced = new Set<string>();

  blocks
    .filter(block => block.type === 'table')
    .forEach(tableBlock => {
      const rows = getTableContentRows(tableBlock.data);

      rows?.forEach(row => {
        if (!Array.isArray(row)) {
          return;
        }
        row.forEach(cell => {
          if (!isCellWithBlockRefs(cell)) {
            return;
          }
          cell.blocks.forEach(id => {
            if (typeof id === 'string') {
              referenced.add(id);
            }
          });
        });
      });
    });

  return referenced;
};

/**
 * Recover migrated table cells whose text was detached by a pre-fix save.
 *
 * The "migration table content loss" bug worked like this: a migrated table
 * references its cell text via `data.content[r][c].blocks = [<childId>]`, but the
 * child paragraph lacked `parent === tableId`. A save on an unfixed editor filtered
 * that child out of the cell (Table.save() keeps only `parentId === tableId`) and
 * the saver emitted it as a root-level block. The text is NOT lost — it survives
 * as a detached top-level paragraph — but the cell now reads `{ blocks: [] }`.
 *
 * Crucially, the migration minted that paragraph with a POSITIONAL id
 * (`cell-<row>-<col>`, 1-based) that still encodes which cell it came from. This
 * pass walks every root-level block whose id matches that pattern and is no longer
 * referenced by any cell, and — when exactly one table has a matching EMPTY cell at
 * that position — re-attaches it: the id is restored to `content[row][col].blocks`
 * and the block's `parent` is set to that table.
 *
 * Safety: only empty cells are filled (occupied cells are never overwritten), only
 * `cell-R-C`-id root blocks are consumed (user-authored blocks never match), blocks
 * that already carry a `parent` are skipped, and reclamation is skipped entirely
 * when two or more tables share the matching empty cell (ambiguous — never guess).
 * The function is non-mutating and returns the same array reference when there is
 * nothing to reclaim.
 * @param blocks - flat block array potentially containing detached migrated cells
 */
export const reclaimDetachedTableCells = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const tableBlocks = blocks.filter(
    (block): block is OutputBlockData => block.type === 'table' && block.id !== undefined && block.id !== null
  );

  // The positional id `cell-<row>-<col>` encodes the cell but NOT which table.
  // With two or more tables the owning table is unidentifiable, so re-attaching
  // could silently drop text into the wrong table. Only single-table documents
  // are unambiguous; anything else is left untouched (never guess).
  if (tableBlocks.length !== 1) {
    return blocks;
  }

  const referenced = collectReferencedCellChildIds(blocks);

  // Count id occurrences: a duplicated id is ambiguous and would be regenerated
  // by the renderer's dedup pass after reclaim (leaving a dangling cell ref), so
  // such ids must never be reclaimed.
  const idCounts = new Map<string, number>();

  for (const block of blocks) {
    if (block.id !== undefined && block.id !== null) {
      idCounts.set(block.id, (idCounts.get(block.id) ?? 0) + 1);
    }
  }

  const reclaimedParent = new Map<BlockId, BlockId>();
  const cellAdditions = new Map<BlockId, Array<CellPosition & { id: BlockId }>>();

  for (const block of blocks) {
    if (block.id === undefined || block.id === null) {
      continue;
    }
    if (block.parent !== undefined && block.parent !== null) {
      continue;
    }
    if (referenced.has(block.id)) {
      continue;
    }
    if ((idCounts.get(block.id) ?? 0) > 1) {
      continue;
    }
    const position = parseDetachedCellPosition(block.id);

    if (position === null) {
      continue;
    }
    const matchingTables = tableBlocks.filter(table =>
      tableCellIsEmptyAt(table, position.row, position.col)
    );

    if (matchingTables.length !== 1) {
      continue;
    }
    const tableId = matchingTables[0].id as BlockId;

    reclaimedParent.set(block.id, tableId);
    const additions = cellAdditions.get(tableId) ?? [];

    additions.push({ ...position, id: block.id });
    cellAdditions.set(tableId, additions);
  }

  if (reclaimedParent.size === 0) {
    return blocks;
  }

  return blocks.map(block => {
    if (block.id !== undefined && block.id !== null && reclaimedParent.has(block.id)) {
      return { ...block, parent: reclaimedParent.get(block.id) };
    }

    if (block.type === 'table' && block.id !== undefined && block.id !== null && cellAdditions.has(block.id)) {
      const additions = cellAdditions.get(block.id) ?? [];
      const rows = getTableContentRows(block.data);

      if (rows === null) {
        return block;
      }
      const newContent = rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
          return row;
        }
        return row.map((cell, colIndex) => {
          const addition = additions.find(a => a.row === rowIndex && a.col === colIndex);

          if (addition === undefined || !isCellWithBlockRefs(cell)) {
            return cell;
          }
          return { ...cell, blocks: [...cell.blocks, addition.id] };
        });
      });

      return { ...block, data: { ...(block.data), content: newContent } } as OutputBlockData;
    }

    return block;
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
