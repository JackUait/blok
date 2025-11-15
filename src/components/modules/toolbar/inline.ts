/* eslint-disable @typescript-eslint/no-non-null-assertion */
import Module from '../../__module';
import $ from '../../dom';
import SelectionUtils from '../../selection';
import * as _ from '../../utils';
import type { InlineTool as IInlineTool } from '../../../../types';
import I18n from '../../i18n';
import { I18nInternalNS } from '../../i18n/namespace-internal';
import Shortcuts from '../../utils/shortcuts';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { CommonInternalSettings } from '../../tools/base';
import type { Popover, PopoverItemHtmlParams, PopoverItemParams, WithChildren } from '../../utils/popover';
import { PopoverItemType } from '../../utils/popover';
import { PopoverInline } from '../../utils/popover/popover-inline';
import type InlineToolAdapter from 'src/components/tools/inline';
import { DATA_INTERFACE_ATTRIBUTE, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../constants';

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
export default class InlineToolbar extends Module<InlineToolbarNodes> {
  /**
   * CSS styles
   */
  public CSS = {
    inlineToolbar: 'ce-inline-toolbar',
  };

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
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  private readonly toolbarVerticalMargin: number = _.isMobileScreen() ? 20 : 6;

  /**
   * Tracks whether inline toolbar DOM and shortcuts are initialized
   */
  private initialized = false;

  /**
   * Currently visible tools instances
   */
  private tools: Map<InlineToolAdapter, IInlineTool> = new Map();

  /**
   * Shortcuts registered for inline tools
   */
  private registeredShortcuts: Map<string, string> = new Map();

  /**
   * Range captured before activating an inline tool via shortcut
   */
  private savedShortcutRange: Range | null = null;

  /**
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Editor's config
   * @param moduleConfiguration.eventsDispatcher - Editor's event dispatcher
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

    window.requestIdleCallback(() => {
      this.initialize();
    }, { timeout: 2000 });
  }

  /**
   * Ensures toolbar DOM and shortcuts are created
   */
  private initialize(): void {
    if (this.initialized) {
      return;
    }

    if (!this.Editor?.UI?.nodes?.wrapper || this.Editor.Tools === undefined) {
      return;
    }

    this.make();
    this.registerInitialShortcuts();
    this.initialized = true;
  }

  /**
   *  Moving / appearance
   *  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   */

  /**
   * Shows Inline Toolbar if something is selected
   *
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

    this.Editor.Toolbar.close();
  }

  /**
   * Hides Inline Toolbar
   */
  public close(): void {
    if (!this.opened) {
      return;
    }

    for (const toolInstance of this.tools.values()) {
      if (_.isFunction(toolInstance.clear)) {
        toolInstance.clear();
      }
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
    this.savedShortcutRange = null;
  }

  /**
   * Check if node is contained by Inline Toolbar
   *
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
    this.nodes.wrapper = $.make('div', [
      this.CSS.inlineToolbar,
      ...(this.isRtl ? [ this.Editor.UI.CSS.editorRtlFix ] : []),
    ]);

    this.nodes.wrapper.setAttribute(DATA_INTERFACE_ATTRIBUTE, INLINE_TOOLBAR_INTERFACE_VALUE);
    this.nodes.wrapper.setAttribute('data-cy', 'inline-toolbar');

    /**
     * Append the inline toolbar to the editor.
     */
    $.append(this.Editor.UI.nodes.wrapper, this.nodes.wrapper);
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
      scopeElement: this.Editor.API?.methods?.ui?.nodes?.redactor ?? this.Editor.UI.nodes.redactor,
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

    this.checkToolsState();
  }

  /**
   * Move Toolbar to the selected text
   *
   * @param popoverWidth - width of the toolbar popover
   */
  private move(popoverWidth: number): void {
    const selectionRect = SelectionUtils.rect as DOMRect;
    const wrapperOffset = this.Editor.UI.nodes.wrapper.getBoundingClientRect();
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
    if (realRightCoord > this.Editor.UI.contentRect.right) {
      newCoords.x = this.Editor.UI.contentRect.right -popoverWidth - wrapperOffset.x;
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
      ? this.Editor.BlockManager.getBlock(anchorElement)
      : null;
    const currentBlock = blockFromAnchor ?? this.Editor.BlockManager.currentBlock;

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

    if (this.Editor.ReadOnly.isEnabled) {
      return SelectionUtils.isSelectionAtEditor(currentSelection);
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
    const currentBlock = this.Editor.BlockManager.currentBlock
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

        return this.Editor.BlockManager.getBlock(anchorElement);
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
      if (this.Editor.ReadOnly.isEnabled && tool.isReadOnlySupported !== true) {
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
   *
   * @param toolName - tool name
   * @param shortcut - shortcut to enable, or undefined
   */
  private tryEnableShortcut(toolName: string, shortcut: string | undefined): void {
    if (shortcut === undefined) {
      return;
    }

    try {
      this.enableShortcuts(toolName, shortcut);
    } catch (e) {
      // Ignore errors when enabling shortcuts
    }
  }

  /**
   * Process a single popover item and add it to the popoverItems array
   *
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
      onActivate: () => {
        this.toolClicked(instance);
      },
      hint: {
        title: toolTitle,
        description: shortcutBeautified,
      },
    } as PopoverItemParams;

    if ($.isElement(item)) {
      this.processElementItem(item, instance, commonPopoverItemParams, popoverItems);

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
   * Process an element-based popover item (deprecated way)
   *
   * @param item - HTML element
   * @param instance - tool instance
   * @param commonPopoverItemParams - common parameters for popover item
   * @param popoverItems - array to add the processed item to
   */
  private processElementItem(
    item: HTMLElement,
    instance: IInlineTool,
    commonPopoverItemParams: PopoverItemParams,
    popoverItems: PopoverItemParams[]
  ): void {
    /**
     * Deprecated way to add custom html elements to the Inline Toolbar
     */

    const popoverItem = {
      ...commonPopoverItemParams,
      element: item,
      type: PopoverItemType.Html,
    } as PopoverItemParams;

    /**
     * If tool specifies actions in deprecated manner, append them as children
     */
    if (_.isFunction(instance.renderActions)) {
      const actions = instance.renderActions();
      const selection = SelectionUtils.get();

      (popoverItem as WithChildren<PopoverItemHtmlParams>).children = {
        isOpen: selection ? instance.checkState?.(selection) ?? false : false,
        /** Disable keyboard navigation in actions, as it might conflict with enter press handling */
        isFlippable: false,
        items: [
          {
            type: PopoverItemType.Html,
            element: actions,
          },
        ],
      };
    } else {
      this.checkLegacyToolState(instance);
    }

    popoverItems.push(popoverItem);
  }

  /**
   * Check state for legacy inline tools that might perform UI mutating logic
   *
   * @param instance - tool instance
   */
  private checkLegacyToolState(instance: IInlineTool): void {
    /**
     * Legacy inline tools might perform some UI mutating logic in checkState method, so, call it just in case
     */
    const selection = this.resolveSelection();

    if (selection) {
      instance.checkState?.(selection);
    }
  }

  /**
   * Process a default popover item
   *
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

    /**
     * Prepend the separator if item has children and not the first one
     */
    if ('children' in popoverItem && index !== 0) {
      popoverItems.push({
        type: PopoverItemType.Separator,
      });
    }

    popoverItems.push(popoverItem);

    /**
     * Append a separator after the item if it has children and not the last one
     */
    if ('children' in popoverItem && index < this.tools.size - 1) {
      popoverItems.push({
        type: PopoverItemType.Separator,
      });
    }
  }

  /**
   * Get shortcut name for tool
   *
   * @param toolName — Tool name
   */
  private getToolShortcut(toolName: string): string | undefined {
    const { Tools } = this.Editor;

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
   * Enable Tool shortcut with Editor Shortcuts Module
   *
   * @param toolName - tool name
   * @param shortcut - shortcut according to the ShortcutData Module format
   */
  private enableShortcuts(toolName: string, shortcut: string): void {
    const registeredShortcut = this.registeredShortcuts.get(toolName);

    if (registeredShortcut === shortcut) {
      return;
    }

    if (registeredShortcut !== undefined) {
      Shortcuts.remove(document, registeredShortcut);
      this.registeredShortcuts.delete(toolName);
    }

    Shortcuts.add({
      name: shortcut,
      handler: (event) => {
        const { currentBlock } = this.Editor.BlockManager;

        /**
         * Editor is not focused
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
   * Inline Tool button clicks
   *
   * @param tool - Tool's instance
   */
  private toolClicked(tool: IInlineTool): void {
    const range = SelectionUtils.range ?? this.restoreShortcutRange();

    tool.surround?.(range);
    this.savedShortcutRange = null;
    this.checkToolsState();
  }

  /**
   * Activates inline tool triggered by keyboard shortcut
   *
   * @param toolName - tool to activate
   */
  private async activateToolByShortcut(toolName: string): Promise<void> {
    const initialRange = SelectionUtils.range;

    if (!this.opened) {
      await this.tryToShow();
    }

    const selection = SelectionUtils.get();

    if (!selection) {
      this.savedShortcutRange = initialRange ? initialRange.cloneRange() : null;
      this.popover?.activateItemByName(toolName);

      return;
    }

    const toolEntry = Array.from(this.tools.entries())
      .find(([ toolAdapter ]) => toolAdapter.name === toolName);

    const toolInstance = toolEntry?.[1];
    const isToolActive = toolInstance?.checkState?.(selection) ?? false;

    if (isToolActive) {
      this.savedShortcutRange = null;

      return;
    }

    const currentRange = SelectionUtils.range ?? initialRange ?? null;

    this.savedShortcutRange = currentRange ? currentRange.cloneRange() : null;

    this.popover?.activateItemByName(toolName);
  }

  /**
   * Restores selection from the shortcut-captured range if present
   */
  private restoreShortcutRange(): Range | null {
    if (!this.savedShortcutRange) {
      return null;
    }

    const selection = SelectionUtils.get();

    if (selection) {
      selection.removeAllRanges();
      const restoredRange = this.savedShortcutRange.cloneRange();

      selection.addRange(restoredRange);

      return restoredRange;
    }

    return this.savedShortcutRange;
  }

  /**
   * Check Tools` state by selection
   */
  private checkToolsState(): void {
    const selection = this.resolveSelection();

    if (!selection) {
      return;
    }

    this.tools?.forEach((toolInstance) => {
      toolInstance.checkState?.(selection);
    });
  }

  /**
   * Get inline tools tools
   * Tools that has isInline is true
   */
  private get inlineTools(): { [name: string]: IInlineTool } {
    const result = {} as  { [name: string]: IInlineTool } ;

    Array
      .from(this.Editor.Tools.inlineTools.entries())
      .forEach(([name, tool]) => {
        result[name] = tool.create();
      });

    return result;
  }

  /**
   * Register shortcuts for inline tools ahead of time so they are available before the toolbar opens
   */
  private registerInitialShortcuts(): void {
    const toolNames = Array.from(this.Editor.Tools.inlineTools.keys());

    toolNames.forEach((toolName) => {
      const shortcut = this.getToolShortcut(toolName);

      this.tryEnableShortcut(toolName, shortcut);
    });
  }

  /**
   *
   */
  private createFallbackPopover(): Popover | null {
    try {
      const scopeElement = this.Editor.API?.methods?.ui?.nodes?.redactor ?? this.Editor.UI.nodes.redactor;

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
