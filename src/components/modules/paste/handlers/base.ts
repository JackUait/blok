import type { PasteEvent, PasteEventDetail } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { getRestrictedTools } from '../../../../tools/table/table-restrictions';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

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
   * If we're inside a table cell and any pasted item uses a tool that can't
   * be nested in table cells (e.g. table, header), redirect the insertion
   * point to the parent table block. This prevents new block DOM elements
   * from being placed inside the existing table's grid structure, which
   * would corrupt the table's saved data.
   */
  private redirectToTableParentIfNeeded(data: PasteData[], BlockManager: BlokModules['BlockManager']): void {
    const currentBlock = BlockManager.currentBlock;
    const isInsideTableCell = currentBlock?.holder?.closest('[data-blok-table-cell-blocks]');
    const restricted = new Set(getRestrictedTools());
    const hasRestrictedTools = data.some(item => restricted.has(item.tool));

    if (!isInsideTableCell || !hasRestrictedTools || currentBlock === undefined) {
      return;
    }

    const tableBlockHolder = currentBlock.holder
      .closest('[data-blok-tool="table"]')
      ?.closest('[data-blok-element]') as HTMLElement | null;

    if (!tableBlockHolder) {
      return;
    }

    BlockManager.setCurrentBlockByChildNode(tableBlockHolder);
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
      this.redirectToTableParentIfNeeded(data, BlockManager);

      for (const [index, pasteData] of data.entries()) {
        /**
         * Force each pasted block into its own Yjs undo entry so that
         * Ctrl+Z removes them one at a time.
         *
         * paste() wraps insert() in withAtomicOperation() which suppresses
         * the normal stopCapturing() from currentBlockIndexValue changes.
         * Without this, consecutive addBlock() calls within the 500ms
         * captureTimeout get merged into a single undo entry.
         */
        this.Blok.YjsManager.stopCapturing();
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
