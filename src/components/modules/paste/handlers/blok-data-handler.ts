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
   * Insert Blok JSON blocks.
   * After inserting all blocks, restores parent-child hierarchy using an ID mapping
   * (pasted blocks receive new IDs, so original IDs are mapped to new block instances).
   */
  private insertBlokBlocks(
    blocks: BlokClipboardBlock[],
    canReplace: boolean
  ): void {
    const { BlockManager, Caret, Tools } = this.Blok;
    const sanitizedBlocks = sanitizeBlocks(
      blocks,
      (name) => Tools.blockTools.get(name)?.sanitizeConfig ?? {},
      this.config.sanitizer
    );

    /**
     * Map from original (old) block ID to the newly inserted Block instance.
     * Used after insertion to re-establish parent-child relationships.
     */
    const oldIdToEntry = new Map<string, { newBlock: Block; original: BlokClipboardBlock }>();

    sanitizedBlocks.forEach((sanitizedBlock, i) => {
      const { tool, data } = sanitizedBlock;
      const needToReplaceCurrentBlock = i === 0 &&
        canReplace &&
        Boolean(BlockManager.currentBlock?.tool.isDefault) &&
        Boolean(BlockManager.currentBlock?.isEmpty);

      const block = BlockManager.insert({
        tool,
        data,
        replace: needToReplaceCurrentBlock,
      });

      const originalBlock = blocks[i];

      if (originalBlock !== undefined) {
        oldIdToEntry.set(originalBlock.id, { newBlock: block, original: originalBlock });
      }

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
