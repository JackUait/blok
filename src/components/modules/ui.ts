
/**
 * Module UI
 * @type {UI}
 */
import { Module } from '../__module';
import { Dom as $, toggleEmptyMark } from '../dom';
import { debounce, getValidUrl, isEmpty, openTab, throttle } from '../utils';

import { SelectionUtils as Selection } from '../selection';
import { Flipper } from '../flipper';
import type { Block } from '../block';
import { mobileScreenBreakpoint } from '../utils';

/**
 * Horizontal distance from the content edge where block hover is still detected.
 * Extends to the left for LTR layouts, to the right for RTL.
 */
const HOVER_ZONE_SIZE = 100;

import styles from '../../styles/main.css?inline';
import { BlockHovered } from '../events/BlockHovered';
import {
  DATA_ATTR,
  BLOK_INTERFACE_VALUE,
  selectionChangeDebounceTimeout,
} from '../constants';
import { BlokMobileLayoutToggled } from '../events';
import { destroyAnnouncer, registerAnnouncer } from '../utils/announcer';
/**
 * HTML Elements used for UI
 */
interface UINodes {
  holder: HTMLElement;
  wrapper: HTMLElement;
  redactor: HTMLElement;
}

/**
 * @class
 * @classdesc Makes Blok UI:
 *                <blok-editor>
 *                    <blok-redactor />
 *                    <blok-toolbar />
 *                    <blok-inline-toolbar />
 *                </blok-editor>
 * @typedef {UI} UI
 * @property {BlokConfig} config   - blok configuration {@link Blok#configuration}
 * @property {object} Blok         - available blok modules {@link Blok#moduleInstances}
 * @property {object} nodes          -
 * @property {Element} nodes.holder  - element where we need to append redactor
 * @property {Element} nodes.wrapper  - <blok-editor>
 * @property {Element} nodes.redactor - <blok-redactor>
 */
export class UI extends Module<UINodes> {
  /**
   * Return Width of center column of Blok
   * @returns {DOMRect}
   */
  public get contentRect(): DOMRect {
    if (this.contentRectCache !== null) {
      return this.contentRectCache;
    }

    const someBlock = this.nodes.wrapper.querySelector('[data-blok-testid="block-content"]');

    /**
     * When Blok is not ready, there is no Blocks, so return the default value
     */
    if (!someBlock) {
      return {
        width: 650,
        left: 0,
        right: 0,
      } as DOMRect;
    }

    this.contentRectCache = someBlock.getBoundingClientRect();

    return this.contentRectCache;
  }

  /**
   * Flag that became true on mobile viewport
   * @type {boolean}
   */
  public isMobile = false;


  /**
   * Cache for center column rectangle info
   * Invalidates on window resize
   * @type {DOMRect}
   */
  private contentRectCache: DOMRect | null = null;

  /**
   * Handle window resize only when it finished
   * @type {() => void}
   */
  private resizeDebouncer: () => void = debounce(() => {
    this.windowResize();

  }, 200);

  /**
   * Handle selection change to manipulate Inline Toolbar appearance
   */
  private selectionChangeDebounced = debounce(() => {
    this.selectionChanged();
  }, selectionChangeDebounceTimeout);

  /**
   * Making main interface
   */
  public async prepare(): Promise<void> {
    /**
     * Detect mobile version
     */
    this.setIsMobile();

    /**
     * Make main UI elements
     */
    this.make();

    /**
     * Load and append CSS
     */
    this.loadStyles();

    /**
     * Register this Blok instance with the accessibility announcer
     * for proper multi-instance cleanup
     */
    registerAnnouncer();
  }

  /**
   * Toggle read-only state
   *
   * If readOnly is true:
   * - removes all listeners from main UI module elements
   *
   * if readOnly is false:
   * - enables all listeners to UI module elements
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    /**
     * Prepare components based on read-only state
     */
    if (readOnlyEnabled) {
      /**
       * Unbind all events
       *
       */
      this.unbindReadOnlySensitiveListeners();

      return;
    }

    const bindListeners = (): void => {
      /**
       * Bind events for the UI elements
       */
      this.bindReadOnlySensitiveListeners();
    };

    /**
     * Ensure listeners are attached immediately for interactive use.
     */
    bindListeners();

    const idleCallback = window.requestIdleCallback;

    if (typeof idleCallback !== 'function') {
      return;
    }

    /**
     * Re-bind on idle to preserve historical behavior when additional nodes appear later.
     */
    idleCallback(bindListeners, {
      timeout: 2000,
    });
  }

  /**
   * Check if Blok is empty and set data attribute on wrapper
   */
  public checkEmptiness(): void {
    const { BlockManager } = this.Blok;

    this.nodes.wrapper.setAttribute(DATA_ATTR.empty, BlockManager.isBlokEmpty ? 'true' : 'false');
  }

  /**
   * Check if one of Toolbar is opened
   * Used to prevent global keydowns (for example, Enter) conflicts with Enter-on-toolbar
   * @returns {boolean}
   */
  public get someToolbarOpened(): boolean {
    const { Toolbar, BlockSettings, InlineToolbar } = this.Blok;

    return Boolean(BlockSettings.opened || InlineToolbar.opened || Toolbar.toolbox.opened);
  }

  /**
   * Check for some Flipper-buttons is under focus
   */
  public get someFlipperButtonFocused(): boolean {
    /**
     * Toolbar has internal module (Toolbox) that has own Flipper,
     * so we check it manually
     */
    if (this.Blok.Toolbar.toolbox.hasFocus()) {
      return true;
    }


    return Object.entries(this.Blok).filter(([_moduleName, moduleClass]) => {
      return moduleClass.flipper instanceof Flipper;
    })
      .some(([_moduleName, moduleClass]) => {
        return moduleClass.flipper.hasFocus();
      });


  }

  /**
   * Clean blok`s UI
   */
  public destroy(): void {
    this.nodes.holder.innerHTML = '';

    this.unbindReadOnlyInsensitiveListeners();
    this.unbindReadOnlySensitiveListeners();

    // Clean up accessibility announcer
    destroyAnnouncer();
  }

  /**
   * Close all Blok's toolbars
   */
  public closeAllToolbars(): void {
    const { Toolbar, BlockSettings, InlineToolbar } = this.Blok;

    BlockSettings.close();
    InlineToolbar.close();
    Toolbar.toolbox.close();
  }

  /**
   * Event listener for 'mousedown' and 'touchstart' events
   * @param event - TouchEvent or MouseEvent
   */
  private documentTouchedListener = (event: Event): void => {
    this.documentTouched(event);
  };

  /**
   * Check for mobile mode and save the result
   */
  private setIsMobile(): void {
    const isMobile = window.innerWidth < mobileScreenBreakpoint;

    if (isMobile !== this.isMobile) {
      /**
       * Dispatch global event
       */
      this.eventsDispatcher.emit(BlokMobileLayoutToggled, {
        isEnabled: this.isMobile,
      });
    }

    this.isMobile = isMobile;
  }

  /**
   * Makes Blok interface
   */
  private make(): void {
    /**
     * Element where we need to append Blok
     * @type {Element}
     */
    const holder = this.config.holder;

    if (!holder) {
      throw new Error('Blok holder is not specified in the configuration.');
    }

    this.nodes.holder = $.getHolder(holder);

    /**
     * Create and save main UI elements
     */
    this.nodes.wrapper = $.make('div', [
      'group',
      'relative',
      'box-border',
      'z-[1]',
      '[&[data-blok-dragging=true]]:cursor-grabbing',
      // SVG defaults
      '[&_svg]:max-h-full',
      '[&_path]:stroke-current',
      // Native selection color
      '[&_::selection]:bg-selection-inline',
      // Hide placeholder when toolbox is opened
      '[&[data-blok-toolbox-opened=true]_[contentEditable=true][data-blok-placeholder]:focus]:before:!opacity-0',
      ...(this.isRtl ? [ '[direction:rtl]' ] : []),
    ]);
    this.nodes.wrapper.setAttribute(DATA_ATTR.interface, BLOK_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute(DATA_ATTR.editor, '');
    this.nodes.wrapper.setAttribute('data-blok-testid', 'blok-editor');
    if (this.isRtl) {
      this.nodes.wrapper.setAttribute(DATA_ATTR.rtl, 'true');
    }
    this.nodes.redactor = $.make('div', [
      // Narrow mode: add right margin on non-mobile screens
      'not-mobile:group-data-[blok-narrow=true]:mr-[theme(spacing.narrow-mode-right-padding)]',
      // RTL narrow mode: add left margin instead
      'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:ml-[theme(spacing.narrow-mode-right-padding)]',
      'not-mobile:group-data-[blok-narrow=true]:group-data-[blok-rtl=true]:mr-0',
      // Firefox empty contenteditable fix
      '[&_[contenteditable]:empty]:after:content-["\\feff_"]',
    ]);
    this.nodes.redactor.setAttribute(DATA_ATTR.redactor, '');
    this.nodes.redactor.setAttribute('data-blok-testid', 'redactor');

    /**
     * If Blok has injected into the narrow container, enable Narrow Mode
     * @todo Forced layout. Get rid of this feature
     */
    if (this.nodes.holder.offsetWidth < this.contentRect.width) {
      this.nodes.wrapper.setAttribute(DATA_ATTR.narrow, 'true');
    }

    /**
     * Set customizable bottom zone height
     */
    this.nodes.redactor.style.paddingBottom = this.config.minHeight + 'px';

    this.nodes.wrapper.appendChild(this.nodes.redactor);
    this.nodes.holder.appendChild(this.nodes.wrapper);

    this.bindReadOnlyInsensitiveListeners();
  }

  /**
   * Appends CSS
   */
  private loadStyles(): void {
    /**
     * Load CSS
     */

    const styleTagId = 'blok-styles';

    /**
     * Do not append styles again if they are already on the page
     */
    if ($.get(styleTagId)) {
      return;
    }

    /**
     * Make tag
     */
    const tag = $.make('style', null, {
      id: styleTagId,
      textContent: styles.toString(),
    });

    /**
     * If user enabled Content Security Policy, he can pass nonce through the config
     * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce
     */
    if (this.config.style && !isEmpty(this.config.style) && this.config.style.nonce) {
      tag.setAttribute('nonce', this.config.style.nonce);
    }

    /**
     * Append styles at the top of HEAD tag
     */
    $.prepend(document.head, tag);
  }

  /**
   * Adds listeners that should work both in read-only and read-write modes
   */
  private bindReadOnlyInsensitiveListeners(): void {
    this.listeners.on(document, 'selectionchange', this.selectionChangeDebounced);

    this.listeners.on(window, 'resize', this.resizeDebouncer, {
      passive: true,
    });

    this.listeners.on(this.nodes.redactor, 'mousedown', this.documentTouchedListener, {
      capture: true,
      passive: true,
    });

    this.listeners.on(this.nodes.redactor, 'touchstart', this.documentTouchedListener, {
      capture: true,
      passive: true,
    });
  }

  /**
   * Removes listeners that should work both in read-only and read-write modes
   */
  private unbindReadOnlyInsensitiveListeners(): void {
    this.listeners.off(document, 'selectionchange', this.selectionChangeDebounced);
    this.listeners.off(window, 'resize', this.resizeDebouncer);
    this.listeners.off(this.nodes.redactor, 'mousedown', this.documentTouchedListener);
    this.listeners.off(this.nodes.redactor, 'touchstart', this.documentTouchedListener);
  }


  /**
   * Adds listeners that should work only in read-only mode
   */
  private bindReadOnlySensitiveListeners(): void {
    this.readOnlyMutableListeners.on(this.nodes.redactor, 'click', (event: Event) => {
      if (event instanceof MouseEvent) {
        this.redactorClicked(event);
      }
    }, false);

    this.readOnlyMutableListeners.on(document, 'keydown', (event: Event) => {
      if (event instanceof KeyboardEvent) {
        this.documentKeydown(event);
      }
    }, true);

    this.readOnlyMutableListeners.on(document, 'mousedown', (event: Event) => {
      if (event instanceof MouseEvent) {
        this.documentClicked(event);
      }
    }, true);

    /**
     * Start watching 'block-hovered' events that is used by Toolbar for moving
     */
    this.watchBlockHoveredEvents();

    /**
     * We have custom logic for providing placeholders for contenteditable elements.
     * To make it work, we need to have data-blok-empty mark on empty inputs.
     */
    this.enableInputsEmptyMark();
  }


  /**
   * Listen redactor mousemove to emit 'block-hovered' event
   */
  private watchBlockHoveredEvents(): void {
    /**
     * Used to not emit the same block multiple times to the 'block-hovered' event on every mousemove.
     * Stores block ID to ensure consistent comparison regardless of how the block was detected.
     */
    const blockHoveredState: { lastHoveredBlockId: string | null } = {
      lastHoveredBlockId: null,
    };

    const handleBlockHovered = (event: Event): void => {
      if (typeof MouseEvent === 'undefined' || !(event instanceof MouseEvent)) {
        return;
      }

      const hoveredBlockElement = (event.target as Element | null)?.closest('[data-blok-testid="block-wrapper"]');

      /**
       * If no block element found directly, try the extended hover zone
       */
      const zoneBlock = !hoveredBlockElement
        ? this.findBlockInHoverZone(event.clientX, event.clientY)
        : null;

      if (zoneBlock !== null && blockHoveredState.lastHoveredBlockId !== zoneBlock.id) {
        blockHoveredState.lastHoveredBlockId = zoneBlock.id;

        this.eventsDispatcher.emit(BlockHovered, {
          block: zoneBlock,
          target: zoneBlock.holder,
        });
      }

      if (zoneBlock !== null) {
        return;
      }

      if (!hoveredBlockElement) {
        return;
      }

      const block = this.Blok.BlockManager.getBlockByChildNode(hoveredBlockElement);

      if (!block) {
        return;
      }

      /**
       * For multi-block selection, still emit 'block-hovered' event so toolbar can follow the hovered block.
       * The toolbar module will handle the logic of whether to move or not.
       */
      if (blockHoveredState.lastHoveredBlockId === block.id) {
        return;
      }

      blockHoveredState.lastHoveredBlockId = block.id;

      this.eventsDispatcher.emit(BlockHovered, {
        block,
        target: event.target as Element,
      });
    };

    const throttledHandleBlockHovered = throttle(
      handleBlockHovered as (...args: unknown[]) => unknown,

      20
    );

    /**
     * Listen on document to detect hover in the extended zone
     * which is outside the wrapper's bounds.
     * We filter events to only process those over the editor or in the hover zone.
     */
    this.readOnlyMutableListeners.on(document, 'mousemove', (event: Event) => {
      throttledHandleBlockHovered(event);
    }, {
      passive: true,
    });
  }

  /**
   * Finds a block by vertical position when cursor is in the extended hover zone.
   * The zone extends HOVER_ZONE_SIZE pixels from the content edge (left for LTR, right for RTL).
   * @param clientX - Cursor X position
   * @param clientY - Cursor Y position
   * @returns Block at the vertical position, or null if not in hover zone or no block found
   */
  private findBlockInHoverZone(clientX: number, clientY: number): Block | null {
    const contentRect = this.contentRect;

    /**
     * For LTR: check if cursor is within hover zone to the left of content
     * For RTL: check if cursor is within hover zone to the right of content
     */
    const isInHoverZone = this.isRtl
      ? clientX > contentRect.right && clientX <= contentRect.right + HOVER_ZONE_SIZE
      : clientX < contentRect.left && clientX >= contentRect.left - HOVER_ZONE_SIZE;

    if (!isInHoverZone) {
      return null;
    }

    /**
     * Find block by Y position
     */
    for (const block of this.Blok.BlockManager.blocks) {
      const rect = block.holder.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return block;
      }
    }

    return null;
  }

  /**
   * Unbind events that should work only in read-only mode
   */
  private unbindReadOnlySensitiveListeners(): void {
    this.readOnlyMutableListeners.clearAll();
  }

  /**
   * Resize window handler
   */
  private windowResize(): void {
    /**
     * Invalidate content zone size cached, because it may be changed
     */
    this.contentRectCache = null;

    /**
     * Detect mobile version
     */
    this.setIsMobile();
  }

  /**
   * All keydowns on document
   * @param {KeyboardEvent} event - keyboard event
   */
  private documentKeydown(event: KeyboardEvent): void {
    const key = event.key ?? '';

    switch (key) {
      case 'Enter':
        this.enterPressed(event);
        break;

      case 'Backspace':
      case 'Delete':
        this.backspacePressed(event);
        break;

      case 'Escape':
        this.escapePressed(event);
        break;

      case 'Tab':
        this.tabPressed(event);
        break;

      case 'z':
      case 'Z':
        this.undoRedoPressed(event);
        break;

      default:
        this.defaultBehaviour(event);
        break;
    }
  }

  /**
   * Handle Tab key press at document level for multi-select indent/outdent
   * @param {KeyboardEvent} event - keyboard event
   */
  private tabPressed(event: KeyboardEvent): void {
    const { BlockSelection } = this.Blok;

    /**
     * Only handle Tab when blocks are selected (for multi-select indent)
     * Otherwise, let the default behavior handle it (e.g., toolbar navigation)
     */
    if (!BlockSelection.anyBlockSelected) {
      this.defaultBehaviour(event);

      return;
    }

    /**
     * Forward to BlockEvents to handle the multi-select indent/outdent.
     * BlockEvents.keydown will call preventDefault if needed.
     */
    this.Blok.BlockEvents.keydown(event);

    /**
     * When blocks are selected, always prevent default Tab behavior (focus navigation)
     * even if the indent operation couldn't be performed (e.g., mixed block types).
     * This ensures Tab doesn't unexpectedly move focus or trigger single-block indent.
     * We call preventDefault AFTER BlockEvents.keydown so that check for defaultPrevented passes.
     * We also stop propagation to prevent the event from reaching block-level handlers
     * (like ListItem's handleKeyDown) which might try to handle the Tab independently.
     */
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Ignore all other document's keydown events
   * @param {KeyboardEvent} event - keyboard event
   */
  private defaultBehaviour(event: KeyboardEvent): void {
    const { currentBlock } = this.Blok.BlockManager;
    const target = event.target;
    const isTargetElement = target instanceof HTMLElement;
    const keyDownOnBlok = isTargetElement ? target.closest('[data-blok-testid="blok-editor"]') : null;
    const isMetaKey = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

    /**
     * Ignore keydowns from inside the BlockSettings popover (e.g., search input)
     * to prevent closing the popover when typing
     */
    if (isTargetElement && this.Blok.BlockSettings.contains(target)) {
      return;
    }

    /**
     * Handle navigation mode keys even when focus is outside the editor
     * Skip if event was already handled (e.g., by block holder listener)
     */
    if (this.Blok.BlockSelection.navigationModeEnabled && !event.defaultPrevented) {
      this.Blok.BlockEvents.keydown(event);
    }

    if (this.Blok.BlockSelection.navigationModeEnabled) {
      return;
    }

    /**
     * When some block is selected, but the caret is not set inside the blok, treat such keydowns as keydown on selected block.
     */
    if (currentBlock !== undefined && keyDownOnBlok === null) {
      this.Blok.BlockEvents.keydown(event);

      return;
    }

    /**
     * Ignore keydowns on blok and meta keys
     */
    if (keyDownOnBlok || (currentBlock && isMetaKey)) {
      return;
    }

    /**
     * Remove all highlights and remove caret
     */
    this.Blok.BlockManager.unsetCurrentBlock();

    /**
     * Close Toolbar
     */
    this.Blok.Toolbar.close();
  }

  /**
   * @param {KeyboardEvent} event - keyboard event
   */
  private backspacePressed(event: KeyboardEvent): void {
    /**
     * Ignore backspace/delete from inside the BlockSettings popover (e.g., search input)
     */
    if (this.Blok.BlockSettings.contains(event.target as HTMLElement)) {
      return;
    }

    const { BlockManager, BlockSelection, Caret } = this.Blok;

    const selectionExists = Selection.isSelectionExists;
    const selectionCollapsed = Selection.isCollapsed;

    /**
     * If any block selected and selection doesn't exists on the page (that means no other editable element is focused),
     * remove selected blocks
     */
    const shouldRemoveSelection = BlockSelection.anyBlockSelected && (
      !selectionExists ||
      selectionCollapsed === true ||
      this.Blok.CrossBlockSelection.isCrossBlockSelectionStarted
    );

    if (!shouldRemoveSelection) {
      return;
    }

    const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

    if (insertedBlock) {
      Caret.setToBlock(insertedBlock, Caret.positions.START);
    }

    BlockSelection.clearSelection(event);

    /**
     * Stop propagations
     * Manipulation with BlockSelections is handled in global backspacePress because they may occur
     * with CMD+A or RectangleSelection and they can be handled on document event
     */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  /**
   * Escape pressed
   * If some of Toolbar components are opened, then close it otherwise close Toolbar.
   * If focus is in editor content and no toolbars are open, enable navigation mode.
   * @param {Event} event - escape keydown event
   */
  private escapePressed(event: KeyboardEvent): void {
    /**
     * If navigation mode is already enabled, disable it and return
     */
    if (this.Blok.BlockSelection.navigationModeEnabled) {
      this.Blok.BlockSelection.disableNavigationMode(false);

      return;
    }

    /**
     * Close BlockSettings first if it's open, regardless of selection state.
     * This prevents navigation mode from being enabled when the user closes block tunes with Escape.
     */
    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();

      return;
    }

    /**
     * Clear blocks selection by ESC (but not when entering navigation mode)
     */
    if (this.Blok.BlockSelection.anyBlockSelected) {
      this.Blok.BlockSelection.clearSelection(event);

      return;
    }

    if (this.Blok.Toolbar.toolbox.opened) {
      this.Blok.Toolbar.toolbox.close();
      this.Blok.BlockManager.currentBlock &&
        this.Blok.Caret.setToBlock(this.Blok.BlockManager.currentBlock, this.Blok.Caret.positions.END);

      return;
    }

    /**
     * If a nested popover is open (like convert-to dropdown),
     * close only the nested popover, not the entire inline toolbar.
     * We use stopImmediatePropagation to prevent other keydown listeners
     * (like the one on block.holder) from also handling this event.
     */
    if (this.Blok.InlineToolbar.opened && this.Blok.InlineToolbar.hasNestedPopoverOpen) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.Blok.InlineToolbar.closeNestedPopover();

      return;
    }

    if (this.Blok.InlineToolbar.opened) {
      this.Blok.InlineToolbar.close();

      return;
    }

    /**
     * If focus is inside editor content and no toolbars are open,
     * enable navigation mode for keyboard-based block navigation
     */
    const target = event.target;
    const isTargetElement = target instanceof HTMLElement;
    const isInsideRedactor = isTargetElement && this.nodes.redactor.contains(target);
    const hasCurrentBlock = this.Blok.BlockManager.currentBlock !== undefined;

    if (isInsideRedactor && hasCurrentBlock) {
      event.preventDefault();
      this.Blok.Toolbar.close();
      this.Blok.BlockSelection.enableNavigationMode();

      return;
    }

    this.Blok.Toolbar.close();
  }

  /**
   * Timestamp of last undo/redo call to prevent double-firing
   */
  private lastUndoRedoTime = 0;

  /**
   * Handle Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo)
   * @param {KeyboardEvent} event - keyboard event
   */
  private undoRedoPressed(event: KeyboardEvent): void {
    const isMeta = event.metaKey || event.ctrlKey;

    if (!isMeta) {
      this.defaultBehaviour(event);

      return;
    }

    // Prevent double-firing within 50ms
    const now = Date.now();

    if (now - this.lastUndoRedoTime < 50) {
      event.preventDefault();

      return;
    }
    this.lastUndoRedoTime = now;

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      this.Blok.YjsManager.redo();
    } else {
      this.Blok.YjsManager.undo();
    }
  }

  /**
   * Enter pressed on document
   * @param {KeyboardEvent} event - keyboard event
   */
  private enterPressed(event: KeyboardEvent): void {
    const { BlockManager, BlockSelection, BlockEvents } = this.Blok;

    if (this.someToolbarOpened) {
      return;
    }

    /**
     * If navigation mode is enabled, delegate to BlockEvents to handle Enter.
     * This will set the caret at the end of the current block.
     */
    if (BlockSelection.navigationModeEnabled) {
      BlockEvents.keydown(event);

      return;
    }

    const hasPointerToBlock = BlockManager.currentBlockIndex >= 0;

    const selectionExists = Selection.isSelectionExists;
    const selectionCollapsed = Selection.isCollapsed;

    /**
     * If any block selected and selection doesn't exists on the page (that means no other editable element is focused),
     * remove selected blocks
     */
    if (BlockSelection.anyBlockSelected && (!selectionExists || selectionCollapsed === true)) {
      /** Clear selection */
      BlockSelection.clearSelection(event);

      /**
       * Stop propagations
       * Manipulation with BlockSelections is handled in global enterPress because they may occur
       * with CMD+A or RectangleSelection
       */
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      return;
    }

    /**
     * If Caret is not set anywhere, event target on Enter is always Element that we handle
     * In our case it is document.body
     *
     * So, BlockManager points some Block and Enter press is on Body
     * We can create a new block
     */
    if (!this.someToolbarOpened && hasPointerToBlock && (event.target as HTMLElement).tagName === 'BODY') {
      /**
       * Insert the default typed Block
       */
      const newBlock = this.Blok.BlockManager.insert();

      /**
       * Prevent default enter behaviour to prevent adding a new line (<div><br></div>) to the inserted block
       */
      event.preventDefault();
      this.Blok.Caret.setToBlock(newBlock);

      /**
       * Move toolbar and show plus button because new Block is empty
       */
      this.Blok.Toolbar.moveAndOpen(newBlock);
    }

    this.Blok.BlockSelection.clearSelection(event);
  }

  /**
   * All clicks on document
   * @param {MouseEvent} event - Click event
   */
  private documentClicked(event: MouseEvent): void {
    /**
     * Sometimes we emulate click on some UI elements, for example by Enter on Block Settings button
     * We don't need to handle such events, because they handled in other place.
     */
    if (!event.isTrusted) {
      return;
    }
    /**
     * Close Inline Toolbar when nothing selected
     * Do not fire check on clicks at the Inline Toolbar buttons
     */
    const target = event.target as HTMLElement;
    const clickedInsideOfBlok = this.nodes.holder.contains(target) || Selection.isAtBlok;
    const clickedInsideRedactor = this.nodes.redactor.contains(target);
    const clickedInsideToolbar = this.Blok.Toolbar.contains(target);
    const clickedInsideInlineToolbar = this.Blok.InlineToolbar.containsNode(target);
    const clickedInsideBlokSurface = clickedInsideOfBlok || clickedInsideToolbar;

    /**
     * Check if click is on Block Settings, Settings Toggler, or Plus Button
     * These elements have their own click handlers and should not trigger default behavior
     */
    const isClickedInsideBlockSettings = this.Blok.BlockSettings.contains(target);
    const isClickedInsideBlockSettingsToggler = this.Blok.Toolbar.nodes.settingsToggler?.contains(target);
    const isClickedInsidePlusButton = this.Blok.Toolbar.nodes.plusButton?.contains(target);
    const doNotProcess = isClickedInsideBlockSettings || isClickedInsideBlockSettingsToggler || isClickedInsidePlusButton;

    const shouldClearCurrentBlock = !clickedInsideBlokSurface || (!clickedInsideRedactor && !clickedInsideToolbar);

    /**
     * Don't clear current block when clicking on settings toggler, plus button, or inside block settings
     * These elements need the current block to function properly
     */
    if (shouldClearCurrentBlock && !doNotProcess) {
      /**
       * Clear pointer on BlockManager
       *
       * Current page might contain several instances
       * Click between instances MUST clear focus, pointers and close toolbars
       */
      this.Blok.BlockManager.unsetCurrentBlock();
      this.Blok.Toolbar.close();
    }

    const shouldCloseBlockSettings = this.Blok.BlockSettings.opened && !doNotProcess;
    if (shouldCloseBlockSettings) {
      this.Blok.BlockSettings.close();
    }

    if (shouldCloseBlockSettings && clickedInsideRedactor) {
      const clickedBlock = this.Blok.BlockManager.getBlockByChildNode(target);
      this.Blok.Toolbar.moveAndOpen(clickedBlock);
    }

    /**
     * Clear Selection if user clicked somewhere
     * But preserve selection when clicking on block settings toggler or inside block settings
     * to allow multi-block operations like conversion
     */
    if (!doNotProcess) {
      this.Blok.BlockSelection.clearSelection(event);
    }

    /**
     * Close Inline Toolbar when clicking outside of it
     * This handles clicks anywhere outside the inline toolbar,
     * including inside the editor content area or on page controls
     */
    if (this.Blok.InlineToolbar.opened && !clickedInsideInlineToolbar) {
      this.Blok.InlineToolbar.close();
    }
  }

  /**
   * First touch on blok
   * Fired before click
   *
   * Used to change current block — we need to do it before 'selectionChange' event.
   * Also:
   * - Move and show the Toolbar
   * - Set a Caret
   * @param event - touch or mouse event
   */
  private documentTouched(event: Event): void {
    const initialTarget = event.target as HTMLElement;

    /**
     * If click was fired on Blok`s wrapper, try to get clicked node by elementFromPoint method
     */
    const clickedNode = (() => {
      if (initialTarget !== this.nodes.redactor) {
        return initialTarget;
      }

      if (event instanceof MouseEvent) {
        const nodeFromPoint = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;

        return nodeFromPoint ?? initialTarget;
      }

      if (event instanceof TouchEvent && event.touches.length > 0) {
        const { clientX, clientY } = event.touches[0];
        const nodeFromPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null;

        return nodeFromPoint ?? initialTarget;
      }

      return initialTarget;
    })();

    /**
     * Select clicked Block as Current
     */
    try {
      this.Blok.BlockManager.setCurrentBlockByChildNode(clickedNode);
    } catch (_e) {
      /**
       * If clicked outside first-level Blocks and it is not RectSelection, set Caret to the last empty Block
       */
      if (!this.Blok.RectangleSelection.isRectActivated()) {
        this.Blok.Caret.setToTheLastBlock();
      }
    }

    /**
     * Move and open toolbar
     * (used for showing Block Settings toggler after opening and closing Inline Toolbar)
     */
    if (!this.Blok.ReadOnly.isEnabled && !this.Blok.Toolbar.contains(initialTarget)) {
      this.Blok.Toolbar.moveAndOpen(undefined, clickedNode);
    }
  }

  /**
   * All clicks on the redactor zone
   * @param {MouseEvent} event - click event
   * @description
   * - By clicks on the Blok's bottom zone:
   *      - if last Block is empty, set a Caret to this
   *      - otherwise, add a new empty Block and set a Caret to that
   */
  private redactorClicked(event: MouseEvent): void {
    if (!Selection.isCollapsed) {
      return;
    }

    /**
     * case when user clicks on anchor element
     * if it is clicked via ctrl key, then we open new window with url
     */
    const element = event.target as Element;
    const ctrlKey = event.metaKey || event.ctrlKey;
    const shouldOpenAnchorInNewTab = $.isAnchor(element) && ctrlKey;

    if (!shouldOpenAnchorInNewTab) {
      this.processBottomZoneClick(event);

      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();

    const href = element.getAttribute('href');

    if (!href) {
      return;
    }

    const validUrl = getValidUrl(href);

    openTab(validUrl);
  }

  /**
   * Check if user clicks on the Blok's bottom zone:
   * - set caret to the last block
   * - or add new empty block
   * @param event - click event
   */
  private processBottomZoneClick(event: MouseEvent): void {
    const lastBlock = this.Blok.BlockManager.getBlockByIndex(-1);

    const lastBlockBottomCoord = $.offset(lastBlock.holder).bottom;
    const clickedCoord = event.pageY;
    const { BlockSelection } = this.Blok;
    const isClickedBottom = event.target instanceof Element &&
      event.target.isEqualNode(this.nodes.redactor) &&
      /**
       * If there is cross block selection started, target will be equal to redactor so we need additional check
       */
      !BlockSelection.anyBlockSelected &&

      /**
       * Prevent caret jumping (to last block) when clicking between blocks
       */
      lastBlockBottomCoord < clickedCoord;

    if (!isClickedBottom) {
      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();

    const { BlockManager, Caret, Toolbar } = this.Blok;

    /**
     * Insert a default-block at the bottom if:
     * - last-block is not a default-block (Text)
     *   to prevent unnecessary tree-walking on Tools with many nodes (for ex. Table)
     * - Or, default-block is not empty
     */
    if (!BlockManager.lastBlock?.tool.isDefault || !BlockManager.lastBlock?.isEmpty) {
      BlockManager.insertAtEnd();
    }

    /**
     * Set the caret and toolbar to empty Block
     */
    Caret.setToTheLastBlock();
    Toolbar.moveAndOpen(BlockManager.lastBlock);
  }

  /**
   * Handle selection changes on mobile devices
   * Uses for showing the Inline Toolbar
   */
  private selectionChanged(): void {
    const { CrossBlockSelection, BlockSelection } = this.Blok;
    const focusedElement = Selection.anchorElement;

    if (CrossBlockSelection.isCrossBlockSelectionStarted && BlockSelection.anyBlockSelected) {
      // Removes all ranges when any Block is selected
      Selection.get()?.removeAllRanges();
    }

    /**
     * Ignore transient selection changes triggered by fake background wrappers (used by inline tools
     * like Convert) while the Inline Toolbar is already open. Otherwise, the toolbar gets torn down
     * and re-rendered, which closes nested popovers before a user can click their items.
     */
    const hasFakeBackground = document.querySelector('[data-blok-fake-background="true"]') !== null;

    if (hasFakeBackground && this.Blok?.InlineToolbar?.opened) {
      return;
    }

    /**
     * Usual clicks on some controls, for example, Block Tunes Toggler
     */
    if (!focusedElement && !Selection.range) {
      /**
       * If there is no selected range, close inline toolbar
       * @todo Make this method more straightforward
       */
      this.Blok.InlineToolbar.close();
    }

    if (!focusedElement) {
      return;
    }

    /**
     * Event can be fired on clicks at non-block-content elements,
     * for example, at the Inline Toolbar or some Block Tune element.
     * We also make sure that the closest block belongs to the current blok and not a parent
     */
    const closestBlock = focusedElement.closest('[data-blok-testid="block-content"]');
    const clickedOutsideBlockContent = closestBlock === null || (closestBlock.closest('[data-blok-testid="blok-editor"]') !== this.nodes.wrapper);

    const inlineToolbarEnabledForExternalTool = (focusedElement as HTMLElement).getAttribute('data-blok-inline-toolbar') === 'true';
    const shouldCloseInlineToolbar = clickedOutsideBlockContent && !this.Blok.InlineToolbar.containsNode(focusedElement);

    /**
     * If the inline toolbar is already open without a nested popover,
     * don't close or re-render it. This prevents the toolbar from flickering
     * when the user closes a nested popover (e.g., via Esc key).
     *
     * However, if the selection is now collapsed or empty (e.g., user deleted the selected text),
     * we should close the inline toolbar since there's nothing to format.
     *
     * Important: Don't close the toolbar if a flipper item is focused (user is navigating
     * with Tab/Arrow keys). In some browsers (webkit), keyboard navigation within the
     * popover can trigger selectionchange events that make the selection appear empty.
     */
    const currentSelection = Selection.get();
    const selectionIsEmpty = !currentSelection || currentSelection.isCollapsed || Selection.text.length === 0;
    const hasFlipperFocus = this.Blok.InlineToolbar.hasFlipperFocus;

    if (selectionIsEmpty && this.Blok.InlineToolbar.opened && !hasFlipperFocus) {
      this.Blok.InlineToolbar.close();

      return;
    }

    if (this.Blok.InlineToolbar.opened && !this.Blok.InlineToolbar.hasNestedPopoverOpen) {
      return;
    }

    if (shouldCloseInlineToolbar) {
      /**
       * If new selection is not on Inline Toolbar, we need to close it
       */
      this.Blok.InlineToolbar.close();
    }

    if (clickedOutsideBlockContent && !inlineToolbarEnabledForExternalTool) {
      /**
       * Case when we click on external tool elements,
       * for example some Block Tune element.
       * If this external content editable element has data-inline-toolbar="true"
       */
      return;
    }

    /**
     * Set current block when entering to Blok by tab key
     */
    if (!this.Blok.BlockManager.currentBlock) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(focusedElement);
    }

    void this.Blok.InlineToolbar.tryToShow(true);
  }

  /**
   * Blok provides and ability to show placeholders for empty contenteditable elements
   *
   * This method watches for input and focus events and toggles 'data-blok-empty' attribute
   * to workaroud the case, when inputs contains only <br>s and has no visible content
   * Then, CSS could rely on this attribute to show placeholders
   */
  private enableInputsEmptyMark(): void {
    /**
     * Toggle data-blok-empty attribute on input depending on its emptiness
     * @param event - input or focus event
     */
    const handleInputOrFocusChange = (event: Event): void => {
      const input = event.target as HTMLElement;

      toggleEmptyMark(input);
    };

    this.readOnlyMutableListeners.on(this.nodes.wrapper, 'input', handleInputOrFocusChange);
    this.readOnlyMutableListeners.on(this.nodes.wrapper, 'focusin', handleInputOrFocusChange);
    this.readOnlyMutableListeners.on(this.nodes.wrapper, 'focusout', handleInputOrFocusChange);
  }
}
