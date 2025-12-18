import { Module } from '../../__module';
import { Dom as $ } from '../../dom';
import { SelectionUtils } from '../../selection';
import { beautifyShortcut, capitalize, isMobileScreen } from '../../utils';
import type { InlineTool as IInlineTool } from '../../../../types';
import { Shortcuts } from '../../utils/shortcuts';
import type { ModuleConfig } from '../../../types-internal/module-config';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { CommonInternalSettings } from '../../tools/base';
import type { Popover, PopoverItemParams } from '../../utils/popover';
import { PopoverItemType } from '../../utils/popover';
import { PopoverInline } from '../../utils/popover/popover-inline';
import type { InlineToolAdapter } from 'src/components/tools/inline';
import { translateToolName } from '../../utils/tools';
import { DATA_ATTR, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../constants';
import { twMerge } from '../../utils/tw';

/**
 * Inline Toolbar elements
 */
interface InlineToolbarNodes {
  /**
   * Wrapper element for the inline toolbar
   */
  wrapper: HTMLElement | undefined;
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
    const popoverInline = this.popover as PopoverInline | null;

    if (popoverInline === null) {
      return false;
    }

    return popoverInline.hasNestedPopoverOpen;
  }

  /**
   * Closes only the nested popover if one is open.
   * Returns true if a nested popover was closed, false otherwise.
   */
  public closeNestedPopover(): boolean {
    const popoverInline = this.popover as PopoverInline | null;

    if (popoverInline === null) {
      return false;
    }

    if (!popoverInline.hasNestedPopoverOpen) {
      return false;
    }

    popoverInline.closeNestedPopover();

    return true;
  }

  /**
   * Returns true if a flipper item is focused (user is navigating with keyboard)
   */
  public get hasFlipperFocus(): boolean {
    const popoverInline = this.popover as PopoverInline | null;

    if (popoverInline === null) {
      return false;
    }

    const mainFlipperHasFocus = popoverInline.flipper?.hasFocus() ?? false;
    const nestedPopover = (popoverInline as unknown as { nestedPopover?: { flipper?: { hasFocus(): boolean } } | null }).nestedPopover;
    const nestedFlipperHasFocus = nestedPopover?.flipper?.hasFocus() ?? false;

    return mainFlipperHasFocus || nestedFlipperHasFocus;
  }

  /**
   * Popover instance reference
   */
  private popover: Popover | null = null;

  /**
   * Margin above/below the Toolbar
   */
  private readonly toolbarVerticalMargin: number = isMobileScreen() ? 20 : 6;

  /**
   * Tracks whether inline toolbar DOM and shortcuts are initialized
   */
  private initialized = false;

  /**
   * Ensures we don't schedule multiple initialization attempts simultaneously
   */
  private initializationScheduled = false;

  /**
   * Currently visible tools instances
   */
  private tools: Map<InlineToolAdapter, IInlineTool> = new Map();

  /**
   * Shortcuts registered for inline tools
   */
  private registeredShortcuts: Map<string, string> = new Map();

  /**
   * Tracks whether inline shortcuts have been registered
   */
  private shortcutsRegistered = false;

  /**
   * Prevents duplicate shortcut registration retries
   */
  private shortcutRegistrationScheduled = false;


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
      const isVerticalArrowKey = keyboardEvent.key === 'ArrowDown' || keyboardEvent.key === 'ArrowUp';
      const isHorizontalArrowKey = keyboardEvent.key === 'ArrowLeft' || keyboardEvent.key === 'ArrowRight';

      /**
       * Close inline toolbar when Up/Down arrow key is pressed without Shift
       * This allows the user to move the cursor and collapse the selection
       *
       * However, if the user has already started keyboard navigation within the toolbar
       * (by pressing Tab to focus on a toolbar item), we should allow arrow key navigation
       * within the toolbar instead of closing it.
       *
       * Left/Right arrow keys should have no effect within the inline toolbar,
       * so we don't close the toolbar when they are pressed.
       *
       * We check:
       * 1. If the main popover's Flipper has focus
       * 2. If a nested popover is open (even if no item is focused)
       * 3. If the nested popover's Flipper has focus
       */
      const shouldCheckForClose = isVerticalArrowKey && !keyboardEvent.shiftKey && this.opened;
      const popoverWithFlipper = this.popover as PopoverInline | null;
      const mainFlipperHasFocus = popoverWithFlipper?.flipper?.hasFocus() ?? false;
      const nestedPopover = (this.popover as unknown as { nestedPopover?: { flipper?: { hasFocus(): boolean } } | null } | null)?.nestedPopover;
      const hasNestedPopover = nestedPopover !== null && nestedPopover !== undefined;
      const nestedFlipperHasFocus = nestedPopover?.flipper?.hasFocus() ?? false;
      const shouldKeepOpen = mainFlipperHasFocus || hasNestedPopover || nestedFlipperHasFocus;

      if (shouldCheckForClose && !shouldKeepOpen) {
        this.close();

        return;
      }

      /**
       * When the inline toolbar is open and the flipper has focus,
       * prevent horizontal arrow keys from doing anything (no navigation, no closing)
       */
      if (isHorizontalArrowKey && this.opened && mainFlipperHasFocus) {
        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();

        return;
      }

      const isShiftArrow = keyboardEvent.shiftKey &&
        (keyboardEvent.key === 'ArrowDown' || keyboardEvent.key === 'ArrowUp');

      if (!isShiftArrow) {
        return;
      }

      void this.tryToShow();
    }, true);

    this.scheduleInitialization();
    this.tryRegisterShortcuts();
  }

  /**
   * Setter for Blok modules that ensures shortcuts registration is retried once dependencies are available
   */
  public override set state(Blok: BlokModules) {
    super.state = Blok;
    this.tryRegisterShortcuts();
  }

  /**
   * Ensures toolbar DOM and shortcuts are created
   */
  private initialize(): void {
    if (this.initialized) {
      return;
    }


    this.make();
    this.tryRegisterShortcuts();
    this.initialized = true;
  }

  /**
   * Attempts to register inline shortcuts as soon as tools are available
   */
  private tryRegisterShortcuts(): void {
    if (this.shortcutsRegistered) {
      return;
    }

    if (this.Blok?.Tools === undefined) {
      this.scheduleShortcutRegistration();

      return;
    }

    const shortcutsWereRegistered = this.registerInitialShortcuts();

    if (shortcutsWereRegistered) {
      this.shortcutsRegistered = true;
    }
  }

  /**
   * Schedules a retry for shortcut registration
   */
  private scheduleShortcutRegistration(): void {
    if (this.shortcutsRegistered || this.shortcutRegistrationScheduled) {
      return;
    }

    this.shortcutRegistrationScheduled = true;

    const callback = (): void => {
      this.shortcutRegistrationScheduled = false;
      this.tryRegisterShortcuts();
    };

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(callback, 0);
    } else {
      callback();
    }
  }

  /**
   * Schedules the next initialization attempt
   */
  private scheduleInitialization(): void {
    if (this.initialized || this.initializationScheduled) {
      return;
    }

    this.initializationScheduled = true;

    const callback = (): void => {
      this.initializationScheduled = false;
      this.initialize();
    };

    const scheduleWithTimeout = (): void => {
      window.setTimeout(callback, 0);
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        scheduleWithTimeout();
      }, { timeout: 2000 });
    } else {
      scheduleWithTimeout();
    }
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

    if (!this.allowedToShow()) {
      return;
    }

    await this.open();

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
    const popoverItems: PopoverItemParams[] = [];
    const toolsEntries = Array.from(this.tools.entries());

    for (const [index, [tool, instance]] of toolsEntries.entries()) {
      const renderedTool = await instance.render();
      const shortcut = this.getToolShortcut(tool.name);
      const shortcutBeautified = shortcut !== undefined ? beautifyShortcut(shortcut) : undefined;

      const toolTitle = translateToolName(this.Blok.I18n, tool.titleKey, tool.title || capitalize(tool.name));

      const items = Array.isArray(renderedTool) ? renderedTool : [renderedTool];
      const isFirstItem = index === 0;

      for (const item of items) {
        const processed = this.processPopoverItem(item, tool.name, toolTitle, shortcutBeautified, isFirstItem);

        popoverItems.push(...processed);
      }
    }

    return popoverItems;
  }

  /**
   * Process a single popover item and return the items to add
   */
  private processPopoverItem(
    item: PopoverItemParams | HTMLElement,
    toolName: string,
    toolTitle: string,
    shortcutBeautified: string | undefined,
    isFirstItem: boolean
  ): PopoverItemParams[] {
    const result: PopoverItemParams[] = [];

    const commonPopoverItemParams = {
      name: toolName,
      hint: {
        title: toolTitle,
        description: shortcutBeautified,
      },
    } as PopoverItemParams;

    // Skip raw HTMLElement items (legacy)
    if (item instanceof HTMLElement) {
      return result;
    }

    if (item.type === PopoverItemType.Html) {
      result.push({
        ...commonPopoverItemParams,
        ...item,
        type: PopoverItemType.Html,
      });

      return result;
    }

    if (item.type === PopoverItemType.Separator) {
      result.push({
        type: PopoverItemType.Separator,
      });

      return result;
    }

    // Default item
    const popoverItem = {
      ...commonPopoverItemParams,
      ...item,
      type: PopoverItemType.Default,
    } as PopoverItemParams;

    result.push(popoverItem);

    // Append separator after first item with children
    if ('children' in popoverItem && isFirstItem) {
      result.push({
        type: PopoverItemType.Separator,
      });
    }

    return result;
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
    const selectionRect = SelectionUtils.rect as DOMRect;

    const newCoords = {
      x: selectionRect.x - wrapperOffset.x,
      y: selectionRect.y +
        selectionRect.height -
        wrapperOffset.top +
        this.toolbarVerticalMargin,
    };

    const realRightCoord = newCoords.x + popoverWidth + wrapperOffset.x;

    // Prevent overflow on right side
    if (realRightCoord > contentRect.right) {
      newCoords.x = contentRect.right - popoverWidth - wrapperOffset.x;
    }

    this.nodes.wrapper.style.left = Math.floor(newCoords.x) + 'px';
    this.nodes.wrapper.style.top = Math.floor(newCoords.y) + 'px';
  }


  /**
   * Need to show Inline Toolbar or not
   */
  private allowedToShow(): boolean {
    /**
     * Tags conflicts with window.selection function.
     * Ex. IMG tag returns null (Firefox) or Redactors wrapper (Chrome)
     */
    const tagsConflictsWithSelection = ['IMG', 'INPUT'];
    const currentSelection = this.resolveSelection();
    const selectedText = SelectionUtils.text;

    // old browsers
    if (!currentSelection || !currentSelection.anchorNode) {
      return false;
    }

    // empty selection
    if (currentSelection.isCollapsed || selectedText.length < 1) {
      return false;
    }

    const target = !$.isElement(currentSelection.anchorNode)
      ? currentSelection.anchorNode.parentElement
      : currentSelection.anchorNode;

    if (target === null) {
      return false;
    }

    if (currentSelection !== null && tagsConflictsWithSelection.includes(target.tagName)) {
      return false;
    }

    /**
     * Check if there is at leas one tool enabled by current Block's Tool
     */
    const anchorElement = $.isElement(currentSelection.anchorNode)
      ? currentSelection.anchorNode as HTMLElement
      : currentSelection.anchorNode.parentElement;
    const blockFromAnchor = anchorElement
      ? this.Blok.BlockManager.getBlock(anchorElement)
      : null;
    const currentBlock = blockFromAnchor ?? this.Blok.BlockManager.currentBlock;

    if (currentBlock === null || currentBlock === undefined) {
      return false;
    }

    /**
     * Check that at least one tool is available for the current block
     */
    const toolsAvailable = this.getTools();
    const isAtLeastOneToolAvailable = toolsAvailable.some((tool) => currentBlock.tool.inlineTools.has(tool.name));

    if (isAtLeastOneToolAvailable === false) {
      return false;
    }

    /**
     * Inline toolbar will be shown only if the target is contenteditable
     * In Read-Only mode, the target should be contenteditable with "false" value
     */
    const contenteditableSelector = '[contenteditable]';
    const contenteditableTarget = target.closest(contenteditableSelector);

    if (contenteditableTarget !== null) {
      return true;
    }

    const blockHolder = currentBlock.holder;
    const holderContenteditable = blockHolder &&
      (
        blockHolder.matches(contenteditableSelector)
          ? blockHolder
          : blockHolder.closest(contenteditableSelector)
      );

    if (holderContenteditable) {
      return true;
    }

    if (this.Blok.ReadOnly.isEnabled) {
      return SelectionUtils.isSelectionAtBlok(currentSelection);
    }

    return false;
  }

  /**
   *  Working with Tools
   *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   */

  /**
   * Returns tools that are available for current block
   */
  private getTools(): InlineToolAdapter[] {
    const currentBlock = this.Blok.BlockManager.currentBlock
      ?? (() => {
        const selection = this.resolveSelection();
        const anchorNode = selection?.anchorNode;

        if (!anchorNode) {
          return null;
        }

        const anchorElement = $.isElement(anchorNode) ? anchorNode as HTMLElement : anchorNode.parentElement;

        if (!anchorElement) {
          return null;
        }

        return this.Blok.BlockManager.getBlock(anchorElement);
      })();

    if (!currentBlock) {
      return [];
    }

    const inlineTools = Array.from(currentBlock.tool.inlineTools.values());

    return inlineTools.filter((tool) => {
      if (this.Blok.ReadOnly.isEnabled && tool.isReadOnlySupported !== true) {
        return false;
      }

      return true;
    });
  }

  /**
   * Constructs tools instances and saves them to this.tools
   */
  private createToolsInstances(): void {
    this.tools = new Map();

    const tools = this.getTools();

    tools.forEach((tool) => {
      const instance = tool.create();

      this.tools.set(tool, instance);
    });
  }

  /**
   * Try to enable shortcut for a tool, catching any errors silently
   */
  private tryEnableShortcut(toolName: string, shortcut: string | undefined): void {
    if (shortcut === undefined) {
      return;
    }

    try {
      this.enableShortcuts(toolName, shortcut);
    } catch (_e) {
      // Ignore errors when enabling shortcuts
    }
  }

  /**
   * Get shortcut name for tool
   */
  private getToolShortcut(toolName: string): string | undefined {
    const { Tools } = this.Blok;

    const tool = Tools.inlineTools.get(toolName);
    const internalTools = Tools.internal.inlineTools;

    if (Array.from(internalTools.keys()).includes(toolName)) {
      return this.inlineTools[toolName][CommonInternalSettings.Shortcut];
    }

    return tool?.shortcut;
  }

  /**
   * Enable Tool shortcut with Blok Shortcuts Module
   */
  private enableShortcuts(toolName: string, shortcut: string): void {
    const registeredShortcut = this.registeredShortcuts.get(toolName);

    if (registeredShortcut === shortcut) {
      return;
    }

    if (this.isShortcutTakenByAnotherTool(toolName, shortcut)) {
      return;
    }

    if (registeredShortcut !== undefined) {
      Shortcuts.remove(document, registeredShortcut);
      this.registeredShortcuts.delete(toolName);
    }

    Shortcuts.add({
      name: shortcut,
      handler: (event) => {
        const { currentBlock } = this.Blok.BlockManager;

        if (!currentBlock) {
          return;
        }

        if (currentBlock.tool.enabledInlineTools === false) {
          return;
        }

        event.preventDefault();

        void this.activateToolByShortcut(toolName);
      },
      on: document,
    });

    this.registeredShortcuts.set(toolName, shortcut);
  }

  /**
   * Check if shortcut is already registered by another inline tool
   */
  private isShortcutTakenByAnotherTool(toolName: string, shortcut: string): boolean {
    return Array.from(this.registeredShortcuts.entries()).some(([name, registeredShortcut]) => {
      return name !== toolName && registeredShortcut === shortcut;
    });
  }

  /**
   * Activates inline tool triggered by keyboard shortcut
   */
  private async activateToolByShortcut(toolName: string): Promise<void> {
    if (!this.opened) {
      await this.tryToShow();
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

  /**
   * Get inline tools tools
   */
  private get inlineTools(): { [name: string]: IInlineTool } {
    const result = {} as { [name: string]: IInlineTool };

    Array
      .from(this.Blok.Tools.inlineTools.entries())
      .forEach(([name, tool]) => {
        result[name] = tool.create();
      });

    return result;
  }

  /**
   * Register shortcuts for inline tools ahead of time
   */
  private registerInitialShortcuts(): boolean {
    const inlineTools = this.Blok.Tools?.inlineTools;

    if (!inlineTools) {
      this.scheduleShortcutRegistration();

      return false;
    }

    const toolNames = Array.from(inlineTools.keys());

    if (toolNames.length === 0) {
      this.scheduleShortcutRegistration();

      return false;
    }

    toolNames.forEach((toolName) => {
      const shortcut = this.getToolShortcut(toolName);

      this.tryEnableShortcut(toolName, shortcut);
    });

    return true;
  }

  /**
   * Resolves the current selection, handling test mocks
   */
  private resolveSelection(): Selection | null {
    const selectionOverride = (SelectionUtils as unknown as { selection?: Selection | null }).selection;

    if (selectionOverride !== undefined) {
      return selectionOverride;
    }

    const instanceOverride = (SelectionUtils as unknown as { instance?: Selection | null }).instance;

    if (instanceOverride !== undefined) {
      return instanceOverride;
    }

    return SelectionUtils.get();
  }
}
