// src/tools/callout/emoji-picker/index.ts

import { loadEmojiData, searchEmojis, groupEmojisByCategory, CURATED_CALLOUT_EMOJIS, type ProcessedEmoji } from './emoji-data';
import { REMOVE_EMOJI_KEY, FILTER_EMOJIS_KEY, CALLOUT_EMOJI_CATEGORY_KEY } from '../constants';

interface I18n {
  t: (key: string) => string;
}

interface EmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
  i18n: I18n;
}

export class EmojiPicker {
  private readonly onSelect: (native: string) => void;
  private readonly onRemove: () => void;
  private readonly i18n: I18n;

  private _element: HTMLElement;
  private _body: HTMLElement;
  private _filterInput: HTMLInputElement;
  private _open = false;
  private _allEmojis: ProcessedEmoji[] = [];

  private _anchorEl: HTMLElement | null = null;
  private _outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(options: EmojiPickerOptions) {
    this.onSelect = options.onSelect;
    this.onRemove = options.onRemove;
    this.i18n = options.i18n;
    this._element = this.buildElement();
    this._body = this._element.querySelector('[data-emoji-picker-body]')!;
    this._filterInput = this._element.querySelector('input[type="text"]')!;
  }

  public getElement(): HTMLElement {
    return this._element;
  }

  public isOpen(): boolean {
    return this._open;
  }

  public async open(anchor: HTMLElement): Promise<void> {
    this._anchorEl = anchor;
    this._open = true;
    this._filterInput.value = '';

    if (this._allEmojis.length === 0) {
      this._allEmojis = await loadEmojiData();
    }

    this.renderEmojiGrid(this._allEmojis);
    this.position(anchor);
    this._element.hidden = false;
    this._filterInput.focus();

    this._outsideClickHandler = (e: MouseEvent) => {
      if (!this._element.contains(e.target as Node) && e.target !== anchor) {
        this.close();
      }
    };

    requestAnimationFrame(() => {
      document.addEventListener('mousedown', this._outsideClickHandler!);
    });
  }

  public close(): void {
    this._open = false;
    this._element.hidden = true;
    document.removeEventListener('mousedown', this._outsideClickHandler!);
    this._outsideClickHandler = null;
    this._anchorEl?.focus();
  }

  private buildElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'absolute z-50 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg w-[300px] overflow-hidden';
    el.hidden = true;

    // Header with Remove button
    const header = document.createElement('div');
    header.className = 'flex items-center justify-end px-3 pt-2 pb-1';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = this.i18n.t(REMOVE_EMOJI_KEY);
    removeBtn.dataset.emojiPickerRemove = '';
    removeBtn.className = 'text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300';
    removeBtn.addEventListener('click', () => {
      this.onRemove();
      this.close();
    });
    header.appendChild(removeBtn);
    el.appendChild(header);

    // Filter input
    const filterWrapper = document.createElement('div');
    filterWrapper.className = 'px-3 pb-2';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this.i18n.t(FILTER_EMOJIS_KEY);
    input.className = 'w-full text-sm border border-neutral-200 dark:border-neutral-700 rounded px-2 py-1 outline-hidden bg-transparent';
    input.addEventListener('input', () => this.handleFilterChange(input.value));
    filterWrapper.appendChild(input);
    el.appendChild(filterWrapper);

    // Scrollable body
    const body = document.createElement('div');
    body.dataset.emojiPickerBody = '';
    body.className = 'overflow-y-auto max-h-[250px] px-2 pb-2';
    el.appendChild(body);

    // Keyboard handler
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    return el;
  }

  private handleFilterChange(query: string): void {
    if (query.trim() === '') {
      this.renderEmojiGrid(this._allEmojis);
      return;
    }

    const results = searchEmojis(this._allEmojis, query);
    this.renderFlatGrid(results);
  }

  private renderEmojiGrid(emojis: ProcessedEmoji[]): void {
    this._body.innerHTML = '';

    // Curated callout section first
    const calloutEmojis = CURATED_CALLOUT_EMOJIS
      .map(native => emojis.find(e => e.native === native))
      .filter((e): e is ProcessedEmoji => e !== undefined);

    if (calloutEmojis.length > 0) {
      this._body.appendChild(this.buildSection(this.i18n.t(CALLOUT_EMOJI_CATEGORY_KEY), calloutEmojis));
    }

    // Standard categories
    const byCategory = groupEmojisByCategory(emojis);
    for (const [category, categoryEmojis] of byCategory) {
      this._body.appendChild(this.buildSection(category, categoryEmojis));
    }
  }

  private renderFlatGrid(emojis: ProcessedEmoji[]): void {
    this._body.innerHTML = '';
    const grid = this.buildGrid(emojis);
    this._body.appendChild(grid);
  }

  private buildSection(title: string, emojis: ProcessedEmoji[]): HTMLElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'text-xs text-neutral-400 dark:text-neutral-500 font-medium uppercase tracking-wide px-1 pt-2 pb-1';
    heading.textContent = title;
    section.appendChild(heading);
    section.appendChild(this.buildGrid(emojis));
    return section;
  }

  private buildGrid(emojis: ProcessedEmoji[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-9 gap-px';

    for (const emoji of emojis) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji.native;
      btn.title = emoji.name;
      btn.dataset.emojiNative = emoji.native;
      btn.className = 'text-[1.1rem] p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer leading-none';
      btn.addEventListener('click', () => {
        this.onSelect(emoji.native);
        this.close();
      });
      grid.appendChild(btn);
    }

    return grid;
  }

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const pickerHeight = 320;
    const pickerWidth = 300;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let top = rect.bottom + window.scrollY + 4;
    let left = rect.left + window.scrollX;

    // Flip up if would overflow bottom
    if (rect.bottom + pickerHeight > viewportHeight) {
      top = rect.top + window.scrollY - pickerHeight - 4;
    }

    // Align right edge if would overflow right
    if (left + pickerWidth > viewportWidth) {
      left = rect.right + window.scrollX - pickerWidth;
    }

    this._element.style.top = `${top}px`;
    this._element.style.left = `${left}px`;
  }
}
