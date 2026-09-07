import { fireEvent, getByRole, queryByAttribute, queryByRole } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { InlineKeyboardHandler } from '../../../../src/components/modules/toolbar/inline/keyboard-handler';
import { buildBlockColorTunes } from '../../../../src/components/shared/block-color';
import { PopoverDesktop } from '../../../../src/components/utils/popover';
import { PopoverInline } from '../../../../src/components/utils/popover/popover-inline';
import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import { buildColumnMenuItems, buildRowMenuItems } from '../../../../src/tools/table/table-row-col-popover';
import type { PopoverMenuOptions } from '../../../../src/tools/table/table-row-col-popover';
import type { API } from '../../../../types';
import type { I18n } from '../../../../types/api';
import type { MenuConfig } from '../../../../types/tools';

const translations: Record<string, string> = {
  'toolNames.marker': 'Color',
  'tools.table.cellColor': 'Color',
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
  'tools.marker.default': 'Default',
  'tools.colorPicker.color.red': 'Red',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
};
const i18n: I18n = {
  t: (key) => translations[key] ?? key,
  has: (key) => key in translations,
  getEnglishTranslation: (key) => translations[key] ?? '',
  getLocale: () => 'en',
};
const cleanup: Array<() => void> = [];

const openMenu = async (config: MenuConfig, itemName: string, inline = false) => {
  const trigger = document.createElement('button');

  trigger.type = 'button';
  trigger.textContent = 'Open settings';
  document.body.appendChild(trigger);
  const Popover = inline ? PopoverInline : PopoverDesktop;
  const popover = new Popover({
    items: Array.isArray(config) ? config : [config],
    trigger,
    autoFocusFirstItem: false,
  });

  cleanup.push(() => popover.destroy());
  popover.show();
  await Promise.resolve();
  const item = queryByAttribute('data-blok-item-name', popover.getElement(), itemName);

  if (item === null) {
    throw new Error('Missing color submenu trigger');
  }
  fireEvent.click(item);
  await Promise.resolve();

  return popover;
};

const checkNativeTabs = (root: HTMLElement): void => {
  const textTab = getByRole(root, 'tab', { name: 'Text color', selected: true });

  expect(textTab).toHaveFocus();
  fireEvent.keyDown(textTab, { key: 'ArrowRight' });
  const backgroundTab = getByRole(root, 'tab', { name: 'Background', selected: true });

  expect(backgroundTab).toHaveFocus();
  expect(queryByRole(root, 'tabpanel', { name: 'Text color' })).toBeNull();
  expect(fireEvent.keyDown(backgroundTab, { key: 'Tab' })).toBe(true);
  const reset = getByRole(getByRole(root, 'tabpanel', { name: 'Background' }), 'button', { name: 'Default' });

  expect(queryByAttribute('data-blok-keyboard-owner', root, '')).toContainElement(reset);
};

describe('native keyboard in color submenus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.setAttribute('data-blok-theme', 'light');
  });

  afterEach(() => {
    cleanup.splice(0).reverse().forEach((dispose) => dispose());
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-blok-theme');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens block colors on the active tab and leaves dismissal to the real popover', async () => {
    const onPick = vi.fn();
    const popover = await openMenu(buildBlockColorTunes({ data: {}, i18n, onPick }), 'block-color');

    checkNativeTabs(popover.getElement());
    fireEvent.click(getByRole(popover.getElement(), 'button', { name: 'Red background' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('backgroundColor', 'red');
    fireEvent.keyDown(getByRole(popover.getElement(), 'tab', { name: 'Background' }), { key: 'Escape' });
    expect(popover.isShown).toBe(false);
  }, 15000);

  it('saves marker selection before moving focus and applies colors after tab navigation', async () => {
    const editor = document.createElement('div');

    editor.contentEditable = 'true';
    editor.textContent = 'Selected words';
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();
    const range = document.createRange();

    range.selectNodeContents(editor);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const close = vi.fn();
    const api = { i18n, inlineToolbar: { close } } as API;
    const marker = new MarkerInlineTool({ api });
    const popover = await openMenu(marker.render(), 'marker', true);

    checkNativeTabs(popover.getElement());
    expect(close).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.click(getByRole(popover.getElement(), 'button', { name: 'Red background' }));
    const mark = getByRole(editor, 'mark');

    expect(mark?.textContent).toBe('Selected words');
    expect(mark?.style.backgroundColor).toBe('var(--blok-color-red-bg)');
  });

  it('dismisses the native marker submenu with Escape without closing its trigger-less inline toolbar', async () => {
    const editor = document.createElement('div');

    editor.contentEditable = 'true';
    editor.textContent = 'Keep this selection';
    document.body.appendChild(editor);
    const range = document.createRange();

    range.selectNodeContents(editor);
    window.getSelection()?.addRange(range);
    const api = { i18n, inlineToolbar: { close: vi.fn() } } as API;
    const config = new MarkerInlineTool({ api }).render();
    const popover = new PopoverInline({ items: Array.isArray(config) ? config : [config] });
    const closeToolbar = vi.fn();
    const handler = new InlineKeyboardHandler(() => popover, closeToolbar);
    const onKeyDown = (event: KeyboardEvent): void => handler.handle(event, popover.isShown);

    window.addEventListener('keydown', onKeyDown, true);
    cleanup.push(() => window.removeEventListener('keydown', onKeyDown, true));
    cleanup.push(() => popover.destroy());
    popover.show();
    await Promise.resolve();
    const marker = queryByAttribute('data-blok-item-name', popover.getElement(), 'marker');

    if (marker === null) {
      throw new Error('Missing marker opener');
    }
    fireEvent.click(marker);
    await Promise.resolve();
    const tab = getByRole(popover.getElement(), 'tab', { name: 'Text color' });

    expect(tab).toHaveFocus();
    const defaultAllowed = fireEvent.keyDown(tab, { key: 'Escape' });

    expect(popover.hasNestedPopoverOpen).toBe(false);
    expect(defaultAllowed).toBe(false);
    expect(popover.isShown).toBe(true);
    expect(closeToolbar).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe('Keep this selection');
  });

  it.each(['row', 'col'] as const)('focuses the %s grip color picker without changing its callback target', async (type) => {
    const onColorChange = vi.fn();
    const options: PopoverMenuOptions = {
      i18n,
      getColumnCount: () => 3,
      getRowCount: () => 3,
      isHeadingRow: () => false,
      isHeadingColumn: () => false,
      onAction: vi.fn(),
      onClearContents: vi.fn(),
      onColorChange,
    };
    const items = type === 'row' ? buildRowMenuItems(1, options) : buildColumnMenuItems(1, options);
    const popover = await openMenu(items, 'cellColor');

    checkNativeTabs(popover.getElement());
    fireEvent.click(getByRole(popover.getElement(), 'button', { name: 'Red background' }));
    expect(onColorChange).toHaveBeenCalledExactlyOnceWith(type, 1, '#fdebec', 'backgroundColor');
    fireEvent.keyDown(getByRole(popover.getElement(), 'tab', { name: 'Background' }), { key: 'Escape' });
    expect(popover.isShown).toBe(false);
  });

  it('focuses the cell-selection picker while retaining the selected cells', async () => {
    const grid = document.createElement('div');
    const row = document.createElement('div');
    const cells = Array.from({ length: 2 }, (_, index) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.textContent = `Cell ${index}`;
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(index * 100, 0, 100, 40));
      row.appendChild(cell);

      return cell;
    });

    row.setAttribute('data-blok-table-row', '');
    grid.appendChild(row);
    document.body.appendChild(grid);
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 40));
    const onColorChange = vi.fn();
    const selection = new TableCellSelection({ grid, i18n, onColorChange });

    cleanup.push(() => selection.destroy());
    selection.selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    const pill = queryByAttribute('data-blok-table-selection-pill', grid, '');

    if (pill === null) {
      throw new Error('Missing cell selection pill');
    }
    fireEvent.pointerDown(pill);
    await Promise.resolve();
    const colorItem = queryByAttribute('data-blok-item-name', document.body, 'cellColor');

    if (colorItem === null) {
      throw new Error('Missing cell color action');
    }
    fireEvent.click(colorItem);
    await Promise.resolve();

    checkNativeTabs(document.body);
    fireEvent.click(getByRole(document.body, 'button', { name: 'Red background' }));
    expect(onColorChange).toHaveBeenCalledExactlyOnceWith(cells, '#fdebec', 'backgroundColor');
    expect(selection.getSelectedRange()).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    fireEvent.keyDown(getByRole(document.body, 'tab', { name: 'Background' }), { key: 'Escape' });
    expect(queryByRole(document.body, 'tab', { name: 'Background' })).toBeNull();
  });
});
