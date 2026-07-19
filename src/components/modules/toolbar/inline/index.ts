import type { InlineTool as IInlineTool } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { ModuleConfig } from '../../../../types-internal/module-config';
import { Module } from '../../../__module';
import { DATA_ATTR, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../../constants';
import { Dom as $ } from '../../../dom';
import { SelectionUtils } from '../../../selection/index';
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
 * Inline tool that applies its effect directly on its keyboard shortcut
 * (e.g. Marker re-applies the last-used color) instead of opening its popover.
 */
interface ShortcutApplicableTool {
  applyShortcut(): void;
}

/**
 * Type guard: whether an inline tool instance exposes a direct keyboard-apply hook.
 * @param tool - inline tool instance
 */
function hasApplyShortcut(tool: unknown): tool is ShortcutApplicableTool {
  return typeof tool === 'object'
    && tool !== null
    && 'applyShortcut' in tool
    && typeof (tool as { applyShortcut: unknown }).applyShortcut === 'function';
}

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
   * Returns true while a shortcut-opened direct menu (Link/Equation/Marker) is
   * showing. Such a menu deliberately moves focus into its own input, which
   * collapses the document selection — the SelectionController uses this to
   * avoid tearing the menu down on the resulting selectionchange (mirrors the
   * fake-background guard used when a range is selected).
   */
  public get hasDirectMenuOpen(): boolean {
    return this.directMenuChildren !== null;
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
   * When a popover-entry tool (Link, Equation, Marker — any tool whose render
   * config carries `children`) is triggered by its keyboard shortcut we skip the
   * format-button row entirely and present only that tool's dedicated menu. This
   * holds the tool name for the next `open()` call.
   */
  private directToolName: string | null = null;

  /**
   * The active direct menu's open/close hooks, captured from the tool's
   * `render().children` config so they can be driven without a parent popover.
   */
  private directMenuChildren: {
    onOpen?: () => void;
    onClose?: () => void;
  } | null = null;

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
   * SelectionUtils instance for fake background cleanup
   */
  private selection: SelectionUtils = new SelectionUtils();

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
     * - Left/Right arrow keys move focus between toolbar items (WAI-ARIA horizontal
     *   toolbar) when the flipper has focus and no nested submenu is open
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

    try {
      await this.openingPromise;
    } catch {
      this.opened = false;

      if (this.popover) {
        this.popover.hide?.();
        this.popover.destroy?.();
        this.popover = null;
      }

      return;
    } finally {
      this.openingPromise = null;
    }

    this.Blok.Toolbar.hideBlockActions();
  }

  /**
   * Open the Link tool's editing menu for a given anchor, prefilled with its
   * href. Selects the anchor contents first so the Link tool resolves the
   * existing <a> and mirrors the CMD+K shortcut path. Used by the link hover
   * card's "Edit" action.
   * @param anchor - the anchor whose href should be edited
   */
  public async editLink(anchor: HTMLAnchorElement): Promise<void> {
    new SelectionUtils().expandToTag(anchor);

    await this.activateToolByShortcut('link');
  }

  /**
   * Hides Inline Toolbar
   */
  public close(): void {
    if (!this.opened) {
      return;
    }

    /**
     * Direct menus (Link/Equation opened via shortcut) have no parent popover to
     * fire their nested onClose, so run the tool's cleanup here before tearing
     * down the popover.
     */
    if (this.directMenuChildren) {
      this.directMenuChildren.onClose?.();
      this.directMenuChildren = null;
    }
    this.directToolName = null;

    this.tools = new Map();
    this.opened = false;
    this.openingPromise = null;

    // Clean up any orphaned fake background elements left by inline tools (Link, Marker, Convert)
    this.selection.clearFakeBackground();

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
      'absolute top-0 left-0 z-3 opacity-100 visible',
      'transition-opacity duration-250 ease-out',
      'will-change-[opacity,left,top]',
      '**:[[hidden]]:hidden!'
    ));
    this.nodes.wrapper.setAttribute(DATA_ATTR.interface, INLINE_TOOLBAR_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-blok-testid', 'inline-toolbar');

    /**
     * Accessibility: expose the inline toolbar as a horizontal ARIA toolbar
     * with a descriptive label for the text-formatting controls it hosts.
     */
    this.nodes.wrapper.setAttribute('role', 'toolbar');
    this.nodes.wrapper.setAttribute('aria-label', this.Blok.I18n.t('a11y.textFormatting'));
    this.nodes.wrapper.setAttribute('aria-orientation', 'horizontal');

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

    /**
     * Direct mode (shortcut-triggered Link/Equation): render only the tool's
     * dedicated menu. Otherwise render the full format-button row.
     */
    const directName = this.directToolName;

    this.directToolName = null;

    const popoverItems = directName !== null
      ? await this.buildDirectMenuItems(directName)
      : await this.buildPopoverItems();

    // Create popover
    this.popover = new PopoverInline({
      items: popoverItems,
      messages: {
        nothingFound: this.Blok.I18n.t('popover.nothingFound'),
        search: this.Blok.I18n.t('popover.search'),
        actions: this.Blok.I18n.t('popover.actions'),
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

    if (directName !== null) {
      this.applyDirectMenuLook();
      this.directMenuChildren?.onOpen?.();
    }
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

    const uiWrapper = this.Blok.UI.nodes.wrapper;
    const offsetParent = this.nodes.wrapper.offsetParent as HTMLElement | null;
    const isContainedByUiWrapper = offsetParent === uiWrapper;
    const wrapperOffset = isContainedByUiWrapper
      ? uiWrapper.getBoundingClientRect()
      : new DOMRect(0, 0, 0, 0);
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
    /**
     * Some popover-entry tools expose a direct keyboard-apply hook (e.g. Marker
     * re-applies the last-used color). Their shortcut applies instantly rather
     * than opening the picker — the picker stays reachable via the toolbar button.
     */
    if (this.tryApplyToolShortcut(toolName)) {
      return;
    }

    /**
     * Popover-entry tools (Link, Equation, Marker) present their own menu.
     * Triggered by shortcut they replace the inline toolbar with just that menu
     * — never the full format-button row flanking a fly-out input.
     */
    if (this.toolOpensPopover(toolName)) {
      await this.openToolMenuDirect(toolName);

      return;
    }

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
   * Invoke a tool's direct keyboard-apply hook when it exposes one. Such tools
   * (e.g. Marker) act on the current selection immediately on their shortcut
   * instead of opening their popover. Returns true when the shortcut was handled.
   * @param toolName - inline tool name
   */
  private tryApplyToolShortcut(toolName: string): boolean {
    const tool = this.Blok.Tools.inlineTools.get(toolName);

    if (!tool) {
      return false;
    }

    const instance = tool.create();

    if (!hasApplyShortcut(instance)) {
      return false;
    }

    instance.applyShortcut();

    return true;
  }

  /**
   * Whether the named inline tool renders as a nested popover (e.g. Link,
   * Equation) — i.e. its render config carries `children` rather than a direct
   * `onActivate`. Such tools open an input/menu when activated.
   * @param toolName - inline tool name
   */
  private toolOpensPopover(toolName: string): boolean {
    const tool = this.Blok.Tools.inlineTools.get(toolName);

    if (!tool) {
      return false;
    }

    const rendered = tool.create().render();
    const items = Array.isArray(rendered) ? rendered : [rendered];

    return items.some((item) => 'children' in item && Boolean(item.children));
  }

  /**
   * Opens just the named tool's dedicated menu (Link/Equation/Marker) at the
   * caret, replacing any open inline toolbar. The collapsed-caret gate is
   * relaxed so the shortcut works with nothing selected (the user types a fresh
   * value); all other validity checks still apply.
   * @param toolName - inline tool whose menu should open
   */
  private async openToolMenuDirect(toolName: string): Promise<void> {
    // Tear down whatever is open (full toolbar or a previous menu) first.
    this.close();
    this.initialize();

    /**
     * Only caret-insert tools (Equation) may open with nothing selected; a
     * selection-wrapping tool (Link, Marker) needs a range to act on, so its
     * shortcut is a no-op at a collapsed caret.
     */
    const allowCollapsed = this.Blok.Tools.inlineTools.get(toolName)?.allowCaretShortcut ?? false;
    const { allowed } = this.selectionValidator.canShow({ allowCollapsed });

    if (!allowed) {
      return;
    }

    this.directToolName = toolName;
    this.openingPromise = this.open();

    try {
      await this.openingPromise;
    } catch {
      this.opened = false;
      this.directToolName = null;
      this.directMenuChildren = null;

      if (this.popover) {
        this.popover.hide?.();
        this.popover.destroy?.();
        this.popover = null;
      }

      return;
    } finally {
      this.openingPromise = null;
    }

    this.Blok.Toolbar.hideBlockActions();
  }

  /**
   * Build popover items for a direct tool menu: the tool's `render().children`
   * content (its input/menu) with the open/close hooks captured so they can be
   * driven without a parent popover. Returns an empty list when the tool has no
   * nested menu.
   * @param toolName - inline tool whose menu should be built
   */
  private async buildDirectMenuItems(toolName: string): Promise<PopoverItemParams[]> {
    const entry = Array.from(this.tools.entries()).find(([tool]) => tool.name === toolName);

    if (entry === undefined) {
      return [];
    }

    const rendered = await entry[1].render();
    const items = Array.isArray(rendered) ? rendered : [rendered];
    const withChildren = items.find((item) => 'children' in item && Boolean(item.children));

    if (withChildren === undefined || !('children' in withChildren)) {
      return [];
    }

    const { children } = withChildren;

    this.directMenuChildren = {
      onOpen: children.onOpen,
      onClose: children.onClose,
    };

    return children.items ?? [];
  }

  /**
   * Restyles the direct menu's popover from the horizontal toolbar shape into a
   * vertical menu box (matching the nested-popover look), so it reads as a
   * standalone menu rather than a one-item toolbar.
   */
  private applyDirectMenuLook(): void {
    const popoverEl = this.popover?.getElement?.();

    if (!popoverEl) {
      return;
    }

    // The inline popover pins its root to the horizontal bar size; clear it so
    // the vertical box sizes to its own content.
    popoverEl.style.width = '';
    popoverEl.style.height = '';

    // The root is `inline-block`; once its height collapses to 0 (the absolute
    // container carries the size), default baseline alignment drops it ~one
    // line-height below the wrapper top, placing the menu too low. Align its top
    // to the wrapper so it sits right under the selection like the toolbar does.
    popoverEl.style.verticalAlign = 'top';

    const container = popoverEl.querySelector<HTMLElement>(`[${DATA_ATTR.popoverContainer}]`);

    if (container) {
      // show() pins the container to the 38px toolbar height and zeroes its
      // max-height — both crop a stacked menu (e.g. the equation input +
      // preview). Release the height; keep overflow clipping so KaTeX's hidden
      // MathML stays hidden.
      container.style.height = '';
      container.className = twMerge(container.className, 'h-fit w-max flex-col p-1.5 max-h-none');
    }

    const items = popoverEl.querySelector<HTMLElement>(`[${DATA_ATTR.popoverItems}]`);

    if (items) {
      items.className = twMerge(items.className, 'block w-full pb-0');
    }
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
export type { InlineToolbarNodes } from './types';
