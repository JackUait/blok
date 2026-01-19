
/**
 * Module UI
 * @type {UI}
 */
import styles from '../../styles/main.css?inline';
import { Module } from '../__module';
import {
  DATA_ATTR,
  BLOK_INTERFACE_VALUE,
} from '../constants';
import { Dom as $, toggleEmptyMark } from '../dom';
import { BlokMobileLayoutToggled } from '../events';
import { Flipper } from '../flipper';
import { SelectionUtils as Selection } from '../selection/index';
import { debounce, getValidUrl, isEmpty, openTab, mobileScreenBreakpoint } from '../utils';
import { destroyAnnouncer, registerAnnouncer } from '../utils/announcer';

// Controllers and handlers
import { BlockHoverController } from './uiControllers/controllers/blockHover';
import { KeyboardController } from './uiControllers/controllers/keyboard';
import { SelectionController } from './uiControllers/controllers/selection';
import { createDocumentClickedHandler } from './uiControllers/handlers/click';
import { createRedactorTouchHandler } from './uiControllers/handlers/touch';

/**
 * HTML Elements used for UI
 */
interface UINodes extends Record<string, unknown> {
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
   * Controllers for UI state management
   */
  private keyboardController: KeyboardController | null = null;
  private selectionController: SelectionController | null = null;
  private blockHoverController: BlockHoverController | null = null;

  /**
   * Handlers for simple event behaviors
   */
  private documentClickedHandler: ((event: MouseEvent) => void) | null = null;
  private redactorTouchHandler: ((event: Event) => void) | null = null;

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

    /**
     * Initialize controllers after Blok modules are ready
     */
    this.initializeControllers();

    /**
     * Enable selection controller after initialization.
     * This is needed because bindReadOnlyInsensitiveListeners() is called in make()
     * before initializeControllers(), so the selectionController doesn't exist yet.
     */
    this.selectionController?.enable();
  }

  /**
   * Initialize controllers with their dependencies
   */
  private initializeControllers(): void {
    /**
     * Keyboard controller needs someToolbarOpened callback to avoid circular dependencies
     */
    this.keyboardController = new KeyboardController({
      config: this.config,
      eventsDispatcher: this.eventsDispatcher,
      someToolbarOpened: () => this.someToolbarOpened,
    });
    this.keyboardController.state = this.Blok;
    this.keyboardController.setRedactorElement(this.nodes.redactor);

    /**
     * Selection controller needs wrapper element for click detection
     */
    this.selectionController = new SelectionController({
      config: this.config,
      eventsDispatcher: this.eventsDispatcher,
    });
    this.selectionController.state = this.Blok;
    this.selectionController.setWrapperElement(this.nodes.wrapper);

    /**
     * Block hover controller needs content rect getter and RTL flag
     */
    this.blockHoverController = new BlockHoverController({
      config: this.config,
      eventsDispatcher: this.eventsDispatcher,
      contentRectGetter: () => this.contentRect,
      isRtl: this.isRtl,
    });
    this.blockHoverController.state = this.Blok;

    /**
     * Create handlers for click and touch events
     */
    this.documentClickedHandler = createDocumentClickedHandler({
      Blok: this.Blok,
      nodes: {
        holder: this.nodes.holder,
        redactor: this.nodes.redactor,
      },
    });

    this.redactorTouchHandler = createRedactorTouchHandler({
      Blok: this.Blok,
      redactorElement: this.nodes.redactor,
    });
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

    /**
     * Type guard to check if a module has a flipper property
     */
    const hasFlipper = (module: unknown): module is { flipper: Flipper } => {
      return typeof module === 'object' && module !== null && 'flipper' in module && module.flipper instanceof Flipper;
    };

    return Object.values(this.Blok).some((moduleClass) => {
      return hasFlipper(moduleClass) && moduleClass.flipper.hasFocus();
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
    if (this.redactorTouchHandler) {
      this.redactorTouchHandler(event);
    }
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
    this.listeners.off(window, 'resize', this.resizeDebouncer);
    this.listeners.off(this.nodes.redactor, 'mousedown', this.documentTouchedListener);
    this.listeners.off(this.nodes.redactor, 'touchstart', this.documentTouchedListener);

    /**
     * Disable selection controller
     */
    this.selectionController?.disable();
  }


  /**
   * Adds listeners that should work only in read-only mode
   */
  private bindReadOnlySensitiveListeners(): void {
    /**
     * Redactor click handler for bottom zone clicks
     */
    this.readOnlyMutableListeners.on(this.nodes.redactor, 'click', (event: Event) => {
      if (event instanceof MouseEvent) {
        this.redactorClicked(event);
      }
    }, false);

    /**
     * Document click handler - uses the click handler from handlers/click.ts
     */
    this.readOnlyMutableListeners.on(document, 'mousedown', (event: Event) => {
      if (event instanceof MouseEvent && this.documentClickedHandler) {
        this.documentClickedHandler(event);
      }
    }, true);

    /**
     * Enable keyboard controller for document keydown handling
     * Keyboard controller also handles beforeinput and caret capture
     */
    this.keyboardController?.enable();

    /**
     * Enable block hover controller for block hover detection
     */
    this.blockHoverController?.enable();

    /**
     * We have custom logic for providing placeholders for contenteditable elements.
     * To make it work, we need to have data-blok-empty mark on empty inputs.
     */
    this.enableInputsEmptyMark();
  }


  /**
   * Unbind events that should work only in read-only mode
   */
  private unbindReadOnlySensitiveListeners(): void {
    this.readOnlyMutableListeners.clearAll();

    /**
     * Disable keyboard controller
     */
    this.keyboardController?.disable();

    /**
     * Disable block hover controller
     */
    this.blockHoverController?.disable();
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

    if (lastBlock === undefined) {
      return;
    }

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
