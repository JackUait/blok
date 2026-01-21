import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { Dom as $ } from '../../dom';
import type { BlockChangedPayload } from '../../events/BlockChanged';
import { BlockChanged } from '../../events/BlockChanged';
import { BlockHovered } from '../../events/BlockHovered';
import { BlockSettingsClosed } from '../../events/BlockSettingsClosed';
import { BlockSettingsOpened } from '../../events/BlockSettingsOpened';
import { Toolbox, ToolboxEvent } from '../../ui/toolbox';
import { getUserOS, isMobileScreen, log } from '../../utils';
import { hide } from '../../utils/tooltip';

/**
 * Refactored Toolbar module components
 */
import { ClickDragHandler } from './click-handler';
import { PlusButtonHandler } from './plus-button';
import { ToolbarPositioner } from './positioning';
import { SettingsTogglerHandler } from './settings-toggler';
import { getToolbarStyles } from './styles';
import type { ToolbarNodes } from './types';

/**
 *
 *«Toolbar» is the node that moves up/down over current block
 *
 *______________________________________ Toolbar ____________________________________________
 *|                                                                                           |
 *|  ..................... Content .........................................................  |
 *|  .                                                   ........ Block Actions ...........   |
 *|  .                                                   .        [Open Settings]         .   |
 *|  .  [Plus Button]  [Toolbox: {Tool1}, {Tool2}]       .                                .   |
 *|  .                                                   .        [Settings Panel]        .   |
 *|  .                                                   ..................................   |
 *|  .......................................................................................  |
 *|                                                                                           |
 *|___________________________________________________________________________________________|
 *
 *
 *Toolbox — its an Element contains tools buttons. Can be shown by Plus Button.
 *
 *_______________ Toolbox _______________
 *|                                       |
 *| [Header] [Image] [List] [Quote] ...   |
 *|_______________________________________|
 *
 *
 *Settings Panel — is an Element with block settings:
 *
 *____ Settings Panel ____
 *| ...................... |
 *| .   Tool Settings    . |
 *| ...................... |
 *| .  Default Settings  . |
 *| ...................... |
 *|________________________|
 * @class
 * @classdesc Toolbar module
 */
/**
 * @property {object} nodes - Toolbar nodes
 * @property {Element} nodes.wrapper        - Toolbar main element
 * @property {Element} nodes.content        - Zone with Plus button and toolbox.
 * @property {Element} nodes.actions        - Zone with Block Settings and Remove Button
 * @property {Element} nodes.blockActionsButtons   - Zone with Block Buttons: [Settings]
 * @property {Element} nodes.plusButton     - Button that opens or closes Toolbox
 * @property {Element} nodes.toolbox        - Container for tools
 * @property {Element} nodes.settingsToggler - open/close Settings Panel button
 * @property {Element} nodes.settings          - Settings Panel
 * @property {Element} nodes.pluginSettings    - Plugin Settings section of Settings Panel
 * @property {Element} nodes.defaultSettings   - Default Settings section of Settings Panel
 */
export class Toolbar extends Module<ToolbarNodes> {
  /**
   * Block near which we display the Toolbox
   */
  private hoveredBlock: Block | null = null;

  /**
   * Toolbox class instance
   * It will be created in requestIdleCallback so it can be null in some period of time
   */
  private toolboxInstance: Toolbox | null = null;

  /**
   * Toolbar positioner instance
   */
  private positioner: ToolbarPositioner;

  /**
   * Click-vs-drag handler instance
   */
  private clickDragHandler: ClickDragHandler;

  /**
   * Plus button handler instance
   */
  private plusButtonHandler: PlusButtonHandler;

  /**
   * Settings toggler handler instance
   */
  private settingsTogglerHandler: SettingsTogglerHandler;

  /**
   * @class
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Blok's config
   * @param moduleConfiguration.eventsDispatcher - Blok's event dispatcher
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({
      config,
      eventsDispatcher,
    });
    this.positioner = new ToolbarPositioner();
    this.clickDragHandler = new ClickDragHandler();

    /**
     * Initialize handlers with callbacks to toolbar methods
     */
    this.plusButtonHandler = new PlusButtonHandler(
      () => this.Blok,
      {
        getToolboxOpened: () => this.toolbox.opened ?? false,
        openToolbox: () => this.toolbox.open(),
        closeToolbox: () => this.toolbox.close(),
        moveAndOpenToolbar: (block, target) => this.moveAndOpen(block, target),
      }
    );

    this.settingsTogglerHandler = new SettingsTogglerHandler(
      () => this.Blok,
      this.clickDragHandler,
      {
        setHoveredBlock: (block) => { this.hoveredBlock = block; },
        getToolboxOpened: () => this.toolbox.opened ?? false,
        closeToolbox: () => this.toolbox.close(),
      }
    );
  }

  /**
   * CSS styles
   * @returns {object}
   * @deprecated Use data attributes via constants instead
   */
  public get CSS(): { [name: string]: string } {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter is deprecated but still used internally
    return getToolbarStyles();
  }

  /**
   * Returns the Toolbar opening state
   * @returns {boolean}
   */
  public get opened(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return this.nodes.wrapper?.classList.contains(this.CSS.toolbarOpened) ?? false;
  }

  /**
   * Check if the element is contained in the Toolbar or its components (Toolbox, BlockSettings)
   * @param element - element to check
   */
  public contains(element: HTMLElement): boolean {
    if (this.nodes.wrapper?.contains(element)) {
      return true;
    }

    if (this.toolboxInstance?.contains(element)) {
      return true;
    }

    if (this.Blok.BlockSettings.contains(element)) {
      return true;
    }

    return false;
  }

  /**
   * Public interface for accessing the Toolbox
   */
  public get toolbox(): {
    opened: boolean | undefined; // undefined is for the case when Toolbox is not initialized yet
    close: () => void;
    open: () => void;
    toggle: () => void;
    hasFocus: () => boolean | undefined;
    } {
    return {
      opened: this.toolboxInstance?.opened,
      close: () => {
        this.toolboxInstance?.close();
      },
      open: () => {
        /**
         * If Toolbox is not initialized yet, do nothing
         */
        if (this.toolboxInstance === null)  {
          log('toolbox.open() called before initialization is finished', 'warn');

          return;
        }

        /**
         * Set current block to cover the case when the Toolbar showed near hovered Block but caret is set to another Block.
         */
        if (this.hoveredBlock) {
          this.Blok.BlockManager.currentBlock = this.hoveredBlock;
        }

        this.toolboxInstance.open();
      },
      toggle: () => {
        /**
         * If Toolbox is not initialized yet, do nothing
         */
        if (this.toolboxInstance === null)  {
          log('toolbox.toggle() called before initialization is finished', 'warn');

          return;
        }

        this.toolboxInstance.toggle();
      },
      hasFocus: () => this.toolboxInstance?.hasFocus(),
    };
  }

  /**
   * Block actions appearance manipulations
   */
  private get blockActions(): { hide: () => void; show: () => void } {
    return {
      hide: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.nodes.actions?.classList.remove(this.CSS.actionsOpened);
        this.nodes.actions?.removeAttribute('data-blok-opened');
      },
      show: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.nodes.actions?.classList.add(this.CSS.actionsOpened);
        this.nodes.actions?.setAttribute('data-blok-opened', 'true');
      },
    };
  }

  /**
   * Methods for working with Block Tunes toggler
   */
  private get blockTunesToggler(): { hide: () => void; show: () => void } {
    return {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      hide: (): void => this.nodes.settingsToggler?.classList.add(this.CSS.settingsTogglerHidden),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      show: (): void => this.nodes.settingsToggler?.classList.remove(this.CSS.settingsTogglerHidden),
    };
  }


  /**
   * Toggles read-only mode
   * @param {boolean} readOnlyEnabled - read-only mode
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      window.requestIdleCallback(async () => {
        await this.drawUI();
        this.enableModuleBindings();
      }, { timeout: 2000 });
    } else {
      this.destroy();
      this.Blok.BlockSettings.destroy();
      this.disableModuleBindings();
    }
  }

  /**
   * Move Toolbar to the passed (or current) Block
   * @param block - block to move Toolbar near it
   * @param target - optional target element that was hovered (for content offset calculation)
   */
  public moveAndOpen(block?: Block | null, target?: Element | null): void {
    /**
     * Some UI elements creates inside requestIdleCallback, so the can be not ready yet
     */
    if (this.toolboxInstance === null)  {
      log('Can\'t open Toolbar since Blok initialization is not finished yet', 'warn');

      return;
    }

    /**
     * Close Toolbox when we move toolbar
     */
    if (this.toolboxInstance.opened) {
      this.toolboxInstance.close();
    }

    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    }

    /**
     * If no one Block selected as a Current
     */
    const targetBlock = block ?? this.Blok.BlockManager.currentBlock;

    if (!targetBlock) {
      return;
    }

    /** Clean up draggable on previous block if any */
    if (this.hoveredBlock && this.hoveredBlock !== targetBlock) {
      this.hoveredBlock.cleanupDraggable();
    }

    this.hoveredBlock = targetBlock;
    this.plusButtonHandler.setHoveredBlock(targetBlock);
    this.settingsTogglerHandler.setHoveredBlock(targetBlock);
    this.positioner.setHoveredTarget(target ?? null);
    this.positioner.resetCachedPosition(); // Reset cached position when moving to a new block

    const { wrapper, plusButton, settingsToggler } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    const targetBlockHolder = targetBlock.holder;
    const { isMobile } = this.Blok.UI;

    const toolbarY = this.positioner.calculateToolbarY(
      { targetBlock, hoveredTarget: target ?? null, isMobile },
      plusButton
    );

    if (toolbarY === null) {
      return;
    }

    /**
     * Move Toolbar to the Top coordinate of Block
     */
    this.positioner.moveToY(this.nodes, toolbarY);
    targetBlockHolder.appendChild(wrapper);

    /** Set up draggable on the target block using the settings toggler as drag handle */
    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    /**
     * Apply content offset for nested elements (e.g., nested list items)
     */
    this.positioner.applyContentOffset(this.nodes, targetBlock);

    /**
     * Do not show Block Tunes Toggler near single and empty block
     */
    const tunes = targetBlock.getTunes();
    const hasAnyTunes = tunes.toolTunes.length > 0 || tunes.commonTunes.length > 0;

    if (this.Blok.BlockManager.blocks.length === 1 && targetBlock.isEmpty && !hasAnyTunes) {
      this.blockTunesToggler.hide();
    } else {
      this.blockTunesToggler.show();
    }

    this.open();
  }

  /**
   * Move Toolbar to the specified block (or first selected block) and open it for multi-block selection.
   * Keeps the add button visible so users can still insert blocks while multiple are selected.
   * @param block - optional block to position the toolbar at (defaults to first selected block)
   */
  public moveAndOpenForMultipleBlocks(block?: Block): void {
    /**
     * Do not move toolbar if Block Settings is opened or opening.
     * The settings menu should remain anchored to where the user opened it.
     */
    if (this.Blok.BlockSettings.opened || this.Blok.BlockSettings.isOpening) {
      return;
    }

    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;

    if (selectedBlocks.length < 2) {
      return;
    }

    /**
     * Some UI elements creates inside requestIdleCallback, so they can be not ready yet
     */
    if (this.toolboxInstance === null) {
      log('Can\'t open Toolbar since Blok initialization is not finished yet', 'warn');

      return;
    }

    /**
     * Close Toolbox when we move toolbar
     */
    if (this.toolboxInstance.opened) {
      this.toolboxInstance.close();
    }

    /**
     * Don't close BlockSettings here - it should remain open if the user explicitly opened it via the settings toggler.
     * The hover behavior that calls this method shouldn't interfere with the user's intent to open the menu.
     */

    /**
     * Use the provided block or fall back to the first selected block as the anchor for the toolbar
     */
    const targetBlock = block ?? selectedBlocks[0];

    /** Clean up draggable on previous block if any */
    if (this.hoveredBlock && this.hoveredBlock !== targetBlock) {
      this.hoveredBlock.cleanupDraggable();
    }

    this.hoveredBlock = targetBlock;
    this.plusButtonHandler.setHoveredBlock(targetBlock);
    this.settingsTogglerHandler.setHoveredBlock(targetBlock);
    this.positioner.setHoveredTarget(null); // No target for multi-block selection
    this.positioner.resetCachedPosition(); // Reset cached position when moving to a new block

    const { wrapper, plusButton } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    const targetBlockHolder = targetBlock.holder;

    const toolbarY = this.positioner.calculateToolbarY(
      { targetBlock, hoveredTarget: null, isMobile: false },
      plusButton
    );

    if (toolbarY === null) {
      return;
    }

    this.positioner.moveToY(this.nodes, toolbarY);
    targetBlockHolder.appendChild(wrapper);

    /** Set up draggable on the target block using the settings toggler as drag handle */
    const { settingsToggler } = this.nodes;

    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    /**
     * Reset content offset for multi-block selection
     */
    this.positioner.applyContentOffset(this.nodes, targetBlock);

    /**
     * Always show the settings toggler for multi-block selection
     */
    this.blockTunesToggler.show();

    this.open();
  }

  /**
   * Close the Toolbar
   */
  public close(): void {
    if (this.Blok.ReadOnly.isEnabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.remove(this.CSS.toolbarOpened);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.add(this.CSS.toolbarClosed);
    this.nodes.wrapper?.removeAttribute('data-blok-opened');

    /** Close components */
    this.blockActions.hide();
    this.toolboxInstance?.close();
    this.Blok.BlockSettings.close();

    /**
     * Clear hovered block state to prevent toolbar from reopening
     * for a block that no longer exists or is no longer valid
     */
    this.hoveredBlock = null;

    /**
     * Restore plus button visibility in case it was hidden by other interactions
     */
    if (this.nodes.plusButton) {
      this.nodes.plusButton.style.display = '';
    }

    /**
     * Reset the content offset transform
     */
    if (this.nodes.actions) {
      this.nodes.actions.style.transform = '';
    }
    this.positioner.setHoveredTarget(null);

    this.reset();
  }

  /**
   * Prevents the settings menu from opening on the next mouseup event
   * Used after block drop to avoid accidental menu opening
   */
  public skipNextSettingsToggle(): void {
    this.settingsTogglerHandler.skipNextToggle();
  }

  /**
   * Reset the Toolbar position to prevent DOM height growth, for example after blocks deletion
   */
  private reset(): void {
    this.positioner.resetCachedPosition(); // Reset cached position when toolbar is reset

    if (this.nodes.wrapper) {
      this.nodes.wrapper.style.top = 'unset';

      /**
       * Move Toolbar back to the Blok wrapper to save it from deletion
       */
      this.Blok.UI.nodes.wrapper.appendChild(this.nodes.wrapper);
    }
  }

  /**
   * Open Toolbar with Plus Button and Actions
   * @param {boolean} withBlockActions - by default, Toolbar opens with Block Actions.
   *                                     This flag allows to open Toolbar without Actions.
   */
  private open(withBlockActions = true): void {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.remove(this.CSS.toolbarClosed);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.add(this.CSS.toolbarOpened);
    this.nodes.wrapper?.setAttribute('data-blok-opened', 'true');

    if (withBlockActions) {
      this.blockActions.show();
    } else {
      this.blockActions.hide();
    }
  }

  /**
   * Draws Toolbar elements
   */
  private async make(): Promise<void> {
    const wrapper = $.make('div', [
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.toolbar,
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.toolbarClosed,
      'group-data-[blok-dragging=true]:pointer-events-none',
    ]);

    this.nodes.wrapper = wrapper;
    wrapper.setAttribute(DATA_ATTR.toolbar, '');
    wrapper.setAttribute('data-blok-testid', 'toolbar');

    /**
     * Make Content Zone and Actions Zone
     */
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
    const content = $.make('div', this.CSS.content);
    const actions = $.make('div', [
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.actions,
      // Narrow mode positioning on non-mobile screens
      'not-mobile:group-data-[blok-narrow=true]:right-[calc(-1*theme(spacing.narrow-mode-right-padding)-5px)]',
      // RTL narrow mode: use left positioning instead
      'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:right-auto',
      'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:left-[calc(-1*theme(spacing.narrow-mode-right-padding)-5px)]',
      // RTL narrow mode additional left offset
      'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:left-[-5px]',
    ]);

    this.nodes.content = content;

    this.nodes.actions = actions;
    actions.setAttribute('data-blok-testid', 'toolbar-actions');

    /**
     * Actions will be included to the toolbar content so we can align in to the right of the content
     */
    $.append(wrapper, content);
    $.append(content, actions);

    /**
     * Fill Content Zone:
     *  - Plus Button (created by handler)
     *  - Toolbox
     */
    const plusButton = this.plusButtonHandler.make(this.nodes);
    $.append(actions, plusButton);

    /**
     * Fill Actions Zone:
     *  - Settings Toggler (created by handler)
     *  - Remove Block Button
     *  - Settings Panel
     */
    const settingsToggler = this.settingsTogglerHandler.make(this.nodes);
    $.append(actions, settingsToggler);

    /**
     * Appending Toolbar components to itself
     */
    $.append(actions, this.makeToolbox());

    const blockSettingsElement = this.Blok.BlockSettings.getElement();

    if (!blockSettingsElement) {
      throw new Error('Block Settings element was not created');
    }

    $.append(actions, blockSettingsElement);

    /**
     * Append toolbar to the Blok
     */
    $.append(this.Blok.UI.nodes.wrapper, wrapper);
  }

  /**
   * Creates the Toolbox instance and return it's rendered element
   */
  private makeToolbox(): Element {
    /**
     * Make the Toolbox
     */
    this.toolboxInstance = new Toolbox({
      api: this.Blok.API.methods,
      tools: this.Blok.Tools.blockTools,
      i18nLabels: {
        filter: this.Blok.I18n.t('popover.search'),
        nothingFound: this.Blok.I18n.t('popover.nothingFound'),
      },
      i18n: this.Blok.I18n,
      triggerElement: this.nodes.plusButton,
    });

    this.toolboxInstance.on(ToolboxEvent.Opened, () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.Blok.UI.nodes.wrapper.classList.add(this.CSS.openedToolboxHolderModifier);
      this.Blok.UI.nodes.wrapper.setAttribute(DATA_ATTR.toolboxOpened, 'true');
    });

    this.toolboxInstance.on(ToolboxEvent.Closed, () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.Blok.UI.nodes.wrapper.classList.remove(this.CSS.openedToolboxHolderModifier);
      this.Blok.UI.nodes.wrapper.removeAttribute(DATA_ATTR.toolboxOpened);
    });

    this.toolboxInstance.on(ToolboxEvent.BlockAdded, ({ block }) => {
      const { BlockManager, Caret } = this.Blok;
      const newBlock = BlockManager.getBlockById(block.id);

      if (!newBlock) {
        return;
      }

      if (newBlock.inputs.length !== 0) {
        return;
      }

      /**
       * If the new block doesn't contain inputs, insert the new paragraph below
       */
      if (newBlock === BlockManager.lastBlock) {
        BlockManager.insertAtEnd();
        Caret.setToBlock(BlockManager.lastBlock);

        return;
      }

      const nextBlock = BlockManager.nextBlock;

      if (nextBlock) {
        Caret.setToBlock(nextBlock);
      }
    });

    const element = this.toolboxInstance.getElement();

    if (element === null) {
      throw new Error('Toolbox element was not created');
    }

    return element;
  }


  /**
   * Enable bindings
   */
  private enableModuleBindings(): void {
    /**
     * Plus button mousedown handler
     * Uses click-vs-drag detection to distinguish clicks from drags.
     */
    const plusButton = this.nodes.plusButton;

    if (plusButton) {
      this.readOnlyMutableListeners.on(plusButton, 'mousedown', (e) => {
        hide();

        this.clickDragHandler.setup(
          e as MouseEvent,
          (mouseUpEvent) => {
            /**
             * Check for modifier key to determine insert direction:
             * - Option/Alt on Mac, Ctrl on Windows → insert above
             * - No modifier → insert below (default)
             */
            const userOS = getUserOS();
            const insertAbove = userOS.win ? mouseUpEvent.ctrlKey : mouseUpEvent.altKey;

            this.plusButtonHandler.handleClick(insertAbove);
          }
        );
      }, true);
    }

    /**
     * Settings toggler mousedown handler
     * Uses click-vs-drag detection to distinguish clicks from drags.
     */
    const settingsToggler = this.nodes.settingsToggler;

    if (settingsToggler) {
      this.readOnlyMutableListeners.on(settingsToggler, 'mousedown', this.settingsTogglerHandler.createMousedownHandler(), true);
    }

    /**
     * Subscribe to the 'block-hovered' event if current view is not mobile
     * @see https://github.com/codex-team/editor.js/issues/1972
     */
    if (!isMobileScreen()) {
      /**
       * Subscribe to the 'block-hovered' event
       */
      this.eventsDispatcher.on(BlockHovered, (data) => {
        /**
         * Do not move toolbar during drag or rectangle selection operations
         */
        if (this.Blok.DragManager.isDragging || this.Blok.RectangleSelection.isRectActivated()) {
          return;
        }

        const hoveredBlock = (data as { block?: Block; target?: Element }).block;
        const hoveredTarget = (data as { block?: Block; target?: Element }).target;

        if (!(hoveredBlock instanceof Block)) {
          return;
        }

        /**
         * Do not move toolbar if Block Settings or Toolbox opened
         */
        if (this.Blok.BlockSettings.opened || this.Blok.BlockSettings.isOpening || this.toolboxInstance?.opened) {
          return;
        }

        /**
         * Check if multiple blocks are selected
         */
        const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
        const isMultiBlockSelection = selectedBlocks.length > 1;
        const isHoveredBlockSelected = isMultiBlockSelection && selectedBlocks.some(block => block === hoveredBlock);

        /**
         * For multi-block selection, only move toolbar if the hovered block is one of the selected blocks
         */
        if (isMultiBlockSelection && isHoveredBlockSelected) {
          this.moveAndOpenForMultipleBlocks(hoveredBlock);

          return;
        }

        /**
         * For multi-block selection where hovered block is not selected, do nothing
         */
        if (isMultiBlockSelection) {
          return;
        }

        this.moveAndOpen(hoveredBlock, hoveredTarget);
      });
    }

    /**
     * Subscribe to the Block Settings events to toggle 'opened' state of the Settings Toggler
     */
    this.eventsDispatcher.on(BlockSettingsOpened, this.onBlockSettingsOpen);
    this.eventsDispatcher.on(BlockSettingsClosed, this.onBlockSettingsClose);

    /**
     * Subscribe to block changes to reposition toolbar when block content changes
     */
    this.eventsDispatcher.on(BlockChanged, this.onBlockChanged);
  }

  /**
   * Disable bindings
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();
    this.eventsDispatcher.off(BlockSettingsOpened, this.onBlockSettingsOpen);
    this.eventsDispatcher.off(BlockSettingsClosed, this.onBlockSettingsClose);
    this.eventsDispatcher.off(BlockChanged, this.onBlockChanged);
  }

  /**
   * Handler for BlockSettingsOpened event
   */
  private onBlockSettingsOpen = (): void => {
    this.Blok.UI.nodes.wrapper.setAttribute(DATA_ATTR.blockSettingsOpened, 'true');
  };

  /**
   * Handler for BlockSettingsClosed event
   */
  private onBlockSettingsClose = (): void => {
    this.Blok.UI.nodes.wrapper.removeAttribute(DATA_ATTR.blockSettingsOpened);
  };

  /**
   * Handler for BlockChanged event - repositions toolbar when block content changes
   */
  private onBlockChanged = (payload: BlockChangedPayload): void => {
    /**
     * Only reposition if toolbar is opened and we have a hovered block
     */
    if (!this.opened || !this.hoveredBlock) {
      return;
    }

    /**
     * Don't reposition if Block Settings or Toolbox is opened
     */
    if (this.Blok.BlockSettings.opened || this.toolboxInstance?.opened) {
      return;
    }

    /**
     * Only reposition if the changed block is the hovered block.
     * This prevents unnecessary repositioning when other blocks change,
     * and avoids toolbar jumping when interacting with checklist items.
     */
    const changedBlockId = payload.event.detail.target.id;

    if (changedBlockId !== this.hoveredBlock.id) {
      return;
    }

    this.repositionToolbar();
  };

  /**
   * Repositions the toolbar to stay centered on the first line of the current block
   * without closing/opening toolbox or block settings
   */
  private repositionToolbar(): void {
    if (!this.hoveredBlock || !this.nodes.plusButton) {
      return;
    }

    this.positioner.repositionToolbar(
      this.nodes,
      {
        targetBlock: this.hoveredBlock,
        hoveredTarget: this.positioner.target,
        isMobile: this.Blok.UI.isMobile,
      },
      this.nodes.plusButton
    );
  }


  /**
   * Draws Toolbar UI
   *
   * Toolbar contains BlockSettings and Toolbox.
   * That's why at first we draw its components and then Toolbar itself
   *
   * Steps:
   *  - Make Toolbar dependent components like BlockSettings, Toolbox and so on
   *  - Make itself and append dependent nodes to itself
   *
   */
  private async drawUI(): Promise<void> {
    /**
     * Make BlockSettings Panel
     */
    this.Blok.BlockSettings.make();

    /**
     * Make Toolbar
     */
    await this.make();
  }

  /**
   * Removes all created and saved HTMLElements
   * It is used in Read-Only mode
   */
  private destroy(): void {
    this.removeAllNodes();
    if (this.toolboxInstance) {
      this.toolboxInstance.destroy();
    }

    /**
     * Clean up any pending click-drag handlers
     */
    this.clickDragHandler.destroy();
  }
}
