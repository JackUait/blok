import Module from '../../__module';
import $ from '../../dom';
import SelectionUtils from '../../selection';
import type Block from '../../block';
import I18n from '../../i18n';
import { I18nInternalNS } from '../../i18n/namespace-internal';
import Flipper from '../../flipper';
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
import BlockAPI from '../../block/api';

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
export default class BlockSettings extends Module<BlockSettingsNodes> {
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

    this.opened = true;

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

    /** Tell to subscribers that block settings is opened */
    this.eventsDispatcher.emit(this.events.opened);

    const PopoverClass = isMobileScreen() ? PopoverMobile : PopoverDesktop;
    const popoverParams: PopoverParams & { flipper?: Flipper } = {
      searchable: true,
      trigger: trigger || this.nodes.wrapper,
      items: await this.getTunesItems(block, commonTunes, toolTunes),
      scopeElement: this.Blok.API.methods.ui.nodes.redactor,
      messages: {
        nothingFound: I18n.ui(I18nInternalNS.ui.popover, 'Nothing found'),
        search: I18n.ui(I18nInternalNS.ui.popover, 'Filter'),
      },
    };

    if (PopoverClass === PopoverDesktop) {
      popoverParams.flipper = this.flipperInstance;
    }

    this.popover = new PopoverClass(popoverParams);
    this.popover.getElement().setAttribute('data-blok-testid', 'block-tunes-popover');

    this.popover.on(PopoverEvent.Closed, this.onPopoverClose);

    this.popover.show();
    if (PopoverClass === PopoverDesktop) {
      this.flipperInstance.focusItem(0);
    }
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
        const titleKey = toolboxItem.title ?? tool.name;

        result.push({
          icon: toolboxItem.icon,
          title: I18n.t(I18nInternalNS.toolNames, titleKey),
          name: toolboxItem.name ?? tool.name,
          closeOnActivate: true,
          onActivate: async () => {
            const { BlockManager, Caret, Toolbar } = this.Blok;

            const newBlock = hasMultipleBlocksSelected
              ? await this.convertMultipleBlocks(selectedBlocks, tool.name, toolboxItem.data)
              : await BlockManager.convert(currentBlock, tool.name, toolboxItem.data);

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
        title: I18n.ui(I18nInternalNS.ui.popover, 'Convert to'),
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
        title: I18n.t(I18nInternalNS.blockTunes.delete, 'Delete'),
        name: 'delete',
        closeOnActivate: true,
        onActivate: () => {
          const { BlockManager, Caret, Toolbar } = this.Blok;
          const indexToInsert = BlockManager.removeSelectedBlocks();

          if (indexToInsert !== undefined && BlockManager.blocks.length === 0) {
            BlockManager.insert();
          }

          const currentBlock = BlockManager.currentBlock;

          if (currentBlock) {
            Caret.setToBlock(currentBlock, Caret.positions.END);
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
   * Converts multiple selected blocks to a target tool type
   * Converts blocks in order and merges them into a single block
   * @param blocks - array of blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides for the new blocks
   * @returns the merged block or null if all conversions failed
   */
  private async convertMultipleBlocks(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;

    if (blocks.length === 0) {
      return null;
    }

    /**
     * Convert blocks in order (first to last)
     */
    const blocksToConvert = [...blocks];
    const convertedBlocks: Block[] = [];

    for (const block of blocksToConvert) {
      const convertedBlock = await this.convertBlockSafely(BlockManager, block, targetToolName, toolboxData);

      if (convertedBlock) {
        convertedBlocks.push(convertedBlock);
      }
    }

    if (convertedBlocks.length === 0) {
      return null;
    }

    /**
     * Merge all converted blocks into the first one
     * Process from the second block onwards, merging each into the first
     */
    const targetBlock = convertedBlocks[0];

    for (let i = 1; i < convertedBlocks.length; i++) {
      const blockToMerge = convertedBlocks[i];

      try {
        await BlockManager.mergeBlocks(targetBlock, blockToMerge);
      } catch (e) {
        console.warn(`Failed to merge block ${blockToMerge.id} into ${targetBlock.id}:`, e);
      }
    }

    return targetBlock;
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
