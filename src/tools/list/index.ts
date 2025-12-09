/**
 * List Tool for the Blok Editor
 * Provides Ordered, Unordered, and Checklist Blocks
 *
 * @license MIT
 */
import { IconListUnordered, IconListOrdered, IconListChecklist } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { BLOK_TOOL_ATTR } from '../../components/constants';
import { PLACEHOLDER_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
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
 * List styles enum
 */
export type ListStyle = 'unordered' | 'ordered' | 'checklist';

/**
 * Single list item data
 */
export interface ListItem {
  /** Item content (can include HTML) */
  content: string;
  /** Checked state for checklist items */
  checked?: boolean;
  /** Nested items for indentation */
  items?: ListItem[];
}

/**
 * Tool's input and output data format
 */
export interface ListData extends BlockToolData {
  /** List style: unordered, ordered, or checklist */
  style: ListStyle;
  /** Array of list items */
  items: ListItem[];
  /** Starting number for ordered lists (defaults to 1) */
  start?: number;
}

/**
 * Tool's config from Editor
 */
export interface ListConfig {
  /** Default list style */
  defaultStyle?: ListStyle;
  /**
   * Available list styles for the settings menu.
   * When specified, only these styles will be available in the block settings dropdown.
   */
  styles?: ListStyle[];
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
  toolboxStyles?: ListStyle[];
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
 * List style configuration
 */
interface StyleConfig {
  /** Style identifier */
  style: ListStyle;
  /** Display name */
  name: string;
  /** Icon SVG */
  icon: string;
}

/**
 * List block for the Blok Editor.
 * Supports ordered, unordered, and checklist styles.
 */
export default class List implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _settings: ListConfig;
  private _data: ListData;
  private _element: HTMLElement | null = null;

  private static readonly BASE_STYLES = 'outline-none py-1';
  private static readonly ITEM_STYLES = 'outline-none py-0.5 leading-[1.6em]';
  private static readonly CHECKLIST_ITEM_STYLES = 'flex items-start py-0.5';
  private static readonly CHECKBOX_STYLES = 'mt-1 w-4 mr-2 h-4 cursor-pointer accent-current';



  private static readonly STYLE_CONFIGS: StyleConfig[] = [
    { style: 'unordered', name: 'Bulleted list', icon: IconListUnordered },
    { style: 'ordered', name: 'Numbered list', icon: IconListOrdered },
    { style: 'checklist', name: 'Checklist', icon: IconListChecklist },
  ];



  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<ListData, ListConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);
  }
  sanitize?: SanitizerConfig | undefined;

  private normalizeData(data: ListData | Record<string, never>): ListData {
    const defaultStyle = this._settings.defaultStyle || 'unordered';

    if (!data || typeof data !== 'object') {
      return {
        style: defaultStyle,
        items: [{ content: '', checked: false }],
      };
    }

    // Handle case where only style is provided (from toolbox data)
    const style = data.style || defaultStyle;

    if (!Array.isArray(data.items)) {
      return {
        style,
        items: [{ content: '', checked: false }],
        ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
      };
    }

    const normalizedItems = data.items.length > 0
      ? data.items.map(item => this.normalizeItem(item))
      : [{ content: '', checked: false }];

    return {
      style,
      items: normalizedItems,
      ...(data.start !== undefined && data.start !== 1 ? { start: data.start } : {}),
    };
  }

  private normalizeItem(item: ListItem | string): ListItem {
    if (typeof item === 'string') {
      return { content: item, checked: false };
    }

    const normalizedItem: ListItem = {
      content: item.content || '',
      checked: Boolean(item.checked),
    };

    // Preserve nested items
    if (item.items && Array.isArray(item.items) && item.items.length > 0) {
      normalizedItem.items = item.items.map(nestedItem => this.normalizeItem(nestedItem));
    }

    return normalizedItem;
  }

  private get currentStyleConfig(): StyleConfig {
    return List.STYLE_CONFIGS.find(s => s.style === this._data.style) || List.STYLE_CONFIGS[0];
  }

  private get availableStyles(): StyleConfig[] {
    const configuredStyles = this._settings.styles;
    if (!configuredStyles || configuredStyles.length === 0) {
      return List.STYLE_CONFIGS;
    }
    return List.STYLE_CONFIGS.filter(s => configuredStyles.includes(s.style));
  }

  private get itemColor(): string | undefined {
    return this._settings.itemColor;
  }

  private get itemSize(): string | undefined {
    return this._settings.itemSize;
  }

  private static readonly DEFAULT_PLACEHOLDER = 'List';

  private get placeholder(): string {
    return this.api.i18n.t(List.DEFAULT_PLACEHOLDER);
  }

  private applyItemStyles(el: HTMLElement): void {
    const element = el;
    if (this.itemColor) {
      element.style.color = this.itemColor;
    }
    if (this.itemSize) {
      element.style.fontSize = this.itemSize;
    }
  }

  private setupItemPlaceholder(el: HTMLElement): void {
    if (this.readOnly) {
      return;
    }
    setupPlaceholder(el, this.placeholder);
  }

  public render(): HTMLElement {
    this._element = this.createListElement();
    return this._element;
  }

  private createListElement(): HTMLElement {
    const { style, items } = this._data;

    const wrapper = document.createElement('div');
    wrapper.className = List.BASE_STYLES;
    wrapper.setAttribute(BLOK_TOOL_ATTR, 'list');
    wrapper.setAttribute('data-list-style', style);

    const listContent = style === 'checklist'
      ? this.createChecklistContent(items)
      : this.createStandardListContent(items, style);

    wrapper.appendChild(listContent);

    if (!this.readOnly) {
      wrapper.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    return wrapper;
  }



  private createStandardListContent(items: ListItem[], style: ListStyle, parentPath: number[] = []): HTMLElement {
    const depth = parentPath.length;
    const list = document.createElement('div');
    list.setAttribute('role', 'list');
    list.className = 'pl-0.5';

    // Store start value as data attribute for ordered lists
    const startValue = style === 'ordered' && depth === 0 ? (this._data.start ?? 1) : 1;
    if (style === 'ordered') {
      list.setAttribute('data-list-start', String(startValue));
    }

    items.forEach((item, index) => {
      list.appendChild(this.createListItem(item, index, parentPath, startValue));
    });

    return list;
  }

  private createChecklistContent(items: ListItem[], parentPath: number[] = []): HTMLElement {
    const list = document.createElement('div');
    list.setAttribute('role', 'list');
    list.className = 'space-y-0.5';

    items.forEach((item, index) => {
      const currentPath = [...parentPath, index];
      list.appendChild(this.createChecklistItem(item, index, currentPath));

      // Render nested items for checklist recursively
      if (item.items && item.items.length > 0) {
        const nestedContainer = this.createChecklistContent(item.items, currentPath);
        nestedContainer.className = 'pl-6 space-y-0.5';
        list.appendChild(nestedContainer);
      }
    });

    return list;
  }

  private createListItem(item: ListItem, index: number, itemPath: number[] = [], startValue: number = 1): HTMLDivElement {
    const listItem = document.createElement('div');
    listItem.setAttribute('role', 'listitem');
    listItem.className = twMerge(List.ITEM_STYLES, 'flex', ...PLACEHOLDER_CLASSES);
    listItem.setAttribute('data-item-index', String(index));

    // Store the full path to this item for nested item tracking
    const currentPath = [...itemPath, index];
    listItem.setAttribute('data-item-path', JSON.stringify(currentPath));
    this.applyItemStyles(listItem);

    // Create marker element
    const marker = this.createListMarker(index, itemPath.length, startValue);
    listItem.appendChild(marker);

    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'flex-1 min-w-0';

    // If this item has nested items, render them recursively
    if (item.items && item.items.length > 0) {
      // Create a content wrapper for the main item text
      const contentWrapper = document.createElement('div');
      contentWrapper.contentEditable = this.readOnly ? 'false' : 'true';
      contentWrapper.innerHTML = item.content;
      contentWrapper.className = twMerge('outline-none', ...PLACEHOLDER_CLASSES);
      this.setupItemPlaceholder(contentWrapper);

      contentContainer.appendChild(contentWrapper);

      // Create nested list recursively
      const nestedList = document.createElement('div');
      nestedList.setAttribute('role', 'list');
      nestedList.className = 'pl-0.5 mt-1';

      item.items.forEach((nestedItem, nestedIndex) => {
        // Recursively create nested items with the full path
        const nestedListItem = this.createListItem(nestedItem, nestedIndex, currentPath, 1);
        nestedList.appendChild(nestedListItem);
      });

      contentContainer.appendChild(nestedList);
    } else {
      // No nested items - make the content container editable
      contentContainer.contentEditable = this.readOnly ? 'false' : 'true';
      contentContainer.innerHTML = item.content;
      contentContainer.className = twMerge(contentContainer.className, 'outline-none', ...PLACEHOLDER_CLASSES);
      this.setupItemPlaceholder(contentContainer);
    }

    listItem.appendChild(contentContainer);
    return listItem;
  }

  /**
   * Create the marker element (bullet or number) for a list item
   */
  private createListMarker(index: number, depth: number, startValue: number): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'flex-shrink-0 select-none';
    marker.setAttribute('aria-hidden', 'true');
    marker.contentEditable = 'false';

    if (this._data.style === 'ordered') {
      const markerText = this.getOrderedMarkerText(index, depth, startValue);
      marker.textContent = markerText;
      marker.className = twMerge(marker.className, 'text-right');
      marker.style.paddingRight = '11px';
      // Width is set dynamically based on marker text content
      marker.style.minWidth = 'fit-content';
    } else {
      // Unordered list - use bullet character based on depth with 24px size
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
   * Get the appropriate bullet character based on nesting depth
   */
  private getBulletCharacter(depth: number): string {
    const bullets = ['•', '◦', '▪'];
    return bullets[depth % bullets.length];
  }

  /**
   * Get the ordered list marker text based on depth and index
   * Level 0: decimal (1, 2, 3...)
   * Level 1: lower-alpha (a, b, c...)
   * Level 2: lower-roman (i, ii, iii...)
   */
  private getOrderedMarkerText(index: number, depth: number, startValue: number): string {
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
   * Convert number to lowercase letter (1=a, 2=b, ..., 26=z, 27=aa, etc.)
   */
  private numberToLowerAlpha(num: number): string {
    const convertRecursive = (n: number): string => {
      if (n <= 0) return '';
      const adjusted = n - 1;
      return convertRecursive(Math.floor(adjusted / 26)) + String.fromCharCode(97 + (adjusted % 26));
    };
    return convertRecursive(num);
  }

  /**
   * Convert number to lowercase Roman numerals
   */
  private numberToLowerRoman(num: number): string {
    const romanNumerals: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
    ];

    const convertRecursive = (remaining: number, index: number): string => {
      if (remaining <= 0 || index >= romanNumerals.length) return '';
      const [value, numeral] = romanNumerals[index];
      if (remaining >= value) {
        return numeral + convertRecursive(remaining - value, index);
      }
      return convertRecursive(remaining, index + 1);
    };

    return convertRecursive(num, 0);
  }

  private createChecklistItem(item: ListItem, index: number, itemPath: number[]): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'listitem');
    wrapper.className = List.CHECKLIST_ITEM_STYLES;
    wrapper.setAttribute('data-item-index', String(index));
    wrapper.setAttribute('data-item-path', JSON.stringify(itemPath));
    this.applyItemStyles(wrapper);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = List.CHECKBOX_STYLES;
    checkbox.checked = Boolean(item.checked);
    checkbox.disabled = this.readOnly;

    const content = document.createElement('div');
    content.className = twMerge(
      'flex-1 outline-none leading-[1.6em]',
      item.checked ? 'line-through opacity-60' : '',
      ...PLACEHOLDER_CLASSES
    );
    content.contentEditable = this.readOnly ? 'false' : 'true';
    content.innerHTML = item.content;
    this.setupItemPlaceholder(content);

    if (!this.readOnly) {
      checkbox.addEventListener('change', () => {
        // Update the correct item using the path
        const itemToUpdate = this.getItemAtPath(itemPath);
        if (itemToUpdate) {
          itemToUpdate.checked = checkbox.checked;
        }
        content.classList.toggle('line-through', checkbox.checked);
        content.classList.toggle('opacity-60', checkbox.checked);
      });
    }

    wrapper.appendChild(checkbox);
    wrapper.appendChild(content);
    return wrapper;
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
      this.handleOutdent();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.handleIndent();
    }
  }

  private handleEnter(): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    const currentItem = this.findItemElement(focusNode);
    if (!currentItem) return;

    const itemPath = this.getItemPath(currentItem);
    if (!itemPath || itemPath.length === 0) return;

    const contentEl = this.getContentElement(currentItem);
    if (!contentEl) return;

    const currentContent = contentEl.innerHTML.trim();

    // If current item is empty, exit the list and create a new paragraph
    if (currentContent === '' || currentContent === '<br>') {
      this.exitListAndCreateParagraph(itemPath);
      return;
    }

    // Otherwise, add a new item
    this.addNewItem(itemPath);
  }

  private exitListAndCreateParagraph(itemPath: number[]): void {
    const currentIndex = itemPath[itemPath.length - 1];
    const parentPath = itemPath.slice(0, -1);

    // If item is nested (not at root level), un-nest it instead of exiting
    if (parentPath.length > 0) {
      this.unnestEmptyItem(itemPath);
      return;
    }

    // Get the array containing this item (root level)
    const itemsArray = this.getItemsArrayAtPath(parentPath);
    if (!itemsArray) return;

    // Remove the empty item
    itemsArray.splice(currentIndex, 1);

    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();

    // If no items left at root level, delete the entire list block and insert a paragraph
    if (this._data.items.length === 0) {
      this.api.blocks.delete(currentBlockIndex);
      const newBlock = this.api.blocks.insert('paragraph', { text: '' }, undefined, currentBlockIndex, true);
      this.api.caret.setToBlock(newBlock, 'start');
      return;
    }

    // Re-render the list without the empty item
    this.rerender();

    // Insert a new paragraph block after the current list block and focus it
    const newBlock = this.api.blocks.insert('paragraph', { text: '' }, undefined, currentBlockIndex + 1, true);
    this.api.caret.setToBlock(newBlock, 'start');
  }

  /**
   * Un-nest an empty item by moving it to the parent level.
   * This is called when Enter is pressed on an empty nested item.
   */
  private unnestEmptyItem(itemPath: number[]): void {
    const currentIndex = itemPath[itemPath.length - 1];
    const parentPath = itemPath.slice(0, -1);
    const parentIndex = parentPath[parentPath.length - 1];

    // Get the parent item that contains this nested item
    const parentItem = this.getItemAtPath(parentPath);
    if (!parentItem || !parentItem.items) return;

    // Get the empty item to un-nest
    const itemToUnnest = this.deepCopyItem(parentItem.items[currentIndex]);

    // Get any siblings that come after the current item - they should become children of the un-nested item
    const followingSiblings = parentItem.items.slice(currentIndex + 1).map(item => this.deepCopyItem(item));

    // If there are following siblings, add them as children of the un-nested item
    if (followingSiblings.length > 0) {
      const existingItems = itemToUnnest.items || [];
      itemToUnnest.items = [...existingItems, ...followingSiblings];
    }

    // Remove the un-nested item and all following siblings from the parent's nested array
    parentItem.items.splice(currentIndex);

    // Clean up empty nested arrays
    if (parentItem.items.length === 0) {
      delete parentItem.items;
    }

    // Get the grandparent array (where we'll insert the un-nested item)
    const grandparentPath = parentPath.slice(0, -1);
    const grandparentArray = this.getItemsArrayAtPath(grandparentPath);
    if (!grandparentArray) return;

    // Insert after the parent item at the grandparent level
    grandparentArray.splice(parentIndex + 1, 0, itemToUnnest);

    this.rerender();

    // Focus the un-nested item at its new path
    const newPath = [...grandparentPath, parentIndex + 1];
    this.focusItemAtPath(newPath);
  }

  private addNewItem(itemPath: number[]): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const pathStr = JSON.stringify(itemPath);
    const currentItem = this._element.querySelector(`[data-item-path='${pathStr}']`) as HTMLElement;
    if (!currentItem) return;

    const contentEl = this.getContentElement(currentItem);
    if (!contentEl) return;

    const range = selection.getRangeAt(0);
    const { beforeContent, afterContent } = this.splitContentAtCursor(contentEl, range);

    // Sync DOM content to data before modifying
    this.syncDataFromDOM();

    const currentIndex = itemPath[itemPath.length - 1];
    const parentPath = itemPath.slice(0, -1);

    // Get the array containing this item
    const itemsArray = this.getItemsArrayAtPath(parentPath);
    if (!itemsArray) return;

    // Update the current item's content
    const currentItemData = itemsArray[currentIndex];
    if (!currentItemData) return;

    currentItemData.content = beforeContent;

    // Create new item with afterContent
    const newItem: ListItem = { content: afterContent, checked: false };

    // If current item has nested children, move them to the new item
    if (currentItemData.items && currentItemData.items.length > 0) {
      newItem.items = currentItemData.items;
      delete currentItemData.items;
    }

    itemsArray.splice(currentIndex + 1, 0, newItem);

    this.rerender();

    // Focus the new item at the correct path
    const newItemPath = [...parentPath, currentIndex + 1];
    this.focusItemAtPath(newItemPath);
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

  private getContentElement(item: HTMLElement): HTMLElement | null {
    if (this._data.style === 'checklist') {
      return item.querySelector('[contenteditable]') as HTMLElement;
    }

    // For standard lists with non-semantic structure, find the content container
    // It's the second child (after the marker) or a nested contenteditable div
    const contentContainer = item.querySelector(':scope > div.flex-1') as HTMLElement;
    if (!contentContainer) {
      return null;
    }

    // Check if there's a nested contenteditable wrapper (for items with children)
    const nestedWrapper = contentContainer.querySelector(':scope > div[contenteditable]') as HTMLElement;
    if (nestedWrapper) {
      return nestedWrapper;
    }

    // Otherwise the content container itself is editable
    return contentContainer;
  }

  private handleBackspace(event: KeyboardEvent): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    const currentItem = this.findItemElement(focusNode);
    if (!currentItem) return;

    const currentIndex = parseInt(currentItem.getAttribute('data-item-index') || '0', 10);
    const range = selection.getRangeAt(0);

    if (!this.shouldMergeWithPrevious(currentItem, range, currentIndex)) return;

    event.preventDefault();
    this.mergeWithPreviousItem(currentIndex);
  }

  private shouldMergeWithPrevious(currentItem: HTMLElement, range: Range, currentIndex: number): boolean {
    if (range.startOffset !== 0 || !range.collapsed || currentIndex === 0) return false;

    const contentEl = this.getContentElement(currentItem);
    if (!contentEl) return false;

    return this.isAtStart(contentEl, range);
  }

  private mergeWithPreviousItem(currentIndex: number): void {
    const prevContent = this._data.items[currentIndex - 1].content;
    const currentContent = this._data.items[currentIndex].content;
    this._data.items[currentIndex - 1].content = prevContent + currentContent;
    this._data.items.splice(currentIndex, 1);

    this.rerender();
    this.focusItem(currentIndex - 1, prevContent.length);
  }

  /**
   * Sync DOM content to this._data.items to ensure data is up-to-date
   * before performing operations like indent/outdent
   */
  private syncDataFromDOM(): void {
    if (!this._element) return;

    const items = this.extractItemsFromDOM();
    if (items.length > 0) {
      this._data.items = items;
    }
  }

  private handleIndent(): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    const currentItem = this.findItemElement(focusNode);
    if (!currentItem) return;

    const itemPath = this.getItemPath(currentItem);
    if (!itemPath || itemPath.length === 0) return;

    const currentIndex = itemPath[itemPath.length - 1];

    // Cannot indent the first item at any level (no previous sibling to nest under)
    if (currentIndex === 0) return;

    // Save cursor position before modifying DOM
    const cursorOffset = this.saveCursorOffset(currentItem);

    // Sync DOM content to data before modifying
    this.syncDataFromDOM();

    // Get the parent array that contains this item
    const parentArray = this.getItemsArrayAtPath(itemPath.slice(0, -1));
    if (!parentArray) return;

    // Get the current item data
    const itemToIndent = parentArray[currentIndex];
    if (!itemToIndent) return;

    // Get the previous item at the same level
    const previousItem = parentArray[currentIndex - 1];
    if (!previousItem) return;

    // Initialize nested items array if it doesn't exist
    if (!previousItem.items) {
      previousItem.items = [];
    }

    // Move current item as a child of the previous item (deep copy to preserve nested items)
    previousItem.items.push(this.deepCopyItem(itemToIndent));

    // Remove the item from the current level
    parentArray.splice(currentIndex, 1);

    this.rerender();

    // Focus the indented item - build the new path
    const newPath = [...itemPath.slice(0, -1), currentIndex - 1, previousItem.items.length - 1];
    this.focusItemAtPath(newPath, cursorOffset);
  }

  /**
   * Get the path array from an item element's data-item-path attribute
   */
  private getItemPath(element: HTMLElement): number[] | null {
    const pathAttr = element.getAttribute('data-item-path');
    if (!pathAttr) {
      // Fallback for items without path (shouldn't happen after fix)
      const index = element.getAttribute('data-item-index');
      return index !== null ? [parseInt(index, 10)] : null;
    }
    try {
      return JSON.parse(pathAttr);
    } catch {
      return null;
    }
  }

  /**
   * Get the items array at a given path (empty path returns root items)
   */
  private getItemsArrayAtPath(path: number[]): ListItem[] | null {
    if (path.length === 0) {
      return this._data.items;
    }

    return path.reduce<ListItem[] | null>((current, index, i) => {
      if (!current) return null;
      const item = current[index];
      if (!item) return null;
      if (i === path.length - 1) {
        return item.items || null;
      }
      return item.items || null;
    }, this._data.items);
  }

  /**
   * Get a specific item at a given path
   */
  private getItemAtPath(path: number[]): ListItem | null {
    if (path.length === 0) return null;

    const parentArray = this.getItemsArrayAtPath(path.slice(0, -1));
    if (!parentArray) return null;

    return parentArray[path[path.length - 1]] || null;
  }

  /**
   * Deep copy a list item including all nested items
   */
  private deepCopyItem(item: ListItem): ListItem {
    const copy: ListItem = {
      content: item.content,
      checked: item.checked,
    };
    if (item.items && item.items.length > 0) {
      copy.items = item.items.map(nestedItem => this.deepCopyItem(nestedItem));
    }
    return copy;
  }

  /**
   * Focus an item at a specific path, optionally restoring cursor position
   */
  private focusItemAtPath(path: number[], cursorOffset?: number): void {
    if (!this._element || path.length === 0) return;

    const pathStr = JSON.stringify(path);
    const item = this._element.querySelector(`[data-item-path='${pathStr}']`);
    if (!item) return;

    const contentEl = this.getContentElement(item as HTMLElement);
    if (!contentEl) return;

    contentEl.focus();

    if (cursorOffset !== undefined) {
      this.setCursorAtOffset(contentEl, cursorOffset);
    }
  }

  /**
   * Save the current cursor offset within an item element
   */
  private saveCursorOffset(itemElement: HTMLElement): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;

    const contentEl = this.getContentElement(itemElement);
    if (!contentEl) return 0;

    const range = selection.getRangeAt(0);

    // Calculate the offset from the start of the content element
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(contentEl);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    // Get the text length before the cursor
    return preCaretRange.toString().length;
  }

  private handleOutdent(): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    const currentItem = this.findItemElement(focusNode);
    if (!currentItem) return;

    const itemPath = this.getItemPath(currentItem);
    if (!itemPath || itemPath.length <= 1) {
      // Item is at root level, cannot outdent further
      return;
    }

    // Save cursor position before modifying DOM
    const cursorOffset = this.saveCursorOffset(currentItem);

    // Sync DOM content to data before modifying
    this.syncDataFromDOM();

    const currentIndex = itemPath[itemPath.length - 1];
    const parentPath = itemPath.slice(0, -1);
    const parentIndex = parentPath[parentPath.length - 1];

    // Get the parent item that contains this nested item
    const parentItem = this.getItemAtPath(parentPath);
    if (!parentItem || !parentItem.items || !parentItem.items[currentIndex]) return;

    // Get the nested item to outdent
    const itemToOutdent = this.deepCopyItem(parentItem.items[currentIndex]);

    // Get any siblings that come after the current item - they should become children of the outdented item
    const followingSiblings = parentItem.items.slice(currentIndex + 1).map(item => this.deepCopyItem(item));

    // If there are following siblings, add them as children of the outdented item
    if (followingSiblings.length > 0) {
      const existingItems = itemToOutdent.items || [];
      itemToOutdent.items = [...existingItems, ...followingSiblings];
    }

    // Remove the outdented item and all following siblings from the parent's nested array
    parentItem.items.splice(currentIndex);

    // Clean up empty nested arrays
    if (parentItem.items.length === 0) {
      delete parentItem.items;
    }

    // Get the grandparent array (where we'll insert the outdented item)
    const grandparentPath = parentPath.slice(0, -1);
    const grandparentArray = this.getItemsArrayAtPath(grandparentPath);
    if (!grandparentArray) return;

    // Insert after the parent item at the grandparent level
    grandparentArray.splice(parentIndex + 1, 0, itemToOutdent);

    this.rerender();

    // Focus the outdented item at its new path
    const newPath = [...grandparentPath, parentIndex + 1];
    this.focusItemAtPath(newPath, cursorOffset);
  }

  private isAtStart(element: HTMLElement, range: Range): boolean {
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length === 0;
  }

  private findItemElement(node: Node): HTMLElement | null {
    return this.traverseToItemElement(node);
  }

  private traverseToItemElement(node: Node): HTMLElement | null {
    if (node === this._element) return null;

    if (node instanceof HTMLElement && node.hasAttribute('data-item-index')) {
      return node;
    }

    const parent = node.parentNode;
    if (!parent) return null;

    return this.traverseToItemElement(parent);
  }

  private getFragmentHTML(fragment: DocumentFragment): string {
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  private rerender(): void {
    if (!this._element) return;

    const parent = this._element.parentNode;
    if (!parent) return;

    const newElement = this.createListElement();
    parent.replaceChild(newElement, this._element);
    this._element = newElement;
  }

  private focusItem(index: number, offset?: number): void {
    if (!this._element) return;

    // Use path-based lookup for root items
    const pathStr = JSON.stringify([index]);
    const item = this._element.querySelector(`[data-item-path='${pathStr}']`);
    if (!item) return;

    const contentEl = this.getContentElement(item as HTMLElement);
    if (!contentEl) return;

    contentEl.focus();

    if (offset === undefined) return;

    this.setCursorAtOffset(contentEl, offset);
  }

  private setCursorAtOffset(element: HTMLElement, offset: number): void {
    const range = document.createRange();
    const selection = window.getSelection();
    const textNode = this.findTextNodeAtOffset(element, offset);

    if (!textNode) return;

    range.setStart(textNode.node, textNode.offset);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private findTextNodeAtOffset(element: HTMLElement, targetOffset: number): { node: Node; offset: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const result = this.walkTextNodes(walker, targetOffset, 0);

    if (result) return result;

    return this.getLastTextNodePosition(element);
  }

  private walkTextNodes(
    walker: TreeWalker,
    targetOffset: number,
    currentOffset: number
  ): { node: Node; offset: number } | null {
    const node = walker.nextNode();
    if (!node) return null;

    const nodeLength = node.textContent?.length || 0;
    if (currentOffset + nodeLength >= targetOffset) {
      return { node, offset: targetOffset - currentOffset };
    }

    return this.walkTextNodes(walker, targetOffset, currentOffset + nodeLength);
  }

  private getLastTextNodePosition(element: HTMLElement): { node: Node; offset: number } | null {
    const lastChild = element.lastChild;
    if (!lastChild || lastChild.nodeType !== Node.TEXT_NODE) return null;

    return { node: lastChild, offset: lastChild.textContent?.length || 0 };
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

  private setStyle(style: ListStyle): void {
    this._data.style = style;
    this.rerender();
  }

  public validate(blockData: ListData): boolean {
    return blockData.items && blockData.items.length > 0 &&
      blockData.items.some(item => item.content.trim() !== '');
  }

  public save(): ListData {
    if (!this._element) return this._data;

    const items = this.extractItemsFromDOM();

    const result: ListData = {
      style: this._data.style,
      items: items.length > 0 ? items : this._data.items,
    };

    // Include start property for ordered lists with non-default start
    if (this._data.style === 'ordered' && this._data.start !== undefined && this._data.start !== 1) {
      result.start = this._data.start;
    }

    return result;
  }

  private extractItemsFromDOM(): ListItem[] {
    if (!this._element) return [];

    if (this._data.style === 'checklist') {
      return this.extractChecklistItemsFromDOM();
    }

    // Get all root-level items (path length of 1)
    const rootItemElements = this._element.querySelectorAll('[data-item-path]');
    const items: ListItem[] = [];

    rootItemElements.forEach((itemEl) => {
      const pathAttr = itemEl.getAttribute('data-item-path');
      if (!pathAttr) return;

      try {
        const path = JSON.parse(pathAttr) as number[];
        // Only process root-level items (path length of 1)
        if (path.length === 1) {
          const item = this.extractItemDataRecursive(itemEl as HTMLElement);
          items.push(item);
        }
      } catch {
        // Skip items with invalid paths
      }
    });

    return items;
  }

  /**
   * Extract checklist items from DOM, handling the flat sibling structure
   */
  private extractChecklistItemsFromDOM(): ListItem[] {
    if (!this._element) return [];

    const allElements = this._element.querySelectorAll('[data-item-path]');

    // Build a map of items by their path
    const itemMap = new Map<string, ListItem>();
    const rootItems: ListItem[] = [];

    allElements.forEach((itemEl) => {
      const pathAttr = itemEl.getAttribute('data-item-path');
      if (!pathAttr) return;

      try {
        const path = JSON.parse(pathAttr) as number[];
        const item = this.extractItemData(itemEl as HTMLElement);
        itemMap.set(pathAttr, item);

        if (path.length === 1) {
          // Root level item
          rootItems[path[0]] = item;
        } else {
          // Nested item - find parent and add to its items array
          this.addNestedItemToParent(itemMap, path, item);
        }
      } catch {
        // Skip items with invalid paths
      }
    });

    // Filter out any undefined entries
    return rootItems.filter(Boolean);
  }

  /**
   * Helper to add a nested item to its parent
   */
  private addNestedItemToParent(
    itemMap: Map<string, ListItem>,
    path: number[],
    item: ListItem
  ): void {
    const parentPath = path.slice(0, -1);
    const parentPathStr = JSON.stringify(parentPath);
    const parentItem = itemMap.get(parentPathStr);
    if (!parentItem) return;

    if (!parentItem.items) {
      parentItem.items = [];
    }
    parentItem.items[path[path.length - 1]] = item;
  }

  /**
   * Recursively extract item data including all nested items
   */
  private extractItemDataRecursive(itemEl: HTMLElement): ListItem {
    const item = this.extractItemData(itemEl);

    // Check for nested list within this item (now a div with role="list")
    const contentContainer = itemEl.querySelector(':scope > div.flex-1') as HTMLElement;
    const nestedList = contentContainer?.querySelector(':scope > div[role="list"]');
    const nestedItems = nestedList?.querySelectorAll(':scope > div[data-item-path]');

    if (!nestedItems || nestedItems.length === 0) {
      return item;
    }

    item.items = [];
    nestedItems.forEach((nestedEl) => {
      item.items!.push(this.extractItemDataRecursive(nestedEl as HTMLElement));
    });

    return item;
  }

  private extractItemData(itemEl: HTMLElement): ListItem {
    if (this._data.style === 'checklist') {
      const checkbox = itemEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const content = itemEl.querySelector('[contenteditable]') as HTMLElement;
      return {
        content: content?.innerHTML || '',
        checked: checkbox?.checked || false,
      };
    }

    // For standard lists with non-semantic structure
    const contentContainer = itemEl.querySelector(':scope > div.flex-1') as HTMLElement;
    if (!contentContainer) {
      return { content: '', checked: false };
    }

    // Check for nested content wrapper
    const nestedWrapper = contentContainer.querySelector(':scope > div[contenteditable]') as HTMLElement;
    if (nestedWrapper) {
      return { content: nestedWrapper.innerHTML || '', checked: false };
    }

    return { content: contentContainer.innerHTML || '', checked: false };
  }

  public merge(data: ListData): void {
    this._data.items = [...this._data.items, ...data.items];
    this.rerender();
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;
    if (!('data' in detail)) return;

    const content = detail.data as HTMLElement;
    const style = this.getStyleFromTag(content.tagName);
    const items = this.extractItemsFromPastedContent(content);

    this._data = {
      style,
      items: items.length > 0 ? items : [{ content: '', checked: false }],
    };

    // Extract start attribute from pasted ordered lists
    if (style === 'ordered' && content instanceof HTMLOListElement && content.start !== 1) {
      this._data.start = content.start;
    }

    this.rerender();
  }

  private getStyleFromTag(tagName: string): ListStyle {
    if (tagName === 'OL') return 'ordered';
    return 'unordered';
  }

  private extractItemsFromPastedContent(content: HTMLElement): ListItem[] {
    const items: ListItem[] = [];
    const listItems = content.querySelectorAll('li');

    listItems.forEach(li => {
      items.push({ content: li.innerHTML, checked: false });
    });

    return items;
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: (data: ListData): string => {
        return data.items.map(item => item.content).join('\n');
      },
      import: (content: string): ListData => {
        return {
          style: 'unordered',
          items: content.split('\n').map(line => ({ content: line, checked: false })),
        };
      },
    };
  }

  public static get sanitize(): SanitizerConfig {
    return { style: false, items: true };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return { tags: ['OL', 'UL'] };
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
