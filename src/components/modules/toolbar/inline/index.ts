import type { InlineTool as IInlineTool } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { ModuleConfig } from '../../../../types-internal/module-config';
import { Module } from '../../../__module';
import { DATA_ATTR, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../../constants';
import { Dom as $ } from '../../../dom';
import { SelectionUtils } from '../../../selection';
import type { InlineToolAdapter } from '../../../tools/inline';
import { isMobileScreen } from '../../../utils';
import type { Popover, PopoverItemParams } from '../../../utils/popover';
import { PopoverInline } from '../../../utils/popover/popover-inline';
import { twMerge } from '../../../utils/tw';

/**
 * Refactored InlineToolbar components
 */
import { InlineKeyboardHandler } from './keyboard-handler';
import { InlineLifecycleManager } from './lifecycle-manager';
import { InlinePopoverBuilder } from './popover-builder';
import { InlinePositioner } from './positioner';
import { InlineSelectionValidator } from './selection-validator';
import { InlineShortcutManager } from './shortcuts-manager';
import { InlineToolsManager } from './tools-manager';
import type { InlineToolbarNodes } from './types';

/**
 * Inline toolbar with actions that modifies selected text fragment
 *
 * |¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯|
 * |   B  i [link] [mark]   |
 * |________________________|
 */
export class InlineToolbar extends Module<InlineToolbarNodes> {

  /**
   * State of inline toolbar
   */
  public opened = false;

  /**
   * Returns true if a nested popover (like convert-to dropdown) is currently open
   */
  public get hasNestedPopoverOpen(): boolean {
    return this.keyboardHandler.hasNestedPopoverOpen;
  }

  /**
   * Closes only the nested popover if one is open.
   * Returns true if a nested popover was closed, false otherwise.
   */
  public closeNestedPopover(): boolean {
    return this.keyboardHandler.closeNestedPopover();
  }

  /**
   * Returns true if a flipper item is focused (user is navigating with keyboard)
   */
  public get hasFlipperFocus(): boolean {
    return this.keyboardHandler.hasFlipperFocus;
  }

  /**
   * Popover instance reference
   */
  private popover: Popover | null = null;

  /**
   * Promise that resolves when the toolbar is fully opened
   * Used to ensure shortcuts wait for popover initialization
   */
  private openingPromise: Promise<void> | null = null;

  /**
   * Helper instances
   */
  private shortcutManager: InlineShortcutManager;
  private positioner: InlinePositioner;
  private toolsManager: InlineToolsManager;
  private selectionValidator: InlineSelectionValidator;
  private popoverBuilder: InlinePopoverBuilder;
  private keyboardHandler: InlineKeyboardHandler;
  private lifecycleManager: InlineLifecycleManager;

  /**
   * Currently visible tools instances
   */
  private tools: Map<InlineToolAdapter, IInlineTool> = new Map();


  /**
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Blok's config
   * @param moduleConfiguration.eventsDispatcher - Blok's event dispatcher
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({
      config,
      eventsDispatcher,
    });

    // Initialize positioner (doesn't need Blok modules)
    this.positioner = new InlinePositioner(isMobileScreen());

    const getBlok = () => this.Blok;

    // Initialize helpers that need Blok modules
    this.shortcutManager = new InlineShortcutManager(getBlok, (toolName) =>
      this.activateToolByShortcut(toolName)
    );
    this.toolsManager = new InlineToolsManager(getBlok);
    this.selectionValidator = new InlineSelectionValidator(getBlok);
    this.popoverBuilder = new InlinePopoverBuilder(getBlok, () => this.Blok.I18n);
    this.keyboardHandler = new InlineKeyboardHandler(
      () => this.popover as PopoverInline | null,
      () => this.close()
    );
    this.lifecycleManager = new InlineLifecycleManager(getBlok, () => this.initialize());

    /**
     * Handle arrow key events for inline toolbar
     * - Close toolbar when Up/Down arrow key is pressed without Shift (allows cursor movement)
     *   but only if no toolbar item is focused (user hasn't started keyboard navigation via Tab)
     * - Left/Right arrow keys have no effect within the inline toolbar (per accessibility requirements)
     * - Show toolbar when Shift+Arrow is pressed (extends selection)
     *
     * Note: We listen on window with capture=true to ensure this runs before
     * the Flipper's keydown handler which also uses capture phase
     */
    this.listeners.on(window, 'keydown', (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;

      this.keyboardHandler.handle(keyboardEvent, this.opened);

      if (this.keyboardHandler.isShiftArrow(keyboardEvent)) {
        void this.tryToShow();
      }
    }, true);

    // Schedule initialization
    this.lifecycleManager.schedule();
    this.shortcutManager.tryRegisterShortcuts();
  }

  /**
   * Setter for Blok modules that ensures shortcuts registration is retried once dependencies are available
   */
  public override set state(Blok: BlokModules) {
    super.state = Blok;
    this.shortcutManager.tryRegisterShortcuts();
  }

  /**
   * Ensures toolbar DOM and shortcuts are created
   */
  private initialize(): void {
    if (this.lifecycleManager.isInitialized) {
      return;
    }

    this.make();
    this.shortcutManager.tryRegisterShortcuts();
    this.lifecycleManager.markInitialized();
  }

  /**
   *  Moving / appearance
   *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   */

  /**
   * Shows Inline Toolbar if something is selected
   * @param [needToClose] - pass true to close toolbar if it is not allowed.
   */
  public async tryToShow(needToClose = false): Promise<void> {
    if (needToClose) {
      this.close();
    }

    this.initialize();

    const { allowed } = this.selectionValidator.canShow();

    if (!allowed) {
      return;
    }

    this.openingPromise = this.open();
    await this.openingPromise;
    this.openingPromise = null;

    this.Blok.Toolbar.close();
  }

  /**
   * Hides Inline Toolbar
   */
  public close(): void {
    if (!this.opened) {
      return;
    }

    this.tools = new Map();
    this.opened = false;
    this.openingPromise = null;

    // Hide and destroy popover
    if (this.popover) {
      this.popover.hide?.();
      this.popover.destroy?.();
      this.popover = null;
    }

    // Clear wrapper content
    if (this.nodes.wrapper) {
      this.nodes.wrapper.innerHTML = '';
    }

    // Handle test mocks for PopoverInline
    const popoverMockInfo = (PopoverInline as unknown as { mock?: { results?: Array<{ value?: Popover | undefined }> } }).mock;
    const lastPopover = popoverMockInfo?.results?.at(-1)?.value;

    if (lastPopover) {
      lastPopover.hide?.();
      lastPopover.destroy?.();
    }
  }

  /**
   * Check if node is contained by Inline Toolbar
   * @param {Node} node — node to check
   */
  public containsNode(node: Node): boolean {
    if (this.nodes.wrapper === undefined) {
      return false;
    }

    if (this.nodes.wrapper.contains(node)) {
      return true;
    }

    // Also check if node is inside the popover (including nested popovers)
    if (this.popover !== null && this.popover.hasNode(node)) {
      return true;
    }

    return false;
  }

  /**
   * Removes UI and its components
   */
  public destroy(): void {
    if (this.popover) {
      this.popover.hide?.();
      this.popover.destroy?.();
      this.popover = null;
    }

    this.shortcutManager.destroy();
    this.removeAllNodes();
  }


  /**
   * Making DOM - creates wrapper element for the inline toolbar
   */
  private make(): void {
    this.nodes.wrapper = $.make('div', twMerge(
      'absolute top-0 left-0 z-[3] opacity-100 visible',
      'transition-opacity duration-[250ms] ease-out',
      'will-change-[opacity,left,top]',
      '[&_[hidden]]:!hidden'
    ));
    this.nodes.wrapper.setAttribute(DATA_ATTR.interface, INLINE_TOOLBAR_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-blok-testid', 'inline-toolbar');

    $.append(this.Blok.UI.nodes.wrapper, this.nodes.wrapper);
  }

  /**
   * Shows Inline Toolbar
   */
  private async open(): Promise<void> {
    if (this.opened) {
      return;
    }

    this.initialize();
    this.opened = true;

    // Cleanup existing popover
    if (this.popover) {
      this.popover.hide?.();
      this.popover.destroy?.();
      this.popover = null;
    }

    this.createToolsInstances();

    if (!this.nodes.wrapper) {
      return;
    }

    // Clear wrapper
    this.nodes.wrapper.innerHTML = '';

    // Build popover items
    const popoverItems = await this.buildPopoverItems();

    // Create popover
    const scopeElement = this.Blok.API?.methods?.ui?.nodes?.redactor ?? this.Blok.UI.nodes.redactor;

    this.popover = new PopoverInline({
      items: popoverItems,
      scopeElement,
      messages: {
        nothingFound: this.Blok.I18n.t('popover.nothingFound'),
        search: this.Blok.I18n.t('popover.search'),
      },
    });

    // Get popover element and calculate position
    const popoverMountElement = this.popover.getMountElement?.() ?? this.popover.getElement?.();
    const popoverElement = this.popover.getElement?.();
    const popoverWidth = this.popover.size?.width
      ?? popoverElement?.getBoundingClientRect().width
      ?? 0;

    this.applyPosition(popoverWidth);

    // Mount popover
    if (popoverMountElement && this.nodes.wrapper) {
      this.nodes.wrapper.appendChild(popoverMountElement);
    }

    this.popover.show?.();
  }

  /**
   * Build popover items from tools map
   */
  private async buildPopoverItems(): Promise<PopoverItemParams[]> {
    return this.popoverBuilder.build(this.tools);
  }

  /**
   * Calculate and apply position to wrapper
   */
  private applyPosition(popoverWidth: number): void {
    if (!this.nodes.wrapper) {
      return;
    }

    const wrapperOffset = this.Blok.UI.nodes.wrapper.getBoundingClientRect();
    const contentRect = this.Blok.UI.contentRect;
    const selectionRect = SelectionUtils.rect;

    this.positioner.apply({
      wrapper: this.nodes.wrapper,
      selectionRect,
      wrapperOffset,
      contentRect,
      popoverWidth,
    });
  }


  /**
   *  Working with Tools
   *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   */

  /**
   * Constructs tools instances and saves them to this.tools
   */
  private createToolsInstances(): void {
    const tools = this.toolsManager.getAvailableTools();
    this.tools = this.toolsManager.createInstances(tools);
  }

  /**
   * Activates inline tool triggered by keyboard shortcut
   */
  private async activateToolByShortcut(toolName: string): Promise<void> {
    if (!this.opened) {
      await this.tryToShow();
    }

    /**
     * Wait for any pending opening operation to complete.
     * This handles the race condition where the toolbar is being opened
     * asynchronously (e.g., from a selectionchange event) and the shortcut
     * is pressed before the popover is fully initialized.
     */
    if (this.openingPromise !== null) {
      await this.openingPromise;
    }

    if (this.popover) {
      this.popover.activateItemByName(toolName);

      return;
    }

    this.invokeToolActionDirectly(toolName);
  }

  /**
   * Invokes the tool's action directly without relying on the popover.
   */
  private invokeToolActionDirectly(toolName: string): void {
    const tool = this.Blok.Tools.inlineTools.get(toolName);

    if (!tool) {
      return;
    }

    const instance = tool.create();
    const rendered = instance.render();
    const items = Array.isArray(rendered) ? rendered : [rendered];

    for (const item of items) {
      if ('onActivate' in item && typeof item.onActivate === 'function') {
        item.onActivate(item);

        return;
      }
    }
  }
}

// Re-export helper classes for testing
export { InlineShortcutManager } from './shortcuts-manager';
export { InlinePositioner } from './positioner';
export { InlineToolsManager } from './tools-manager';
export { InlineSelectionValidator } from './selection-validator';
export { InlinePopoverBuilder } from './popover-builder';
export { InlineKeyboardHandler } from './keyboard-handler';
export { InlineLifecycleManager } from './lifecycle-manager';
export type { InlineToolbarNodes, InlinePositioningOptions, SelectionValidationResult } from './types';
