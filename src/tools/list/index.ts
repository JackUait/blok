/**
 * ListItem Tool for the Blok Editor
 * Represents a single list item in a hierarchical structure (Notion-like)
 *
 * @license MIT
 */
import { IconListUnordered, IconListOrdered, IconListChecklist } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { BLOK_TOOL_ATTR } from '../../components/constants';
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
  SanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

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
export default class ListItem implements BlockTool {
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
  private static readonly ITEM_STYLES = 'outline-none py-0.5 leading-[1.6em]';
  private static readonly CHECKLIST_ITEM_STYLES = 'flex items-start py-0.5';
  private static readonly CHECKBOX_STYLES = 'mt-1 w-4 mr-2 h-4 cursor-pointer accent-current';

  private static readonly STYLE_CONFIGS: StyleConfig[] = [
    { style: 'unordered', name: 'Bulleted list', icon: IconListUnordered },
    { style: 'ordered', name: 'Numbered list', icon: IconListOrdered },
    { style: 'checklist', name: 'Checklist', icon: IconListChecklist },
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
  }
  sanitize?: SanitizerConfig | undefined;

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

  private static readonly DEFAULT_PLACEHOLDER = 'List';

  private get placeholder(): string {
    return this.api.i18n.t(ListItem.DEFAULT_PLACEHOLDER);
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
   * Updates the marker to reflect the new position,
   * and also updates all sibling list items since their indices may have changed.
   */
  public moved(): void {
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
   * Called when this block is about to be removed.
   * Updates sibling ordered list markers to renumber correctly after removal.
   */
  public removed(): void {
    if (this._data.style !== 'ordered') {
      return;
    }

    // Schedule marker update for next frame, after DOM has been updated
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
   */
  private updateSiblingListMarkers(): void {
    const currentBlockIndex = this.blockId
      ? this.api.blocks.getBlockIndex(this.blockId) ?? this.api.blocks.getCurrentBlockIndex()
      : this.api.blocks.getCurrentBlockIndex();

    const currentDepth = this.getDepth();
    const blocksCount = this.api.blocks.getBlocksCount();

    // Find the start of this list group by walking backwards
    const groupStartIndex = this.findListGroupStartIndex(currentBlockIndex, currentDepth);

    // Update all ordered list items from groupStartIndex forward at this depth
    this.updateMarkersInRange(groupStartIndex, blocksCount, currentBlockIndex, currentDepth);
  }

  /**
   * Find the starting index of a list group by walking backwards
   */
  private findListGroupStartIndex(currentBlockIndex: number, currentDepth: number): number {
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

      const newStartIndex = blockDepth === currentDepth ? index : startIndex;
      return findStart(index - 1, newStartIndex);
    };

    return findStart(currentBlockIndex - 1, currentBlockIndex);
  }

  /**
   * Update markers for all list items in a range at the given depth
   */
  private updateMarkersInRange(
    startIndex: number,
    endIndex: number,
    skipIndex: number,
    targetDepth: number
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

      if (blockDepth === targetDepth) {
        this.updateBlockMarker(block);
      }

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

    const paddingMatch = styleAttr?.match(/padding-left:\s*(\d+)px/);
    return paddingMatch ? Math.round(parseInt(paddingMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;
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
    const siblingIndex = this.countPrecedingSiblingsAtDepth(blockIndex, blockDepth);

    // Get the start value for this list group
    const startValue = this.getListStartValueForBlock(blockIndex, blockDepth, siblingIndex);
    const actualNumber = startValue + siblingIndex;
    const markerText = this.formatOrderedMarker(actualNumber, blockDepth);

    marker.textContent = markerText;
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
   * Count preceding list items at the same depth for a given block index
   */
  private countPrecedingSiblingsAtDepth(blockIndex: number, targetDepth: number): number {
    if (blockIndex <= 0) {
      return 0;
    }

    return this.countPrecedingListItemsAtDepthFromIndex(blockIndex - 1, targetDepth);
  }

  /**
   * Recursively count preceding list items at the given depth starting from index
   */
  private countPrecedingListItemsAtDepthFromIndex(index: number, targetDepth: number): number {
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

    if (blockDepth === targetDepth) {
      return 1 + this.countPrecedingListItemsAtDepthFromIndex(index - 1, targetDepth);
    }

    // Deeper depth, skip and continue
    return this.countPrecedingListItemsAtDepthFromIndex(index - 1, targetDepth);
  }

  /**
   * Get the list start value for a block at a given index and depth
   */
  private getListStartValueForBlock(blockIndex: number, targetDepth: number, siblingIndex: number): number {
    if (siblingIndex === 0) {
      return this.getBlockStartValue(blockIndex);
    }

    // Find the first item in this list group
    const firstItemIndex = this.findFirstListItemIndexFromBlock(blockIndex - 1, targetDepth, siblingIndex);
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
   * Find the first list item in a consecutive group
   */
  private findFirstListItemIndexFromBlock(index: number, targetDepth: number, remainingCount: number): number | null {
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

    if (blockDepth === targetDepth) {
      return this.findFirstListItemIndexFromBlock(index - 1, targetDepth, remainingCount - 1);
    }

    return this.findFirstListItemIndexFromBlock(index - 1, targetDepth, remainingCount);
  }

  private createItemElement(): HTMLElement {
    const { style } = this._data;

    const wrapper = document.createElement('div');
    wrapper.className = ListItem.BASE_STYLES;
    wrapper.setAttribute(BLOK_TOOL_ATTR, ListItem.TOOL_NAME);
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
      item.style.paddingLeft = `${depth * ListItem.INDENT_PER_LEVEL}px`;
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
      wrapper.style.paddingLeft = `${depth * ListItem.INDENT_PER_LEVEL}px`;
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
   * Recursively count consecutive preceding list blocks at the same depth.
   * Stops when encountering a block that's not a list, or a list at a different depth.
   */
  private countPrecedingListItemsAtDepth(index: number, targetDepth: number): number {
    if (index < 0) {
      return 0;
    }

    const block = this.api.blocks.getBlockByIndex(index);
    if (!block || block.name !== ListItem.TOOL_NAME) {
      return 0;
    }

    // We need to get the block's data to check its depth
    // Since we can't directly access another block's tool data,
    // we'll check via the DOM for the depth attribute
    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[data-list-style]');
    const depthAttr = listItemEl?.querySelector('[role="listitem"]')?.getAttribute('style');

    // Calculate depth from padding (paddingLeft = depth * 24px)
    const paddingMatch = depthAttr?.match(/padding-left:\s*(\d+)px/);
    const blockDepth = paddingMatch ? Math.round(parseInt(paddingMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;

    // If this block is at a shallower depth, it's a "parent" - stop counting
    if (blockDepth < targetDepth) {
      return 0;
    }

    // If at same depth, count it and continue
    if (blockDepth === targetDepth) {
      return 1 + this.countPrecedingListItemsAtDepth(index - 1, targetDepth);
    }

    // If at deeper depth, skip it and continue checking
    return this.countPrecedingListItemsAtDepth(index - 1, targetDepth);
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
   * Walks backwards through the blocks counting items at the same depth.
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

    const paddingMatch = depthAttr?.match(/padding-left:\s*(\d+)px/);
    const blockDepth = paddingMatch ? Math.round(parseInt(paddingMatch[1], 10) / ListItem.INDENT_PER_LEVEL) : 0;

    // If this block is at a shallower depth, we've reached the boundary
    if (blockDepth < targetDepth) {
      return index + 1;
    }

    // If at same depth, decrement count and continue
    if (blockDepth === targetDepth) {
      return this.findFirstListItemIndex(index - 1, targetDepth, remainingCount - 1);
    }

    // If at deeper depth, skip it and continue checking
    return this.findFirstListItemIndex(index - 1, targetDepth, remainingCount);
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
      this.handleEnter();
      return;
    }

    if (event.key === 'Backspace') {
      this.handleBackspace(event);
      return;
    }

    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      void this.handleOutdent();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      void this.handleIndent();
    }
  }

  private handleEnter(): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const contentEl = this.getContentElement();
    if (!contentEl) return;

    const currentContent = contentEl.innerHTML.trim();

    // If current item is empty, handle based on depth
    if (currentContent === '' || currentContent === '<br>') {
      this.exitListOrOutdent();
      return;
    }

    // Split content and create new block
    const range = selection.getRangeAt(0);
    const { beforeContent, afterContent } = this.splitContentAtCursor(contentEl, range);

    // Update current block with before content
    contentEl.innerHTML = beforeContent;
    this._data.text = beforeContent;

    // Insert new list block after this one, preserving the depth
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const newBlock = this.api.blocks.insert(ListItem.TOOL_NAME, {
      text: afterContent,
      style: this._data.style,
      checked: false,
      depth: this._data.depth,
    }, undefined, currentBlockIndex + 1, true);

    // Set caret to the start of the new block's content element
    this.setCaretToBlockContent(newBlock, 'start');
  }

  private exitListOrOutdent(): void {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentDepth = this.getDepth();

    // If nested, outdent instead of exiting
    if (currentDepth > 0) {
      void this.handleOutdent();
      return;
    }

    // At root level, convert to paragraph
    this.api.blocks.delete(currentBlockIndex);
    const newBlock = this.api.blocks.insert('paragraph', { text: '' }, undefined, currentBlockIndex, true);
    this.setCaretToBlockContent(newBlock, 'start');
  }

  private handleBackspace(event: KeyboardEvent): void {
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

    const isEmptyContent = !currentContent || currentContent === '' || currentContent === '<br>';

    // Convert to paragraph (preserving indentation for nested items)
    this.api.blocks.delete(currentBlockIndex);
    const newBlock = this.api.blocks.insert(
      'paragraph',
      { text: isEmptyContent ? '' : currentContent },
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
   * Maximum allowed nesting depth
   */
  private static readonly MAX_DEPTH = 8;

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

  private async handleIndent(): Promise<void> {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    if (currentBlockIndex === 0) return;

    const previousBlock = this.api.blocks.getBlockByIndex(currentBlockIndex - 1);
    if (!previousBlock || previousBlock.name !== ListItem.TOOL_NAME) return;

    const currentDepth = this.getDepth();

    // Prevent indenting beyond max depth
    if (currentDepth >= ListItem.MAX_DEPTH) return;

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
      label: this.api.i18n.t(styleConfig.name),
      onActivate: (): void => this.setStyle(styleConfig.style),
      closeOnActivate: true,
      isActive: this._data.style === styleConfig.style,
    }));
  }

  private setStyle(style: ListItemStyle): void {
    this._data.style = style;
    this.rerender();
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

  public static get sanitize(): SanitizerConfig {
    return {
      text: {
        br: true,
        a: true,
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

  public static get toolbox(): ToolboxConfig {
    return [
      {
        icon: IconListUnordered,
        title: 'Bulleted list',
        data: { style: 'unordered' },
        name: 'bulleted-list',
      },
      {
        icon: IconListOrdered,
        title: 'Numbered list',
        data: { style: 'ordered' },
        name: 'numbered-list',
      },
      {
        icon: IconListChecklist,
        title: 'Checklist',
        data: { style: 'checklist' },
        name: 'check-list',
      },
    ];
  }
}
