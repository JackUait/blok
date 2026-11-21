import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverflowList, tabsThatFit, type OverflowListOptions } from '../../../../src/components/utils/overflow-list';

const P = 'data-test-overflow';

const ROWS = [
  { id: 'a', name: 'Table', icon: { text: '' }, active: false },
  { id: 'b', name: 'Board', icon: { text: '' }, active: true },
  { id: 'c', name: 'Calendar', icon: { text: '' }, active: false },
];

describe('OverflowList keyboard (research/21 §2)', () => {
  let anchor: HTMLElement;
  let list: OverflowList;
  const onSelect = vi.fn();
  const onNew = vi.fn();

  const make = (overrides: Partial<OverflowListOptions> = {}): OverflowList => new OverflowList({
    anchor,
    prefix: P,
    idAttribute: 'data-id',
    rows: ROWS,
    labels: { search: 'Search for a view...', handle: 'Drag', menu: 'More', newItem: 'New view', noResults: 'No results' },
    readOnly: false,
    onSelect,
    onNew,
    ownsNode: () => false,
    closeLayer: () => false,
    ownsEscape: () => false,
    ...overrides,
  });

  const input = (): HTMLInputElement => document.querySelector(`[${P}-dropdown] input`) as HTMLInputElement;
  const highlighted = (): string | null => {
    const el = document.querySelector(`[${P}-dropdown] [data-highlighted]`);

    if (el === null) return null;

    return el.getAttribute('data-id') ?? 'new';
  };
  const press = (key: string, target: EventTarget = input()): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const type = (value: string): void => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    list = make();
    list.open();
  });

  afterEach(() => {
    list.close();
    anchor.remove();
    vi.restoreAllMocks();
  });

  // Customize layout sits in the top layer: a list below it could not be reached.
  it('opens in the top layer, above a builder that is there already', () => {
    expect(document.querySelector(`[${P}-dropdown]`)?.getAttribute('data-blok-top-layer')).toBe('true');
  });

  // notion-motion.md Round 38 §5: the capped list opens scrolled so the current view shows; arrows keep the highlight in view.
  it('scrolls the highlighted row into view, on open and on an arrow key', () => {
    const scrolled: Array<{ id: string | null; options: unknown }> = [];

    list.close();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement, options: unknown) {
        scrolled.push({ id: this.getAttribute('data-id'), options });
      },
    });
    list = make();
    list.open();
    press('ArrowDown');

    expect(scrolled).toEqual([{ id: 'b', options: { block: 'nearest' } }, { id: 'c', options: { block: 'nearest' } }]);
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  // The menu opens at scale 0.96 (database.css), so its box reads short on the first frame.
  it('places the list by its unscaled height, not the box shrunk by its opening scale', () => {
    const placeTop = vi.fn((_box: DOMRect, height: number) => height);

    list.close();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(318);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 278.4, 305.28));
    list = make({ placeTop });
    list.open();

    expect(placeTop).toHaveBeenCalled();
    expect(placeTop.mock.calls.every(([, height]) => height === 318)).toBe(true);
  });

  // notion-motion.md Round 74 §3: a checkmark marks the current view; aria-selected already says so.
  it('puts a hidden-from-readers checkmark on the current row only', () => {
    const checks = Array.from(document.querySelectorAll(`[${P}-dropdown] [${P}-check]`));

    expect(checks).toHaveLength(1);
    expect(checks[0].closest('[data-id]')?.getAttribute('data-id')).toBe('b');
    expect(checks[0].getAttribute('aria-hidden')).toBe('true');
    expect(checks[0].querySelector('svg')).not.toBeNull();
  });

  // The ••• button stays last, so the check sits just before it.
  it('draws the checkmark after the name and before the row menu', () => {
    const row = document.querySelector(`[${P}-dropdown] [data-id="b"]`);
    const children = Array.from(row?.children ?? []);
    const check = children.findIndex((el) => el.hasAttribute(`${P}-check`));

    expect(children[check - 1]?.hasAttribute(`${P}-name`)).toBe(true);
    list.close();
    list = make({ onMenu: vi.fn() });
    list.open();
    const withMenu = Array.from(document.querySelector(`[${P}-dropdown] [data-id="b"]`)?.children ?? []);

    expect(withMenu.at(-1)?.hasAttribute(`${P}-menu`)).toBe(true);
    expect(withMenu.at(-2)?.hasAttribute(`${P}-check`)).toBe(true);
  });

  it('focuses the search and highlights the current view, not the first row', () => {
    expect(input()).toHaveFocus();
    expect(highlighted()).toBe('b');
  });

  it('wires the search as a combobox over a listbox of options', () => {
    const listbox = document.querySelector(`[${P}-dropdown] [role="listbox"]`);
    const current = document.querySelector(`[${P}-item][data-id="b"]`);

    expect(listbox).not.toBeNull();
    expect(input().getAttribute('aria-controls')).toBe(listbox?.id);
    expect(current?.getAttribute('role')).toBe('option');
    expect(document.querySelector(`[${P}-new]`)?.getAttribute('role')).toBe('option');
    expect(input().getAttribute('aria-activedescendant')).toBe(current?.id);
  });

  it('ArrowDown walks every row and New view, then wraps to the first row', () => {
    press('ArrowDown');
    expect(highlighted()).toBe('c');
    press('ArrowDown');
    expect(highlighted()).toBe('new');
    expect(input().getAttribute('aria-activedescendant')).toBe(document.querySelector(`[${P}-new]`)?.id);
    press('ArrowDown');
    expect(highlighted()).toBe('a');
  });

  it('ArrowUp from the first row wraps to New view', () => {
    press('ArrowUp');
    expect(highlighted()).toBe('a');
    press('ArrowUp');
    expect(highlighted()).toBe('new');
  });

  it('typing filters and highlights the first match', () => {
    type('ca');

    expect(highlighted()).toBe('c');
  });

  it('shows "No results" and highlights nothing when no view matches', () => {
    const empty = (): HTMLElement | null => document.querySelector(`[${P}-empty]`);

    expect(empty()?.hidden).toBe(true);
    type('zzz');

    expect(empty()?.hidden).toBe(false);
    expect(empty()?.textContent).toBe('No results');
    expect(highlighted()).toBeNull();
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);

    press('ArrowDown');
    expect(highlighted()).toBe('new');
  });

  it('Enter opens the highlighted view and closes the list', () => {
    press('ArrowDown');
    press('Enter');

    expect(onSelect).toHaveBeenCalledWith('c', true);
    expect(list.isOpen).toBe(false);
  });

  // The owner hands the focus back to its button only when Escape closed the list.
  it('tells the owner whether Escape closed it', () => {
    const onClose = vi.fn();

    list.close();
    list = make({ onClose });
    list.open();
    press('Escape');
    list = make({ onClose });
    list.open();
    press('Enter');

    expect(onClose.mock.calls).toEqual([[true], [false]]);
  });

  it('Enter on New view runs the new-item action and closes the list', () => {
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.isOpen).toBe(false);
  });

  it('leaves arrows and Enter alone outside the search field (a rename input)', () => {
    const rename = document.createElement('input');

    document.querySelector(`[${P}-item][data-id="a"]`)?.appendChild(rename);
    press('ArrowDown', rename);
    press('Enter', rename);

    expect(highlighted()).toBe('b');
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.isOpen).toBe(true);
  });
});

describe('tabsThatFit', () => {
  it('keeps the leading tabs that fit when the current one is among them', () => {
    expect(tabsThatFit([100, 100, 100, 100], 1, 250, 10)).toEqual([0, 1]);
  });

  it('puts the current tab in place of the last ones that fit, in order', () => {
    expect(tabsThatFit([100, 100, 100, 100], 3, 250, 10)).toEqual([0, 3]);
  });

  it('keeps every tab when all fit', () => {
    expect(tabsThatFit([100, 100], 1, 210, 10)).toEqual([0, 1]);
  });

  it('shows the current tab even when it does not fit alone', () => {
    expect(tabsThatFit([100, 100, 400], 2, 250, 10)).toEqual([2]);
  });
});

describe('OverflowList second new-item row ("New data source", research/23 §10)', () => {
  let anchor: HTMLElement;
  let list: OverflowList;
  const onNewSource = vi.fn();

  const input = (): HTMLInputElement => document.querySelector(`[${P}-dropdown] input`) as HTMLInputElement;
  const press = (key: string): void => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const options = (): string[] => [...document.querySelectorAll<HTMLElement>(`[${P}-dropdown] [role="option"]`)]
    .filter((el) => !el.hidden).map((el) => el.textContent?.trim() ?? '');

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    list = new OverflowList({
      anchor,
      prefix: P,
      idAttribute: 'data-id',
      rows: ROWS,
      labels: { search: 'Search', handle: 'Drag', menu: 'More', newItem: 'New view', noResults: 'No results' },
      readOnly: false,
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onNewSecond: { label: 'New data source', icon: '<svg></svg>', activate: onNewSource },
      ownsNode: () => false,
      closeLayer: () => false,
      ownsEscape: () => false,
    });
    list.open();
  });

  afterEach(() => {
    list.close();
    anchor.remove();
    vi.restoreAllMocks();
  });

  it('is the last row, below New view', () => {
    expect(options().slice(-2)).toEqual(['New view', 'New data source']);
  });

  it('stays when typing filters the views', () => {
    input().value = 'ca';
    input().dispatchEvent(new Event('input'));

    expect(options()).toEqual(['Calendar', 'New view', 'New data source']);
  });

  it('Up from the first row lands on it; Down from it wraps to the first row', () => {
    press('ArrowUp');
    press('ArrowUp');
    expect(document.querySelector(`[${P}-dropdown] [data-highlighted]`)?.textContent).toBe('New data source');
    press('ArrowDown');
    expect(document.querySelector(`[${P}-dropdown] [data-highlighted]`)?.getAttribute('data-id')).toBe('a');
  });

  it('Enter on it runs its action and closes the list', () => {
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');

    expect(onNewSource).toHaveBeenCalledTimes(1);
    expect(list.isOpen).toBe(false);
  });
});

describe('OverflowList fixed rows', () => {
  let anchor: HTMLElement;
  let list: OverflowList;
  const onReorder = vi.fn();
  const onSelect = vi.fn();
  const row = (id: string): HTMLElement => document.querySelector(`[${P}-item][data-id="${id}"]`) as HTMLElement;
  const order = (): Array<string | null> => [...document.querySelectorAll(`[${P}-item]`)].map((el) => el.getAttribute('data-id'));

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    list = new OverflowList({
      anchor,
      prefix: P,
      idAttribute: 'data-id',
      rows: [{ ...ROWS[0], fixed: true }, ROWS[1], ROWS[2]],
      labels: { search: 'Search', handle: 'Drag', menu: 'More', newItem: 'New view', noResults: 'No results' },
      readOnly: false,
      onSelect,
      onReorder,
      ownsNode: () => false,
      closeLayer: () => false,
      ownsEscape: () => false,
    });
    list.open();
    ['a', 'b', 'c'].forEach((id, index) => {
      vi.spyOn(row(id), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 28, 290, 28));
    });
  });

  afterEach(() => {
    list.close();
    anchor.remove();
    vi.restoreAllMocks();
  });

  it('gives a fixed row no handle, but keeps the handle\'s room so names line up', () => {
    expect(row('a').querySelector(`[${P}-handle]`)).toBeNull();
    expect(row('a').querySelector(`[${P}-handle-space]`)).not.toBeNull();
    expect(row('b').querySelector(`[${P}-handle]`)).not.toBeNull();
  });

  it('drops a row dragged above a leading fixed row right after it', () => {
    row('c').querySelector(`[${P}-handle]`)?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientY: 2 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientY: 2 }));

    expect(order()).toEqual(['a', 'c', 'b']);
    expect(onReorder).toHaveBeenCalledWith('c', 'a', 'b');
  });

  it('the click a browser fires after a drop does not open the row or close the list', () => {
    row('c').querySelector(`[${P}-handle]`)?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientY: 30 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientY: 30 }));
    // Down and up landed on different nodes: the click goes to the row.
    row('c').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(list.isOpen).toBe(true);

    row('c').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(onSelect).toHaveBeenCalledWith('c', false);
  });
});

// notion-motion.md Round 75 §2: the open plays in reverse (opacity and scale 0.96, 200ms ease) before the list leaves.
describe('OverflowList close fade', () => {
  let anchor: HTMLElement;
  let finish: () => void;
  const onClose = vi.fn();
  const dropdowns = (): NodeListOf<HTMLElement> => document.querySelectorAll<HTMLElement>(`[${P}-dropdown]`);
  const make = (): OverflowList => new OverflowList({
    anchor,
    prefix: P,
    idAttribute: 'data-id',
    rows: ROWS,
    labels: { search: 'Search', handle: 'Drag', menu: 'More', newItem: 'New view', noResults: 'No results' },
    readOnly: false,
    onSelect: vi.fn(),
    ownsNode: () => false,
    closeLayer: () => false,
    ownsEscape: () => false,
    onClose,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const finished = new Promise<void>((resolve) => { finish = resolve; });

    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [{ finished }],
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    dropdowns().forEach((el) => el.remove());
    anchor.remove();
    vi.restoreAllMocks();
  });

  it('keeps the list on screen, closed and inert, until the fade ends', async () => {
    const list = make();

    list.open();
    const el = dropdowns()[0];

    list.close();

    expect(el.isConnected).toBe(true);
    expect(el.hasAttribute('data-blok-closing')).toBe(true);
    expect(el.hasAttribute('inert')).toBe(true);
    expect(list.isOpen).toBe(false);
    expect(list.contains(el)).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();

    expect(el.isConnected).toBe(false);
  });

  it('drops a fading list at once when it opens again', () => {
    const list = make();

    list.open();
    list.close();
    list.open();

    expect(dropdowns()).toHaveLength(1);
    expect(dropdowns()[0].hasAttribute('data-blok-closing')).toBe(false);
    list.close();
  });

  // The tab bar makes a new list on every open.
  it('drops a fading list at once when a new list with its prefix opens', () => {
    const first = make();

    first.open();
    first.close();
    const second = make();

    second.open();

    expect(dropdowns()).toHaveLength(1);
    expect(dropdowns()[0].hasAttribute('data-blok-closing')).toBe(false);
    second.close();
  });
});
