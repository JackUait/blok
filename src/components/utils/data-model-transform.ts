/**
 * Data Model Transformation Utilities
 *
 * Handles conversion between legacy nested format and hierarchical flat-with-references format.
 * Used for automatic detection and transformation when dataModel config is 'auto'.
 */
import type { OutputBlockData, BlockId } from '../../../types';
import { generateBlockId } from '../utils';
// The forward legacy→hierarchical expansion lives in ONE zero-dep grammar module
// shared verbatim with the standalone codemod, so the two migration surfaces
// cannot drift. The runtime drives it with nanoid ids + a deduping console.warn.
import { expandLegacyBlocks, analyzeLegacyFormat } from '../migration/legacy-grammar.mjs';

/**
 * Build the per-pass lossy-field warning sink handed to the grammar interpreter.
 * Emits a one-time `console.warn` per (blockType, field) — letting users SEE what
 * Editor.js data was dropped (the fields themselves have no Blok equivalent and
 * are still dropped; this only adds visibility). Deduped for the whole pass.
 */
const createMigrationWarn = (): ((blockType: string, field: string, verb: string) => void) => {
  const warned = new Set<string>();

  return (blockType, field, verb) => {
    const key = `${blockType}.${field}`;

    if (warned.has(key)) {
      return;
    }
    warned.add(key);

    console.warn(`[Blok migration] ${blockType} block ${verb} unsupported field "${field}" (no Blok equivalent)`);
  };
};

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
 * Map backgroundColor preset name back to legacy variant (collapse path only).
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
 * Type guard for object with text property
 */
const isObjectWithText = (data: unknown): data is { text: string } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'text' in data && typeof (data).text === 'string';
};

/**
 * Type guard for object with checked property
 */
const isObjectWithChecked = (data: unknown): data is { checked: boolean } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'checked' in data && typeof (data).checked === 'boolean';
};

/**
 * Type guard for object with style property
 */
const isObjectWithStyle = (data: unknown): data is { style: string } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'style' in data && typeof (data).style === 'string';
};

/**
 * Type guard for object with start property
 */
const isObjectWithStart = (data: unknown): data is { start: number } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'start' in data && typeof (data).start === 'number';
};

/**
 * Type guard for object with items property
 */
const isObjectWithItems = (data: unknown): data is { items: unknown } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'items' in data;
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
  // Legacy detection + nesting heuristic come from the shared grammar so the set
  // of recognized legacy shapes has exactly one definition.
  const { hasLegacyBlocks, hasNesting } = analyzeLegacyFormat(blocks);

  if (foundHierarchicalRefs && !hasLegacyBlocks) {
    return { format: 'hierarchical', hasHierarchy: true };
  }

  if (hasLegacyBlocks) {
    return { format: 'legacy', hasHierarchy: foundHierarchicalRefs || hasNesting };
  }

  return { format: 'flat', hasHierarchy: false };
};

/**
 * Expand legacy nested format to hierarchical flat-with-references format
 * @param blocks - array of blocks potentially containing nested structures
 * @returns expanded array of flat blocks with parent/content references
 */
export const expandToHierarchical = (blocks: OutputBlockData[]): OutputBlockData[] => {
  return expandLegacyBlocks(blocks, {
    generateId: generateBlockId,
    warn: createMigrationWarn(),
  });
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
    },
    ...(block.tunes !== undefined ? { tunes: block.tunes } : {}),
    ...(nonListContent.length > 0 ? { content: nonListContent } : {}),
  };

  return listBlock;
};

/**
 * Preserved-id set per collapse run, keyed by the run's blockMap. Primed by
 * collapseToLegacy so the nested body collapse can ask "may I strip this
 * block's hierarchy refs?" without threading the set through every helper.
 */
const preservedIdsByBlockMap = new WeakMap<Map<BlockId, OutputBlockData>, Set<BlockId>>();

const getPreservedIds = (blockMap: Map<BlockId, OutputBlockData>): Set<BlockId> => {
  const cached = preservedIdsByBlockMap.get(blockMap);

  if (cached !== undefined) {
    return cached;
  }

  const computed = collectPreservedContainerSubtreeIds([...blockMap.values()]);

  preservedIdsByBlockMap.set(blockMap, computed);

  return computed;
};

/**
 * Emit a hierarchy-only container (a table, a column list) that sits inside a
 * legacy body, together with its whole descendant subtree, refs intact.
 *
 * The container's OWN `parent` ref is dropped — living in the body already
 * encodes "child of this toggle/callout", and the load-side expansion
 * (appendLegacyBodyBlocks) re-parents parent-less body roots. Descendants keep
 * their `parent`/`content` because nothing else can express their nesting; they
 * ride along inside the same body so they never dangle at the document root.
 * @param container - preserved container block found in the body
 * @param blockMap - id → block for the whole document
 * @param processedIds - ids already emitted (mutated)
 * @param result - body block list being built (mutated)
 */
const findUnprocessedChildren = (
  parentId: BlockId | undefined,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>
): Array<{ id: BlockId; block: OutputBlockData }> => {
  const children: Array<{ id: BlockId; block: OutputBlockData }> = [];

  for (const candidate of blockMap.values()) {
    const candidateId = candidate.id;
    const isUnprocessedChild = candidate.parent === parentId &&
      candidateId !== undefined &&
      candidateId !== null &&
      !processedIds.has(candidateId);

    if (isUnprocessedChild && candidateId !== undefined && candidateId !== null) {
      children.push({
        id: candidateId,
        block: candidate,
      });
    }
  }

  return children;
};

const appendPreservedSubtreeToBody = (
  container: OutputBlockData,
  blockMap: Map<BlockId, OutputBlockData>,
  processedIds: Set<BlockId>,
  result: OutputBlockData[]
): void => {
  markBlockAsProcessed(container.id, processedIds);

  const { parent: _parent, ...containerWithoutParent } = container;

  result.push(containerWithoutParent);

  const queue: BlockId[] = container.id !== undefined && container.id !== null ? [container.id] : [];

  while (queue.length > 0) {
    const parentId = queue.shift();

    for (const child of findUnprocessedChildren(parentId, blockMap, processedIds)) {
      markBlockAsProcessed(child.id, processedIds);
      result.push(child.block);
      queue.push(child.id);
    }
  }
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
  const preservedIds = getPreservedIds(blockMap);

  for (const childId of contentIds) {
    if (processedIds.has(childId)) {
      continue;
    }
    const childBlock = blockMap.get(childId);

    if (childBlock === undefined) {
      continue;
    }

    if (preservedIds.has(childId)) {
      appendPreservedSubtreeToBody(childBlock, blockMap, processedIds, result);
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

/**
 * Ids that must keep their flat parent/content hierarchy through a legacy
 * collapse: every `table` block that references its cell content by block id
 * (`data.content[row][col].blocks`) plus each referenced child.
 *
 * A Blok-native table always stores its cells as child blocks — even inside a
 * document whose top-level shape is otherwise legacy. Unlike list/toggle/callout
 * (whose bodies fold inline into legacy fields), a table has NO inline legacy
 * body to fold cell blocks into, so the collapse's strip paths would eject the
 * cell paragraphs to the document root (dropping the table's `content` and each
 * cell's `parent`) — silent data loss. Preserving the subtree as-is keeps the
 * table in its Blok-native block-ref shape, which round-trips correctly.
 * @param blocks - flat block array being collapsed
 */
/** Extracts the string block-ref child ids from a single table cell's `blocks`. */
const collectCellRefChildIds = (cell: unknown): string[] => {
  const cellBlocks = (cell as { blocks?: unknown }).blocks;

  if (!Array.isArray(cellBlocks)) {
    return [];
  }

  return cellBlocks.filter((childId): childId is string => typeof childId === 'string');
};

/** Extracts the string block-ref child ids from a single table row. */
const collectRowRefChildIds = (row: unknown): string[] => {
  if (!Array.isArray(row)) {
    return [];
  }

  return row.flatMap((cell) => collectCellRefChildIds(cell));
};

/** Extracts every string block-ref child id from a table's `data.content` grid. */
const collectTableRefChildIds = (content: unknown[]): string[] =>
  content.flatMap((row) => collectRowRefChildIds(row));

/**
 * True when the legacy collapse can ABSORB this block's children into an inline
 * legacy payload (list.items[], toggleList body, callout body). Only such a
 * container may have its children's parent/content refs stripped — the nesting
 * survives inside the collapsed payload.
 *
 * Every other container (column_list / column / table / any future container)
 * has NO legacy representation, so stripping its refs does not collapse the
 * containment — it destroys it.
 * @param block - candidate container block
 */
const isLegacyAbsorbingContainer = (block: OutputBlockData): boolean =>
  isFlatModelListBlock(block) ||
  isFlatModelToggleBlock(block) ||
  isToggleableHeaderBlock(block) ||
  isFlatModelCalloutBlock(block);

/**
 * Ids of every block that participates in a containment the legacy model cannot
 * express: a parent that is not a legacy-absorbing container, plus its whole
 * descendant subtree. Those blocks keep their `parent`/`content` refs through
 * the collapse instead of being flattened to root — the flat-with-references
 * shape is the ONLY shape that can carry them.
 * @param blocks - flat block array being collapsed
 */
const collectHierarchyOnlyContainerIds = (blocks: OutputBlockData[]): Set<BlockId> => {
  const blockById = new Map<BlockId, OutputBlockData>();
  const childIdsByParent = new Map<BlockId, BlockId[]>();

  for (const block of blocks) {
    if (block.id !== undefined && block.id !== null) {
      blockById.set(block.id, block);
    }
  }

  for (const block of blocks) {
    const parentId = block.parent;

    if (parentId === undefined || parentId === null || block.id === undefined || block.id === null) {
      continue;
    }

    const siblings = childIdsByParent.get(parentId);

    if (siblings === undefined) {
      childIdsByParent.set(parentId, [block.id]);
    } else {
      siblings.push(block.id);
    }
  }

  const preserved = new Set<BlockId>();

  const preserveSubtree = (id: BlockId): void => {
    if (preserved.has(id)) {
      return;
    }
    preserved.add(id);

    for (const childId of childIdsByParent.get(id) ?? []) {
      preserveSubtree(childId);
    }
  };

  for (const [parentId, childIds] of childIdsByParent) {
    const parent = blockById.get(parentId);

    if (parent === undefined || isLegacyAbsorbingContainer(parent)) {
      continue;
    }

    preserved.add(parentId);
    childIds.forEach(preserveSubtree);
  }

  return preserved;
};

const collectPreservedContainerSubtreeIds = (blocks: OutputBlockData[]): Set<BlockId> => {
  const preserved = collectHierarchyOnlyContainerIds(blocks);

  for (const block of blocks) {
    if (block.type !== 'table' || block.id === undefined || block.id === null) {
      continue;
    }

    const content = (block.data as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    const refChildIds = collectTableRefChildIds(content);

    for (const childId of refChildIds) {
      preserved.add(childId);
    }

    if (refChildIds.length > 0) {
      preserved.add(block.id);
    }
  }

  return preserved;
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

  // Containers the legacy model cannot express (tables, columns) keep their
  // child-block subtree flat instead of being stripped — see
  // collectPreservedContainerSubtreeIds. Shared with the nested body collapse
  // via the blockMap-keyed cache.
  const preservedIds = collectPreservedContainerSubtreeIds(reconciledBlocks);

  preservedIdsByBlockMap.set(blockMap, preservedIds);

  const isPreserved = (block: OutputBlockData): boolean =>
    block.id !== undefined && block.id !== null && preservedIds.has(block.id);

  // If no flat-model list, toggle, or callout blocks, just strip hierarchy fields and return
  const hasFlatListBlocks = reconciledBlocks.some(isFlatModelListBlock);
  const hasFlatToggleBlocks = reconciledBlocks.some(isFlatModelToggleBlock);
  const hasFlatToggleableHeaders = reconciledBlocks.some(b => isToggleableHeaderBlock(b) && !b.parent);
  const hasFlatCalloutBlocks = reconciledBlocks.some(isFlatModelCalloutBlock);

  if (!hasFlatListBlocks && !hasFlatToggleBlocks && !hasFlatToggleableHeaders && !hasFlatCalloutBlocks) {
    return reconciledBlocks.map(block => (isPreserved(block) ? block : stripHierarchyFields(block)));
  }

  // Process blocks, converting root flat-model list blocks to legacy List blocks
  const result: OutputBlockData[] = [];
  const processedIds = new Set<BlockId>();

  for (const block of reconciledBlocks) {
    const alreadyProcessed = block.id && processedIds.has(block.id);

    if (alreadyProcessed) {
      continue;
    }

    /**
     * A block inside a container the legacy model cannot express (columns, a
     * table's cell subtree) is emitted verbatim, refs intact. Without this the
     * per-type branches below either strip its `parent` (ejecting it from the
     * container) or — for a list/toggle/callout item that is nested rather than
     * root — match no branch at all and drop the block from the output entirely.
     */
    if (isPreserved(block)) {
      result.push(block);
      markBlockAsProcessed(block.id, processedIds);

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
      result.push(isPreserved(block) ? block : collapseNonListBlock(block, blockMap));
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

      return { ...block, data: { ...(block.data), content: newContent } };
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
