/**
 * List Tool for the Blok Editor
 * Provides Ordered, Unordered, and Checklist Blocks
 *
 * @license MIT
 */
import { IconListUnordered, IconListOrdered, IconListChecklist } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { BLOK_TOOL_ATTR } from '../../components/constants';
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
  /** HTML tag for the list */
  tag: 'ul' | 'ol';
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
  private static readonly CHECKLIST_ITEM_STYLES = 'flex items-start gap-2 py-0.5';
  private static readonly CHECKBOX_STYLES = 'mt-1 w-4 h-4 cursor-pointer accent-current';

  /**
   * Placeholder styling classes using Tailwind arbitrary variants.
   * Applied to ::before pseudo-element only when element is empty.
   */
  private static readonly PLACEHOLDER_CLASSES = [
    'empty:before:pointer-events-none',
    'empty:before:text-gray-text',
    'empty:before:cursor-text',
    'empty:before:content-[attr(data-placeholder)]',
    '[&[data-blok-empty=true]]:before:pointer-events-none',
    '[&[data-blok-empty=true]]:before:text-gray-text',
    '[&[data-blok-empty=true]]:before:cursor-text',
    '[&[data-blok-empty=true]]:before:content-[attr(data-placeholder)]',
  ];

  private static readonly STYLE_CONFIGS: StyleConfig[] = [
    { style: 'unordered', name: 'Bulleted list', icon: IconListUnordered, tag: 'ul' },
    { style: 'ordered', name: 'Numbered list', icon: IconListOrdered, tag: 'ol' },
    { style: 'checklist', name: 'Checklist', icon: IconListChecklist, tag: 'ul' },
  ];



  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<ListData, ListConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config || {};
    this._data = this.normalizeData(data);
  }

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
      };
    }

    const normalizedItems = data.items.length > 0
      ? data.items.map(item => this.normalizeItem(item))
      : [{ content: '', checked: false }];

    return { style, items: normalizedItems };
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

  private applyPlaceholder(el: HTMLElement): void {
    if (this.placeholder) {
      el.setAttribute('data-placeholder', this.placeholder);
    }
  }

  private addFocusHandler(el: HTMLElement): void {
    if (this.readOnly) {
      return;
    }

    el.addEventListener('focus', () => {
      const element = el;
      const isEmpty = element.innerHTML.trim() === '' || element.innerHTML === '<br>';
      if (!isEmpty) {
        return;
      }

      // Clear any <br> tags to ensure clean empty state for placeholder
      if (element.innerHTML === '<br>') {
        element.innerHTML = '';
      }

      // Set caret at the start for empty items (at the placeholder position)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
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

  /**
   * Ordered list style cycle for nested levels:
   * Level 0: decimal (1, 2, 3...)
   * Level 1: lower-alpha (a, b, c...)
   * Level 2: lower-roman (i, ii, iii...)
   * Level 3+: cycle repeats
   */
  private static readonly ORDERED_LIST_STYLES = ['list-decimal', 'list-[lower-alpha]', 'list-[lower-roman]'];

  private getOrderedListStyle(depth: number): string {
    return List.ORDERED_LIST_STYLES[depth % List.ORDERED_LIST_STYLES.length];
  }

  private createStandardListContent(items: ListItem[], style: ListStyle, parentPath: number[] = []): HTMLElement {
    const styleConfig = this.currentStyleConfig;
    const list = document.createElement(styleConfig.tag);
    const depth = parentPath.length;
    const listStyleClass = style === 'ordered' ? this.getOrderedListStyle(depth) : 'list-disc';
    list.className = twMerge('pl-6', listStyleClass);

    items.forEach((item, index) => {
      list.appendChild(this.createListItem(item, index, parentPath));
    });

    return list;
  }

  private createChecklistContent(items: ListItem[], parentPath: number[] = []): HTMLElement {
    const list = document.createElement('div');
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

  private createListItem(item: ListItem, index: number, itemPath: number[] = []): HTMLLIElement {
    const li = document.createElement('li');
    li.className = twMerge(List.ITEM_STYLES, ...List.PLACEHOLDER_CLASSES);
    li.setAttribute('data-item-index', String(index));

    // Store the full path to this item for nested item tracking
    const currentPath = [...itemPath, index];
    li.setAttribute('data-item-path', JSON.stringify(currentPath));
    this.applyItemStyles(li);
    this.applyPlaceholder(li);

    // If this item has nested items, render them recursively
    if (item.items && item.items.length > 0) {
      li.contentEditable = 'false';

      // Create a content wrapper for the main item text
      const contentWrapper = document.createElement('div');
      contentWrapper.contentEditable = this.readOnly ? 'false' : 'true';
      contentWrapper.innerHTML = item.content;
      contentWrapper.className = twMerge('outline-none', ...List.PLACEHOLDER_CLASSES);
      this.applyPlaceholder(contentWrapper);
      this.addFocusHandler(contentWrapper);

      li.appendChild(contentWrapper);

      // Create nested list recursively
      const nestedList = document.createElement(this.currentStyleConfig.tag);
      const nestedDepth = currentPath.length;
      const nestedListStyleClass = this._data.style === 'ordered' ? this.getOrderedListStyle(nestedDepth) : 'list-disc';
      nestedList.className = twMerge('pl-6 mt-1', nestedListStyleClass);

      item.items.forEach((nestedItem, nestedIndex) => {
        // Recursively create nested items with the full path
        const nestedLi = this.createListItem(nestedItem, nestedIndex, currentPath);
        nestedList.appendChild(nestedLi);
      });

      li.appendChild(nestedList);
    } else {
      // No nested items - make the li itself editable
      li.contentEditable = this.readOnly ? 'false' : 'true';
      li.innerHTML = item.content;
      this.addFocusHandler(li);
    }

    return li;
  }

  private createChecklistItem(item: ListItem, index: number, itemPath: number[]): HTMLDivElement {
    const wrapper = document.createElement('div');
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
      ...List.PLACEHOLDER_CLASSES
    );
    content.contentEditable = this.readOnly ? 'false' : 'true';
    content.innerHTML = item.content;
    this.applyPlaceholder(content);
    this.addFocusHandler(content);

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

    // Get the array containing this item
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

    // If item is at root level, skip to inserting paragraph
    if (parentPath.length === 0) {
      // Insert a new paragraph block after the current list block and focus it
      const newBlock = this.api.blocks.insert('paragraph', { text: '' }, undefined, currentBlockIndex + 1, true);
      this.api.caret.setToBlock(newBlock, 'start');
      return;
    }

    // Focus the parent item or next sibling at the same level
    const focusPath = itemsArray.length > 0
      ? [...parentPath, Math.min(currentIndex, itemsArray.length - 1)]
      : parentPath;
    this.focusItemAtPath(focusPath);
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

    const currentIndex = itemPath[itemPath.length - 1];
    const parentPath = itemPath.slice(0, -1);

    // Get the array containing this item
    const itemsArray = this.getItemsArrayAtPath(parentPath);
    if (!itemsArray) return;

    // Update the current item's content
    const currentItemData = itemsArray[currentIndex];
    if (!currentItemData) return;

    currentItemData.content = beforeContent;

    const newItem: ListItem = { content: afterContent, checked: false };
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
    return this._data.style === 'checklist'
      ? item.querySelector('[contenteditable]') as HTMLElement
      : item;
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
    this.focusItemAtPath(newPath);
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
   * Focus an item at a specific path
   */
  private focusItemAtPath(path: number[]): void {
    if (!this._element || path.length === 0) return;

    const pathStr = JSON.stringify(path);
    const item = this._element.querySelector(`[data-item-path='${pathStr}']`);
    if (!item) return;

    const contentEl = this.getContentElement(item as HTMLElement);
    if (!contentEl) return;

    contentEl.focus();
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
    this.focusItemAtPath(newPath);
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

    return {
      style: this._data.style,
      items: items.length > 0 ? items : this._data.items,
    };
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

    // Check for nested list within this item
    const nestedList = itemEl.querySelector(':scope > ul, :scope > ol');
    const nestedItems = nestedList?.querySelectorAll(':scope > li[data-item-path]');

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

    // For standard lists, check if item has nested content
    const contentWrapper = itemEl.querySelector(':scope > div[contenteditable]') as HTMLElement;
    if (contentWrapper) {
      return { content: contentWrapper.innerHTML || '', checked: false };
    }

    return { content: itemEl.innerHTML || '', checked: false };
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
