import { fireEvent, getAllByRole, getByRole, queryAllByRole } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../src/components/constants/data-attributes';
import { PopoverDesktop } from '../../../src/components/utils/popover/popover-desktop';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import { PopoverItemType } from '../../../src/components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';

type Family = 'heading' | 'toggle-heading';

const menus: Array<PopoverDesktop | PopoverMobile> = [];
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

const makeItems = (selected: Family = 'heading'): PopoverItemParams[] => {
  const tabs = document.createElement('div');

  tabs.setAttribute('data-blok-popover-tabs', '');
  tabs.setAttribute('role', 'tablist');

  const select = (family: Family): void => {
    for (const button of getAllByRole(tabs, 'tab', { hidden: true })) {
      const active = button.getAttribute('data-blok-popover-tab') === family;

      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  };

  for (const family of ['heading', 'toggle-heading'] as const) {
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = family === 'heading' ? 'Headings' : 'Toggle headings';
    button.setAttribute('role', 'tab');
    button.setAttribute('data-blok-popover-tab', family);
    button.addEventListener('click', () => {
      select(family);
      tabs.dispatchEvent(new Event('blok-popover-tabs-change', { bubbles: true }));
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      let nextFamily: Family = family === 'heading' ? 'toggle-heading' : 'heading';

      if (event.key === 'Home') {
        nextFamily = 'heading';
      } else if (event.key === 'End') {
        nextFamily = 'toggle-heading';
      }
      const next = queryAllByRole(tabs, 'tab', { hidden: true })
        .find(tab => tab.getAttribute('data-blok-popover-tab') === nextFamily);

      next?.click();
      next?.focus();
    });
    tabs.appendChild(button);
  }
  select(selected);

  return [
    { type: PopoverItemType.Html, name: 'convert-heading-tabs', element: tabs },
    { title: 'Heading 1', name: 'heading-1', dataset: { 'blok-popover-tab': 'heading' }, onActivate: vi.fn() },
    { title: 'Heading 2', name: 'heading-2', dataset: { 'blok-popover-tab': 'heading' }, onActivate: vi.fn() },
    { title: 'Toggle heading 1', name: 'toggle-1', dataset: { 'blok-popover-tab': 'toggle-heading' }, onActivate: vi.fn() },
    { title: 'Toggle heading 2', name: 'toggle-2', dataset: { 'blok-popover-tab': 'toggle-heading' }, onActivate: vi.fn() },
    { title: 'Paragraph', name: 'paragraph', onActivate: vi.fn() },
  ];
};

const visibleRows = (menu: PopoverDesktop | PopoverMobile): string[] => {
  return queryAllByRole(menu.getElement(), 'menuitem', { hidden: true })
    .filter(item => !item.hasAttribute(DATA_ATTR.hidden))
    .map(item => item.textContent?.trim() ?? '');
};

const focusedRows = (menu: PopoverDesktop | PopoverMobile): string[] => {
  return queryAllByRole(menu.getElement(), 'menuitem', { hidden: true })
    .filter(item => item.hasAttribute(DATA_ATTR.focused))
    .map(item => item.textContent?.trim() ?? '');
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
  fireEvent.pointerDown(document.body);
});

afterEach(() => {
  menus.splice(0).forEach(menu => menu.destroy());
  document.body.replaceChildren();

  if (scrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  vi.restoreAllMocks();
});

describe.each([
  ['desktop', PopoverDesktop],
  ['mobile', PopoverMobile],
] as const)('native %s popover tabs', (_name, PopoverClass) => {
  const open = async (selected?: Family): Promise<PopoverDesktop | PopoverMobile> => {
    const menu = new PopoverClass({ items: makeItems(selected), autoFocusFirstItem: false });

    menus.push(menu);
    menu.show();
    await Promise.resolve();

    return menu;
  };

  it('applies the selected family before opening', () => {
    const menu = new PopoverClass({ items: makeItems('toggle-heading') });

    menus.push(menu);
    expect(visibleRows(menu)).toEqual(['Toggle heading 1', 'Toggle heading 2', 'Paragraph']);
  });

  it('switches native rows without focusing a heading and resets scrolling', async () => {
    const menu = await open();
    const items = getByRole(menu.getElement(), 'menu');

    items.scrollTop = 100;
    fireEvent.click(getByRole(menu.getElement(), 'tab', { name: 'Toggle headings' }));

    expect(visibleRows(menu)).toEqual(['Toggle heading 1', 'Toggle heading 2', 'Paragraph']);
    expect(focusedRows(menu)).toEqual([]);
    expect(items.scrollTop).toBe(0);
    expect(menu.isShown).toBe(true);
  });

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])('leaves %s to the tab target handlers', async key => {
    const menu = await open(key === 'Home' ? 'toggle-heading' : 'heading');
    const tab = getByRole(menu.getElement(), 'tab', { selected: true });

    tab.focus();
    fireEvent.keyDown(tab, { key });

    const expected = key === 'Home' ? 'Headings' : 'Toggle headings';

    expect(getByRole(menu.getElement(), 'tab', { name: expected })).toHaveFocus();
    expect(getByRole(menu.getElement(), 'tab', { name: expected })).toHaveAttribute('aria-selected', 'true');
    expect(visibleRows(menu)[0]).toBe(key === 'Home' ? 'Heading 1' : 'Toggle heading 1');
  });

  it('enters the first visible heading on Down from the selected tab, then advances', async () => {
    const menu = await open('toggle-heading');
    const tab = getByRole(menu.getElement(), 'tab', { selected: true });

    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 1']);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    const focusedRow = queryAllByRole(menu.getElement(), 'menuitem', { hidden: true })
      .find(item => item.matches(':focus'));

    fireEvent.keyDown(focusedRow ?? tab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 2']);
  });

  it('preserves the selected tab when the virtual cursor leaves it', async () => {
    fireEvent.keyDown(document.body, { key: 'Shift' });
    const menu = new PopoverClass({ items: makeItems(), searchable: true });

    menus.push(menu);
    menu.show();
    await Promise.resolve();

    if (menu instanceof PopoverDesktop) {
      menu.filterItems('');
    }

    const tab = getByRole(menu.getElement(), 'tab', { name: 'Headings' });

    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowDown' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(focusedRows(menu)).toEqual(['Heading 1']);
    menu.hide();
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps only the selected tab in native Tab navigation', async () => {
    const menu = await open('toggle-heading');
    const items = getByRole(menu.getElement(), 'menu');
    const tab = getByRole(menu.getElement(), 'tab', { selected: true });

    fireEvent.keyDown(items, { key: 'Tab' });
    expect(tab).toHaveAttribute(DATA_ATTR.focused, 'true');
    fireEvent.keyDown(items, { key: 'Tab' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 1']);
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('enters the tabs by keyboard and navigates their visible rows', async () => {
    const onActivate = vi.fn();
    const menu = new PopoverClass({
      items: [...makeItems(), { title: 'Finish', onActivate }],
      searchable: true,
      autoFocusFirstItem: false,
    });

    menus.push(menu);
    menu.show();
    await Promise.resolve();
    const host = menu instanceof PopoverDesktop
      ? getByRole(menu.getElement(), 'combobox')
      : getByRole(menu.getElement(), 'menu');
    const headingTab = getByRole(menu.getElement(), 'tab', { name: 'Headings' });
    const toggleTab = getByRole(menu.getElement(), 'tab', { name: 'Toggle headings' });

    expect(host).toHaveFocus();
    fireEvent.keyDown(host, { key: 'Tab' });
    expect(headingTab).toHaveFocus();
    fireEvent.keyDown(headingTab, { key: 'ArrowRight' });
    expect(toggleTab).toHaveFocus();
    fireEvent.keyDown(toggleTab, { key: 'ArrowLeft' });
    expect(headingTab).toHaveFocus();
    fireEvent.keyDown(headingTab, { key: 'ArrowRight' });
    expect(toggleTab).toHaveFocus();
    fireEvent.keyDown(toggleTab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 1']);
    fireEvent.keyDown(toggleTab, { key: 'Tab' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 2']);
    fireEvent.keyDown(toggleTab, { key: 'ArrowUp' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 1']);
    fireEvent.keyDown(toggleTab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 2']);
    fireEvent.keyDown(toggleTab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Paragraph']);
    fireEvent.keyDown(toggleTab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Finish']);
    fireEvent.keyDown(toggleTab, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledOnce();
    expect(toggleTab).toHaveAttribute('aria-selected', 'true');
  });

  it('starts at the first heading after focus returns to the selected tab', async () => {
    fireEvent.keyDown(document.body, { key: 'Shift' });
    const menu = new PopoverClass({ items: makeItems(), searchable: true });

    menus.push(menu);
    menu.show();
    await Promise.resolve();

    if (menu instanceof PopoverDesktop) {
      menu.filterItems('');
    }

    const tab = getByRole(menu.getElement(), 'tab', { selected: true });
    const host = menu instanceof PopoverDesktop
      ? getByRole(menu.getElement(), 'combobox')
      : getByRole(menu.getElement(), 'menu');

    fireEvent.keyDown(host, { key: 'ArrowDown' });
    host.focus();
    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Heading 1']);
    fireEvent.keyDown(tab, { key: 'Tab' });
    expect(focusedRows(menu)).toEqual(['Heading 2']);
  });

  it('does not restore permanently hidden rows when tabs change', async () => {
    const menu = await open();

    menu.toggleItemHiddenByName('toggle-1', true);
    menu.toggleItemHiddenByName('paragraph', true);
    fireEvent.click(getByRole(menu.getElement(), 'tab', { name: 'Toggle headings' }));
    expect(visibleRows(menu)).toEqual(['Toggle heading 2']);

    const tab = getByRole(menu.getElement(), 'tab', { selected: true });

    tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowDown' });
    expect(focusedRows(menu)).toEqual(['Toggle heading 2']);
  });
});

describe('desktop tab search', () => {
  it('keeps permanently hidden search results out of keyboard navigation', async () => {
    const menu = new PopoverDesktop({ items: makeItems(), searchable: true });

    menus.push(menu);
    menu.show();
    await Promise.resolve();
    menu.toggleItemHiddenByName('heading-1', true);
    menu.filterItems('heading');
    expect(focusedRows(menu)).not.toContain('Heading 1');
    expect(focusedRows(menu)).toHaveLength(1);
  });

  it('searches both families and restores the current family when cleared', () => {
    const menu = new PopoverDesktop({ items: makeItems() });

    menus.push(menu);
    fireEvent.click(getByRole(menu.getElement(), 'tab', { name: 'Toggle headings' }));
    menu.filterItems('heading');
    expect(visibleRows(menu)).toEqual(expect.arrayContaining(['Heading 1', 'Heading 2', 'Toggle heading 1', 'Toggle heading 2']));
    menu.filterItems('');
    expect(visibleRows(menu)).toEqual(['Toggle heading 1', 'Toggle heading 2', 'Paragraph']);
  });

  it('ignores tab changes during nonempty search without hiding its matches', () => {
    const menu = new PopoverDesktop({ items: makeItems(), searchable: true });

    menus.push(menu);
    menu.filterItems('heading');
    fireEvent.click(getByRole(menu.getElement(), 'tab', { name: 'Toggle headings', hidden: true }));
    expect(visibleRows(menu)).toEqual(expect.arrayContaining(['Heading 1', 'Toggle heading 1']));
    menu.filterItems('');
    expect(visibleRows(menu)).toEqual(['Toggle heading 1', 'Toggle heading 2', 'Paragraph']);
  });
});

describe('mobile tab pages', () => {
  it('does not reset scrolling when an ordinary page has no tabs', () => {
    const menu = new PopoverMobile({
      items: [{ title: 'More', children: { items: [{ title: 'Ordinary item', onActivate: vi.fn() }] } }],
      autoFocusFirstItem: false,
    });

    menus.push(menu);
    menu.show();
    const items = getByRole(menu.getElement(), 'menu');

    items.scrollTop = 80;
    fireEvent.click(getByRole(menu.getElement(), 'menuitem', { name: 'More' }));
    expect(items.scrollTop).toBe(80);
  });

  it('applies tabs after page swaps and Back navigation', () => {
    const menu = new PopoverMobile({
      items: [{ title: 'Convert', children: { items: makeItems('toggle-heading') } }],
    });

    menus.push(menu);
    menu.show();
    fireEvent.click(getByRole(menu.getElement(), 'menuitem', { name: 'Convert' }));
    expect(visibleRows(menu)).toEqual(['Toggle heading 1', 'Toggle heading 2', 'Paragraph']);
    fireEvent.click(getByRole(menu.getElement(), 'tab', { name: 'Headings' }));
    fireEvent.click(getByRole(menu.getElement(), 'button', { name: 'Back' }));
    expect(visibleRows(menu)).toEqual(['Convert']);
    fireEvent.click(getByRole(menu.getElement(), 'menuitem', { name: 'Convert' }));
    expect(visibleRows(menu)).toEqual(['Heading 1', 'Heading 2', 'Paragraph']);
  });
});
