import type { LanguageEntry } from './constants';
import { SEARCH_LANGUAGE_KEY } from './constants';

interface I18n {
  t: (key: string) => string;
}

export interface LanguagePickerOptions {
  languages: LanguageEntry[];
  onSelect: (id: string) => void;
  i18n: I18n;
  activeLanguageId: string;
}

export class LanguagePicker {
  private readonly _languages: LanguageEntry[];
  private readonly _onSelect: (id: string) => void;
  private readonly _i18n: I18n;
  private _activeLanguageId: string;

  private _element: HTMLElement;
  private _searchInput: HTMLInputElement;
  private _list: HTMLElement;
  private _backdrop: HTMLElement | null = null;
  private _anchorEl: HTMLElement | null = null;

  constructor(options: LanguagePickerOptions) {
    this._languages = options.languages;
    this._onSelect = options.onSelect;
    this._i18n = options.i18n;
    this._activeLanguageId = options.activeLanguageId;
    this._element = this.buildElement();

    const searchInput = this._element.querySelector<HTMLInputElement>('[data-blok-testid="code-language-search"]');
    const list = this._element.querySelector<HTMLElement>('[data-language-list]');

    if (searchInput === null || list === null) {
      throw new Error('LanguagePicker: failed to build required elements');
    }

    this._searchInput = searchInput;
    this._list = list;
  }

  public getElement(): HTMLElement {
    return this._element;
  }

  public open(anchor: HTMLElement): void {
    this._anchorEl = anchor;
    this._searchInput.value = '';
    this.renderList(this._languages);

    this._element.hidden = false;
    this.showBackdrop();
    this.position(anchor);
    this._searchInput.focus();
  }

  public close(): void {
    this._element.hidden = true;
    this.removeBackdrop();
    this._anchorEl?.focus();
  }

  public setActiveLanguage(id: string): void {
    this._activeLanguageId = id;

    const buttons = Array.from(this._list.querySelectorAll<HTMLButtonElement>('button[data-language-id]'));

    for (const btn of buttons) {
      const isActive = btn.getAttribute('data-language-id') === id;

      this.applyActiveStyle(btn, isActive);
    }
  }

  // ─── DOM Construction ─────────────────────────────────────

  private buildElement(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-testid', 'code-language-picker');
    el.className = [
      'fixed z-50 w-[240px] overflow-hidden rounded-lg',
      'border border-neutral-200/70 bg-white shadow-xl',
      'theme-dark:border-neutral-700/50 theme-dark:bg-neutral-900',
    ].join(' ');
    el.hidden = true;

    // Search wrapper
    const searchWrapper = document.createElement('div');

    searchWrapper.className = 'px-2 pt-2 pb-1';

    const input = document.createElement('input');

    input.type = 'text';
    input.placeholder = this._i18n.t(SEARCH_LANGUAGE_KEY);
    input.setAttribute('data-blok-testid', 'code-language-search');
    input.className = [
      'w-full text-xs rounded-md py-1.5 px-2.5 outline-hidden',
      'bg-neutral-100 text-neutral-800 placeholder:text-neutral-400',
      'theme-dark:bg-neutral-800 theme-dark:text-neutral-200 theme-dark:placeholder:text-neutral-500',
      'focus:ring-2 focus:ring-neutral-300/60 theme-dark:focus:ring-neutral-600/60',
      'transition-shadow duration-150',
    ].join(' ');
    input.addEventListener('input', () => this.handleSearchChange(input.value));

    searchWrapper.appendChild(input);
    el.appendChild(searchWrapper);

    // Language list
    const list = document.createElement('div');

    list.setAttribute('data-language-list', '');
    list.className = 'max-h-[300px] overflow-y-auto px-1 pb-1';
    el.appendChild(list);

    // Keyboard handler
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    return el;
  }

  // ─── Rendering ────────────────────────────────────────────

  private renderList(languages: LanguageEntry[]): void {
    this._list.innerHTML = '';

    for (const lang of languages) {
      const btn = document.createElement('button');

      btn.type = 'button';
      btn.setAttribute('data-language-id', lang.id);
      btn.textContent = lang.name;
      btn.className = [
        'w-full text-left text-xs px-2 py-1.5 rounded cursor-pointer',
        'bg-transparent border-0',
        'text-neutral-700 theme-dark:text-neutral-300',
        'can-hover:hover:bg-neutral-100 theme-dark:can-hover:hover:bg-neutral-800',
        'transition-colors',
      ].join(' ');

      this.applyActiveStyle(btn, lang.id === this._activeLanguageId);

      btn.addEventListener('click', () => {
        this._onSelect(lang.id);
        this.close();
      });

      this._list.appendChild(btn);
    }
  }

  private applyActiveStyle(btn: HTMLButtonElement, active: boolean): void {
    const activeClasses = ['bg-neutral-100', 'theme-dark:bg-neutral-800', 'font-medium'];

    if (active) {
      btn.classList.add(...activeClasses);
      btn.setAttribute('data-active', 'true');
    } else {
      btn.classList.remove(...activeClasses);
      btn.removeAttribute('data-active');
    }
  }

  private handleSearchChange(query: string): void {
    const trimmed = query.trim().toLowerCase();

    if (trimmed === '') {
      this.renderList(this._languages);

      return;
    }

    const filtered = this._languages.filter(
      (lang) => lang.name.toLowerCase().includes(trimmed)
    );

    this.renderList(filtered);
  }

  // ─── Backdrop ──────────────────────────────────────────────

  private showBackdrop(): void {
    this.removeBackdrop();

    const backdrop = document.createElement('div');

    backdrop.setAttribute('data-blok-language-picker-backdrop', '');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.zIndex = '50';

    backdrop.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === backdrop) {
        this.close();
      }
    });

    this._element.parentElement?.insertBefore(backdrop, this._element);
    backdrop.appendChild(this._element);
    this._backdrop = backdrop;
  }

  private removeBackdrop(): void {
    if (this._backdrop === null) {
      return;
    }

    this._backdrop.parentElement?.insertBefore(this._element, this._backdrop);
    this._backdrop.remove();
    this._backdrop = null;
  }

  // ─── Positioning ──────────────────────────────────────────

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const pickerRect = this._element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const top = rect.bottom + pickerRect.height > viewportHeight
      ? rect.top - pickerRect.height - 4
      : rect.bottom + 4;

    const idealLeft = rect.left - 8;
    const left = idealLeft + pickerRect.width > viewportWidth
      ? rect.right - pickerRect.width
      : Math.max(0, idealLeft);

    this._element.style.top = `${top}px`;
    this._element.style.left = `${left}px`;
  }
}
