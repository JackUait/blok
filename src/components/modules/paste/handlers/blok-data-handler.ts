import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { SavedData } from '../../../../../types/data-formats';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { Block } from '../../../block';
import { sanitizeBlocks } from '../../../utils/sanitizer';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PatternMatch } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';
import { PatternHandler } from './pattern-handler';

/**
 * Shape of a block in the Blok clipboard data.
 * Extends the basic SavedData fields with optional hierarchy information.
 */
interface BlokClipboardBlock extends Pick<SavedData, 'id' | 'data' | 'tool'> {
  parentId?: string | null;
  contentIds?: string[];
}


/**
 * Blok Data Handler Priority.
 * Handles internal Blok JSON data.
 */
export class BlokDataHandler extends BasePasteHandler implements PasteHandler {
  private patternHandler?: PatternHandler;

  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    private readonly config: { sanitizer?: SanitizerConfig }
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    try {
      JSON.parse(data);
      return 100;
    } catch {
      return 0;
    }
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const parsedBlokData = JSON.parse(data) as BlokClipboardBlock[];

    // Check if we should try pattern matching first (for URL pasting within editor)
    const hasPatterns = this.toolRegistry.toolsPatterns.length > 0;
    const plainData = context.plainData;

    if (!hasPatterns || !plainData) {
      this.insertBlokBlocks(parsedBlokData, context.canReplaceCurrentBlock);

      return true;
    }

    const patternResult = await this.tryPatternMatch(plainData);

    if (patternResult) {
      await this.insertPatternMatch(patternResult, context.canReplaceCurrentBlock);

      return true;
    }

    this.insertBlokBlocks(parsedBlokData, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Try pattern matching before inserting Blok JSON.
   */
  private async tryPatternMatch(plainData: string): Promise<PatternMatch | undefined> {
    if (!this.patternHandler) {
      this.patternHandler = new PatternHandler(
        this.Blok,
        this.toolRegistry,
        this.sanitizerBuilder
      );
    }

    if (plainData.length > PatternHandler.PATTERN_PROCESSING_MAX_LENGTH) {
      return;
    }

    const pattern = this.toolRegistry.findToolForPattern(plainData);

    if (!pattern) {
      return;
    }

    const event = this.composePasteEvent('pattern', {
      key: pattern.key,
      data: plainData,
    });

    return {
      key: pattern.key,
      data: plainData,
      tool: pattern.tool.name,
      event,
    };
  }

  /**
   * Insert a matched pattern as a new block.
   */
  private async insertPatternMatch(patternResult: PatternMatch, canReplace: boolean): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    const insertedBlock = await BlockManager.paste(patternResult.tool, patternResult.event, canReplace);

    Caret.setToBlock(insertedBlock, Caret.positions.END);
  }

  /**
   * Insert Blok JSON blocks using a two-pass approach:
   *
   * Pass 1 — child blocks (those whose parentId is within the pasted set) are
   * inserted first.  They receive new IDs, which are recorded in a map.
   *
   * Pass 2 — root/container blocks (e.g. tables) are inserted with their data
   * remapped so that any old child-block ID references are replaced by the new
   * IDs from Pass 1.  This prevents container tools (TableCellBlocks) from
   * resolving old IDs that still exist in the editor and stealing blocks from
   * the original table.
   *
   * After both passes the parent-child hierarchy is re-established using the
   * accumulated old→new ID mapping.
   */
  private insertBlokBlocks(
    rawBlocks: BlokClipboardBlock[],
    canReplace: boolean
  ): void {
    const { BlockManager, Caret, Tools } = this.Blok;

    // Some article shapes (e.g. flat-array exports) reference table children
    // ONLY via `data.content[r][c].blocks = [<id>]` and never set parentId
    // on the children themselves. Backfill parentId before classification so
    // those children get adopted by the table during the two-pass insert
    // instead of becoming detached top-level paragraphs.
    const blocks = backfillTableChildParents(rawBlocks);
    const sanitizedBlocks = sanitizeBlocks(
      blocks,
      (name) => Tools.blockTools.get(name)?.sanitizeConfig ?? {},
      this.config.sanitizer
    );

    // Capture replace intent before any insertions move the current block pointer.
    const shouldReplaceFirst =
      canReplace &&
      Boolean(BlockManager.currentBlock?.tool.isDefault) &&
      Boolean(BlockManager.currentBlock?.isEmpty);

    // Set of old IDs present in this paste, used to identify parent-child pairs.
    const pastedOldIds = new Set(blocks.map(b => b.id));

    type Entry = { sanitized: (typeof sanitizedBlocks)[number]; original: BlokClipboardBlock };
    const children: Entry[] = [];
    const roots: Entry[] = [];

    sanitizedBlocks.forEach((sanitizedBlock, i) => {
      const original = blocks[i];

      if (original === undefined) {
        return;
      }

      const isChild =
        original.parentId !== undefined &&
        original.parentId !== null &&
        pastedOldIds.has(original.parentId);

      (isChild ? children : roots).push({ sanitized: sanitizedBlock, original });
    });

    /**
     * Map from original (old) block ID to the newly inserted Block instance.
     * Used to remap data and restore hierarchy after both passes.
     */
    const oldIdToEntry = new Map<string, { newBlock: Block; original: BlokClipboardBlock }>();

    // Pass 1: insert children first so they exist with new IDs before the parent.
    children.forEach(({ sanitized, original }) => {
      const block = BlockManager.insert({ tool: sanitized.tool, data: sanitized.data });

      oldIdToEntry.set(original.id, { newBlock: block, original });
      Caret.setToBlock(block, Caret.positions.END);
    });

    // Build old→new string map for remapping ID references inside parent data.
    const oldIdToNewId = new Map<string, string>();

    for (const [oldId, { newBlock }] of oldIdToEntry) {
      oldIdToNewId.set(oldId, newBlock.id);
    }

    // Pass 2: insert root blocks with child IDs remapped in their data.
    // Skip replace when children were pre-inserted to avoid replacing a
    // just-inserted child paragraph rather than the original empty block.
    roots.forEach(({ sanitized, original }, idx) => {
      const remappedData = oldIdToNewId.size > 0
        ? remapIds(sanitized.data, oldIdToNewId) as typeof sanitized.data
        : sanitized.data;

      const block = BlockManager.insert({
        tool: sanitized.tool,
        data: remappedData,
        replace: idx === 0 && shouldReplaceFirst && children.length === 0,
      });

      oldIdToEntry.set(original.id, { newBlock: block, original });
      Caret.setToBlock(block, Caret.positions.END);
    });

    /**
     * Restore parent-child hierarchy using the old-to-new ID mapping.
     * Only restores relationships where both parent and child are in the pasted set.
     */
    for (const [, { newBlock, original }] of oldIdToEntry) {
      if (original.parentId === undefined || original.parentId === null) {
        continue;
      }

      const parentEntry = oldIdToEntry.get(original.parentId);

      if (parentEntry === undefined) {
        continue;
      }

      newBlock.parentId = parentEntry.newBlock.id;

      if (!parentEntry.newBlock.contentIds.includes(newBlock.id)) {
        parentEntry.newBlock.contentIds = [...parentEntry.newBlock.contentIds, newBlock.id];
      }
    }
  }
}

/**
 * Records each cell-referenced child id under its owning table.
 */
function collectCellChildIds(
  cell: unknown,
  tableId: string,
  childToTable: Map<string, string>
): void {
  if (
    typeof cell !== 'object' ||
    cell === null ||
    !Array.isArray((cell as { blocks?: unknown }).blocks)
  ) {
    return;
  }
  const ids = (cell as { blocks: unknown[] }).blocks;

  ids.forEach(childId => {
    if (typeof childId === 'string' && !childToTable.has(childId)) {
      childToTable.set(childId, tableId);
    }
  });
}

/**
 * Walks a clipboard table block's `data.content[r][c]` cells and records
 * every child id referenced by `cell.blocks` under its owning table.
 */
function collectTableCellRefs(
  block: BlokClipboardBlock,
  childToTable: Map<string, string>
): void {
  if (block.tool !== 'table' || block.id === undefined) {
    return;
  }
  const data = block.data as { content?: unknown } | undefined;
  const content = data?.content;

  if (!Array.isArray(content)) {
    return;
  }

  const tableId = block.id;

  content.forEach(row => {
    if (!Array.isArray(row)) {
      return;
    }
    row.forEach(cell => collectCellChildIds(cell, tableId, childToTable));
  });
}

/**
 * Backfills `parentId` on clipboard blocks that are referenced by a sibling
 * table's `data.content[r][c].blocks` array but never declare a parent of
 * their own. Idempotent — never overwrites an explicit parentId.
 */
function backfillTableChildParents(
  blocks: BlokClipboardBlock[]
): BlokClipboardBlock[] {
  const childToTable = new Map<string, string>();

  blocks.forEach(block => collectTableCellRefs(block, childToTable));

  if (childToTable.size === 0) {
    return blocks;
  }

  return blocks.map(block => {
    if (block.id === undefined) {
      return block;
    }
    const tableId = childToTable.get(block.id);

    if (tableId === undefined) {
      return block;
    }
    if (block.parentId !== undefined && block.parentId !== null) {
      return block;
    }

    return { ...block, parentId: tableId };
  });
}

/**
 * Recursively walks `value` and replaces any string found as a key in `idMap`
 * with its mapped value.  Used to remap old block IDs to new IDs within a
 * tool's data object before insertion, so that container blocks (e.g. tables)
 * reference the correct newly-inserted child block IDs.
 */
function remapIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMap.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map(item => remapIds(item, idMap));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = remapIds(v, idMap);
    }

    return result;
  }

  return value;
}
