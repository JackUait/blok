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

import { LightweightI18n } from '../../../../src/components/i18n/lightweight-i18n';
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

describe('PagePicker sections', () => {
  let anchor: HTMLElement;
  let picker: PagePicker;
  let onPick: ReturnType<typeof vi.fn<(pageId: string) => void>>;

  const t = (key: string, vars?: Record<string, string | number>): string => {
    const messages: Record<string, string> = {
      'toolNames.pageLink': 'Link to page',
      'tools.page.mentionNewSection': 'New page',
      'tools.page.mentionNewSubPage': 'New “{query}” sub-page',
      'tools.page.mentionNewPageIn': 'New “{query}” page in…',
      'tools.page.mentionAddSubPage': 'Add new sub-page',
      'tools.page.mentionAddPageIn': 'Add new page in…',
      'tools.page.moreResults': '{count} more results',
      'tools.page.searching': 'Searching…',
    };

    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));
  };
  const options = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });

    picker.handleKeydown(event);

    return event;
  };
  const pages = (count: number): Array<{ pageId: string; title: string }> =>
    Array.from({ length: count }, (_, index) => ({ pageId: `p${index + 1}`, title: `Page ${index + 1}` }));
  const section = (name: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-blok-page-picker-section="${name}"]`);

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.length = 0;
    anchor = document.createElement('div');
    anchor.contentEditable = 'true';
    document.body.append(anchor);
    onPick = vi.fn<(pageId: string) => void>();
    picker = new PagePicker('Pages', 'Page', 'Draft', 'Nothing found', t);
  });

  afterEach(() => {
    picker.close();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('heads the page rows with a "Link to page" section that headers keep out of the options', () => {
    picker.open('', anchor, onPick);
    picker.setResults(pages(2));
    const header = section('link');

    expect(header?.textContent).toBe('Link to page');
    expect(header?.getAttribute('role')).toBe('presentation');
    expect(options()).toHaveLength(2);
  });

  it('shows a spinner and two hidden skeleton rows while the first search runs', () => {
    picker.open('', anchor, onPick);
    picker.startSearch('');

    const spinner = document.querySelector('[data-blok-testid="page-picker-spinner"]');
    const skeletons = document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]');

    expect(spinner?.getAttribute('aria-label')).toBe('Searching…');
    // A listbox may own only options: the spinner stays out of the tree and the list says it is busy.
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.hasAttribute('role')).toBe(false);
    expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('true');
    expect(section('link')?.contains(spinner ?? null)).toBe(true);
    expect(skeletons).toHaveLength(2);
    skeletons.forEach((row) => expect(row.getAttribute('aria-hidden')).toBe('true'));
    expect(options()).toHaveLength(0);
    expect(popovers[0]?.nothingFound).toBe(false);

    picker.setResults(pages(1));

    expect(document.querySelector('[data-blok-testid="page-picker-spinner"]')).toBeNull();
    expect(document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]')).toHaveLength(0);
    expect(document.querySelector('[role="listbox"]')?.hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps the previous rows while a later search runs, with the spinner and no skeletons', () => {
    picker.open('', anchor, onPick);
    picker.setResults(pages(2));
    picker.startSearch('pa');

    expect(options()).toHaveLength(2);
    expect(document.querySelector('[data-blok-testid="page-picker-spinner"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]')).toHaveLength(0);
  });

  it('gives the active row and a hovered row the neutral menu fill, as popover items do', () => {
    picker.open('', anchor, onPick, { newPage: { onSubPage: vi.fn(), onPageIn: vi.fn() } });
    picker.setResults(pages(7));

    options().forEach((option) => {
      expect(option.className.split(' ')).toEqual(expect.arrayContaining([
        'aria-selected:bg-item-focus-bg', 'can-hover:hover:bg-item-hover-bg',
      ]));
      expect(option.className).not.toMatch(/blue|primary-bg|accent/);
    });
  });

  it('draws each row\'s emoji, image or the page glyph, hidden from readers', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'p1', title: 'Map', icon: { type: 'emoji', value: '🗺️' } },
      { pageId: 'p2', title: 'Photo', icon: { type: 'image', url: 'https://example.com/a.png' } },
      { pageId: 'p3', title: 'Plain' },
      { pageId: 'p4', title: 'Bad', icon: { type: 'image', url: 'javascript:alert(1)' } },
    ]);
    const icons = options().map((option) => option.querySelector<HTMLElement>('[data-blok-testid="page-picker-option-icon"]'));

    expect(icons.every((icon) => icon?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(icons[0]?.textContent).toBe('🗺️');
    expect(icons[1]?.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(icons[2]?.querySelector('svg')).not.toBeNull();
    expect(icons[3]?.querySelector('img')).toBeNull();
    expect(icons[3]?.querySelector('svg')).not.toBeNull();
  });

  it('shows six rows, then a "more results" option that expands the list in place', () => {
    picker.open('', anchor, onPick);
    picker.setResults(pages(9));

    expect(options().map((option) => option.textContent)).toEqual([
      'Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 6', '3 more results',
    ]);
    ['End', 'Enter'].forEach(press);

    expect(onPick).not.toHaveBeenCalled();
    expect(options().map((option) => option.textContent)).toHaveLength(9);
    // The active row is the first one the expansion revealed.
    expect(anchor.getAttribute('aria-activedescendant')).toBe(options()[6]?.id);
    expect(options()[6]?.textContent).toBe('Page 7');
  });

  it('expands on a click of the more-results row', () => {
    picker.open('', anchor, onPick);
    picker.setResults(pages(7));
    document.querySelector<HTMLElement>('[data-blok-testid="page-picker-more"]')?.click();

    expect(options()).toHaveLength(7);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('collapses again when a new answer arrives', () => {
    picker.open('', anchor, onPick);
    picker.setResults(pages(8));
    document.querySelector<HTMLElement>('[data-blok-testid="page-picker-more"]')?.click();
    picker.setResults(pages(8));

    expect(options()).toHaveLength(7);
  });

  describe('New page section', () => {
    let onSubPage: ReturnType<typeof vi.fn<(query: string) => Promise<void> | void>>;
    let onPageIn: ReturnType<typeof vi.fn<(query: string) => void>>;
    const openWithNewPage = (): void => {
      picker.open('', anchor, onPick, { newPage: { onSubPage, onPageIn } });
    };

    beforeEach(() => {
      onSubPage = vi.fn<(query: string) => Promise<void> | void>();
      onPageIn = vi.fn<(query: string) => void>();
    });

    it('offers Add new sub-page and Add new page in… with an empty query', () => {
      openWithNewPage();
      picker.startSearch('');
      const header = section('new');

      expect(header?.textContent).toBe('New page');
      expect(header?.getAttribute('role')).toBe('presentation');
      expect(options().map((option) => option.textContent)).toEqual(['Add new sub-page', 'Add new page in…']);
      expect(options()[0]?.querySelector('svg')).not.toBeNull();
      expect(options()[1]?.querySelector('svg')).not.toBeNull();
    });

    it('names the query in bold, as text, in both items', () => {
      openWithNewPage();
      picker.startSearch('<b>x</b>');
      const [subPage, pageIn] = options();

      expect(subPage?.textContent).toBe('New “<b>x</b>” sub-page');
      expect(pageIn?.textContent).toBe('New “<b>x</b>” page in…');
      expect(subPage?.querySelector('strong')?.textContent).toBe('<b>x</b>');
      expect(subPage?.querySelector('b')).toBeNull();
    });

    it('puts the page rows first and moves across both sections with arrows', () => {
      openWithNewPage();
      picker.startSearch('pa');
      picker.setResults(pages(2));

      expect(options().map((option) => option.textContent)).toEqual([
        'Page 1', 'Page 2', 'New “pa” sub-page', 'New “pa” page in…',
      ]);
      ['ArrowDown', 'ArrowDown'].forEach(press);
      expect(anchor.getAttribute('aria-activedescendant')).toBe(options()[2]?.id);
      press('End');
      press('ArrowDown');
      expect(anchor.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
      press('ArrowUp');
      press('Enter');

      expect(onPageIn).toHaveBeenCalledExactlyOnceWith('pa');
      expect(onPick).not.toHaveBeenCalled();
    });

    it('hides the page section and its header when no page matches, and never says Nothing found', () => {
      openWithNewPage();
      picker.startSearch('zzqx');
      picker.setResults([]);

      expect(section('link')).toBeNull();
      expect(section('new')).not.toBeNull();
      expect(popovers[0]?.nothingFound).toBe(false);
      expect(options()).toHaveLength(2);
    });

    it('draws a hairline between the two sections only when both show', () => {
      openWithNewPage();
      picker.startSearch('pa');
      picker.setResults(pages(1));

      expect(document.querySelectorAll('[data-blok-testid="page-picker-separator"]')).toHaveLength(1);

      picker.setResults([]);

      expect(document.querySelectorAll('[data-blok-testid="page-picker-separator"]')).toHaveLength(0);
    });

    it('marks the sub-page item busy while its create runs and ignores another Enter', async () => {
      let finish: (() => void) | undefined;

      onSubPage.mockReturnValue(new Promise<void>((resolve) => {
        finish = resolve;
      }));
      openWithNewPage();
      picker.startSearch('pa');
      picker.setResults([]);
      press('Enter');
      const item = options()[0];

      expect(onSubPage).toHaveBeenCalledExactlyOnceWith('pa');
      expect(item?.getAttribute('aria-busy')).toBe('true');
      press('Enter');
      item?.click();
      expect(onSubPage).toHaveBeenCalledOnce();

      finish?.();
      await vi.waitFor(() => expect(item?.hasAttribute('aria-busy')).toBe(false));
    });

    it('keeps the query a later search answers with in the item labels', () => {
      openWithNewPage();
      picker.startSearch('p');
      picker.startSearch('pa');
      picker.setResults([]);

      expect(options()[0]?.textContent).toBe('New “pa” sub-page');
    });
  });

  it('shows Nothing found only when the page list is empty and there is no New page section', () => {
    picker.open('', anchor, onPick);
    picker.startSearch('zz');

    expect(popovers[0]?.nothingFound).toBe(false);

    picker.setResults([]);

    expect(popovers[0]?.nothingFound).toBe(true);
  });

  it('has no section headers in the search-field mode', () => {
    picker.open('', anchor, onPick, { searchField: { placeholder: 'Search', onQuery: vi.fn() } });
    picker.setResults(pages(7));

    expect(section('link')).toBeNull();
    expect(options()).toHaveLength(7);
    expect(options()[6]?.textContent).toBe('1 more results');
  });

  describe('choosing a parent', () => {
    it('turns the open menu into a search field over the pages, then hands the chosen page back busy', async () => {
      let finish: (() => void) | undefined;
      const onQuery = vi.fn<(query: string) => void>();
      const onChoose = vi.fn<(pageId: string) => Promise<void>>().mockReturnValue(new Promise<void>((resolve) => {
        finish = resolve;
      }));

      picker.open('', anchor, onPick, { newPage: { onSubPage: vi.fn(), onPageIn: vi.fn() } });
      picker.setResults(pages(1));
      picker.chooseParent({ placeholder: 'Search pages…', onQuery, onChoose });
      const field = document.querySelector<HTMLInputElement>('[data-blok-testid="page-picker-search-input"]');

      expect(popovers).toHaveLength(1);
      expect(field).toHaveFocus();
      expect(field?.getAttribute('role')).toBe('combobox');
      expect(anchor.hasAttribute('aria-controls')).toBe(false);
      expect(section('new')).toBeNull();
      expect(onQuery).toHaveBeenCalledExactlyOnceWith('');
      expect(popovers[0]?.getElement().hasAttribute('data-blok-keyboard-owner')).toBe(true);

      picker.setResults(pages(2));
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(onChoose).toHaveBeenCalledExactlyOnceWith('p2');
      expect(onPick).not.toHaveBeenCalled();
      expect(picker.opened).toBe(true);
      expect(options()[1]?.getAttribute('aria-busy')).toBe('true');
      finish?.();
      await vi.waitFor(() => expect(options()[1]?.hasAttribute('aria-busy')).toBe(false));
    });
  });
});

describe('PagePicker with the English messages', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('pluralizes the more-results row and bolds the query in the New page items', () => {
    vi.clearAllMocks();
    const i18n = new LightweightI18n();
    const anchor = document.createElement('div');
    const picker = new PagePicker('Pages', 'Page', 'Draft', 'Nothing found', (key, vars) => i18n.t(key, vars));

    document.body.append(anchor);
    picker.open('', anchor, vi.fn(), { newPage: { onSubPage: vi.fn(), onPageIn: vi.fn() } });
    picker.startSearch('plan');
    picker.setResults(Array.from({ length: 7 }, (_, index) => ({ pageId: `p${index}`, title: `P${index}` })));

    expect(document.querySelector('[data-blok-testid="page-picker-more"]')?.textContent).toBe('1 more result');
    expect(document.querySelector('[data-blok-page-picker-section="link"]')?.textContent).toBe('Link to page');
    expect(document.querySelector('[data-blok-page-picker-section="new"]')?.textContent).toBe('New page');
    const subPage = document.querySelector('[data-blok-testid="page-picker-new-sub-page"]');

    expect(subPage?.textContent).toBe('New “plan” sub-page');
    expect(subPage?.querySelector('strong')?.textContent).toBe('plan');

    picker.setResults(Array.from({ length: 9 }, (_, index) => ({ pageId: `p${index}`, title: `P${index}` })));

    expect(document.querySelector('[data-blok-testid="page-picker-more"]')?.textContent).toBe('3 more results');
    picker.close();
  });
});
