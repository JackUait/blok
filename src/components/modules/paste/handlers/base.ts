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
  /**
   * Caret-split for a multi-line plain-text paste into a NON-EMPTY block: extract
   * the current block's post-caret remainder, merge the FIRST pasted line inline at
   * the caret, carry that remainder onto the LAST line, and return the remaining
   * lines (everything after the first) to be inserted as new blocks.
   * @param data - the multi-line paste, one item per line
   */
  private async caretSplitFirstLine(data: PasteData[]): Promise<PasteData[]> {
    const { Caret } = this.Blok;
    const trailingFragment = Caret.extractFragmentFromCaretPosition();

    // First line merges into the current block at the caret.
    await this.processInlinePaste(data[0], false);

    const linesToInsert = data.slice(1);

    // Carry the current block's post-caret remainder onto the last line.
    if (trailingFragment) {
      linesToInsert[linesToInsert.length - 1].content.append(trailingFragment);
    }

    return linesToInsert;
  }

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

      // Caret-split path: a multi-line PLAIN-TEXT paste (every item is inline,
      // not a block) into a NON-EMPTY block must split at the caret, matching
      // Notion: the first line merges into the current block at the caret, the
      // middle lines become new blocks, and the current block's post-caret
      // remainder rides with the LAST pasted segment.
      const isInlineMultiline = data.every((item) => !item.isBlock);

      // Container context: the caret is either in a container's title (the block
      // owns the [data-blok-toggle-children] region but the caret is outside it)
      // or inside a container child (the block's holder lives within that region).
      // A caret-split would wrongly merge the first line into the title/child, so
      // it must be suppressed — the pasted lines belong in the container's children.
      const childContainer = currentBlock?.holder?.querySelector('[data-blok-toggle-children]') ?? null;
      const isInContainerTitle = childContainer !== null &&
        !childContainer.contains(currentBlock?.currentInput ?? null);
      const isInContainerChild = currentBlock?.holder?.closest('[data-blok-toggle-children]') != null;
      const isContainerContext = isInContainerTitle || isInContainerChild;

      // A newline-prefixed paste has an empty first segment: there is no real
      // inline first line to merge, so suppress the caret-split and drop the
      // empty lead — the remaining lines become new blocks.
      const firstSegmentIsEmpty = isInlineMultiline &&
        (data[0]?.content?.textContent ?? '').trim() === '';

      const canCaretSplit = isInlineMultiline &&
        currentBlock !== undefined &&
        !currentBlock.isEmpty &&
        currentBlock.currentInput != null &&
        !isContainerContext &&
        !firstSegmentIsEmpty;

      const linesToInsert = canCaretSplit
        ? await this.caretSplitFirstLine(data)
        : firstSegmentIsEmpty
          ? data.slice(1)
          : data;

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

      // Notion parity (M-17): pasting list-style continuation blocks into an
      // EMPTY list item replaces it with the first inserted block. The global
      // canReplaceCurrentBlock flag is false for a non-default (list) target,
      // so allow the replace here when the produced blocks are list items.
      const firstIsListOverride = this.readListOverride(linesToInsert[0]?.content) !== null;
      const targetIsEmptyList = currentBlock?.name === 'list' && currentBlock.isEmpty;
      const allowReplaceEmptyList = firstIsListOverride && targetIsEmptyList;

      const runPasteLoop = (): void => {
        pasteChainRef.current = (async (): Promise<void> => {
          for (const [index, pasteData] of linesToInsert.entries()) {
            // Re-assert suppression on every iteration — transactForTool's
            // close-boundary microtask may have flipped suppressStopCapturing
            // back to false before the next paste() runs its sync prefix.
            if (operationsBridge !== undefined) {
              operationsBridge.suppressStopCapturing = true;
            }

            const shouldReplace = index === 0 &&
              (canReplaceCurrentBlock || allowReplaceEmptyList) &&
              BlockManager.currentBlock?.isEmpty === true;
            const pastedBlock = shouldReplace
              ? await BlockManager.paste(pasteData.tool, pasteData.event, true)
              : await BlockManager.paste(pasteData.tool, pasteData.event);

            // Stamp the inherited list style/depth/checked onto the freshly
            // pasted list block. The list tool's onPaste only sets text + a
            // default style from the plain-text content, so the override is
            // applied here via BlockManager.update (carrier read from content).
            const block = await this.applyListStyleOverride(pastedBlock, pasteData.content, operationsBridge);

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
   * Stamp the inherited list style/depth/checked onto a freshly pasted list
   * block. Returns the (possibly re-created) block, or the original block when
   * no override applies.
   * @param pastedBlock - the block produced by the paste
   * @param content - the pasted item's content carrying the list override
   * @param operationsBridge - undo-suppression bridge, re-asserted before update
   */
  private async applyListStyleOverride(
    pastedBlock: Awaited<ReturnType<BlokModules['BlockManager']['paste']>>,
    content: HTMLElement | undefined,
    operationsBridge: { suppressStopCapturing: boolean } | undefined
  ): Promise<Awaited<ReturnType<BlokModules['BlockManager']['paste']>>> {
    const { BlockManager } = this.Blok;
    const listOverride = this.readListOverride(content);

    if (listOverride === null || typeof BlockManager.update !== 'function') {
      return pastedBlock;
    }

    if (operationsBridge !== undefined) {
      const bridge = operationsBridge;

      bridge.suppressStopCapturing = true;
    }

    return BlockManager.update(pastedBlock, listOverride);
  }

  /**
   * Read the inherited list style/depth carried on a pasted item's content
   * (set by TextHandler when the paste target is a list item). Returns the
   * data to merge into the new block, or null when the item is not a list
   * continuation. New list items are always created unchecked (m-16).
   */
  private readListOverride(content: HTMLElement | undefined): { style: string; depth: number; checked: boolean } | null {
    if (content === undefined) {
      return null;
    }

    const style = content.getAttribute('data-blok-paste-list-style');

    if (style !== 'ordered' && style !== 'unordered' && style !== 'checklist') {
      return null;
    }

    const depthAttr = content.getAttribute('data-blok-paste-list-depth');
    const parsedDepth = depthAttr !== null ? Number.parseInt(depthAttr, 10) : 0;
    const depth = Number.isNaN(parsedDepth) ? 0 : Math.max(0, parsedDepth);

    return {
      style,
      depth,
      checked: false,
    };
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
