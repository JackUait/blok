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
      ? data.items.map(item => ({
          content: typeof item === 'string' ? item : (item.content || ''),
          checked: typeof item === 'object' ? Boolean(item.checked) : false,
        }))
      : [{ content: '', checked: false }];

    return { style, items: normalizedItems };
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

  private applyItemStyles(el: HTMLElement): void {
    const element = el;
    if (this.itemColor) {
      element.style.color = this.itemColor;
    }
    if (this.itemSize) {
      element.style.fontSize = this.itemSize;
    }
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

  private createStandardListContent(items: ListItem[], style: ListStyle): HTMLElement {
    const styleConfig = this.currentStyleConfig;
    const list = document.createElement(styleConfig.tag);
    list.className = twMerge('pl-6', style === 'ordered' ? 'list-decimal' : 'list-disc');

    items.forEach((item, index) => {
      list.appendChild(this.createListItem(item, index));
    });

    return list;
  }

  private createChecklistContent(items: ListItem[]): HTMLElement {
    const list = document.createElement('div');
    list.className = 'space-y-0.5';

    items.forEach((item, index) => {
      list.appendChild(this.createChecklistItem(item, index));
    });

    return list;
  }

  private createListItem(item: ListItem, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = List.ITEM_STYLES;
    li.contentEditable = this.readOnly ? 'false' : 'true';
    li.innerHTML = item.content;
    li.setAttribute('data-item-index', String(index));
    this.applyItemStyles(li);
    return li;
  }

  private createChecklistItem(item: ListItem, index: number): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = List.CHECKLIST_ITEM_STYLES;
    wrapper.setAttribute('data-item-index', String(index));
    this.applyItemStyles(wrapper);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = List.CHECKBOX_STYLES;
    checkbox.checked = Boolean(item.checked);
    checkbox.disabled = this.readOnly;

    const content = document.createElement('div');
    content.className = twMerge(
      'flex-1 outline-none leading-[1.6em]',
      item.checked ? 'line-through opacity-60' : ''
    );
    content.contentEditable = this.readOnly ? 'false' : 'true';
    content.innerHTML = item.content;

    if (!this.readOnly) {
      checkbox.addEventListener('change', () => {
        this._data.items[index].checked = checkbox.checked;
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
    }
  }

  private handleEnter(): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const focusNode = selection.focusNode;
    if (!focusNode) return;

    const currentItem = this.findItemElement(focusNode);
    if (!currentItem) return;

    const currentIndex = parseInt(currentItem.getAttribute('data-item-index') || '0', 10);
    const contentEl = this.getContentElement(currentItem);
    if (!contentEl) return;

    const currentContent = contentEl.innerHTML.trim();

    // If current item is empty, exit the list and create a new paragraph
    if (currentContent === '' || currentContent === '<br>') {
      this.exitListAndCreateParagraph(currentIndex);
      return;
    }

    // Otherwise, add a new item
    this.addNewItem(currentIndex);
  }

  private exitListAndCreateParagraph(currentIndex: number): void {
    // Remove the empty item
    this._data.items.splice(currentIndex, 1);

    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();

    // If no items left, delete the entire list block and insert a paragraph
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

  private addNewItem(currentIndex: number): void {
    const selection = window.getSelection();
    if (!selection || !this._element) return;

    const currentItem = this._element.querySelector(`[data-item-index="${currentIndex}"]`) as HTMLElement;
    if (!currentItem) return;

    const contentEl = this.getContentElement(currentItem);
    if (!contentEl) return;

    const range = selection.getRangeAt(0);
    const { beforeContent, afterContent } = this.splitContentAtCursor(contentEl, range);

    this._data.items[currentIndex].content = beforeContent;

    const newItem: ListItem = { content: afterContent, checked: false };
    this._data.items.splice(currentIndex + 1, 0, newItem);

    this.rerender();
    this.focusItem(currentIndex + 1);
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

    const item = this._element.querySelector(`[data-item-index="${index}"]`);
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

    const items: ListItem[] = [];
    const itemElements = this._element.querySelectorAll('[data-item-index]');

    itemElements.forEach((itemEl) => {
      items.push(this.extractItemData(itemEl as HTMLElement));
    });

    return items;
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
