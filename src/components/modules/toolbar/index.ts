import { Module } from '../../__module';
import { Dom as $ } from '../../dom';
import { getUserOS, isMobileScreen, log } from '../../utils';
import { hide, onHover } from '../../utils/tooltip';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Block } from '../../block';
import { Toolbox,  ToolboxEvent  } from '../../ui/toolbox';
import { IconMenu, IconPlus } from '../../icons';
import { BlockHovered } from '../../events/BlockHovered';
import { BlockSettingsClosed } from '../../events/BlockSettingsClosed';
import { BlockSettingsOpened } from '../../events/BlockSettingsOpened';
import type { BlockChangedPayload } from '../../events/BlockChanged';
import { BlockChanged } from '../../events/BlockChanged';
import { twJoin } from '../../utils/tw';
import { DATA_ATTR } from '../../constants';
import { SelectionUtils } from '../../selection';

/**
 * @todo Tab on non-empty block should open Block Settings of the hoveredBlock (not where caret is set)
 *          - make Block Settings a standalone module
 * @todo - Keyboard-only mode bug:
 *         press Tab, flip to the Checkbox. press Enter (block will be added), Press Tab
 *         (Block Tunes will be opened with Move up focused), press Enter, press Tab ———— both Block Tunes and Toolbox will be opened
 * @todo TEST CASE - show toggler after opening and closing the Inline Toolbar
 */

/**
 * HTML Elements used for Toolbar UI
 */
interface ToolbarNodes {
  wrapper: HTMLElement | undefined;
  content: HTMLElement | undefined;
  actions: HTMLElement | undefined;

  plusButton: HTMLElement | undefined;
  settingsToggler: HTMLElement | undefined;
}

/**
 * Threshold in pixels to distinguish between a click and a drag.
 * Should be higher than DragManager's dragThreshold (5px) so that
 * clicks with slight mouse movement still open the menu.
 */
const DRAG_THRESHOLD = 10;
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
   * The actual element being hovered (could be a nested element like a list item)
   */
  private hoveredTarget: Element | null = null;

  /**
   * Toolbox class instance
   * It will be created in requestIdleCallback so it can be null in some period of time
   */
  private toolboxInstance: Toolbox | null = null;

  /**
   * Mouse position when mousedown occurred on settings toggler
   * Used to distinguish between click and drag
   */
  private settingsTogglerMouseDownPosition: { x: number; y: number } | null = null;

  /**
   * Mouse position when mousedown occurred on plus button
   * Used to distinguish between click and drag
   */
  private plusButtonMouseDownPosition: { x: number; y: number } | null = null;

  /**
   * Last calculated toolbar Y position
   * Used to avoid unnecessary repositioning when the position hasn't changed
   */
  private lastToolbarY: number | null = null;

  /**
   * Flag to ignore the next mouseup on settings toggler after a block drop
   * Prevents the settings menu from opening when the cursor is over the toggler after drop
   */
  private ignoreNextSettingsMouseUp = false;

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
  }

  /**
   * CSS styles
   * @returns {object}
   * @deprecated Use data attributes via constants instead
   */
  public get CSS(): { [name: string]: string } {
    return {
      toolbar: twJoin(
        'absolute left-0 right-0 top-0 transition-opacity duration-100 ease-linear will-change-[opacity,top]'
      ),
      toolbarOpened: 'block',
      toolbarClosed: 'hidden',
      content: twJoin(
        'relative mx-auto max-w-content'
      ),
      actions: twJoin(
        'absolute flex opacity-0 pr-[5px]',
        'right-full',
        // Mobile styles
        'mobile:right-auto',
        // RTL styles
        'group-data-[blok-rtl=true]:right-auto group-data-[blok-rtl=true]:left-[calc(-1*theme(width.toolbox-btn))]',
        'mobile:group-data-[blok-rtl=true]:ml-0 mobile:group-data-[blok-rtl=true]:mr-auto mobile:group-data-[blok-rtl=true]:pr-0 mobile:group-data-[blok-rtl=true]:pl-[10px]'
      ),
      actionsOpened: 'opacity-100',

      plusButton: twJoin(
        // Base toolbox-button styles
        'text-dark cursor-pointer w-toolbox-btn h-toolbox-btn rounded-[7px] inline-flex justify-center items-center select-none',
        'shrink-0',
        // SVG sizing
        '[&_svg]:h-6 [&_svg]:w-6',
        // Hover (can-hover)
        'can-hover:hover:bg-bg-light',
        // Keep hover background when toolbox is open
        'group-data-[blok-toolbox-opened=true]:bg-bg-light',
        // Mobile styles (static positioning with overlay-pane appearance)
        'mobile:bg-white mobile:border mobile:border-[#e8e8eb] mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-[2]',
        'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
        // RTL styles
        'group-data-[blok-rtl=true]:right-[calc(-1*theme(width.toolbox-btn))] group-data-[blok-rtl=true]:left-auto',
        // Narrow mode (not-mobile)
        'not-mobile:group-data-[blok-narrow=true]:left-[5px]',
        // Narrow mode RTL (not-mobile)
        'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:left-0 not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:right-[5px]'
      ),
      plusButtonShortcutKey: 'text-white',
      /**
       * Data attribute selector used by SortableJS for drag handle
       */
      settingsToggler: twJoin(
        // Base toolbox-button styles
        'text-dark cursor-pointer w-toolbox-btn h-toolbox-btn rounded-[7px] inline-flex justify-center items-center select-none',
        'cursor-pointer select-none',
        // SVG sizing
        '[&_svg]:h-6 [&_svg]:w-6',
        // Active state
        'active:cursor-grabbing',
        // Hover (can-hover)
        'can-hover:hover:bg-bg-light can-hover:hover:cursor-grab',
        // When toolbox is opened, use pointer cursor on hover
        'group-data-[blok-toolbox-opened=true]:can-hover:hover:cursor-pointer',
        // When block settings is opened, show hover background and pointer cursor
        'group-data-[blok-block-settings-opened=true]:bg-bg-light',
        'group-data-[blok-block-settings-opened=true]:can-hover:hover:cursor-pointer',
        // Mobile styles (static positioning with overlay-pane appearance)
        'mobile:bg-white mobile:border mobile:border-[#e8e8eb] mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-[2]',
        'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
        // Not-mobile styles
        'not-mobile:w-6'
      ),
      settingsTogglerHidden: 'hidden',
      settingsTogglerOpened: '',
    };
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
    this.hoveredTarget = target ?? null;
    this.lastToolbarY = null; // Reset cached position when moving to a new block

    const { wrapper, plusButton, settingsToggler } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    const targetBlockHolder = targetBlock.holder;
    const { isMobile } = this.Blok.UI;


    const toolbarY = this.calculateToolbarY(targetBlock, plusButton, isMobile);

    /**
     * Move Toolbar to the Top coordinate of Block
     */
    const newToolbarY = Math.floor(toolbarY);

    this.lastToolbarY = newToolbarY;
    wrapper.style.top = `${newToolbarY}px`;
    targetBlockHolder.appendChild(wrapper);

    /** Set up draggable on the target block using the settings toggler as drag handle */
    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    /**
     * Apply content offset for nested elements (e.g., nested list items)
     */
    this.applyContentOffset(targetBlock);

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

    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    }

    /**
     * Use the provided block or fall back to the first selected block as the anchor for the toolbar
     */
    const targetBlock = block ?? selectedBlocks[0];

    /** Clean up draggable on previous block if any */
    if (this.hoveredBlock && this.hoveredBlock !== targetBlock) {
      this.hoveredBlock.cleanupDraggable();
    }

    this.hoveredBlock = targetBlock;
    this.hoveredTarget = null; // No target for multi-block selection
    this.lastToolbarY = null; // Reset cached position when moving to a new block

    const { wrapper, plusButton } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    const targetBlockHolder = targetBlock.holder;

    const newToolbarY = Math.floor(this.calculateToolbarY(targetBlock, plusButton, false));

    this.lastToolbarY = newToolbarY;
    wrapper.style.top = `${newToolbarY}px`;
    targetBlockHolder.appendChild(wrapper);

    /** Set up draggable on the target block using the settings toggler as drag handle */
    const { settingsToggler } = this.nodes;

    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    /**
     * Reset content offset for multi-block selection
     */
    this.applyContentOffset(targetBlock);

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
    this.hoveredTarget = null;

    this.reset();
  }

  /**
   * Prevents the settings menu from opening on the next mouseup event
   * Used after block drop to avoid accidental menu opening
   */
  public skipNextSettingsToggle(): void {
    this.ignoreNextSettingsMouseUp = true;
  }

  /**
   * Reset the Toolbar position to prevent DOM height growth, for example after blocks deletion
   */
  private reset(): void {
    this.lastToolbarY = null; // Reset cached position when toolbar is reset

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
     *  - Plus Button
     *  - Toolbox
     */
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const plusButton = $.make('div', this.CSS.plusButton, {
      innerHTML: IconPlus,
    });

    plusButton.setAttribute('data-blok-testid', 'plus-button');

    this.nodes.plusButton = plusButton;
    $.append(actions, plusButton);

    /**
     * Plus button mousedown handler
     * Stores the initial mouse position to distinguish between click and drag
     */
    this.readOnlyMutableListeners.on(plusButton, 'mousedown', (e) => {
      const mouseEvent = e as MouseEvent;

      /**
       * Store the mouse position when mousedown occurs
       * This will be used to determine if the user dragged or clicked
       */
      this.plusButtonMouseDownPosition = {
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
      };
    }, true);

    /**
     * Plus button mouseup handler
     * Only opens the toolbox if the mouse didn't move significantly (i.e., it was a click, not a drag)
     *
     * We use mouseup instead of click because when multiple blocks are selected,
     * the browser may not generate a click event due to focus/selection changes
     * during the mousedown phase.
     */
    this.readOnlyMutableListeners.on(plusButton, 'mouseup', (e) => {
      e.stopPropagation();

      const mouseEvent = e as MouseEvent;

      /**
       * Check if this was a drag or a click by comparing mouse positions
       * If the mouse moved more than the threshold, it was a drag - don't open toolbox
       */
      const mouseDownPos = this.plusButtonMouseDownPosition;

      this.plusButtonMouseDownPosition = null;

      /**
       * If mouseDownPos is null, it means mousedown didn't happen on this element
       * (e.g., user started drag from elsewhere), so ignore this mouseup
       */
      if (mouseDownPos === null) {
        return;
      }

      const wasDragged = (
        Math.abs(mouseEvent.clientX - mouseDownPos.x) > DRAG_THRESHOLD ||
        Math.abs(mouseEvent.clientY - mouseDownPos.y) > DRAG_THRESHOLD
      );

      if (wasDragged) {
        return;
      }

      hide();
      this.plusButtonClicked();
    }, true);

    /**
     * Add events to show/hide tooltip for plus button
     */
    const userOS = getUserOS();
    const modifierClickText = userOS.win
      ? this.Blok.I18n.t('toolbox.ctrlAddAbove')
      : this.Blok.I18n.t('toolbox.optionAddAbove');

    const tooltipContent = this.createTooltipContent([
      this.Blok.I18n.t('toolbox.addBelow'),
      modifierClickText,
    ]);

    onHover(plusButton, tooltipContent, {
      delay: 500,
    });

    /**
     * Fill Actions Zone:
     *  - Settings Toggler
     *  - Remove Block Button
     *  - Settings Panel
     */
    const settingsToggler = $.make('span', [
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.CSS.settingsToggler,
      'group-data-[blok-dragging=true]:cursor-grabbing',
    ], {
      innerHTML: IconMenu,
    });

    settingsToggler.setAttribute(DATA_ATTR.settingsToggler, '');
    settingsToggler.setAttribute(DATA_ATTR.dragHandle, '');
    settingsToggler.setAttribute('data-blok-testid', 'settings-toggler');

    // Accessibility: make the drag handle accessible to screen readers
    // Using tabindex="-1" keeps it accessible but removes from tab order
    // Users can move blocks with keyboard shortcuts (Cmd/Ctrl+Shift+Arrow)
    settingsToggler.setAttribute('role', 'button');
    settingsToggler.setAttribute('tabindex', '-1');
    settingsToggler.setAttribute(
      'aria-label',
      this.Blok.I18n.t('a11y.dragHandle')
    );
    settingsToggler.setAttribute(
      'aria-roledescription',
      this.Blok.I18n.t('a11y.dragHandleRole')
    );

    this.nodes.settingsToggler = settingsToggler;

    $.append(actions, settingsToggler);

    const blockTunesTooltip = this.createTooltipContent([
      this.Blok.I18n.t('blockSettings.dragToMove'),
      this.Blok.I18n.t('blockSettings.clickToOpenMenu'),
    ]);

    onHover(settingsToggler, blockTunesTooltip, {
      delay: 500,
    });

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
   * Handler for Plus Button
   */
  private plusButtonClicked(): void {
    /**
     * We need to update Current Block because user can click on the Plus Button (thanks to appearing by hover) without any clicks on blok
     * In this case currentBlock will point last block
     */
    if (this.hoveredBlock) {
      this.Blok.BlockManager.currentBlock = this.hoveredBlock;
    }

    /**
     * Close Block Settings if opened, similar to how settings toggler closes toolbox
     */
    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    }

    /**
     * Clear block selection when plus button is clicked
     * This allows users to add new blocks even when multiple blocks are selected
     */
    if (this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockSelection.clearSelection();
    }

    /**
     * Remove native text selection that may have been created during cross-block selection
     * This needs to happen regardless of anyBlockSelected state, as cross-block selection
     * via Shift+Arrow creates native text selection that spans multiple blocks
     */
    SelectionUtils.get()?.removeAllRanges();

    this.toolboxInstance?.toggle();
  }

  /**
   * Enable bindings
   */
  private enableModuleBindings(): void {
    /**
     * Settings toggler
     *
     * mousedown is used because on click selection is lost in Safari and FF
     */
    const settingsToggler = this.nodes.settingsToggler;

    if (settingsToggler) {
      /**
       * Settings toggler mousedown handler
       * Stores the initial mouse position and sets up a document-level mouseup listener.
       * Using document-level mouseup ensures we catch the event even if the mouse
       * moves slightly off the toggler element during the click.
       */
      this.readOnlyMutableListeners.on(settingsToggler, 'mousedown', (e) => {
        hide();

        const mouseEvent = e as MouseEvent;

        /**
         * Store the mouse position when mousedown occurs
         * This will be used to determine if the user dragged or clicked
         */
        this.settingsTogglerMouseDownPosition = {
          x: mouseEvent.clientX,
          y: mouseEvent.clientY,
        };

        /**
         * Add document-level mouseup listener to catch the event even if mouse
         * moves slightly off the toggler. This is removed after firing once.
         */
        const onMouseUp = (mouseUpEvent: MouseEvent): void => {
          document.removeEventListener('mouseup', onMouseUp, true);

          /**
           * Ignore mouseup after a block drop to prevent settings menu from opening
           */
          if (this.ignoreNextSettingsMouseUp) {
            this.ignoreNextSettingsMouseUp = false;
            this.settingsTogglerMouseDownPosition = null;

            return;
          }

          const mouseDownPos = this.settingsTogglerMouseDownPosition;

          this.settingsTogglerMouseDownPosition = null;

          if (mouseDownPos === null) {
            return;
          }

          const wasDragged = (
            Math.abs(mouseUpEvent.clientX - mouseDownPos.x) > DRAG_THRESHOLD ||
            Math.abs(mouseUpEvent.clientY - mouseDownPos.y) > DRAG_THRESHOLD
          );

          if (wasDragged) {
            return;
          }

          this.settingsTogglerClicked();

          if (this.toolboxInstance?.opened) {
            this.toolboxInstance.close();
          }
        };

        document.addEventListener('mouseup', onMouseUp, true);
      }, true);
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
        if (this.Blok.BlockSettings.opened || this.toolboxInstance?.opened) {
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
   * Calculates the Y position for the toolbar, centered on the first line of the block
   * @param targetBlock - the block to position the toolbar relative to
   * @param plusButton - the plus button element (used to get toolbar height)
   * @param isMobile - whether the current view is mobile
   * @returns the Y position in pixels
   */
  private calculateToolbarY(targetBlock: Block, plusButton: HTMLElement, isMobile: boolean): number {
    const targetBlockHolder = targetBlock.holder;
    const holderRect = targetBlockHolder.getBoundingClientRect();

    /**
     * Use the hovered target element (e.g., a nested list item) if available,
     * otherwise fall back to the block's pluginsContent
     */
    const listItemElement = this.hoveredTarget?.closest('[role="listitem"]');
    /**
     * For list items, find the actual text content element ([contenteditable]) and use its position
     * to properly center the toolbar on the text, not on the marker which may have different font-size
     */
    const textElement = listItemElement?.querySelector('[contenteditable]');
    const contentElement = textElement ?? listItemElement ?? targetBlock.pluginsContent;
    const contentRect = contentElement.getBoundingClientRect();
    const contentOffset = contentRect.top - holderRect.top;

    const contentStyle = window.getComputedStyle(contentElement);
    const contentPaddingTop = parseInt(contentStyle.paddingTop, 10) || 0;
    const lineHeight = parseFloat(contentStyle.lineHeight) || 24;
    const toolbarHeight = parseInt(window.getComputedStyle(plusButton).height, 10);

    if (isMobile) {
      return contentOffset - toolbarHeight;
    }

    const firstLineTop = contentOffset + contentPaddingTop;
    const firstLineCenterY = firstLineTop + (lineHeight / 2);

    return firstLineCenterY - (toolbarHeight / 2);
  }

  /**
   * Repositions the toolbar to stay centered on the first line of the current block
   * without closing/opening toolbox or block settings
   */
  private repositionToolbar(): void {
    const { wrapper, plusButton } = this.nodes;

    if (!wrapper || !plusButton || !this.hoveredBlock) {
      return;
    }

    const newToolbarY = Math.floor(this.calculateToolbarY(this.hoveredBlock, plusButton, this.Blok.UI.isMobile));

    /**
     * Only update the toolbar position if it has actually changed significantly.
     * This prevents unnecessary repositioning when block changes don't affect
     * the toolbar's position (e.g., toggling checkbox styles in a checklist).
     *
     * We use a tolerance of 2px to account for:
     * - Floating-point precision issues in getBoundingClientRect()
     * - Minor layout changes that don't warrant toolbar repositioning
     * - Browser rendering differences during DOM mutations
     */
    const POSITION_TOLERANCE = 2;
    const positionChanged = this.lastToolbarY === null ||
      Math.abs(newToolbarY - this.lastToolbarY) > POSITION_TOLERANCE;

    if (positionChanged) {
      this.lastToolbarY = newToolbarY;
      wrapper.style.top = `${newToolbarY}px`;
    }
  }

  /**
   * Applies the content offset transform to the actions element based on the hovered target.
   * This positions the toolbar closer to nested content like list items.
   * @param targetBlock - the block to get the content offset from
   */
  private applyContentOffset(targetBlock: Block): void {
    const { actions } = this.nodes;

    if (!actions) {
      return;
    }

    if (!this.hoveredTarget) {
      actions.style.transform = '';

      return;
    }

    const contentOffset = targetBlock.getContentOffset(this.hoveredTarget);
    const hasValidOffset = contentOffset && contentOffset.left > 0;

    actions.style.transform = hasValidOffset ? `translateX(${contentOffset.left}px)` : '';
  }

  /**
   * Clicks on the Block Settings toggler
   */
  private settingsTogglerClicked(): void {
    /**
     * Cancel any pending drag tracking since we're opening the settings menu
     * This prevents the drag from starting when the user moves their mouse to the menu
     */
    this.Blok.DragManager.cancelTracking();

    /**
     * Prefer the hovered block (desktop), fall back to the current block (mobile) so tapping the toggler still works
     */
    const targetBlock = this.hoveredBlock ?? this.Blok.BlockManager.currentBlock;

    if (!targetBlock) {
      return;
    }

    this.hoveredBlock = targetBlock;
    this.Blok.BlockManager.currentBlock = targetBlock;

    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    } else {
      void this.Blok.BlockSettings.open(targetBlock, this.nodes.settingsToggler);
    }
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
   * Creates a tooltip content element with multiple lines and consistent styling
   * @param lines - array of text strings, each will be displayed on its own line
   * @returns the tooltip container element
   */
  private createTooltipContent(lines: string[]): HTMLElement {
    const container = $.make('div');

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '4px';

    lines.forEach((text) => {
      const line = $.make('div');
      const spaceIndex = text.indexOf(' ');

      if (spaceIndex > 0) {
        const firstWord = text.substring(0, spaceIndex);
        const rest = text.substring(spaceIndex);
        const styledWord = $.make('span', null, { textContent: firstWord });

        styledWord.style.color = 'white';
        line.appendChild(styledWord);
        line.appendChild(document.createTextNode(rest));
      } else {
        line.appendChild(document.createTextNode(text));
      }

      container.appendChild(line);
    });

    return container;
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
  }
}
