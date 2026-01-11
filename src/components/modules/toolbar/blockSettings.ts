import { Module } from '../../__module';
import { Dom as $ } from '../../dom';
import { SelectionUtils } from '../../selection';
import type { Block } from '../../block';
import { Flipper } from '../../flipper';
import type { MenuConfigItem } from '../../../../types/tools';
import type { PopoverItemParams } from '../../utils/popover';
import { type Popover, PopoverDesktop, PopoverMobile, PopoverItemType } from '../../utils/popover';
import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { isMobileScreen, keyCodes } from '../../utils';
import { css as popoverItemCls } from '../../utils/popover/components/popover-item';
import { BlockSettingsClosed, BlockSettingsOpened, BlokMobileLayoutToggled } from '../../events';
import { IconReplace, IconCross } from '../../icons';
import { getConvertibleToolsForBlock, getConvertibleToolsForBlocks } from '../../utils/blocks';
import { translateToolTitle } from '../../utils/tools';
import { BlockAPI } from '../../block/api';
import type { BlockToolAdapter } from '../../tools/block';

/**
 * HTML Elements that used for BlockSettings
 */
interface BlockSettingsNodes {
  /**
   * Block Settings wrapper. Undefined when before "make" method called
   */
  wrapper: HTMLElement | undefined;
}

/**
 * Block Settings
 *  @todo Make Block Settings no-module but a standalone class, like Toolbox
 */
export class BlockSettings extends Module<BlockSettingsNodes> {
  /**
   * Module Events
   */
  public get events(): { opened: typeof BlockSettingsOpened; closed: typeof BlockSettingsClosed } {
    return {
      opened: BlockSettingsOpened,
      closed: BlockSettingsClosed,
    };
  }

  /**
   * Block Settings CSS
   * @deprecated Use data attributes for identification instead
   */
  public get CSS(): { [name: string]: string } {
    return {
      settings: '',
    };
  }

  /**
   * Opened state
   */
  public opened = false;

  /**
   * Getter for inner popover's flipper instance
   * @todo remove once BlockSettings becomes standalone non-module class
   */
  public get flipper(): Flipper {
    return this.flipperInstance;
  }

  /**
   * Page selection utils
   */
  private selection: SelectionUtils = new SelectionUtils();

  /**
   * Popover instance. There is a util for vertical lists.
   * Null until popover is not initialized
   */
  private popover: Popover | null = null;

  /**
   * Shared flipper instance used for keyboard navigation in block settings popover
   */
  private readonly flipperInstance: Flipper = new Flipper({
    focusedItemClass: popoverItemCls.focused,
    allowedKeys: [
      keyCodes.TAB,
      keyCodes.UP,
      keyCodes.DOWN,
      keyCodes.ENTER,
      keyCodes.RIGHT,
      keyCodes.LEFT,
    ],
  });

  /**
   * Stored keydown handler reference to detach when block tunes are closed
   */
  private flipperKeydownHandler: ((event: KeyboardEvent) => void) | null = null;

  /**
   * Element that listens for keydown events while block tunes are opened
   */
  private flipperKeydownSource: HTMLElement | null = null;

  /**
   * Panel with block settings with 2 sections:
   *  - Tool's Settings
   *  - Default Settings [Move, Remove, etc]
   */
  public make(): void {
    this.nodes.wrapper = $.make('div');
    this.nodes.wrapper.setAttribute('data-blok-testid', 'block-tunes-wrapper');

    this.eventsDispatcher.on(BlokMobileLayoutToggled, this.close);
  }

  /**
   * Destroys module
   */
  public destroy(): void {
    this.detachFlipperKeydownListener();
    this.removeAllNodes();
    this.listeners.destroy();
    this.eventsDispatcher.off(BlokMobileLayoutToggled, this.close);
  }

  /**
   * Open Block Settings pane
   * @param targetBlock - near which Block we should open BlockSettings
   * @param trigger - element to position the popover relative to
   */
  public async open(targetBlock?: Block, trigger?: HTMLElement): Promise<void> {
    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;

    /**
     * When multiple blocks are selected, use the first selected block as the anchor
     * Otherwise, use the target block or current block
     */
    const block = hasMultipleBlocksSelected
      ? selectedBlocks[0]
      : (targetBlock ?? this.Blok.BlockManager.currentBlock);

    if (block === undefined) {
      return;
    }

    /**
     * If block settings contains any inputs, focus will be set there,
     * so we need to save current selection to restore it after block settings is closed
     */
    this.selection.save();

    /**
     * Highlight content of a Block we are working with
     * For multiple blocks, they should already be selected
     */
    if (!hasMultipleBlocksSelected) {
      this.Blok.BlockSelection.selectBlock(block);
      this.Blok.BlockSelection.clearCache();
    }

    /** Get tool's settings data - only relevant for single block selection */
    const { toolTunes, commonTunes } = block.getTunes();

    const PopoverClass = isMobileScreen() ? PopoverMobile : PopoverDesktop;
    const popoverParams: PopoverParams & { flipper?: Flipper } = {
      searchable: false,
      trigger: trigger || this.nodes.wrapper,
      items: await this.getTunesItems(block, commonTunes, toolTunes),
      scopeElement: this.Blok.API.methods.ui.nodes.redactor,
      width: 'auto',
      messages: {
        nothingFound: this.Blok.I18n.t('popover.nothingFound'),
        search: this.Blok.I18n.t('popover.search'),
      },
    };

    if (PopoverClass === PopoverDesktop) {
      popoverParams.flipper = this.flipperInstance;
    }

    this.popover = new PopoverClass(popoverParams);
    this.popover.getElement().setAttribute('data-blok-testid', 'block-tunes-popover');

    this.popover.on(PopoverEvent.Closed, this.onPopoverClose);

    /**
     * Set opened flag AFTER popover is created to prevent race conditions
     * where close() is called during the async getTunesItems() call
     * when opened=true but popover is still null
     */
    this.opened = true;

    /** Tell to subscribers that block settings is opened */
    this.eventsDispatcher.emit(this.events.opened);

    this.popover.show();
    this.attachFlipperKeydownListener(block);
  }

  /**
   * Returns root block settings element
   */
  public getElement(): HTMLElement | undefined {
    return this.nodes.wrapper;
  }

  /**
   * Checks if the element is contained in the BlockSettings or its Popover
   * @param element - element to check
   */
  public contains(element: HTMLElement): boolean {
    if (this.nodes.wrapper?.contains(element)) {
      return true;
    }

    if (this.popover?.hasNode(element)) {
      return true;
    }

    return false;
  }

  /**
   * Close Block Settings pane
   */
  public close = (): void => {
    if (!this.opened) {
      return;
    }

    this.opened = false;

    /**
     * If selection is at blok on Block Settings closing,
     * it means that caret placed at some editable element inside the Block Settings.
     * Previously we have saved the selection, then open the Block Settings and set caret to the input
     *
     * So, we need to restore selection back to Block after closing the Block Settings
     */
    if (!SelectionUtils.isAtBlok) {
      this.selection.restore();
    }

    this.selection.clearSaved();
    this.detachFlipperKeydownListener();

    /**
     * Remove highlighted content of Blocks we are working with
     * Handle both single and multiple block selection
     */
    this.clearBlockSelectionOnClose();

    /** Tell to subscribers that block settings is closed */
    this.eventsDispatcher.emit(this.events.closed);

    if (this.popover) {
      this.popover.off(PopoverEvent.Closed, this.onPopoverClose);
      this.popover.destroy();
      this.popover.getElement().remove();
      this.popover = null;
    }
  };

  /**
   * Returns list of items to be displayed in block tunes menu.
   * Merges tool specific tunes, conversion menu and common tunes in one list in predefined order
   * @param currentBlock –  block we are about to open block tunes for
   * @param commonTunes – common tunes
   * @param toolTunes - tool specific tunes
   */
  private async getTunesItems(currentBlock: Block, commonTunes: MenuConfigItem[], toolTunes?: MenuConfigItem[]): Promise<PopoverItemParams[]> {
    const items = [] as MenuConfigItem[];
    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;

    /**
     * Only show tool-specific tunes when a single block is selected
     */
    if (!hasMultipleBlocksSelected && toolTunes !== undefined && toolTunes.length > 0) {
      items.push(...toolTunes);
      items.push({
        type: PopoverItemType.Separator,
      });
    }

    const allBlockTools = Array.from(this.Blok.Tools.blockTools.values());

    /**
     * Get convertible tools based on selection:
     * - For single block: use existing single-block conversion logic
     * - For multiple blocks: find tools that ALL selected blocks can convert to
     */
    const convertibleTools = hasMultipleBlocksSelected
      ? await getConvertibleToolsForBlocks(
          selectedBlocks.map((block) => new BlockAPI(block)),
          allBlockTools
        )
      : await getConvertibleToolsForBlock(currentBlock, allBlockTools);

    const convertToItems = convertibleTools.reduce<PopoverItemParams[]>((result, tool) => {
      if (tool.toolbox === undefined) {
        return result;
      }

      tool.toolbox.forEach((toolboxItem) => {
        result.push({
          icon: toolboxItem.icon,
          title: translateToolTitle(this.Blok.I18n, toolboxItem, tool.name),
          name: toolboxItem.name ?? tool.name,
          closeOnActivate: true,
          onActivate: async () => {
            const { Caret, Toolbar } = this.Blok;

            const newBlock = await this.convertBlock(
              currentBlock,
              selectedBlocks,
              hasMultipleBlocksSelected,
              tool,
              toolboxItem.data
            );

            Toolbar.close();

            if (newBlock) {
              Caret.setToBlock(newBlock, Caret.positions.END);
            }
          },
        });
      });

      return result;
    }, []);

    if (convertToItems.length > 0) {
      items.push({
        icon: IconReplace,
        name: 'convert-to',
        title: this.Blok.I18n.t('popover.convertTo'),
        children: {
          items: convertToItems,
        },
      });
      items.push({
        type: PopoverItemType.Separator,
      });
    }

    /**
     * For single block selection, show all common tunes (delete, move, etc.)
     * For multiple blocks, only show delete option with multi-block delete behavior
     */
    if (!hasMultipleBlocksSelected) {
      items.push(...commonTunes);
    } else {
      items.push({
        icon: IconCross,
        title: this.Blok.I18n.t('blockSettings.delete'),
        name: 'delete',
        closeOnActivate: true,
        onActivate: () => {
          const { BlockManager, Caret, Toolbar } = this.Blok;

          const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

          if (insertedBlock) {
            Caret.setToBlock(insertedBlock, Caret.positions.END);
          }

          Toolbar.close();
        },
      });
    }

    return items;
  }

  /**
   * Handles popover close event
   */
  private onPopoverClose = (): void => {
    this.close();
  };

  /**
   * Clears block selection when block settings is closed
   * Handles both single and multiple block selection scenarios
   */
  private clearBlockSelectionOnClose(): void {
    if (this.Blok.CrossBlockSelection.isCrossBlockSelectionStarted) {
      return;
    }

    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;

    if (hasMultipleBlocksSelected) {
      this.Blok.BlockSelection.allBlocksSelected = false;

      return;
    }

    const currentBlock = this.Blok.BlockManager.currentBlock;

    if (currentBlock) {
      this.Blok.BlockSelection.unselectBlock(currentBlock);
    }
  }

  /**
   * Converts multiple selected blocks to a target tool type.
   * For tools that support multi-item data (like lists), all blocks are combined into a single block.
   * Otherwise, each block is converted individually and remains as a separate block.
   * @param blocks - array of blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides for the new blocks
   * @returns the resulting block (merged or last converted) or null if all conversions failed
   */
  private async convertBlock(
    currentBlock: Block,
    selectedBlocks: Block[],
    hasMultipleBlocksSelected: boolean,
    tool: BlockToolAdapter,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;

    if (hasMultipleBlocksSelected) {
      return this.convertMultipleBlocks(selectedBlocks, tool.name, toolboxData);
    }

    /**
     * Check if we should explode a multi-item block (like List) into separate blocks
     * This happens when converting to a tool that doesn't support multiple items
     */
    const explodableItems = await this.getExplodableItems(currentBlock);
    const shouldExplode = !this.canToolMergeMultipleItems(tool) && explodableItems !== null;

    if (shouldExplode) {
      return this.convertMultiItemBlockToSeparateBlocks(currentBlock, tool.name, toolboxData);
    }

    return BlockManager.convert(currentBlock, tool.name, toolboxData);
  }

  /**
   * Converts multiple selected blocks to a target tool type.
   * For tools that support multi-item data (like lists), all blocks are combined into a single block.
   * Otherwise, each block is converted individually and remains as a separate block.
   * @param blocks - array of blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides for the new blocks
   * @returns the resulting block (merged or last converted) or null if all conversions failed
   */
  private async convertMultipleBlocks(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { Tools } = this.Blok;

    if (blocks.length === 0) {
      return null;
    }

    /**
     * Check if the target tool's conversion config import function can handle
     * newline-separated content to create multiple items (like lists do).
     * We detect this by checking if the import function returns data with an 'items' array.
     */
    const targetTool = Tools.blockTools.get(targetToolName);
    const shouldMergeIntoSingleBlock = targetTool && this.canToolMergeMultipleItems(targetTool);

    if (shouldMergeIntoSingleBlock) {
      return this.convertBlocksToSingleMergedBlock(blocks, targetToolName, toolboxData);
    }

    /**
     * Convert each block individually, maintaining them as separate blocks
     */
    return this.convertBlocksIndividually(blocks, targetToolName, toolboxData);
  }

  /**
   * Checks if a tool can merge multiple items into a single block.
   * This is determined by testing if the tool's import function creates an 'items' array.
   * @param tool - the target tool adapter
   * @returns true if the tool supports merging multiple items
   */
  private canToolMergeMultipleItems(tool: BlockToolAdapter): boolean {
    const conversionConfig = tool.conversionConfig;

    if (!conversionConfig?.import) {
      return false;
    }

    /**
     * Test the import function with a sample multi-line string
     * to see if it creates multiple items
     */
    try {
      const testResult = typeof conversionConfig.import === 'function'
        ? conversionConfig.import('line1\nline2', tool.settings)
        : { [conversionConfig.import]: 'line1\nline2' };

      return Array.isArray(testResult?.items) && testResult.items.length > 1;
    } catch {
      return false;
    }
  }

  /**
   * Converts multiple blocks into a single merged block by combining their exported content.
   * Used for tools like lists that can hold multiple items.
   * @param blocks - blocks to convert and merge
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the merged block or null if conversion failed
   */
  private async convertBlocksToSingleMergedBlock(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;

    /**
     * Export all blocks' content and combine with newlines
     */
    const exportedContents: string[] = [];

    for (const block of blocks) {
      try {
        const content = await block.exportDataAsString();

        exportedContents.push(content);
      } catch {
        // Skip blocks that fail to export
      }
    }

    if (exportedContents.length === 0) {
      return null;
    }

    /**
     * Convert the first block with combined content
     */
    const firstBlock = blocks[0];
    const combinedContent = exportedContents.join('\n');

    /**
     * Get the target tool to use its conversion config
     */
    const targetTool = this.Blok.Tools.blockTools.get(targetToolName);

    if (!targetTool) {
      return null;
    }

    /**
     * Import the combined content using the target tool's conversion config
     */
    const importedData = typeof targetTool.conversionConfig?.import === 'function'
      ? targetTool.conversionConfig.import(combinedContent, targetTool.settings)
      : { [targetTool.conversionConfig?.import as string]: combinedContent };

    const newBlockData = toolboxData
      ? Object.assign(importedData, toolboxData)
      : importedData;

    /**
     * Replace the first block with the new merged block
     */
    const newBlock = BlockManager.replace(firstBlock, targetToolName, newBlockData);

    /**
     * Remove the remaining blocks (they've been merged into the first one)
     */
    const remainingBlocks = blocks.slice(1);

    for (const block of remainingBlocks) {
      await BlockManager.removeBlock(block, false);
    }

    return newBlock;
  }

  /**
   * Converts blocks individually, keeping them as separate blocks.
   * @param blocks - blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the last converted block or null if all conversions failed
   */
  private async convertBlocksIndividually(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;
    const convertedBlocks: Block[] = [];

    for (const block of blocks) {
      const convertedBlock = await this.convertBlockSafely(BlockManager, block, targetToolName, toolboxData);

      if (convertedBlock) {
        convertedBlocks.push(convertedBlock);
      }
    }

    return convertedBlocks.length > 0
      ? convertedBlocks[convertedBlocks.length - 1]
      : null;
  }

  /**
   * Safely converts a single block, catching any errors
   * @param blockManager - the block manager instance
   * @param block - block to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the converted block or null if conversion failed
   */
  private async convertBlockSafely(
    blockManager: typeof this.Blok.BlockManager,
    block: Block,
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    try {
      return await blockManager.convert(block, targetToolName, toolboxData);
    } catch (e) {
      console.warn(`Failed to convert block ${block.id}:`, e);

      return null;
    }
  }

  /**
   * Checks if a block contains multiple items that should be exploded into separate blocks
   * when converting to a single-item tool.
   * @param block - block to check
   * @returns array of content strings if block should be exploded, null otherwise
   */
  private async getExplodableItems(block: Block): Promise<string[] | null> {
    try {
      const blockData = await block.data;

      /**
       * Check if block has an 'items' array with multiple items (like List tool)
       */
      if (!Array.isArray(blockData?.items) || blockData.items.length <= 1) {
        return null;
      }

      /**
       * Extract content from each item, handling nested items recursively
       */
      const extractContent = (items: Array<{ content?: string; items?: unknown[] }>): string[] => {
        const contents: string[] = [];

        for (const item of items) {
          if (item.content !== undefined && item.content !== '') {
            contents.push(item.content);
          }
          if (Array.isArray(item.items) && item.items.length > 0) {
            contents.push(...extractContent(item.items as Array<{ content?: string; items?: unknown[] }>));
          }
        }

        return contents;
      };

      return extractContent(blockData.items);
    } catch {
      return null;
    }
  }

  /**
   * Converts a multi-item block (like List) into multiple single-item blocks.
   * Each item becomes a separate block of the target type.
   * @param block - block to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the last created block or null if conversion failed
   */
  private async convertMultiItemBlockToSeparateBlocks(
    block: Block,
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager, Tools } = this.Blok;
    const items = await this.getExplodableItems(block);

    if (!items || items.length === 0) {
      return null;
    }

    const targetTool = Tools.blockTools.get(targetToolName);
    const conversionImport = targetTool?.conversionConfig?.import;

    if (!conversionImport) {
      return null;
    }

    const blockIndex = BlockManager.getBlockIndex(block);

    /**
     * Remove the original block first
     */
    await BlockManager.removeBlock(block, false);

    /**
     * Create a new block for each item
     */
    const createdBlocks = items.map((content, index) => {
      /**
       * Import the content using the target tool's conversion config
       */
      const importedData = typeof conversionImport === 'function'
        ? conversionImport(content, targetTool?.settings)
        : { [conversionImport as string]: content };

      const newBlockData = toolboxData
        ? Object.assign(importedData, toolboxData)
        : importedData;

      return BlockManager.insert({
        tool: targetToolName,
        data: newBlockData,
        index: blockIndex + index,
        needToFocus: false,
      });
    });

    return createdBlocks.length > 0 ? createdBlocks[createdBlocks.length - 1] : null;
  }

  /**
   * Attaches keydown listener to delegate navigation events to the shared flipper
   * @param block - block that owns the currently focused content
   */
  private attachFlipperKeydownListener(block: Block): void {
    this.detachFlipperKeydownListener();

    const pluginsContent = block?.pluginsContent;

    if (!(pluginsContent instanceof HTMLElement)) {
      return;
    }

    this.flipperInstance.setHandleContentEditableTargets(true);

    this.flipperKeydownHandler = (event: KeyboardEvent) => {
      this.flipperInstance.handleExternalKeydown(event);
    };

    pluginsContent.addEventListener('keydown', this.flipperKeydownHandler, true);
    this.flipperKeydownSource = pluginsContent;
  }

  /**
   * Removes keydown listener from the previously active block
   */
  private detachFlipperKeydownListener(): void {
    if (this.flipperKeydownSource !== null && this.flipperKeydownHandler !== null) {
      this.flipperKeydownSource.removeEventListener('keydown', this.flipperKeydownHandler, true);
    }

    this.flipperInstance.setHandleContentEditableTargets(false);

    this.flipperKeydownSource = null;
    this.flipperKeydownHandler = null;
  }
}
