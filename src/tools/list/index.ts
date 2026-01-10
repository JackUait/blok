/**
 * ListItem Tool for the Blok Editor
 * Represents a single list item in a hierarchical structure (Notion-like)
 *
 * @license MIT
 */
import { IconListBulleted, IconListNumbered, IconListChecklist } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { DATA_ATTR } from '../../components/constants';
import { PLACEHOLDER_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
import { stripFakeBackgroundElements } from '../../components/utils';
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { MoveEvent } from '../../../types/tools/hook-events';

/**
 * List item styles
 */
export type ListItemStyle = 'unordered' | 'ordered' | 'checklist';

/**
 * Tool's input and output data format
 */
export interface ListItemData extends BlockToolData {
  /** Item text content (can include HTML) */
  text: string;
  /** List style: unordered, ordered, or checklist */
  style: ListItemStyle;
  /** Checked state for checklist items */
  checked?: boolean;
  /** Starting number for ordered lists (only applies to root items) */
  start?: number;
  /** Nesting depth level (0 = root, 1 = first indent, etc.) */
  depth?: number;
}

/**
 * Tool's config from Editor
 */
export interface ListItemConfig {
  /** Default list style */
  defaultStyle?: ListItemStyle;
  /**
   * Available list styles for the settings menu.
   * When specified, only these styles will be available in the block settings dropdown.
   */
  styles?: ListItemStyle[];
  /**
   * List styles to show in the toolbox.
   * When specified, only these list types will appear as separate entries in the toolbox.
   * If not specified, all list types (unordered, ordered, checklist) will be shown.
   *
   * @example
   * // Show only bulleted and numbered lists in toolbox
   * toolboxStyles: ['unordered', 'ordered']
   *
   * @example
   * // Show only checklist in toolbox
   * toolboxStyles: ['checklist']
   */
  toolboxStyles?: ListItemStyle[];
  /**
   * Custom color for list items.
   * Accepts any valid CSS color value (hex, rgb, hsl, named colors, etc.)
   *
   * @example
   * // Set list items to a hex color
   * itemColor: '#3b82f6'
   *
   * @example
   * // Set list items to an rgb color
   * itemColor: 'rgb(59, 130, 246)'
   */
  itemColor?: string;
  /**
   * Custom font size for list items.
   * Accepts any valid CSS font-size value (px, rem, em, etc.)
   *
   * @example
   * // Set list items to 18px
   * itemSize: '18px'
   *
   * @example
   * // Set list items to 1.25rem
   * itemSize: '1.25rem'
   */
  itemSize?: string;
}

/**
 * Style configuration
 */
interface StyleConfig {
  style: ListItemStyle;
  name: string;
  icon: string;
}

/**
 * ListItem block for the Blok Editor.
 * Represents a single list item that can have children (nested items).
 */
export class ListItem implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _settings: ListItemConfig;
  private _data: ListItemData;
  private _element: HTMLElement | null = null;

  /**
   * Block instance properties for hierarchy
   */
  private blockId?: string;
  private parentId?: string | null;
  private contentIds?: string[];

  private static readonly BASE_STYLES = 'outline-none';
  private static readonly ITEM_STYLES = 'outline-none py-0.5 pl-0.5 leading-[1.6em]';
  private static readonly CHECKLIST_ITEM_STYLES = 'flex items-start py-0.5 pl-0.5';
  private static readonly CHECKBOX_STYLES = 'mt-1 w-4 mr-2 h-4 cursor-pointer accent-current';

  private static readonly STYLE_CONFIGS: StyleConfig[] = [
    { style: 'unordered', name: 'bulletedList', icon: IconListBulleted },
    { style: 'ordered', name: 'numberedList', icon: IconListNumbered },
    { style: 'checklist', name: 'todoList', icon: IconListChecklist },
  ];

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<ListItemData, ListItemConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);

    // Store block hierarchy info
    if (block) {
      this.blockId = block.id;
      // Note: parent and content are available on the block
    }

    // Only ordered lists need to listen for block removals to renumber
    if (this._data.style === 'ordered') {
      this.api.events.on('block changed', this.handleBlockChanged);
    }
  }

  /**
   * Handler for block change events.
   * When any block is removed, trigger renumbering of ordered list items.
   * Uses a static flag to deduplicate multiple calls in the same frame.
   */
  private handleBlockChanged = (data: unknown): void => {
    const payload = data as { event?: { type?: string } } | undefined;

    if (payload?.event?.type !== 'block-removed') {
      return;
    }

    // Deduplicate: only schedule one update per frame across all instances
    if (ListItem.pendingMarkerUpdate) {
      return;
    }

    ListItem.pendingMarkerUpdate = true;
    requestAnimationFrame(() => {
      ListItem.pendingMarkerUpdate = false;
      this.updateAllOrderedListMarkers();
    });
  };

  /**
   * Static flag to deduplicate marker updates across all ListItem instances.
   * Prevents redundant updates when multiple list items respond to the same event.
   */
  private static pendingMarkerUpdate = false;

  sanitize?: ToolSanitizerConfig | undefined;

  /**
   * Legacy list item structure for backward compatibility
   */
  private static isLegacyFormat(data: unknown): data is { items: Array<{ content: string; checked?: boolean }>, style?: ListItemStyle, start?: number } {
    return typeof data === 'object' && data !== null && 'items' in data && Array.isArray((data as { items: unknown }).items);
  }

  private normalizeData(data: ListItemData | Record<string, never>): ListItemData {
    const defaultStyle = this._settings.defaultStyle || 'unordered';

    if (!data || typeof data !== 'object') {
      return {
        text: '',
        style: defaultStyle,
        checked: false,
        depth: 0,
      };
    }

    // Handle legacy format with items[] array - extract first item's content
    // This provides backward compatibility when legacy data is passed directly to the tool
    if (ListItem.isLegacyFormat(data)) {
      const firstItem = data.items[0];
      const text = firstItem?.content || '';
      const checked = firstItem?.checked || false;

      return {
        text,
        style: data.style || defaultStyle,
        checked: Boolean(checked),
        depth: 0,
        ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
      };
    }

    return {
      text: data.text || '',
      style: data.style || defaultStyle,
      checked: Boolean(data.checked),
      depth: data.depth ?? 0,
      ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
    };
  }

  private get currentStyleConfig(): StyleConfig {
    return ListItem.STYLE_CONFIGS.find(s => s.style === this._data.style) || ListItem.STYLE_CONFIGS[0];
  }

  private get availableStyles(): StyleConfig[] {
    const configuredStyles = this._settings.styles;
    if (!configuredStyles || configuredStyles.length === 0) {
      return ListItem.STYLE_CONFIGS;
    }
    return ListItem.STYLE_CONFIGS.filter(s => configuredStyles.includes(s.style));
  }

  private get itemColor(): string | undefined {
    return this._settings.itemColor;
  }

  private get itemSize(): string | undefined {
    return this._settings.itemSize;
  }

  private static readonly PLACEHOLDER_KEY = 'tools.list.placeholder';

  private get placeholder(): string {
    return this.api.i18n.t(ListItem.PLACEHOLDER_KEY);
  }

  private applyItemStyles(element: HTMLElement): void {
    const styleUpdates = element.style;

    if (this.itemColor) {
      styleUpdates.color = this.itemColor;
    }
    if (this.itemSize) {
      styleUpdates.fontSize = this.itemSize;
    }
  }

  private setupItemPlaceholder(element: HTMLElement): void {
    if (this.readOnly) {
      return;
    }
    setupPlaceholder(element, this.placeholder);
  }

  public render(): HTMLElement {
    this._element = this.createItemElement();
    return this._element;
  }

  /**
   * Called after block content is added to the page.
   * Updates the marker with the correct index now that we know our position,
   * and also updates all sibling list items since their indices may have changed.
   */
  public rendered(): void {
    this.updateMarkersAfterPositionChange();
  }

  /**
   * Called after block was moved.
   * Validates and adjusts depth to follow list formation rules,
   * then updates the marker to reflect the new position.
   */
  public moved(event: MoveEvent): void {
    this.validateAndAdjustDepthAfterMove(event.detail.toIndex);
    this.updateMarkersAfterPositionChange();
  }

  /**
   * Updates this block's marker and all sibling ordered list markers.
   * Called after this block's position may have changed (rendered, moved).
   */
  private updateMarkersAfterPositionChange(): void {
    if (this._data.style !== 'ordered' || !this._element) {
      return;
    }

    // Update this block's marker
    this.updateMarker();

    // Update all sibling ordered list items since their indices may have changed
    this.updateSiblingListMarkers();
  }

  /**
   * Validates and adjusts the depth of this list item after a drag-and-drop move.
   * Ensures the depth follows list formation rules:
   * 1. First item (index 0) must be at depth 0
   * 2. Item depth cannot exceed previousItem.depth + 1
   * 3. When dropped between nested items, adopt the sibling's depth
   *
   * @param newIndex - The new index where the block was moved to
   */
  private validateAndAdjustDepthAfterMove(newIndex: number): void {
    const currentDepth = this.getDepth();
    const maxAllowedDepth = this.calculateMaxAllowedDepth(newIndex);
    const targetDepth = this.calculateTargetDepthForPosition(newIndex, maxAllowedDepth);

    if (currentDepth !== targetDepth) {
      this.adjustDepthTo(targetDepth);
    }
  }

  /**
   * Calculates the target depth for a list item dropped at the given index.
   * When dropping into a nested context, the item should match the sibling's depth.
   *
   * @param blockIndex - The index where the block was dropped
   * @param maxAllowedDepth - The maximum allowed depth at this position
   * @returns The target depth for the dropped item
   */
  private calculateTargetDepthForPosition(blockIndex: number, maxAllowedDepth: number): number {
    const currentDepth = this.getDepth();

    // If current depth exceeds max, cap it
    if (currentDepth > maxAllowedDepth) {
      return maxAllowedDepth;
    }

    // Check if we're inserting before a list item (next block)
    const nextBlock = this.api.blocks.getBlockByIndex(blockIndex + 1);
    const nextIsListItem = nextBlock && nextBlock.name === ListItem.TOOL_NAME;
    const nextBlockDepth = nextIsListItem ? this.getBlockDepth(nextBlock) : 0;

    // If next block is a deeper list item, match its depth (become a sibling)
    // This prevents breaking list structure by inserting a shallower item
    const shouldMatchNextDepth = nextIsListItem
      && nextBlockDepth > currentDepth
      && nextBlockDepth <= maxAllowedDepth;

    if (shouldMatchNextDepth) {
      return nextBlockDepth;
    }

    // Check if previous block is a list item at a deeper level
    const previousBlock = blockIndex > 0 ? this.api.blocks.getBlockByIndex(blockIndex - 1) : null;
    const previousIsListItem = previousBlock && previousBlock.name === ListItem.TOOL_NAME;
    const previousBlockDepth = previousIsListItem ? this.getBlockDepth(previousBlock) : 0;

    // If previous block is deeper and there's no next list item to guide us,
    // match the previous block's depth (append as sibling in the nested list)
    const shouldMatchPreviousDepth = previousIsListItem
      && !nextIsListItem
      && previousBlockDepth > currentDepth
      && previousBlockDepth <= maxAllowedDepth;

    if (shouldMatchPreviousDepth) {
      return previousBlockDepth;
    }

    return currentDepth;
  }

  /**
   * Calculates the maximum allowed depth for a list item at the given index.
   *
   * Rules:
   * 1. First item (index 0) must be at depth 0
   * 2. For other items: maxDepth = previousListItem.depth + 1
   * 3. If previous block is not a list item, maxDepth = 0
   *
   * @param blockIndex - The index of the block
   * @returns The maximum allowed depth (0 or more)
   */
  private calculateMaxAllowedDepth(blockIndex: number): number {
    // First item must be at depth 0
    if (blockIndex === 0) {
      return 0;
    }

    const previousBlock = this.api.blocks.getBlockByIndex(blockIndex - 1);

    // If previous block doesn't exist or isn't a list item, max depth is 0
    if (!previousBlock || previousBlock.name !== ListItem.TOOL_NAME) {
      return 0;
    }

    // Max depth is previous item's depth + 1
    const previousBlockDepth = this.getBlockDepth(previousBlock);

    return previousBlockDepth + 1;
  }

  /**
   * Adjusts the depth of this list item to the specified value.
   * Updates internal data and the DOM element's indentation.
   *
   * @param newDepth - The new depth value
   */
  private adjustDepthTo(newDepth: number): void {
    this._data.depth = newDepth;

    // Update the data-list-depth attribute on the wrapper
    if (this._element) {
      this._element.setAttribute('data-list-depth', String(newDepth));
    }

    // Update DOM element's indentation
    const listItemEl = this._element?.querySelector('[role="listitem"]');

    if (listItemEl instanceof HTMLElement) {
      listItemEl.style.marginLeft = newDepth > 0
        ? `${newDepth * ListItem.INDENT_PER_LEVEL}px`
        : '';
    }
  }

  /**
   * Called when this block is about to be removed.
   * Updates sibling ordered list markers to renumber correctly after removal.
   */
  public removed(): void {
    if (this._data.style !== 'ordered') {
      return;
    }

    // Unsubscribe from block change events to prevent memory leaks
    this.api.events.off('block changed', this.handleBlockChanged);

    // Schedule marker update for next frame, after DOM has been updated
    // Note: This is still needed because when THIS list item is removed,
    // handleBlockChanged won't be called on this instance (it's being destroyed)
    requestAnimationFrame(() => {
      this.updateAllOrderedListMarkers();
    });
  }

  /**
   * Update markers on all ordered list items in the editor.
   * Called when a list item is removed to ensure correct renumbering.
   */
  private updateAllOrderedListMarkers(): void {
    const blocksCount = this.api.blocks.getBlocksCount();

    Array.from({ length: blocksCount }, (_, i) => i).forEach(i => {
      const block = this.api.blocks.getBlockByIndex(i);
      if (!block || block.name !== ListItem.TOOL_NAME) {
        return;
      }

      const blockHolder = block.holder;
      const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
      if (!listItemEl) {
        return; // Not an ordered list
      }

      this.updateBlockMarker(block);
    });
  }

  /**
   * Update marker if this is an ordered list item.
   */
  private updateMarkerIfOrdered(): void {
    if (this._data.style !== 'ordered' || !this._element) {
      return;
    }

    this.updateMarker();
  }

  /**
   * Update the marker element with the correct index.
   * Called after the block is rendered and positioned.
   */
  private updateMarker(): void {
    const marker = this._element?.querySelector('[data-list-marker]');
    if (!marker) {
      return;
    }

    const depth = this.getDepth();
    const siblingIndex = this.getSiblingIndex();
    const markerText = this.getOrderedMarkerText(siblingIndex, depth);
    marker.textContent = markerText;
  }

  /**
   * Update markers on all sibling ordered list items.
   * Called when this block is moved to ensure all list numbers are correct.
   * Respects style boundaries - only updates items with the same style.
   */
  private updateSiblingListMarkers(): void {
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    const currentDepth = this.getDepth();
    const currentStyle = this._data.style;
    const blocksCount = this.api.blocks.getBlocksCount();

    // Find the start of this list group by walking backwards (respecting style boundaries)
    const groupStartIndex = this.findListGroupStartIndex(currentBlockIndex, currentDepth, currentStyle);

    // Update all ordered list items from groupStartIndex forward at this depth (respecting style boundaries)
    this.updateMarkersInRange(groupStartIndex, blocksCount, currentBlockIndex, currentDepth, currentStyle);
  }

  /**
   * Find the starting index of a list group by walking backwards.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   */
  private findListGroupStartIndex(currentBlockIndex: number, currentDepth: number, currentStyle?: ListItemStyle): number {
    const findStart = (index: number, startIndex: number): number => {
      if (index < 0) {
        return startIndex;
      }

      const block = this.api.blocks.getBlockByIndex(index);
      if (!block || block.name !== ListItem.TOOL_NAME) {
        return startIndex;
      }

      const blockDepth = this.getBlockDepth(block);
      if (blockDepth < currentDepth) {
        return startIndex; // Hit a parent, stop
      }

      // If at deeper depth, skip it and continue (ignore style at deeper depths)
      if (blockDepth > currentDepth) {
        return findStart(index - 1, startIndex);
      }

      // At same depth - check style boundary if currentStyle is provided
      const blockStyle = this.getBlockStyle(block);
      if (currentStyle !== undefined && blockStyle !== currentStyle) {
        return startIndex; // Style boundary at same depth - treat as separate list
      }

      // Same depth and same style - update startIndex and continue
      return findStart(index - 1, index);
    };

    return findStart(currentBlockIndex - 1, currentBlockIndex);
  }

  /**
   * Update markers for all list items in a range at the given depth.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   */
  private updateMarkersInRange(
    startIndex: number,
    endIndex: number,
    skipIndex: number,
    targetDepth: number,
    targetStyle?: ListItemStyle
  ): void {
    const processBlock = (index: number): void => {
      if (index >= endIndex) {
        return;
      }

      if (index === skipIndex) {
        processBlock(index + 1);
        return;
      }

      const block = this.api.blocks.getBlockByIndex(index);
      if (!block || block.name !== ListItem.TOOL_NAME) {
        return; // Stop when we hit a non-list block
      }

      const blockDepth = this.getBlockDepth(block);
      if (blockDepth < targetDepth) {
        return; // Hit a parent, stop searching forward
      }

      // If at deeper depth, skip it and continue (ignore style at deeper depths)
      if (blockDepth > targetDepth) {
        processBlock(index + 1);
        return;
      }

      // At same depth - check style boundary if targetStyle is provided
      const blockStyle = this.getBlockStyle(block);
      if (targetStyle !== undefined && blockStyle !== targetStyle) {
        return; // Style boundary at same depth - stop updating
      }

      // Same depth and same style - update marker and continue
      this.updateBlockMarker(block);

      processBlock(index + 1);
    };

    processBlock(startIndex);
  }

  /**
   * Get the depth of a block by reading from its DOM
   */
  private getBlockDepth(block: ReturnType<typeof this.api.blocks.getBlockByIndex>): number {
    if (!block) {
      return 0;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[role="listitem"]');
    const styleAttr = listItemEl?.getAttribute('style');

    const marginMatch = styleAttr?.match(/margin-left:\s*(\d+)px/);
    return marginMatch ? Math.round(parseInt(marginMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;
  }

  /**
   * Get the style of a block by reading from its DOM
   */
  private getBlockStyle(block: ReturnType<typeof this.api.blocks.getBlockByIndex>): ListItemStyle | null {
    if (!block) {
      return null;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');
    const style = listItemEl?.getAttribute('data-list-style');

    return (style as ListItemStyle) || null;
  }

  /**
   * Update the marker of a specific block by finding its marker element and recalculating
   */
  private updateBlockMarker(block: ReturnType<typeof this.api.blocks.getBlockByIndex>): void {
    if (!block) {
      return;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style="ordered"]');
    if (!listItemEl) {
      return; // Not an ordered list
    }

    const marker = listItemEl.querySelector('[data-list-marker]');
    if (!marker) {
      return;
    }

    // Calculate the correct index for this block
    const blockIndex = this.api.blocks.getBlockIndex(block.id);
    if (blockIndex === undefined || blockIndex === null) {
      return;
    }

    const blockDepth = this.getBlockDepth(block);
    const blockStyle = this.getBlockStyle(block) || 'ordered';
    const siblingIndex = this.countPrecedingSiblingsAtDepth(blockIndex, blockDepth, blockStyle);

    // Get the start value for this list group
    const startValue = this.getListStartValueForBlock(blockIndex, blockDepth, siblingIndex, blockStyle);
    const actualNumber = startValue + siblingIndex;
    const markerText = this.formatOrderedMarker(actualNumber, blockDepth);

    marker.textContent = markerText;
  }

  /**
   * Update the marker element when depth changes.
   * Handles both ordered and unordered list markers.
   */
  private updateMarkerForDepth(newDepth: number, style: ListItemStyle): void {
    const marker = this._element?.querySelector('[aria-hidden="true"]');

    if (!(marker instanceof HTMLElement)) {
      return;
    }

    if (style === 'ordered') {
      const siblingIndex = this.getSiblingIndex();
      const markerText = this.getOrderedMarkerText(siblingIndex, newDepth);

      marker.textContent = markerText;
    } else {
      const bulletChar = this.getBulletCharacter(newDepth);

      marker.textContent = bulletChar;
    }
  }

  /**
   * Update the checkbox state for checklist items.
   */
  private updateCheckboxState(checked: boolean): void {
    const checkbox = this._element?.querySelector('input[type="checkbox"]');

    if (!(checkbox instanceof HTMLInputElement)) {
      return;
    }

    checkbox.checked = checked;
  }

  /**
   * Format an ordered list marker based on the number and depth
   */
  private formatOrderedMarker(number: number, depth: number): string {
    const style = depth % 3;

    if (style === 1) {
      return `${this.numberToLowerAlpha(number)}.`;
    }
    if (style === 2) {
      return `${this.numberToLowerRoman(number)}.`;
    }
    return `${number}.`;
  }

  /**
   * Count preceding list items at the same depth and style for a given block index
   */
  private countPrecedingSiblingsAtDepth(blockIndex: number, targetDepth: number, targetStyle?: ListItemStyle): number {
    if (blockIndex <= 0) {
      return 0;
    }

    return this.countPrecedingListItemsAtDepthFromIndex(blockIndex - 1, targetDepth, targetStyle);
  }

  /**
   * Recursively count preceding list items at the given depth and style starting from index.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   */
  private countPrecedingListItemsAtDepthFromIndex(index: number, targetDepth: number, targetStyle?: ListItemStyle): number {
    if (index < 0) {
      return 0;
    }

    const block = this.api.blocks.getBlockByIndex(index);
    if (!block || block.name !== ListItem.TOOL_NAME) {
      return 0;
    }

    const blockDepth = this.getBlockDepth(block);

    if (blockDepth < targetDepth) {
      return 0; // Hit a parent
    }

    // If at deeper depth, skip it and continue (ignore style at deeper depths)
    if (blockDepth > targetDepth) {
      return this.countPrecedingListItemsAtDepthFromIndex(index - 1, targetDepth, targetStyle);
    }

    // At same depth - check style boundary if targetStyle is provided
    const blockStyle = this.getBlockStyle(block);
    if (targetStyle !== undefined && blockStyle !== targetStyle) {
      return 0; // Style boundary at same depth - treat as separate list
    }

    // Same depth and same style (or no style check) - count it and continue
    return 1 + this.countPrecedingListItemsAtDepthFromIndex(index - 1, targetDepth, targetStyle);
  }

  /**
   * Get the list start value for a block at a given index and depth
   */
  private getListStartValueForBlock(blockIndex: number, targetDepth: number, siblingIndex: number, targetStyle?: ListItemStyle): number {
    if (siblingIndex === 0) {
      return this.getBlockStartValue(blockIndex);
    }

    // Find the first item in this list group
    const firstItemIndex = this.findFirstListItemIndexFromBlock(blockIndex - 1, targetDepth, siblingIndex, targetStyle);
    if (firstItemIndex === null) {
      return 1;
    }

    return this.getBlockStartValue(firstItemIndex);
  }

  /**
   * Get the start value from a block's data-list-start attribute
   */
  private getBlockStartValue(blockIndex: number): number {
    const block = this.api.blocks.getBlockByIndex(blockIndex);
    if (!block) {
      return 1;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');
    const startAttr = listItemEl?.getAttribute('data-list-start');
    return startAttr ? parseInt(startAttr, 10) : 1;
  }

  /**
   * Find the first list item in a consecutive group.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   */
  private findFirstListItemIndexFromBlock(index: number, targetDepth: number, remainingCount: number, targetStyle?: ListItemStyle): number | null {
    if (index < 0 || remainingCount <= 0) {
      return index + 1;
    }

    const block = this.api.blocks.getBlockByIndex(index);
    if (!block || block.name !== ListItem.TOOL_NAME) {
      return index + 1;
    }

    const blockDepth = this.getBlockDepth(block);

    if (blockDepth < targetDepth) {
      return index + 1;
    }

    // If at deeper depth, skip it and continue (ignore style at deeper depths)
    if (blockDepth > targetDepth) {
      return this.findFirstListItemIndexFromBlock(index - 1, targetDepth, remainingCount, targetStyle);
    }

    // At same depth - check style boundary if targetStyle is provided
    const blockStyle = this.getBlockStyle(block);
    if (targetStyle !== undefined && blockStyle !== targetStyle) {
      return index + 1; // Style boundary at same depth - treat as separate list
    }

    // Same depth and same style - decrement count and continue
    return this.findFirstListItemIndexFromBlock(index - 1, targetDepth, remainingCount - 1, targetStyle);
  }

  private createItemElement(): HTMLElement {
    const { style } = this._data;

    const wrapper = document.createElement('div');
    wrapper.className = ListItem.BASE_STYLES;
    wrapper.setAttribute(DATA_ATTR.tool, ListItem.TOOL_NAME);
    wrapper.setAttribute('data-list-style', style);
    wrapper.setAttribute('data-list-depth', String(this.getDepth()));

    // Store start value as data attribute for sibling items to read
    if (this._data.start !== undefined && this._data.start !== 1) {
      wrapper.setAttribute('data-list-start', String(this._data.start));
    }

    const itemContent = style === 'checklist'
      ? this.createChecklistContent()
      : this.createStandardContent();

    wrapper.appendChild(itemContent);

    if (!this.readOnly) {
      wrapper.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    return wrapper;
  }

  /**
   * Indentation padding per depth level in pixels
   */
  private static readonly INDENT_PER_LEVEL = 24;

  private createStandardContent(): HTMLElement {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.className = twMerge(ListItem.ITEM_STYLES, 'flex', ...PLACEHOLDER_CLASSES);
    this.applyItemStyles(item);

    // Apply indentation based on depth
    const depth = this.getDepth();
    if (depth > 0) {
      item.style.marginLeft = `${depth * ListItem.INDENT_PER_LEVEL}px`;
    }

    // Create marker element (will be updated in rendered() with correct index)
    const marker = this.createListMarker();
    marker.setAttribute('data-list-marker', 'true');
    item.appendChild(marker);

    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = twMerge('flex-1 min-w-0 outline-none', ...PLACEHOLDER_CLASSES);
    contentContainer.contentEditable = this.readOnly ? 'false' : 'true';
    contentContainer.innerHTML = this._data.text;
    this.setupItemPlaceholder(contentContainer);

    item.appendChild(contentContainer);
    return item;
  }

  private createChecklistContent(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'listitem');
    wrapper.className = ListItem.CHECKLIST_ITEM_STYLES;
    this.applyItemStyles(wrapper);

    // Apply indentation based on depth
    const depth = this.getDepth();
    if (depth > 0) {
      wrapper.style.marginLeft = `${depth * ListItem.INDENT_PER_LEVEL}px`;
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = ListItem.CHECKBOX_STYLES;
    checkbox.checked = Boolean(this._data.checked);
    checkbox.disabled = this.readOnly;

    const content = document.createElement('div');
    content.className = twMerge(
      'flex-1 outline-none leading-[1.6em]',
      this._data.checked ? 'line-through opacity-60' : '',
      ...PLACEHOLDER_CLASSES
    );
    content.contentEditable = this.readOnly ? 'false' : 'true';
    content.innerHTML = this._data.text;
    this.setupItemPlaceholder(content);

    if (!this.readOnly) {
      checkbox.addEventListener('change', () => {
        this._data.checked = checkbox.checked;
        content.classList.toggle('line-through', checkbox.checked);
        content.classList.toggle('opacity-60', checkbox.checked);
      });
    }

    wrapper.appendChild(checkbox);
    wrapper.appendChild(content);
    return wrapper;
  }

  /**
   * Create the marker element (bullet or number) for a list item
   */
  private createListMarker(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'flex-shrink-0 select-none';
    marker.setAttribute('aria-hidden', 'true');
    marker.contentEditable = 'false';

    // Get depth from block's parent chain (will be computed by the UI)
    const depth = this.getDepth();

    if (this._data.style === 'ordered') {
      // Calculate the index of this item among consecutive ordered list siblings
      const siblingIndex = this.getSiblingIndex();
      const markerText = this.getOrderedMarkerText(siblingIndex, depth);
      marker.textContent = markerText;
      marker.className = twMerge(marker.className, 'text-right');
      marker.style.paddingRight = '11px';
      marker.style.minWidth = 'fit-content';
    } else {
      const bulletChar = this.getBulletCharacter(depth);
      marker.textContent = bulletChar;
      marker.className = twMerge(marker.className, 'w-6 text-center flex justify-center');
      marker.style.paddingLeft = '1px';
      marker.style.paddingRight = '13px';
      marker.style.fontSize = '24px';
      marker.style.fontFamily = 'Arial';
    }

    return marker;
  }

  /**
   * Calculate the index of this ListItem among consecutive siblings with the same style.
   * This is used to determine the correct number for ordered lists.
   */
  private getSiblingIndex(): number {
    // Try to get the current block's index using its ID, fallback to getCurrentBlockIndex
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    // If we're the first block or blocks API isn't available, return 0
    if (currentBlockIndex <= 0) {
      return 0;
    }

    const currentDepth = this.getDepth();

    // Count consecutive preceding listItem blocks at the same depth
    return this.countPrecedingListItemsAtDepth(currentBlockIndex - 1, currentDepth);
  }

  /**
   * The tool name used when registering this tool with Blok.
   * Used to identify list blocks when counting siblings.
   */
  private static readonly TOOL_NAME = 'list';

  /**
   * Recursively count consecutive preceding list blocks at the same depth and style.
   * Stops when encountering a block that's not a list, a list at a shallower depth (parent),
   * or a list with a different style at the same depth (treating style changes as list boundaries).
   * Items at deeper depths are skipped regardless of their style.
   */
  private countPrecedingListItemsAtDepth(index: number, targetDepth: number): number {
    if (index < 0) {
      return 0;
    }

    const block = this.api.blocks.getBlockByIndex(index);
    if (!block || block.name !== ListItem.TOOL_NAME) {
      return 0;
    }

    // We need to get the block's data to check its depth and style
    // Since we can't directly access another block's tool data,
    // we'll check via the DOM for the depth and style attributes
    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');

    const depthAttr = listItemEl?.querySelector('[role="listitem"]')?.getAttribute('style');

    // Calculate depth from margin (marginLeft = depth * 24px)
    const marginMatch = depthAttr?.match(/margin-left:\s*(\d+)px/);
    const blockDepth = marginMatch ? Math.round(parseInt(marginMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;

    // If this block is at a shallower depth, it's a "parent" - stop counting
    if (blockDepth < targetDepth) {
      return 0;
    }

    // If at deeper depth, skip it and continue checking (ignore style at deeper depths)
    if (blockDepth > targetDepth) {
      return this.countPrecedingListItemsAtDepth(index - 1, targetDepth);
    }

    // At same depth - check style boundary
    const blockStyle = listItemEl?.getAttribute('data-list-style');
    if (blockStyle !== this._data.style) {
      return 0; // Style boundary at same depth - treat as separate list
    }

    // Same depth and same style - count it and continue
    return 1 + this.countPrecedingListItemsAtDepth(index - 1, targetDepth);
  }

  /**
   * Get the depth of this item in the hierarchy (0 = root level)
   */
  private getDepth(): number {
    return this._data.depth ?? 0;
  }

  /**
   * Get the appropriate bullet character based on nesting depth
   */
  private getBulletCharacter(depth: number): string {
    const bullets = ['•', '◦', '▪'];
    return bullets[depth % bullets.length];
  }

  /**
   * Get the ordered list marker text based on depth and index
   */
  private getOrderedMarkerText(index: number, depth: number): string {
    // Get the start value from the first item in this list group
    const startValue = this.getListStartValue(index, depth);
    const actualNumber = startValue + index;
    const style = depth % 3;

    switch (style) {
      case 0:
        return `${actualNumber}.`;
      case 1:
        return `${this.numberToLowerAlpha(actualNumber)}.`;
      case 2:
        return `${this.numberToLowerRoman(actualNumber)}.`;
      default:
        return `${actualNumber}.`;
    }
  }

  /**
   * Get the starting number for this list group.
   * Looks up the first item in the consecutive list group to find its start value.
   */
  private getListStartValue(siblingIndex: number, targetDepth: number): number {
    // If this is the first item (siblingIndex === 0), use our own start value
    if (siblingIndex === 0) {
      return this._data.start ?? 1;
    }

    // Find the first item in this list group by walking back siblingIndex blocks
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    const firstItemIndex = this.findFirstListItemIndex(currentBlockIndex - 1, targetDepth, siblingIndex);
    if (firstItemIndex === null) {
      return 1;
    }

    const firstBlock = this.api.blocks.getBlockByIndex(firstItemIndex);
    if (!firstBlock) {
      return 1;
    }

    // Get the start value from the first block's data attribute
    const blockHolder = firstBlock.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');
    const startAttr = listItemEl?.getAttribute('data-list-start');

    return startAttr ? parseInt(startAttr, 10) : 1;
  }

  /**
   * Find the index of the first list item in this consecutive group.
   * Walks backwards through the blocks counting items at the same depth and style.
   * Stops at style boundaries at the same depth (when encountering a different list style).
   * Items at deeper depths are skipped regardless of their style.
   */
  private findFirstListItemIndex(index: number, targetDepth: number, remainingCount: number): number | null {
    if (index < 0 || remainingCount <= 0) {
      return index + 1;
    }

    const block = this.api.blocks.getBlockByIndex(index);
    if (!block || block.name !== ListItem.TOOL_NAME) {
      return index + 1;
    }

    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');

    const depthAttr = listItemEl?.querySelector('[role="listitem"]')?.getAttribute('style');

    const marginMatch = depthAttr?.match(/margin-left:\s*(\d+)px/);
    const blockDepth = marginMatch ? Math.round(parseInt(marginMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;

    // If this block is at a shallower depth, we've reached the boundary
    if (blockDepth < targetDepth) {
      return index + 1;
    }

    // If at deeper depth, skip it and continue checking (ignore style at deeper depths)
    if (blockDepth > targetDepth) {
      return this.findFirstListItemIndex(index - 1, targetDepth, remainingCount);
    }

    // At same depth - check style boundary
    const blockStyle = listItemEl?.getAttribute('data-list-style');
    if (blockStyle !== this._data.style) {
      return index + 1; // Style boundary at same depth - treat as separate list
    }

    // Same depth and same style - decrement count and continue
    return this.findFirstListItemIndex(index - 1, targetDepth, remainingCount - 1);
  }

  private numberToLowerAlpha(num: number): string {
    const convertRecursive = (n: number): string => {
      if (n <= 0) return '';
      const adjusted = n - 1;
      return convertRecursive(Math.floor(adjusted / 26)) + String.fromCharCode(97 + (adjusted % 26));
    };
    return convertRecursive(num);
  }

  private numberToLowerRoman(num: number): string {
    const romanNumerals: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
    ];

    const convertRecursive = (remaining: number, idx: number): string => {
      if (remaining <= 0 || idx >= romanNumerals.length) return '';
      const [value, numeral] = romanNumerals[idx];
      if (remaining >= value) {
        return numeral + convertRecursive(remaining - value, idx);
      }
      return convertRecursive(remaining, idx + 1);
    };

    return convertRecursive(num, 0);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleEnter();

      return;
    }

    if (event.key === 'Backspace') {
      void this.handleBackspace(event);

      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    // For Tab/Shift+Tab, let BlockEvents handle it when multiple blocks are selected
    const selectedBlocks = document.querySelectorAll('[data-blok-selected="true"]');

    if (selectedBlocks.length > 1) {
      // Multiple blocks selected - let the event bubble up to BlockEvents
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      void this.handleOutdent();

      return;
    }

    void this.handleIndent();
  }

  private async handleEnter(): Promise<void> {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const contentEl = this.getContentElement();
    if (!contentEl) return;

    const currentContent = contentEl.innerHTML.trim();

    // If current item is empty, handle based on depth
    if (currentContent === '' || currentContent === '<br>') {
      await this.exitListOrOutdent();
      return;
    }

    // Split content at cursor position
    const range = selection.getRangeAt(0);
    const { beforeContent, afterContent } = this.splitContentAtCursor(contentEl, range);

    // Guard: blockId is always provided by Blok when instantiating tools,
    // but we keep this fallback for defensive programming in case the tool
    // is instantiated outside the normal Blok flow (e.g., in tests or external usage)
    if (!this.blockId) {
      contentEl.innerHTML = beforeContent;
      this._data.text = beforeContent;

      const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
      const newBlock = this.api.blocks.insert(ListItem.TOOL_NAME, {
        text: afterContent,
        style: this._data.style,
        checked: false,
        depth: this._data.depth,
      }, undefined, currentBlockIndex + 1, true);

      this.setCaretToBlockContent(newBlock, 'start');

      return;
    }

    // Use atomic splitBlock API to ensure undo works correctly
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const newBlock = this.api.blocks.splitBlock(
      this.blockId,
      { text: beforeContent },
      ListItem.TOOL_NAME,
      {
        text: afterContent,
        style: this._data.style,
        checked: false,
        depth: this._data.depth,
      },
      currentBlockIndex + 1
    );

    // Update internal state to match the DOM
    this._data.text = beforeContent;

    // Set caret to the start of the new block's content element
    this.setCaretToBlockContent(newBlock, 'start');
  }

  private async exitListOrOutdent(): Promise<void> {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentDepth = this.getDepth();

    // If nested, outdent instead of exiting
    if (currentDepth > 0) {
      await this.handleOutdent();
      return;
    }

    // At root level, convert to paragraph
    await this.api.blocks.delete(currentBlockIndex);
    const newBlock = this.api.blocks.insert('paragraph', { text: '' }, undefined, currentBlockIndex, true);
    this.setCaretToBlockContent(newBlock, 'start');
  }

  private async handleBackspace(event: KeyboardEvent): Promise<void> {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const range = selection.getRangeAt(0);
    const contentEl = this.getContentElement();
    if (!contentEl) return;

    // Sync current content from DOM before any deletion happens
    // This is critical for preserving data when whole content is selected
    this.syncContentFromDOM();

    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentContent = this._data.text;
    const currentDepth = this.getDepth();

    // Check if entire content is selected
    const isEntireContentSelected = this.isEntireContentSelected(contentEl, range);

    // Handle case when entire content is selected and deleted
    // Just clear the content and show placeholder - don't delete the block
    if (isEntireContentSelected && !selection.isCollapsed) {
      event.preventDefault();

      // Clear the content and update data
      contentEl.innerHTML = '';
      this._data.text = '';

      // Set caret to the now-empty content element
      const newRange = document.createRange();
      newRange.setStart(contentEl, 0);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      return;
    }

    // Only handle at start of content for non-selection cases
    if (!this.isAtStart(contentEl, range)) return;

    event.preventDefault();

    // Convert to paragraph (preserving indentation for nested items)
    await this.api.blocks.delete(currentBlockIndex);
    const newBlock = this.api.blocks.insert(
      'paragraph',
      { text: currentContent },
      undefined,
      currentBlockIndex,
      true
    );

    // Apply indentation to the new paragraph if the list item was nested
    if (currentDepth > 0) {
      requestAnimationFrame(() => {
        const holder = newBlock.holder;
        if (holder) {
          holder.style.marginLeft = `${currentDepth * ListItem.INDENT_PER_LEVEL}px`;
          holder.setAttribute('data-blok-depth', String(currentDepth));
        }
      });
    }

    this.setCaretToBlockContent(newBlock, 'start');
  }

  /**
   * Collect all text nodes from an element
   * @param node - Node to collect text nodes from
   * @returns Array of text nodes
   */
  private collectTextNodes(node: Node): Text[] {
    if (node.nodeType === Node.TEXT_NODE) {
      return [node as Text];
    }

    if (!node.hasChildNodes?.()) {
      return [];
    }

    return Array.from(node.childNodes).flatMap((child) => this.collectTextNodes(child));
  }

  /**
   * Find the text node and offset for a given character position
   * @param textNodes - Array of text nodes to search through
   * @param targetPosition - Character position to find
   * @returns Object with node and offset, or null if not found
   */
  private findCaretPosition(textNodes: Text[], targetPosition: number): { node: Text; offset: number } | null {
    const result = textNodes.reduce<{ found: boolean; charCount: number; node: Text | null; offset: number }>(
      (acc, node) => {
        if (acc.found) return acc;

        const nodeLength = node.textContent?.length ?? 0;
        if (acc.charCount + nodeLength >= targetPosition) {
          return {
            found: true,
            charCount: acc.charCount,
            node,
            offset: targetPosition - acc.charCount,
          };
        }

        return {
          ...acc,
          charCount: acc.charCount + nodeLength,
        };
      },
      { found: false, charCount: 0, node: null, offset: 0 }
    );

    return result.node ? { node: result.node, offset: result.offset } : null;
  }

  /**
   * Sync the current DOM content to the data model
   */
  private syncContentFromDOM(): void {
    const contentEl = this.getContentElement();
    if (contentEl) {
      this._data.text = contentEl.innerHTML;
    }

    // For checklist, also sync the checked state
    if (this._data.style !== 'checklist') {
      return;
    }

    const checkbox = this._element?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (checkbox) {
      this._data.checked = checkbox.checked;
    }
  }

  /**
   * Get the depth of the parent list item by walking backwards through preceding items.
   * A parent is the first preceding list item with a depth less than the current item.
   * @param blockIndex - The index of the current block
   * @returns The parent's depth, or -1 if no parent exists (at root level)
   */
  private getParentDepth(blockIndex: number): number {
    const currentDepth = this.getDepth();

    const findParentDepth = (index: number): number => {
      if (index < 0) {
        return -1;
      }

      const block = this.api.blocks.getBlockByIndex(index);
      if (!block || block.name !== ListItem.TOOL_NAME) {
        // Hit a non-list block, no parent in this list
        return -1;
      }

      const blockDepth = this.getBlockDepth(block);
      if (blockDepth < currentDepth) {
        // Found a parent (shallower depth)
        return blockDepth;
      }

      return findParentDepth(index - 1);
    };

    return findParentDepth(blockIndex - 1);
  }

  private async handleIndent(): Promise<void> {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    if (currentBlockIndex === 0) return;

    const previousBlock = this.api.blocks.getBlockByIndex(currentBlockIndex - 1);
    if (!previousBlock || previousBlock.name !== ListItem.TOOL_NAME) return;

    const currentDepth = this.getDepth();
    const previousBlockDepth = this.getBlockDepth(previousBlock);

    // Can only indent to at most one level deeper than the previous item
    // This ensures proper parent-child hierarchy
    if (currentDepth > previousBlockDepth) return;

    // Sync current content before updating
    this.syncContentFromDOM();

    // Increase depth by 1
    const newDepth = currentDepth + 1;
    this._data.depth = newDepth;

    // Update the block data and re-render
    const updatedBlock = await this.api.blocks.update(this.blockId || '', {
      ...this._data,
      depth: newDepth,
    });

    // Restore focus to the updated block after DOM has been updated
    this.setCaretToBlockContent(updatedBlock);
  }

  private async handleOutdent(): Promise<void> {
    const currentDepth = this.getDepth();

    // Can't outdent if already at root level
    if (currentDepth === 0) return;

    // Sync current content before updating
    this.syncContentFromDOM();

    // Decrease depth by 1
    const newDepth = currentDepth - 1;
    this._data.depth = newDepth;

    // Update the block data and re-render
    const updatedBlock = await this.api.blocks.update(this.blockId || '', {
      ...this._data,
      depth: newDepth,
    });

    // Restore focus to the updated block after DOM has been updated
    this.setCaretToBlockContent(updatedBlock);
  }

  private getContentElement(): HTMLElement | null {
    if (!this._element) return null;

    if (this._data.style === 'checklist') {
      return this._element.querySelector('[contenteditable]') as HTMLElement;
    }

    const contentContainer = this._element.querySelector('div.flex-1') as HTMLElement;
    return contentContainer;
  }

  /**
   * Sets caret to the content element of a block after ensuring DOM is ready.
   * Uses requestAnimationFrame to wait for the browser to process DOM updates.
   * @param block - BlockAPI to set caret to
   * @param position - 'start' or 'end' position (defaults to 'end')
   */
  private setCaretToBlockContent(block: ReturnType<typeof this.api.blocks.insert>, position: 'start' | 'end' = 'end'): void {
    // Use requestAnimationFrame to ensure DOM has been updated
    requestAnimationFrame(() => {
      const holder = block.holder;
      if (!holder) return;

      // Find the contenteditable element within the new block
      const contentEl = holder.querySelector('[contenteditable="true"]') as HTMLElement;
      if (!contentEl) {
        // Fallback to setToBlock if no content element found
        this.api.caret.setToBlock(block, position);
        return;
      }

      // Focus the content element and set caret position
      contentEl.focus();

      const selection = window.getSelection();
      if (!selection) return;

      const range = document.createRange();

      if (position === 'start') {
        range.setStart(contentEl, 0);
        range.collapse(true);
      } else {
        // Set to end of content
        range.selectNodeContents(contentEl);
        range.collapse(false);
      }

      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  private isAtStart(element: HTMLElement, range: Range): boolean {
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length === 0;
  }

  /**
   * Check if the entire content of an element is selected
   * @param element - The content element to check
   * @param range - The current selection range
   * @returns true if the entire content is selected
   */
  private isEntireContentSelected(element: HTMLElement, range: Range): boolean {
    // Check if selection starts at the beginning
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const isAtStart = preCaretRange.toString().length === 0;

    // Check if selection ends at the end
    const postCaretRange = document.createRange();
    postCaretRange.selectNodeContents(element);
    postCaretRange.setStart(range.endContainer, range.endOffset);
    const isAtEnd = postCaretRange.toString().length === 0;

    return isAtStart && isAtEnd;
  }

  private splitContentAtCursor(contentEl: HTMLElement, range: Range): { beforeContent: string; afterContent: string } {
    const beforeRange = document.createRange();
    beforeRange.setStart(contentEl, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEndAfter(contentEl.lastChild || contentEl);

    return {
      beforeContent: this.getFragmentHTML(beforeRange.cloneContents()),
      afterContent: this.getFragmentHTML(afterRange.cloneContents()),
    };
  }

  private getFragmentHTML(fragment: DocumentFragment): string {
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  public renderSettings(): MenuConfig {
    return this.availableStyles.map(styleConfig => ({
      icon: styleConfig.icon,
      label: this.api.i18n.t(`toolNames.${styleConfig.name}`),
      onActivate: (): void => this.setStyle(styleConfig.style),
      closeOnActivate: true,
      isActive: this._data.style === styleConfig.style,
    }));
  }

  private setStyle(style: ListItemStyle): void {
    const previousStyle = this._data.style;
    this._data.style = style;
    this.rerender();

    // If style changed, update all ordered list markers since style boundaries have changed
    if (previousStyle !== style) {
      requestAnimationFrame(() => {
        this.updateAllOrderedListMarkers();
      });
    }
  }

  private rerender(): void {
    if (!this._element) return;

    const parent = this._element.parentNode;
    if (!parent) return;

    const newElement = this.createItemElement();
    parent.replaceChild(newElement, this._element);
    this._element = newElement;
  }

  public validate(blockData: ListItemData): boolean {
    // List items can be empty (unlike paragraphs)
    return typeof blockData.text === 'string';
  }

  public save(): ListItemData {
    if (!this._element) return this._data;

    const contentEl = this.getContentElement();
    const text = contentEl ? stripFakeBackgroundElements(contentEl.innerHTML) : this._data.text;

    const result: ListItemData = {
      text,
      style: this._data.style,
      checked: this._data.checked,
    };

    if (this._data.start !== undefined && this._data.start !== 1) {
      result.start = this._data.start;
    }

    if (this._data.depth !== undefined && this._data.depth > 0) {
      result.depth = this._data.depth;
    }

    return result;
  }

  /**
   * Updates the block's data in-place without destroying the DOM element.
   * Called by Block.setData() during undo/redo operations.
   *
   * @param newData - the new data to apply to the block
   * @returns true if update was performed in-place, false if full re-render needed
   */
  public setData(newData: ListItemData): boolean {
    if (!this._element) {
      return false;
    }

    const oldDepth = this._data.depth ?? 0;
    const newDepth = newData.depth ?? 0;
    const oldStyle = this._data.style;
    const newStyle = newData.style;

    // Style changes require full re-render (different DOM structure)
    if (oldStyle !== newStyle) {
      return false;
    }

    // Update internal data
    this._data = {
      ...this._data,
      ...newData,
    };

    // Update text content
    const contentEl = this.getContentElement();

    if (contentEl && typeof newData.text === 'string') {
      contentEl.innerHTML = newData.text;
    }

    // Update depth if changed
    const depthChanged = oldDepth !== newDepth;

    if (depthChanged) {
      this.adjustDepthTo(newDepth);
      this.updateMarkerForDepth(newDepth, newStyle);

      return true;
    }

    // Update checkbox state for checklist items
    const isChecklist = newStyle === 'checklist';

    if (isChecklist) {
      this.updateCheckboxState(newData.checked ?? false);
    }

    return true;
  }

  public merge(data: ListItemData): void {
    if (!this._element) {
      return;
    }

    this._data.text += data.text;

    const contentEl = this.getContentElement();
    if (contentEl && data.text) {
      const fragment = this.parseHtml(data.text);
      contentEl.appendChild(fragment);
      contentEl.normalize();
    }
  }

  /**
   * Parse HTML string into a DocumentFragment
   * @param html - HTML string to parse
   * @returns DocumentFragment with parsed nodes
   */
  private parseHtml(html: string): DocumentFragment {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();

    const fragment = document.createDocumentFragment();
    fragment.append(...Array.from(wrapper.childNodes));

    return fragment;
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: (data: ListItemData): string => {
        return data.text;
      },
      import: (content: string): ListItemData => {
        return {
          text: content,
          style: 'unordered',
          checked: false,
        };
      },
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      text: {
        br: true,
        a: {
          href: true,
          target: '_blank',
          rel: 'nofollow',
        },
        b: true,
        i: true,
        mark: true,
      },
    };
  }

  public static get pasteConfig(): PasteConfig {
    return { tags: ['LI'] };
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;
    if (!('data' in detail)) return;

    const content = detail.data as HTMLElement;
    const text = content.innerHTML || content.textContent || '';

    // Check for checked state if checklist
    const checkbox = content.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const checked = checkbox?.checked || false;

    this._data = {
      text,
      style: this.detectStyleFromPastedContent(content),
      checked,
    };

    this.rerender();
  }

  /**
   * Detect list style from pasted content based on parent element
   */
  private detectStyleFromPastedContent(content: HTMLElement): ListItemStyle {
    const parentList = content.parentElement;
    if (!parentList) return this._data.style;

    if (parentList.tagName === 'OL') return 'ordered';
    if (parentList.tagName !== 'UL') return this._data.style;

    // Check for checkbox inputs to detect checklist
    const hasCheckbox = content.querySelector('input[type="checkbox"]');
    return hasCheckbox ? 'checklist' : 'unordered';
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Returns the horizontal offset of the content at the hovered element.
   * Used by the toolbar to position itself closer to nested list items.
   *
   * @param hoveredElement - The element that is currently being hovered
   * @returns Object with left offset in pixels based on the list item's depth
   */
  public getContentOffset(hoveredElement: Element): { left: number } | undefined {
    // First try: find listitem in ancestors (when hovering content)
    // Second try: find listitem in descendants (when hovering wrapper)
    const listItemEl = hoveredElement.closest('[role="listitem"]')
      ?? hoveredElement.querySelector('[role="listitem"]');

    const marginLeftOffset = this.getMarginLeftFromElement(listItemEl);

    if (marginLeftOffset !== undefined) {
      return marginLeftOffset;
    }

    // Fallback: use data-list-depth from wrapper
    return this.getOffsetFromDepthAttribute(hoveredElement);
  }

  /**
   * Extracts the margin-left value from an element's inline style
   * @param element - The element to extract margin-left from
   * @returns Object with left offset if valid margin-left found, undefined otherwise
   */
  private getMarginLeftFromElement(element: Element | null): { left: number } | undefined {
    if (!element) {
      return undefined;
    }

    const style = element.getAttribute('style') || '';
    const marginMatch = style.match(/margin-left:\s*(\d+)px/);

    if (!marginMatch) {
      return undefined;
    }

    const marginLeft = parseInt(marginMatch[1], 10);

    return marginLeft > 0 ? { left: marginLeft } : undefined;
  }

  /**
   * Gets the offset from the data-list-depth attribute
   * @param hoveredElement - The element to start searching from
   * @returns Object with left offset based on depth, undefined if depth is 0 or not found
   */
  private getOffsetFromDepthAttribute(hoveredElement: Element): { left: number } | undefined {
    const wrapper = hoveredElement.closest('[data-list-depth]');

    if (!wrapper) {
      return undefined;
    }

    const depthAttr = wrapper.getAttribute('data-list-depth');

    if (depthAttr === null) {
      return undefined;
    }

    const depth = parseInt(depthAttr, 10);

    return depth > 0 ? { left: depth * ListItem.INDENT_PER_LEVEL } : undefined;
  }

  public static get toolbox(): ToolboxConfig {
    return [
      {
        icon: IconListBulleted,
        title: 'Bulleted list',
        titleKey: 'bulletedList',
        data: { style: 'unordered' },
        name: 'bulleted-list',
        searchTerms: ['ul', 'bullet', 'unordered', 'list'],
        shortcut: '-',
      },
      {
        icon: IconListNumbered,
        title: 'Numbered list',
        titleKey: 'numberedList',
        data: { style: 'ordered' },
        name: 'numbered-list',
        searchTerms: ['ol', 'ordered', 'number', 'list'],
        shortcut: '1.',
      },
      {
        icon: IconListChecklist,
        title: 'To-do list',
        titleKey: 'todoList',
        data: { style: 'checklist' },
        name: 'check-list',
        searchTerms: ['checkbox', 'task', 'todo', 'check', 'list'],
        shortcut: '[]',
      },
    ];
  }
}
