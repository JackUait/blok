
/**
 * Module UI
 * @type {UI}
 */
import type { EditorWidth } from '../../../types/api/width';
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
import { LinkHoverCard } from '../utils/link-hover-card';
import { hasUnsafeScheme } from '../utils/sanitize-url';

// Controllers and handlers
import { BlockHoverController } from './uiControllers/controllers/blockHover';
import { KeyboardController } from './uiControllers/controllers/keyboard';
import { SelectionController } from './uiControllers/controllers/selection';
import { createDocumentClickedHandler } from './uiControllers/handlers/click';
import { createRedactorTouchHandler } from './uiControllers/handlers/touch';
import { ToggleShortcuts } from '../../tools/toggle/toggle-shortcuts';

/**
 * Classes that hide an empty, focused block's placeholder while the toolbox is open.
 *
 * Each rule is gated on the wrapper carrying `data-blok-toolbox-opened=true`, plus a
 * focused editable block, and targets the placeholder attribute the tool ACTUALLY renders:
 *   - paragraph → `data-blok-placeholder-active`
 *   - header    → `data-placeholder`
 *
 * Both attributes must be covered; the historical `[data-blok-placeholder]` selector
 * matched neither and was inert, leaving the placeholder visible behind the + menu.
 */
export const PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES: string[] = [
  '[&[data-blok-toolbox-opened=true]_[contentEditable=true][data-blok-placeholder-active]:focus]:before:opacity-0!',
  '[&[data-blok-toolbox-opened=true]_[contentEditable=true][data-placeholder]:focus]:before:opacity-0!',
];

/**
 * HTML Elements used for UI
 */
interface UINodes extends Record<string, unknown> {
  holder: HTMLElement;
  wrapper: HTMLElement;
  redactor: HTMLElement;
  bottomZone: HTMLElement;
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
  private toggleShortcuts: ToggleShortcuts | null = null;

  /**
   * Hoverable card shown when the pointer rests on a link while editing —
   * surfaces the destination URL with copy/edit actions, mirroring the
   * read-only "clickable link" affordance. Created lazily once modules (I18n)
   * are ready. Only active in edit mode (its listeners live on
   * {@link readOnlyMutableListeners}).
   */
  private linkHoverCard: LinkHoverCard | null = null;

  /**
   * Handlers for simple event behaviors
   */
  private documentClickedHandler: ((event: MouseEvent) => void) | null = null;
  private redactorTouchHandler: ((event: Event) => void) | null = null;

  /** Unique style tag ID for this instance's font override, derived from the holder element */
  private fontStyleTagId: string | null = null;

  /**
   * Reset the block hover state (used after drag cancellation to allow toolbar to show again)
   */
  public resetBlockHoverState(): void {
    this.blockHoverController?.resetHoverState();
  }

  /**
   * Temporarily disable hover detection for a cooldown period.
   * Used after cross-block selection to prevent spurious hover events.
   */
  public disableHoverForCooldown(): void {
    this.blockHoverController?.disableHoverForCooldown();
  }

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
    this.loadFontStyles();

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
     * Must happen before toggleShortcuts.register() so that a shortcut registration
     * error cannot prevent the selectionchange listener from being set up.
     */
    this.selectionController?.enable();

    /**
     * Register toggle shortcuts (CMD+ALT+T) for collapsing/expanding all toggle blocks.
     * Wrapped in try-catch because the Shortcuts singleton may throw if shortcuts are
     * already registered (e.g. race condition with multiple editor instances in CI).
     * This is non-critical — the editor works fine without toggle shortcuts.
     */
    this.toggleShortcuts = new ToggleShortcuts(
      this.Blok.API.methods,
      this.nodes.wrapper
    );

    try {
      this.toggleShortcuts.register();
    } catch (error) {
      console.warn('Blok: Failed to register toggle shortcuts:', error);
    }
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
    this.keyboardController.setWrapperElement(this.nodes.wrapper);

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
     * Block hover controller detects hover over blocks and finds nearest block
     */
    this.blockHoverController = new BlockHoverController({
      config: this.config,
      eventsDispatcher: this.eventsDispatcher,
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
   * - sets contenteditable="false" on all block content elements
   *
   * if readOnly is false:
   * - enables all listeners to UI module elements
   * - sets contenteditable="true" on all block content elements
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    /**
     * Collapse the bottom zone in read-only mode. Its only purpose is to act as
     * a clickable area below the last block for adding/focusing a block, which is
     * disabled in read-only mode. Restore the configured min-height when editing.
     */
    if (this.nodes.bottomZone) {
      this.nodes.bottomZone.style.minHeight = readOnlyEnabled ? '0px' : `${this.config.minHeight}px`;
    }

    /**
     * Prepare components based on read-only state
     */
    if (readOnlyEnabled) {
      /**
       * Unbind editing-only events but keep block hover active so the toolbar
       * can still appear on hover (used by the read-only "copy link to block"
       * popover; see Toolbar.toggleReadOnly).
       */
      this.unbindReadOnlySensitiveListeners({ keepBlockHover: true });

      /**
       * Ensure block hover detection is active even when the editor starts in
       * read-only mode — bindReadOnlySensitiveListeners() was never called in
       * that path.
       */
      this.blockHoverController?.enable();

      /**
       * Set contenteditable="false" on all block content elements
       */
      this.updateBlocksContentEditable(false);

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

    /**
     * Set contenteditable="true" on all block content elements
     */
    this.updateBlocksContentEditable(true);

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
   * Update contenteditable attribute on all block content elements
   * @param editable - whether blocks should be editable
   */
  private updateBlocksContentEditable(editable: boolean): void {
    const { BlockManager } = this.Blok;

    for (const block of BlockManager.blocks) {
      // Exclude mutation-free decorations (e.g. a list item's bullet/number
      // marker, which is deliberately contenteditable="false"). Without this,
      // querySelector('[contenteditable]') would grab the marker — the first
      // `[contenteditable]` in the holder — and flip it editable, later letting
      // a block split overwrite the bullet glyph with the item's own text.
      const contentEditable = block.holder.querySelector<HTMLElement>(
        '[contenteditable]:not([data-blok-mutation-free])'
      );

      if (contentEditable) {
        contentEditable.contentEditable = editable ? 'true' : 'false';
      }
    }
  }

  /**
   * Check if Blok is empty and set data attribute on wrapper
   */
  public checkEmptiness(): void {
    const { BlockManager } = this.Blok;

    this.nodes.wrapper.setAttribute(DATA_ATTR.empty, BlockManager.isBlokEmpty ? 'true' : 'false');
  }

  /**
   * Current editor content width mode. Defaults to 'narrow'.
   */
  private widthMode: EditorWidth = 'narrow';

  /**
   * Returns the current editor content width mode.
   */
  public getWidthMode(): EditorWidth {
    return this.widthMode;
  }

  /**
   * Sets the editor content width mode by writing the width data attribute on
   * the editor wrapper. 'narrow' (the default) leaves the attribute absent so
   * the content keeps its `--max-width-content` constraint; 'full' adds it so
   * the dedicated CSS rule removes the constraint.
   * @param mode - the width mode to apply
   */
  public setWidthMode(mode: EditorWidth): void {
    this.widthMode = mode;

    if (mode === 'full') {
      this.nodes.wrapper.setAttribute(DATA_ATTR.width, 'full');
    } else {
      this.nodes.wrapper.removeAttribute(DATA_ATTR.width);
    }
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
    this.toggleShortcuts?.unregister();
    this.nodes.holder.innerHTML = '';

    this.unbindReadOnlyInsensitiveListeners();
    this.unbindReadOnlySensitiveListeners();

    this.linkHoverCard?.destroy();
    this.linkHoverCard = null;

    // Remove the per-instance font style tag to prevent leaks in SPAs
    if (this.fontStyleTagId !== null) {
      const fontStyleTag = $.get(this.fontStyleTagId);
      if (fontStyleTag) {
        fontStyleTag.remove();
      }
    }

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
   * Link hover card show/hide handlers. Kept as stable references (not inline
   * wrappers) so they can be bound to the read-only-insensitive listener set:
   * the card must appear on hover in both edit and read-only modes.
   */
  private anchorMouseOverListener = (event: Event): void => {
    if (event instanceof MouseEvent) {
      this.handleAnchorMouseOver(event);
    }
  };

  private anchorMouseOutListener = (event: Event): void => {
    if (event instanceof MouseEvent) {
      this.handleAnchorMouseOut(event);
    }
  };

  /**
   * Right-click inside block content opens the block context menu (Block
   * Settings) anchored at the cursor, mirroring a desktop application. This is
   * a hover-independent path to the block menu that avoids the "wrong block"
   * race in the hover-driven settings toggler.
   *
   * The native context menu is left intact on interactive and media elements
   * (links, form fields, images, media) where it carries real value — only
   * plain block content is hijacked.
   * @param event - contextmenu event
   */
  private redactorContextMenu = (event: Event): void => {
    if (!(event instanceof MouseEvent)) {
      return;
    }

    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('a, input, textarea, select, img, video, audio')) {
      return;
    }

    const block = this.Blok.BlockManager.setCurrentBlockByChildNode(target);

    if (block === undefined) {
      return;
    }

    event.preventDefault();

    const { BlockSettings, Toolbar } = this.Blok;

    /**
     * Anchor the toolbar to the right-clicked block (moveAndOpen also closes any
     * already-open settings menu, so a second right-click repositions cleanly),
     * then open Block Settings at the cursor via a zero-size virtual rect.
     */
    Toolbar.moveAndOpen(block);

    void BlockSettings.open(block, new DOMRect(event.clientX, event.clientY, 0, 0));
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
      'z-1',
      'data-[blok-dragging=true]:cursor-grabbing',
      // SVG defaults
      '[&_svg]:max-h-full',
      '[&_path]:stroke-current',
      // Native selection color
      '[&_::selection]:bg-selection-inline',
      // Hide placeholder when toolbox is opened
      ...PLACEHOLDER_HIDE_ON_TOOLBOX_CLASSES,
      ...(this.isRtl ? [ '[direction:rtl]' ] : []),
    ]);
    this.nodes.wrapper.setAttribute(DATA_ATTR.interface, BLOK_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute(DATA_ATTR.editor, '');
    this.nodes.wrapper.setAttribute('data-blok-testid', 'blok-editor');
    this.nodes.wrapper.setAttribute(DATA_ATTR.contentAlign, this.config.style?.contentAlign ?? 'left');
    if (this.isRtl) {
      this.nodes.wrapper.setAttribute(DATA_ATTR.rtl, 'true');
    }
    this.nodes.redactor = $.make('div', [
      // Firefox empty contenteditable fix
      '[&_[contenteditable]:empty]:after:content-["\\feff_"]',
    ]);
    this.nodes.redactor.setAttribute(DATA_ATTR.redactor, '');
    this.nodes.redactor.setAttribute('data-blok-testid', 'redactor');

    /**
     * Create dedicated bottom zone element
     */
    this.nodes.bottomZone = $.make('div', ['cursor-text']);
    this.nodes.bottomZone.setAttribute('data-blok-bottom-zone', '');
    this.nodes.bottomZone.setAttribute('data-blok-testid', 'bottom-zone');
    this.nodes.bottomZone.style.minHeight = this.config.minHeight + 'px';

    this.nodes.wrapper.appendChild(this.nodes.redactor);
    this.nodes.wrapper.appendChild(this.nodes.bottomZone);
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
     * Declare the canonical Tailwind cascade-layer order up front.
     *
     * This stylesheet imports Tailwind utilities into `@layer utilities` (see
     * src/styles/main.css) and is PREPENDED as the first <style> in <head>, so
     * it is what first REGISTERS the `utilities` layer. CSS fixes layer order by
     * first declaration, so without this statement a host Tailwind app's own
     * `@layer theme, base, components, utilities;` (running later) would append
     * `base` AFTER the already-registered `utilities` — inverting the order and
     * letting the host's preflight `base` resets (h1{font-size:inherit}, list
     * resets, …) beat every utility class the moment the editor mounts.
     *
     * Declaring the full canonical order here, before any `@layer` block, pins
     * `base` before `utilities` so a host Tailwind app keeps its intended
     * cascade. Inert for non-Tailwind hosts and for Blok used standalone.
     */
    const layerOrder =
      '@layer properties;\n@layer theme, base, components, utilities;\n';

    /**
     * Make tag
     */
    const tag = $.make('style', null, {
      id: styleTagId,
      textContent: layerOrder + styles.toString(),
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
   * Injects font-family override stylesheets when any config.style font field is set.
   * Handles: --blok-font-family (legacy), --blok-font-sans, --blok-font-serif,
   * --blok-font-mono, and --blok-font-handwriting.
   */
  private loadFontStyles(): void {
    const style = this.config.style;
    const hasAnyFont =
      style?.fontFamily ||
      style?.fontFamilySans ||
      style?.fontFamilySerif ||
      style?.fontFamilyMono ||
      style?.fontFamilyHandwriting;

    if (!hasAnyFont) {
      return;
    }

    const holderId = this.nodes.holder.id !== '' ? this.nodes.holder.id : (this.nodes.wrapper.dataset['blokInterface'] ?? 'default');
    const styleTagId = `blok-font-${holderId}`;

    this.fontStyleTagId = styleTagId;

    if ($.get(styleTagId)) {
      return;
    }

    const varLines: string[] = [];

    if (style.fontFamily)            varLines.push(`  --blok-font-family: ${style.fontFamily};`);
    if (style.fontFamilySans)        varLines.push(`  --blok-font-sans: ${style.fontFamilySans};`);
    if (style.fontFamilySerif)       varLines.push(`  --blok-font-serif: ${style.fontFamilySerif};`);
    if (style.fontFamilyMono)        varLines.push(`  --blok-font-mono: ${style.fontFamilyMono};`);
    if (style.fontFamilyHandwriting) varLines.push(`  --blok-font-handwriting: ${style.fontFamilyHandwriting};`);

    const vars = varLines.join('\n');
    const css = [
      `[data-blok-interface=blok], [data-blok-interface=tooltip] {`,
      vars,
      `}`,
      `[data-blok-popover]:not([data-blok-popover-inline]) {`,
      vars,
      `}`,
    ].join('\n');

    const tag = $.make('style', null, {
      id: styleTagId,
      textContent: css,
    });

    if (this.config.style?.nonce) {
      tag.setAttribute('nonce', this.config.style.nonce);
    }

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

    this.listeners.on(this.nodes.redactor, 'contextmenu', this.redactorContextMenu);

    /**
     * Link hover card — show it while the pointer rests on a link, hide it once
     * the pointer leaves both the link and the card. mouseover/mouseout bubble,
     * so a single delegated pair covers every anchor in the redactor. Bound here
     * (read-only-insensitive) so the card also appears in read-only mode, where
     * it omits its edit affordance (see the hover card's canEdit).
     */
    this.listeners.on(this.nodes.redactor, 'mouseover', this.anchorMouseOverListener);
    this.listeners.on(this.nodes.redactor, 'mouseout', this.anchorMouseOutListener);
  }

  /**
   * Removes listeners that should work both in read-only and read-write modes
   */
  private unbindReadOnlyInsensitiveListeners(): void {
    this.listeners.off(window, 'resize', this.resizeDebouncer);
    this.listeners.off(this.nodes.redactor, 'mousedown', this.documentTouchedListener);
    this.listeners.off(this.nodes.redactor, 'touchstart', this.documentTouchedListener);
    this.listeners.off(this.nodes.redactor, 'contextmenu', this.redactorContextMenu);
    this.listeners.off(this.nodes.redactor, 'mouseover', this.anchorMouseOverListener);
    this.listeners.off(this.nodes.redactor, 'mouseout', this.anchorMouseOutListener);

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
     * Bottom zone click handler — creates new block when clicking below last block
     */
    this.readOnlyMutableListeners.on(this.nodes.bottomZone, 'click', (event: Event) => {
      if (event instanceof MouseEvent) {
        this.bottomZoneClicked(event);
      }
    }, false);

    /**
     * Redactor click handler for anchor navigation (plain or Ctrl+click)
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
   * @param options - when keepBlockHover is true, the block-hover controller
   * stays enabled so the toolbar can still appear on hover. Used when entering
   * read-only mode; editor destroy still disables everything.
   */
  private unbindReadOnlySensitiveListeners(options?: { keepBlockHover?: boolean }): void {
    this.readOnlyMutableListeners.clearAll();

    /**
     * Reset any visible hover card when the mode changes: entering read-only
     * must drop the edit-mode card so the next hover re-renders it without the
     * edit affordance. The hover listeners themselves persist (they are
     * read-only-insensitive), so the card still appears in read-only mode.
     */
    this.linkHoverCard?.hide();

    /**
     * Disable keyboard controller
     */
    this.keyboardController?.disable();

    /**
     * Disable block hover controller unless the caller opted to keep it alive.
     */
    if (options?.keepBlockHover !== true) {
      this.blockHoverController?.disable();
    }
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
   * Handle click on the bottom zone element below the last block.
   * Creates a new default block if needed, focuses the last block, and opens the toolbar.
   */
  private bottomZoneClicked(event: MouseEvent): void {
    if (!Selection.isCollapsed) {
      return;
    }

    const { BlockSelection, BlockManager, Caret, Toolbar } = this.Blok;

    if (BlockSelection.anyBlockSelected) {
      return;
    }

    if (!BlockManager.lastBlock) {
      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();

    /**
     * Insert a default-block at the bottom if:
     * - last-block is not a default-block (Text)
     * - Or, default-block is not empty
     */
    if (!BlockManager.lastBlock.tool.isDefault || !BlockManager.lastBlock.isEmpty) {
      BlockManager.insertAtEnd();
    }

    Caret.setToTheLastBlock();
    Toolbar.moveAndOpen(BlockManager.lastBlock);
  }

  /**
   * Open a link on click, mirroring read-only mode where anchors are natively
   * clickable. A plain left-click on a link navigates; a modifier click still
   * works too. Text selection (a non-collapsed range, e.g. drag-selecting the
   * link text) is left untouched so the link stays editable.
   */
  private redactorClicked(event: MouseEvent): void {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a');

    if (!(anchor instanceof HTMLAnchorElement) || !this.nodes.redactor.contains(anchor)) {
      return;
    }

    /**
     * Only the primary button navigates. A modifier click always opens; a plain
     * click opens only when the selection is collapsed, so drag-selecting the
     * link's text to edit it does not fire off a navigation.
     */
    const isModifierClick = event.metaKey || event.ctrlKey;

    if (event.button !== 0) {
      return;
    }

    if (!isModifierClick && !Selection.isCollapsed) {
      return;
    }

    const href = anchor.getAttribute('href');

    if (!href) {
      return;
    }

    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();

    this.linkHoverCard?.hide();

    this.openLink(href);
  }

  /**
   * Open a link href in a new tab, refusing schemes that execute script when
   * followed (`javascript:`, `data:text/html`, …). Anchors can carry such a
   * href when created outside the inline Link tool's creation-time guard (paste,
   * import, programmatic data), so the click path that follows them must
   * re-check — otherwise a plain click is click-to-XSS.
   * @param href - the raw anchor href
   */
  private openLink(href: string): void {
    if (hasUnsafeScheme(href)) {
      return;
    }

    openTab(getValidUrl(href));
  }

  /**
   * Lazily build the link hover card once modules (I18n / Notifier) are ready.
   */
  private ensureLinkHoverCard(): LinkHoverCard {
    if (this.linkHoverCard === null) {
      this.linkHoverCard = new LinkHoverCard({
        labels: {
          copy: this.Blok.I18n.t('tools.link.copyUrl'),
          edit: this.Blok.I18n.t('tools.link.edit'),
        },
        callbacks: {
          onOpen: (href: string): void => this.openLink(href),
          onCopy: (href: string): void => {
            void this.copyLinkHref(href);
          },
          onEdit: (anchor: HTMLAnchorElement): void => {
            void this.Blok.InlineToolbar.editLink(anchor);
          },
        },
        canEdit: (): boolean => !this.Blok.ReadOnly.isEnabled,
      });
    }

    return this.linkHoverCard;
  }

  /**
   * Copy a link's destination to the clipboard and notify the user.
   * @param href - the URL to copy
   */
  private async copyLinkHref(href: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(href);
      this.Blok.NotifierAPI.methods.show({
        message: this.Blok.I18n.t('tools.link.urlCopied'),
        style: 'success',
        time: 2000,
      });
    } catch {
      this.Blok.NotifierAPI.methods.show({
        message: this.Blok.I18n.t('tools.link.copyFailed'),
        style: 'error',
        time: 3000,
      });
    }
  }

  /**
   * Show the link hover card when the pointer enters an anchor.
   * @param event - mouseover event delegated from the redactor
   */
  private handleAnchorMouseOver(event: MouseEvent): void {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a');

    if (!(anchor instanceof HTMLAnchorElement) || !this.nodes.redactor.contains(anchor)) {
      return;
    }

    if (!anchor.getAttribute('href')) {
      return;
    }

    const card = this.ensureLinkHoverCard();

    if (card.anchor === anchor) {
      return;
    }

    card.show(anchor, { x: event.clientX, y: event.clientY });
  }

  /**
   * Schedule hiding the link hover card when the pointer leaves an anchor.
   * Movement within the same anchor (to a child node) is ignored; the card's
   * own hover keeps it open when the pointer travels onto it.
   * @param event - mouseout event delegated from the redactor
   */
  private handleAnchorMouseOut(event: MouseEvent): void {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a');

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const related = event.relatedTarget as Node | null;

    if (related !== null && anchor.contains(related)) {
      return;
    }

    this.linkHoverCard?.scheduleHide();
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
