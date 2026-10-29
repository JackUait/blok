import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { popovers, MockPopover } = vi.hoisted(() => {
  type Params = {
    items: Array<{ element?: HTMLElement }>;
    listbox?: boolean;
    listboxId?: string;
    messages?: { nothingFound?: string };
  };
  const instances: Array<{
    params: Params;
    closeFromOutside: () => void;
    preserveRootOnDestroy: boolean;
    nothingFound: boolean;
    getElement: () => HTMLElement;
  }> = [];

  class PopoverDouble {
    public readonly params: Params;
    private readonly root = document.createElement('div');
    private closed: (() => void) | null = null;
    public preserveRootOnDestroy = false;
    public nothingFound = false;

    constructor(params: Params) {
      this.params = params;
      instances.push(this);
    }

    getElement(): HTMLElement {
      return this.root;
    }

    mountSearchField(field: HTMLElement): void {
      this.root.prepend(field);
    }

    setNothingFound(isDisplayed: boolean): void {
      this.nothingFound = isDisplayed;
    }

    show(): void {
      const list = document.createElement('div');

      list.setAttribute('role', this.params.listbox === true ? 'listbox' : 'menu');
      if (this.params.listboxId !== undefined) {
        list.id = this.params.listboxId;
      }
      this.params.items.forEach((item) => {
        if (item.element !== undefined) {
          list.append(item.element);
        }
      });
      this.root.append(list);
      document.body.append(this.root);
    }

    on(_event: string, callback: () => void): void {
      this.closed = callback;
    }

    closeFromOutside(): void {
      this.closed?.();
    }

    destroy(): void {
      if (!this.preserveRootOnDestroy) {
        this.root.remove();
      }
    }
  }

  return { popovers: instances, MockPopover: PopoverDouble };
});

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: MockPopover,
}));

import { PagePicker } from '../../../../src/tools/page/page-picker';

describe('PagePicker', () => {
  let anchor: HTMLElement;
  let picker: PagePicker;
  let onPick: ReturnType<typeof vi.fn<(pageId: string) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.length = 0;
    anchor = document.createElement('div');
    anchor.contentEditable = 'true';
    anchor.tabIndex = 0;
    document.body.append(anchor);
    onPick = vi.fn<(pageId: string) => void>();
    picker = new PagePicker('Pages', 'Page', 'Draft', 'Nothing found');
  });

  afterEach(() => {
    picker.close();
    anchor.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('exposes a labelled listbox whose first real option is the active descendant', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }, { pageId: 'p2', title: 'Roadwork' }]);

    const list = document.querySelector<HTMLElement>('[role="listbox"]');
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(list?.getAttribute('aria-label')).toBe('Pages');
    expect(options.map((option) => option.textContent)).toEqual(['Roadmap', 'Roadwork']);
    expect(anchor.getAttribute('aria-controls')).toBe(list?.id);
    expect(anchor.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves the active descendant with arrows and commits that option on Enter', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }, { pageId: 'p2', title: 'Roadwork' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    expect(picker.handleKeydown(down)).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(anchor.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');

    expect(picker.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p2');
  });

  it.each(['Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End'])(
    'claims %s while the page list is empty',
    (key) => {
      picker.open('missing', anchor, onPick);
      picker.setResults([]);
      const event = new KeyboardEvent('keydown', { key, cancelable: true });

      expect(picker.handleKeydown(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(picker.opened).toBe(true);
      expect(onPick).not.toHaveBeenCalled();
    }
  );

  it('shows a focus ring only after keyboard navigation', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'One' }, { pageId: 'p2', title: 'Two' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0]?.style.outline).toBe('');
    expect(options[1]?.style.outline).toBe('');
    picker.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(options[0]?.style.outline).toBe('');
    expect(options[1]?.style.outline).toContain('var(--blok-focus-ring)');
  });

  it('does not give the highlighted row a blue fill or different ink', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'One' }, { pageId: 'p2', title: 'Two' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0]?.style.backgroundColor).toBe('');
    expect(options[0]?.style.color).toBe(options[1]?.style.color);
  });

  it('does not paint or select malformed and inaccessible results', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'secret', title: 'Secret', access: 'none' },
      { pageId: '', title: 'Broken' },
      { pageId: 'p1', title: 'Roadmap' },
    ]);

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Secret');
    expect(document.body.textContent).not.toContain('Broken');
  });

  it('drops results with malformed access or title values', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'bad-access', title: 'Hidden', access: 42 },
      { pageId: 'bad-title', title: { text: 'Wrong' } },
      { pageId: 'p1', title: 'Roadmap' },
    ]);

    expect(Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(['Roadmap']);
  });

  it('commits a pointer-selected option without moving editor focus', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
    anchor.focus();
    const option = document.querySelector<HTMLElement>('[role="option"]');

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });

    option?.dispatchEvent(pointerDown);
    option?.click();

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p1');
    expect(anchor).toHaveFocus();
  });

  it('closes on Escape without touching a second layer', () => {
    picker.open('', anchor, onPick);
    const otherLayer = document.createElement('div');

    otherLayer.setAttribute('data-blok-other-layer', '');
    document.body.append(otherLayer);

    expect(picker.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(otherLayer.isConnected).toBe(true);
    expect(anchor.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('lets Tab leave the editor and ignores IME keydown', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
    const composing = new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, cancelable: true });

    expect(picker.handleKeydown(composing)).toBe(false);
    expect(composing.defaultPrevented).toBe(false);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });

    expect(picker.handleKeydown(tab)).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('clears sensitive option text while the popover exit animation is pending', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Secret' }]);
    if (popovers[0] === undefined) {
      throw new Error('missing popover');
    }
    popovers[0].preserveRootOnDestroy = true;

    picker.close();

    expect(document.body.textContent).not.toContain('Secret');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('restores existing editor semantics after close', () => {
    anchor.setAttribute('role', 'textbox');
    anchor.setAttribute('aria-label', 'Document body');
    anchor.setAttribute('aria-controls', 'existing-controls');
    picker.open('', anchor, onPick);

    picker.close();

    expect(anchor.getAttribute('role')).toBe('textbox');
    expect(anchor.getAttribute('aria-label')).toBe('Document body');
    expect(anchor.getAttribute('aria-controls')).toBe('existing-controls');
  });

  it('releases combobox attributes when the popover closes from outside', () => {
    picker.open('', anchor, onPick);
    expect(popovers).toHaveLength(1);

    popovers[0]?.closeFromOutside();

    expect(anchor.hasAttribute('aria-controls')).toBe(false);
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('shows each page\'s path under its title, as plain text', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'p1', title: 'Напитки', path: ['Общее КЦ', 'Меню'] },
      { pageId: 'p2', title: 'Root' },
    ]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    const path = options[0]?.querySelector('[data-blok-testid="page-picker-option-path"]');

    expect(path?.textContent).toBe('Общее КЦ / Меню');
    expect(options[0]?.textContent).toBe('НапиткиОбщее КЦ / Меню');
    expect(options[1]?.querySelector('[data-blok-testid="page-picker-option-path"]')).toBeNull();
  });

  it('renders a path with markup as text', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Page', path: ['<img src=x onerror=alert(1)>'] }]);

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-blok-testid="page-picker-option-path"]')?.textContent)
      .toBe('<img src=x onerror=alert(1)>');
  });

  it('marks a draft page with the page block\'s Draft badge', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'p1', title: 'Plan', status: 'draft' },
      { pageId: 'p2', title: 'Live', status: 'published' },
    ]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    const badge = options[0]?.querySelector('[data-blok-testid="page-draft-badge"]');

    expect(options[0]?.getAttribute('data-blok-page-status')).toBe('draft');
    expect(badge?.textContent).toBe('Draft');
    expect(badge?.className).toContain('bg-(--blok-color-gray-bg)');
    expect(options[1]?.hasAttribute('data-blok-page-status')).toBe(false);
    expect(options[1]?.querySelector('[data-blok-testid="page-draft-badge"]')).toBeNull();
  });

  it('ignores a malformed path or status but keeps the page', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'p1', title: 'One', path: 'Home', status: 'archived' },
      { pageId: 'p2', title: 'Two', path: ['Home', 42, null, 'Plans'] },
    ]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toBe('One');
    expect(options[0]?.hasAttribute('data-blok-page-status')).toBe(false);
    expect(options[1]?.querySelector('[data-blok-testid="page-picker-option-path"]')?.textContent).toBe('Home / Plans');
  });

  it('shows Nothing found only after a search answers with no pages', () => {
    picker.open('zzz', anchor, onPick);

    expect(popovers[0]?.nothingFound).toBe(false);

    picker.setResults([{ pageId: 'secret', title: 'Secret', access: 'none' }]);

    expect(popovers[0]?.nothingFound).toBe(true);

    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);

    expect(popovers[0]?.nothingFound).toBe(false);
  });

  it('passes the localized Nothing found label to the popover', () => {
    picker.open('', anchor, onPick);

    expect(popovers[0]?.params.messages?.nothingFound).toBe('Nothing found');
  });

  describe('with its own search field', () => {
    let onQuery: ReturnType<typeof vi.fn<(query: string) => void>>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    const field = (): HTMLInputElement => {
      const input = document.querySelector<HTMLInputElement>('[data-blok-testid="page-picker-search-input"]');

      if (input === null) {
        throw new Error('no search field');
      }

      return input;
    };
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

      field().dispatchEvent(event);

      return event;
    };
    const openWithField = (): void => {
      picker.open('', anchor, onPick, { searchField: { placeholder: 'Search pages', onQuery }, onClose });
    };

    beforeEach(() => {
      onQuery = vi.fn<(query: string) => void>();
      onClose = vi.fn<() => void>();
    });

    it('focuses a search field above the results and owns its keyboard', () => {
      openWithField();
      const input = field();
      const root = popovers[0]?.getElement();

      expect(input).toHaveFocus();
      expect(input.placeholder).toBe('Search pages');
      expect(input.closest('[data-blok-field="search"]')).not.toBeNull();
      expect(input.closest('[role="listbox"]')).toBeNull();
      expect(root?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('puts the combobox semantics on the field, not on the anchor', () => {
      anchor.setAttribute('role', 'textbox');
      openWithField();
      picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
      const input = field();
      const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
      const option = document.querySelector<HTMLElement>('[role="option"]');

      expect(input.getAttribute('role')).toBe('combobox');
      expect(input.getAttribute('aria-haspopup')).toBe('listbox');
      expect(list?.getAttribute('role')).toBe('listbox');
      expect(option?.parentElement).toBe(list);
      expect(input.getAttribute('aria-activedescendant')).toBe(option?.id);
      expect(anchor.getAttribute('role')).toBe('textbox');
      expect(anchor.hasAttribute('aria-controls')).toBe(false);
      expect(anchor.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('reports each typed query', () => {
      openWithField();
      const input = field();

      input.value = 'road';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onQuery).toHaveBeenCalledExactlyOnceWith('road');
    });

    it('picks with arrows and Enter from the field, without onClose', () => {
      openWithField();
      picker.setResults([{ pageId: 'p1', title: 'One' }, { pageId: 'p2', title: 'Two' }, { pageId: 'p3', title: 'Three' }]);

      expect(press('End').defaultPrevented).toBe(true);
      press('ArrowUp');
      press('Home');
      press('ArrowDown');
      expect(press('Enter').defaultPrevented).toBe(true);

      expect(onPick).toHaveBeenCalledExactlyOnceWith('p2');
      expect(onClose).not.toHaveBeenCalled();
      expect(picker.opened).toBe(false);
    });

    it('fires onClose once on Escape', () => {
      openWithField();

      expect(press('Escape').defaultPrevented).toBe(true);
      picker.close();
      popovers[0]?.closeFromOutside();

      expect(onClose).toHaveBeenCalledOnce();
      expect(picker.opened).toBe(false);
    });

    it('fires onClose once on Tab', () => {
      openWithField();
      press('Tab');

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('fires onClose once when the popover closes from outside', () => {
      openWithField();
      popovers[0]?.closeFromOutside();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('fires onClose once on a pointer press outside the picker, not inside it', () => {
      openWithField();
      picker.setResults([{ pageId: 'p1', title: 'One' }]);
      document.querySelector('[role="option"]')?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

      expect(onClose).not.toHaveBeenCalled();

      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(picker.opened).toBe(false);
    });

    it('fires the previous onClose when a new open replaces it', () => {
      openWithField();
      picker.open('', anchor, onPick);

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not fire onClose for a pointer pick', () => {
      openWithField();
      picker.setResults([{ pageId: 'p1', title: 'One' }]);
      document.querySelector<HTMLElement>('[role="option"]')?.click();

      expect(onPick).toHaveBeenCalledExactlyOnceWith('p1');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('fires onClose on close in the @ mode too', () => {
    const onClose = vi.fn<() => void>();

    picker.open('', anchor, onPick, { onClose });
    picker.close();
    picker.close();

    expect(onClose).toHaveBeenCalledOnce();
  });
});
