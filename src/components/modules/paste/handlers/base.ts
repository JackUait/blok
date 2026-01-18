import type { PasteEvent, PasteEventDetail } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { HandlerContext, PasteData } from '../types';
import type { ToolRegistry } from '../tool-registry';
import type { SanitizerConfigBuilder } from '../sanitizer-config';

/**
 * Paste Handler interface.
 * All paste handlers implement this interface.
 */
export interface PasteHandler {
  /**
   * Check if this handler can process the given data.
   * @returns Priority score (higher = more specific). Return 0 to skip.
   */
  canHandle(data: unknown): number;

  /**
   * Process the data and insert blocks.
   * @returns true if handled, false otherwise
   */
  handle(data: unknown, context: HandlerContext): Promise<boolean>;
}

/**
 * Base class for all paste handlers.
 * Provides common functionality for handlers.
 */
export abstract class BasePasteHandler implements PasteHandler {
  constructor(
    protected readonly Blok: BlokModules,
    protected readonly toolRegistry: ToolRegistry,
    protected readonly sanitizerBuilder: SanitizerConfigBuilder
  ) {}

  abstract canHandle(data: unknown): number;
  abstract handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Compose a paste event with the given type and detail.
   */
  protected composePasteEvent(type: string, detail: PasteEventDetail): PasteEvent {
    return new CustomEvent(type, {
      detail,
    }) as PasteEvent;
  }

  /**
   * Determine if current block should be replaced.
   */
  protected shouldReplaceCurrentBlock(toolName?: string): boolean {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (toolName && currentBlock.name === toolName) {
      return true;
    }

    const isCurrentBlockDefault = Boolean(currentBlock.tool.isDefault);

    return isCurrentBlockDefault && currentBlock.isEmpty;
  }

  /**
   * Insert paste data as blocks.
   */
  protected async insertPasteData(
    data: PasteData[],
    canReplaceCurrentBlock: boolean
  ): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    if (!data.length) {
      return;
    }

    // Multiple items: insert each as a separate block
    const isMultipleItems = data.length > 1;

    if (isMultipleItems) {
      for (const [index, pasteData] of data.entries()) {
        await this.insertBlock(pasteData, index === 0 && canReplaceCurrentBlock);
      }

      BlockManager.currentBlock && Caret.setToBlock(BlockManager.currentBlock, Caret.positions.END);

      return;
    }

    // Single item: decide whether to insert as block or inline content
    const [singleItem] = data;
    const isBlock = singleItem.isBlock;

    if (isBlock) {
      await this.processSingleBlock(singleItem, canReplaceCurrentBlock);
      return;
    }

    await this.processInlinePaste(singleItem, canReplaceCurrentBlock);
  }

  /**
   * Insert a single block.
   */
  protected async insertBlock(data: PasteData, canReplaceCurrentBlock = false): Promise<void> {
    const { BlockManager, Caret } = this.Blok;
    const { currentBlock } = BlockManager;

    if (canReplaceCurrentBlock && currentBlock && currentBlock.isEmpty) {
      const replacedBlock = await BlockManager.paste(data.tool, data.event, true);

      Caret.setToBlock(replacedBlock, Caret.positions.END);

      return;
    }

    const block = await BlockManager.paste(data.tool, data.event);

    Caret.setToBlock(block, Caret.positions.END);
  }

  /**
   * Process paste of single Block tool content.
   */
  protected async processSingleBlock(dataToInsert: PasteData, canReplaceCurrentBlock: boolean): Promise<void> {
    const { Caret, BlockManager } = this.Blok;
    const { currentBlock } = BlockManager;
    const { Dom } = await import('../../../dom');
    const $ = Dom;

    if (
      !currentBlock ||
      dataToInsert.tool !== currentBlock.name ||
      !$.containsOnlyInlineElements(dataToInsert.content.innerHTML)
    ) {
      await this.insertBlock(dataToInsert, canReplaceCurrentBlock);

      return;
    }

    Caret.insertContentAtCaretPosition(dataToInsert.content.innerHTML);
  }

  /**
   * Process paste to single Block.
   */
  protected async processInlinePaste(dataToInsert: PasteData, canReplaceCurrentBlock: boolean): Promise<void> {
    const { BlockManager, Caret } = this.Blok;
    const { content } = dataToInsert;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock || !currentBlock.currentInput) {
      await this.insertBlock(dataToInsert, canReplaceCurrentBlock);

      return;
    }

    const { clean } = await import('../../../utils/sanitizer');
    const currentToolSanitizeConfig = currentBlock.tool.baseSanitizeConfig;

    Caret.insertContentAtCaretPosition(
      clean(content.innerHTML, currentToolSanitizeConfig)
    );
  }
}
