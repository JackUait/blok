import type { PasteEvent, PasteEventDetail } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { getRestrictedTools } from '../../../../tools/table/table-restrictions';
import { Dom } from '../../../dom';
import { clean } from '../../../utils/sanitizer';
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

      const currentBlock = BlockManager.currentBlock;
      const childContainer = currentBlock?.holder?.querySelector('[data-blok-toggle-children]') ?? null;
      const isInContainerTitle = childContainer !== null &&
        !childContainer.contains(currentBlock?.currentInput ?? null);
      const contextParentId = isInContainerTitle
        ? (currentBlock?.id ?? null)
        : (currentBlock?.parentId ?? null);
      const insertedByIndex: Array<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>> = [];

      /**
       * Group every pasted block's Yjs write into a single undo entry so
       * that one Cmd+Z removes the whole paste. transactForTool sets
       * operations.suppressStopCapturing = true before invoking the fn and
       * restores it in a trailing microtask, which keeps the synchronous
       * prefix of BlockManager.paste (where the currentBlockIndex setter
       * would otherwise fire stopCapturing) inside the group.
       *
       * The fn is synchronous — transactForTool does not await — so the
       * async work is kicked off inside the fn and its promise is awaited
       * below. Between iterations we re-suppress directly on operations to
       * keep the entire loop body inside the same undo group even after
       * the initial close-boundary microtask has fired.
       */
      const operationsBridge = (BlockManager as unknown as { operations?: { suppressStopCapturing: boolean } }).operations;
      const pasteChainRef: { current: Promise<void> } = { current: Promise.resolve() };

      const runPasteLoop = (): void => {
        pasteChainRef.current = (async (): Promise<void> => {
          for (const [index, pasteData] of data.entries()) {
            // Re-assert suppression on every iteration — transactForTool's
            // close-boundary microtask may have flipped suppressStopCapturing
            // back to false before the next paste() runs its sync prefix.
            if (operationsBridge !== undefined) {
              operationsBridge.suppressStopCapturing = true;
            }

            const shouldReplace = index === 0 && canReplaceCurrentBlock && BlockManager.currentBlock?.isEmpty === true;
            const block = shouldReplace
              ? await BlockManager.paste(pasteData.tool, pasteData.event, true)
              : await BlockManager.paste(pasteData.tool, pasteData.event);

            Caret.setToBlock(block, Caret.positions.END);
            insertedByIndex.push(block);

            this.applyPastedBlockParent(block, pasteData, insertedByIndex, BlockManager, contextParentId);
          }
        })();
      };

      // Older test mocks may not expose transactForTool; fall through
      // gracefully in that case so unrelated suites keep working.
      if (typeof BlockManager.transactForTool === 'function') {
        BlockManager.transactForTool(runPasteLoop);
      } else {
        runPasteLoop();
      }

      await pasteChainRef.current;

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
   * Wire up the parent relationship for a pasted block.
   */
  private applyPastedBlockParent(
    block: Awaited<ReturnType<BlokModules['BlockManager']['paste']>>,
    pasteData: PasteData,
    insertedByIndex: Array<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>>,
    BlockManager: BlokModules['BlockManager'],
    contextParentId: string | null
  ): void {
    if (pasteData.parentPasteIndex !== undefined) {
      const parentBlock = insertedByIndex[pasteData.parentPasteIndex];

      if (parentBlock) {
        BlockManager.setBlockParent(block, parentBlock.id);
      }
    } else if (contextParentId !== null) {
      // Container-title paste context: assign all flat blocks to the container
      BlockManager.setBlockParent(block, contextParentId);
    } else if (block.parentId != null) {
      // Root-level paste context: clear any parent inherited from predecessor
      BlockManager.setBlockParent(block, null);
    }
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

    const currentToolSanitizeConfig = currentBlock.tool.baseSanitizeConfig;

    Caret.insertContentAtCaretPosition(
      clean(content.innerHTML, currentToolSanitizeConfig)
    );
  }
}
