import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import type { PageSearchResult } from './types';

const listboxIds = { next: 0 };
const COMBOBOX_ATTRIBUTES = [
  'role', 'aria-expanded', 'aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-activedescendant',
] as const;

const isVisiblePage = (value: unknown): value is PageSearchResult => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { pageId, access, title } = value as Record<string, unknown>;

  return typeof pageId === 'string' && pageId.trim() !== '' &&
    access === undefined && (title === undefined || typeof title === 'string');
};

export class PagePicker {
  private readonly label: string;
  private readonly fallback: string;
  private readonly listboxId = `blok-page-picker-${++listboxIds.next}`;
  private popover: PopoverDesktop | null = null;
  private anchor: HTMLElement | null = null;
  private listbox: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private onPick: ((pageId: string) => void) | null = null;
  private results: PageSearchResult[] = [];
  private activeIndex = -1;
  private keyboardNavigated = false;
  private previousAttributes: Map<string, string | null> | null = null;

  constructor(label: string, fallback: string) {
    this.label = label;
    this.fallback = fallback;
  }

  public get opened(): boolean {
    return this.popover !== null;
  }

  public open(_query: string, anchor: HTMLElement, onPick: (pageId: string) => void): void {
    this.close();
    this.anchor = anchor;
    this.previousAttributes = new Map(COMBOBOX_ATTRIBUTES.map((name) => [name, anchor.getAttribute(name)] as const));
    this.onPick = onPick;
    this.content = document.createElement('div');
    this.popover = new PopoverDesktop({
      items: [{ type: PopoverItemType.Html, element: this.content }],
      trigger: anchor,
      listbox: true,
      listboxId: this.listboxId,
      // Search results arrive after show() measures the empty menu.
      minWidth: '240px',
      flippable: false,
      messages: { actions: this.label },
    });
    this.popover.on(PopoverEvent.Closed, () => this.close());
    this.popover.show();

    this.listbox = document.getElementById(this.listboxId);
    if (this.listbox === null) {
      this.listbox = this.content;
      this.listbox.id = this.listboxId;
    }
    this.listbox.setAttribute('role', 'listbox');
    this.listbox.setAttribute('aria-label', this.label);
    anchor.setAttribute('role', 'combobox');
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-autocomplete', 'list');
    anchor.setAttribute('aria-haspopup', 'listbox');
    anchor.setAttribute('aria-controls', this.listboxId);
  }

  public setResults(results: readonly unknown[]): void {
    if (this.content === null) {
      return;
    }

    this.results = results.filter(isVisiblePage);
    this.activeIndex = this.results.length > 0 ? 0 : -1;
    this.keyboardNavigated = false;
    this.content.replaceChildren(...this.results.map((result, index) => {
      const option = document.createElement('div');

      option.id = `${this.listboxId}-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('data-blok-testid', 'page-picker-option');
      option.className = 'cursor-pointer px-3 py-2 text-sm text-text-primary';
      option.textContent = result.title || this.fallback;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => this.pick(index));

      return option;
    }));
    this.syncSelection();
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.opened || event.isComposing) {
      return false;
    }

    if (event.key === 'Tab') {
      this.close();

      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();

      return true;
    }

    if (this.results.length === 0) {
      if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
        event.key === 'Home' || event.key === 'End') {
        event.preventDefault();

        return true;
      }

      return false;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;

      this.activeIndex = (this.activeIndex + step + this.results.length) % this.results.length;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.activeIndex = event.key === 'Home' ? 0 : this.results.length - 1;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.pick(this.activeIndex);

      return true;
    }

    return false;
  }

  public close(): void {
    const popover = this.popover;
    const anchor = this.anchor;
    const listbox = this.listbox;
    const content = this.content;
    const previousAttributes = this.previousAttributes;

    this.popover = null;
    this.anchor = null;
    this.listbox = null;
    this.content = null;
    this.onPick = null;
    this.results = [];
    this.activeIndex = -1;
    this.keyboardNavigated = false;
    this.previousAttributes = null;
    content?.replaceChildren();
    listbox?.removeAttribute('role');
    listbox?.removeAttribute('aria-label');
    listbox?.removeAttribute('id');
    previousAttributes?.forEach((value, name) => {
      if (value === null) {
        anchor?.removeAttribute(name);
      } else {
        anchor?.setAttribute(name, value);
      }
    });
    popover?.destroy();
  }

  private pick(index: number): void {
    const result = this.results[index];
    const onPick = this.onPick;

    if (result === undefined || onPick === null) {
      return;
    }

    this.close();
    onPick(result.pageId);
  }

  private syncSelection(): void {
    const options = this.content?.querySelectorAll<HTMLElement>('[role="option"]');

    options?.forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === this.activeIndex));
      option.style.setProperty('outline', this.keyboardNavigated && index === this.activeIndex
        ? '2px solid var(--blok-focus-ring)'
        : '');
    });
    const active = options?.[this.activeIndex];

    if (active === undefined) {
      this.anchor?.removeAttribute('aria-activedescendant');
    } else {
      this.anchor?.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }
}
