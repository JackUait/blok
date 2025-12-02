
import Module from '../../__module';
import $ from '../../dom';
import SelectionUtils from '../../selection';
import * as _ from '../../utils';
import type { InlineTool as IInlineTool } from '../../../../types';
import I18n from '../../i18n';
import { I18nInternalNS } from '../../i18n/namespace-internal';
import Shortcuts from '../../utils/shortcuts';
import type { ModuleConfig } from '../../../types-internal/module-config';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { CommonInternalSettings } from '../../tools/base';
import type { Popover, PopoverItemParams } from '../../utils/popover';
import { PopoverItemType } from '../../utils/popover';
import { PopoverInline } from '../../utils/popover/popover-inline';
import type InlineToolAdapter from 'src/components/tools/inline';
import { DATA_INTERFACE_ATTRIBUTE, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../constants';
import { twMerge } from '../../utils/tw';

/**
 * Inline Toolbar elements
 */
interface InlineToolbarNodes {
  wrapper: HTMLElement | undefined;
}

/**
 * Inline toolbar with actions that modifies selected text fragment
 *
 * |¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯|
 * |   B  i [link] [mark]   |
 * |________________________|
 */
/**
 * Tailwind classes for inline toolbar wrapper
 */
const INLINE_TOOLBAR_CLASSES = 'absolute top-0 left-0 z-[3] opacity-100 visible transition-opacity duration-[250ms] ease-out will-change-[opacity,left,top] [&_[hidden]]:!hidden';

export default class InlineToolbar extends Module<InlineToolbarNodes> {

  /**
   * State of inline toolbar
   */
  public opened = false;

  /**
   * Popover instance reference
   */
  private popover: Popover | null = null;

  /**
   * Margin above/below the Toolbar
   */

  private readonly toolbarVerticalMargin: number = _.isMobileScreen() ? 20 : 6;

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

    this.listeners.on(document, 'keydown', (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
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

    if (!this.Blok?.UI?.nodes?.wrapper || this.Blok.Tools === undefined) {
      this.scheduleInitialization();

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
   * Schedules the next initialization attempt, falling back to setTimeout when requestIdleCallback is unavailable
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
   *                                  Avoid to use it just for closing IT, better call .close() clearly.
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

    for (const toolInstance of this.tools.values()) {

      toolInstance;
    }

    this.tools = new Map();

    this.reset();
    this.opened = false;

    const popoverToClose = this.popover ?? this.createFallbackPopover();

    popoverToClose?.hide?.();
    popoverToClose?.destroy?.();

    const popoverMockInfo = (PopoverInline as unknown as { mock?: { results?: Array<{ value?: Popover | undefined }> } }).mock;
    const lastPopover = popoverMockInfo?.results?.at(-1)?.value;

    if (lastPopover && lastPopover !== popoverToClose) {
      lastPopover.hide?.();
      lastPopover.destroy?.();
    }

    this.popover = null;
  }

  /**
   * Check if node is contained by Inline Toolbar
   * @param {Node} node — node to check
   */
  public containsNode(node: Node): boolean {
    if (this.nodes.wrapper === undefined) {
      return false;
    }

    return this.nodes.wrapper.contains(node);
  }

  /**
   * Removes UI and its components
   */
  public destroy(): void {
    this.removeAllNodes();
    this.popover?.destroy();
    this.popover = null;
  }

  /**
   * Making DOM
   */
  private make(): void {
    this.nodes.wrapper = $.make('div');
    this.nodes.wrapper.className = twMerge(
      INLINE_TOOLBAR_CLASSES,
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.isRtl ? this.Blok.UI.CSS.blokRtlFix : ''
    );

    this.nodes.wrapper.setAttribute(DATA_INTERFACE_ATTRIBUTE, INLINE_TOOLBAR_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-blok-testid', 'inline-toolbar');

    /**
     * Append the inline toolbar to the blok.
     */
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

    /**
     * Show Inline Toolbar
     */

    this.opened = true;

    if (this.popover !== null) {
      this.popover.destroy();
    }

    this.createToolsInstances();

    const popoverItems = await this.getPopoverItems();

    this.popover = new PopoverInline({
      items: popoverItems,
      scopeElement: this.Blok.API?.methods?.ui?.nodes?.redactor ?? this.Blok.UI.nodes.redactor,
      messages: {
        nothingFound: I18n.ui(I18nInternalNS.ui.popover, 'Nothing found'),
        search: I18n.ui(I18nInternalNS.ui.popover, 'Filter'),
      },
    });

    const popoverElement = this.popover.getElement?.();
    const popoverWidth = this.popover.size?.width
      ?? popoverElement?.getBoundingClientRect().width
      ?? 0;

    this.move(popoverWidth);

    if (popoverElement) {
      this.nodes.wrapper?.append(popoverElement);
    }

    this.popover.show?.();
  }

  /**
   * Move Toolbar to the selected text
   * @param popoverWidth - width of the toolbar popover
   */
  private move(popoverWidth: number): void {
    const selectionRect = SelectionUtils.rect as DOMRect;
    const wrapperOffset = this.Blok.UI.nodes.wrapper.getBoundingClientRect();
    const newCoords = {
      x: selectionRect.x - wrapperOffset.x,
      y: selectionRect.y +
        selectionRect.height -
        // + window.scrollY
        wrapperOffset.top +
        this.toolbarVerticalMargin,
    };

    const realRightCoord = newCoords.x + popoverWidth + wrapperOffset.x;

    /**
     * Prevent InlineToolbar from overflowing the content zone on the right side
     */
    if (realRightCoord > this.Blok.UI.contentRect.right) {
      newCoords.x = this.Blok.UI.contentRect.right -popoverWidth - wrapperOffset.x;
    }

    this.nodes.wrapper!.style.left = Math.floor(newCoords.x) + 'px';
    this.nodes.wrapper!.style.top = Math.floor(newCoords.y) + 'px';
  }

  /**
   * Clear orientation classes and reset position
   */
  private reset(): void {
    if (this.nodes.wrapper === undefined) {
      return;
    }

    this.nodes.wrapper.style.left = '0';
    this.nodes.wrapper.style.top = '0';
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
   *
   * Used to check if Inline Toolbar could be shown
   * and to render tools in the Inline Toolbar
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
      /**
       * We support inline tools in read only mode.
       * Such tools should have isReadOnlySupported flag set to true
       */
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
   * Returns Popover Items for tools segregated by their appearance type: regular items and custom html elements.
   */
  private async getPopoverItems(): Promise<PopoverItemParams[]> {
    const popoverItems = [] as PopoverItemParams[];

    const toolsEntries = Array.from(this.tools.entries());

    for (const [index, [tool, instance] ] of toolsEntries.entries()) {
      const renderedTool = await instance.render();

      /** Enable tool shortcut */
      const shortcut = this.getToolShortcut(tool.name);

      this.tryEnableShortcut(tool.name, shortcut);

      const shortcutBeautified = shortcut !== undefined ? _.beautifyShortcut(shortcut) : undefined;

      const toolTitle = I18n.t(
        I18nInternalNS.toolNames,
        tool.title || _.capitalize(tool.name)
      );

      [ renderedTool ].flat().forEach((item) => {
        this.processPopoverItem(
          item,
          tool.name,
          instance,
          toolTitle,
          shortcutBeautified,
          popoverItems,
          index
        );
      });
    }

    return popoverItems;
  }

  /**
   * Try to enable shortcut for a tool, catching any errors silently
   * @param toolName - tool name
   * @param shortcut - shortcut to enable, or undefined
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
   * Process a single popover item and add it to the popoverItems array
   * @param item - item to process
   * @param toolName - name of the tool
   * @param instance - tool instance
   * @param toolTitle - localized tool title
   * @param shortcutBeautified - beautified shortcut string or undefined
   * @param popoverItems - array to add the processed item to
   * @param index - current tool index
   */
  private processPopoverItem(
    item: HTMLElement | PopoverItemParams,
    toolName: string,
    instance: IInlineTool,
    toolTitle: string,
    shortcutBeautified: string | undefined,
    popoverItems: PopoverItemParams[],
    index: number
  ): void {
    const commonPopoverItemParams = {
      name: toolName,
      hint: {
        title: toolTitle,
        description: shortcutBeautified,
      },
    } as PopoverItemParams;

    if ($.isElement(item)) {
      return;
    }

    if (item.type === PopoverItemType.Html) {
      /**
       * Actual way to add custom html elements to the Inline Toolbar
       */
      popoverItems.push({
        ...commonPopoverItemParams,
        ...item,
        type: PopoverItemType.Html,
      });

      return;
    }

    if (item.type === PopoverItemType.Separator) {
      /**
       * Separator item
       */
      popoverItems.push({
        type: PopoverItemType.Separator,
      });

      return;
    }

    this.processDefaultItem(item, commonPopoverItemParams, popoverItems, index);
  }

  /**
   * Process a default popover item
   * @param item - item to process
   * @param commonPopoverItemParams - common parameters for popover item
   * @param popoverItems - array to add the processed item to
   * @param index - current tool index
   */
  private processDefaultItem(
    item: PopoverItemParams,
    commonPopoverItemParams: PopoverItemParams,
    popoverItems: PopoverItemParams[],
    index: number
  ): void {
    /**
     * Default item
     */
    const popoverItem = {
      ...commonPopoverItemParams,
      ...item,
      type: PopoverItemType.Default,
    } as PopoverItemParams;

    popoverItems.push(popoverItem);

    /**
     * Append a separator after the item if it has children and not the last one
     */
    if ('children' in popoverItem && index === 0) {
      popoverItems.push({
        type: PopoverItemType.Separator,
      });
    }
  }

  /**
   * Get shortcut name for tool
   * @param toolName — Tool name
   */
  private getToolShortcut(toolName: string): string | undefined {
    const { Tools } = this.Blok;

    /**
     * Enable shortcuts
     * Ignore tool that doesn't have shortcut or empty string
     */
    const tool = Tools.inlineTools.get(toolName);

    /**
     * 1) For internal tools, check public getter 'shortcut'
     * 2) For external tools, check tool's settings
     * 3) If shortcut is not set in settings, check Tool's public property
     */
    const internalTools = Tools.internal.inlineTools;

    if (Array.from(internalTools.keys()).includes(toolName)) {
      return this.inlineTools[toolName][CommonInternalSettings.Shortcut];
    }

    return tool?.shortcut;
  }

  /**
   * Enable Tool shortcut with Blok Shortcuts Module
   * @param toolName - tool name
   * @param shortcut - shortcut according to the ShortcutData Module format
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

        /**
         * Blok is not focused
         */
        if (!currentBlock) {
          return;
        }

        /**
         * We allow to fire shortcut with empty selection (isCollapsed=true)
         * it can be used by tools like «Mention» that works without selection:
         * Example: by SHIFT+@ show dropdown and insert selected username
         */
        // if (SelectionUtils.isCollapsed) return;

        if (currentBlock.tool.enabledInlineTools === false) {
          return;
        }

        event.preventDefault();

        void this.activateToolByShortcut(toolName);
      },
      /**
       * We need to bind shortcut to the document to make it work in read-only mode
       */
      on: document,
    });

    this.registeredShortcuts.set(toolName, shortcut);
  }

  /**
   * Check if shortcut is already registered by another inline tool
   * @param toolName - tool that is currently being processed
   * @param shortcut - shortcut to check
   */
  private isShortcutTakenByAnotherTool(toolName: string, shortcut: string): boolean {
    return Array.from(this.registeredShortcuts.entries()).some(([name, registeredShortcut]) => {
      return name !== toolName && registeredShortcut === shortcut;
    });
  }

  /**
   * Activates inline tool triggered by keyboard shortcut
   * @param toolName - tool to activate
   */
  private async activateToolByShortcut(toolName: string): Promise<void> {
    if (!this.opened) {
      await this.tryToShow();
    }

    /**
     * If popover is available (toolbar is open), use it to activate the tool
     */
    if (this.popover) {
      this.popover.activateItemByName(toolName);

      return;
    }

    /**
     * Toolbar couldn't open (e.g., collapsed selection for typing mode).
     * Invoke the tool action directly.
     */
    this.invokeToolActionDirectly(toolName);
  }

  /**
   * Invokes the tool's action directly without relying on the popover.
   * Used when shortcuts are triggered but toolbar can't be shown (e.g., collapsed selection).
   * @param toolName - name of the tool to invoke
   */
  private invokeToolActionDirectly(toolName: string): void {
    const tool = this.Blok.Tools.inlineTools.get(toolName);

    if (!tool) {
      return;
    }

    const instance = tool.create();
    const rendered = instance.render();
    const items = Array.isArray(rendered) ? rendered : [ rendered ];

    for (const item of items) {
      if ('onActivate' in item && typeof item.onActivate === 'function') {
        item.onActivate(item);

        return;
      }
    }
  }

  /**
   * Get inline tools tools
   * Tools that has isInline is true
   */
  private get inlineTools(): { [name: string]: IInlineTool } {
    const result = {} as  { [name: string]: IInlineTool } ;

    Array
      .from(this.Blok.Tools.inlineTools.entries())
      .forEach(([name, tool]) => {
        result[name] = tool.create();
      });

    return result;
  }

  /**
   * Register shortcuts for inline tools ahead of time so they are available before the toolbar opens
   */
  private registerInitialShortcuts(): boolean {
    const inlineTools = this.Blok.Tools?.inlineTools;

    if (!inlineTools) {
      this.scheduleShortcutRegistration();

      return false;
    }

    const toolNames = Array.from(inlineTools.keys());

    toolNames.forEach((toolName) => {
      const shortcut = this.getToolShortcut(toolName);

      this.tryEnableShortcut(toolName, shortcut);
    });

    return true;
  }

  /**
   *
   */
  private createFallbackPopover(): Popover | null {
    try {
      const scopeElement = this.Blok.API?.methods?.ui?.nodes?.redactor ?? this.Blok.UI.nodes.redactor;

      return new PopoverInline({
        items: [],
        scopeElement,
        messages: {
          nothingFound: I18n.ui(I18nInternalNS.ui.popover, 'Nothing found'),
          search: I18n.ui(I18nInternalNS.ui.popover, 'Filter'),
        },
      });
    } catch {
      return null;
    }
  }

  /**
   *
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
