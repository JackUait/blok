import { fireEvent, getByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlockColorTunes } from '../../../../src/components/shared/block-color';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import { PopoverDesktop } from '../../../../src/components/utils/popover';
import { TableCellSelection } from '../../../../src/tools/table/table-cell-selection';
import { buildColumnMenuItems, buildRowMenuItems } from '../../../../src/tools/table/table-row-col-popover';
import type { PopoverMenuOptions } from '../../../../src/tools/table/table-row-col-popover';
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

/**
 * The modality tracker starts in keyboard mode, so a test that never dispatches
 * a pointer gesture passes whatever the code does. Every pointer case must go
 * through this first.
 * @param target - element the mouse pressed on
 */
const pressPointerOn = (target: Element): void => {
  fireEvent.pointerDown(target, { bubbles: true });
};

/**
 * Opens the submenu named `itemName` inside a fresh desktop popover.
 * @param config - menu config under test
 * @param itemName - `name` of the row that owns the submenu
 * @param modality - whether the row is reached by mouse or by keyboard
 */
const openSubmenu = async (
  config: MenuConfig,
  itemName: string,
  modality: 'pointer' | 'keyboard'
): Promise<PopoverDesktop> => {
  const trigger = document.createElement('button');

  trigger.type = 'button';
  document.body.appendChild(trigger);

  const popover = new PopoverDesktop({
    items: Array.isArray(config) ? config : [config],
    trigger,
    autoFocusFirstItem: false,
  });

  cleanup.push(() => popover.destroy());
  popover.show();
  await Promise.resolve();

  const item = queryByAttribute('data-blok-item-name', popover.getElement(), itemName);

  if (item === null) {
    throw new Error(`Missing "${itemName}" submenu trigger`);
  }

  if (modality === 'pointer') {
    pressPointerOn(item);
  }
  fireEvent.click(item);
  await Promise.resolve();

  return popover;
};

/**
 * Builds the two-tab picker on its own, outside any popover.
 * @returns the mounted picker element
 */
const mountPicker = (): HTMLElement => {
  const handle = createColorPicker({
    i18n,
    testIdPrefix: 'block-color',
    modes: [
      { key: 'textColor',
        labelKey: 'tools.marker.textColor',
        presetField: 'text' },
      { key: 'backgroundColor',
        labelKey: 'tools.marker.background',
        presetField: 'bg' },
    ],
    onColorSelect: vi.fn(),
  });

  document.body.appendChild(handle.element);

  return handle.element;
};

/**
 * Mounts a two-cell table selection and opens its cell-color submenu.
 * @param modality - whether the color row is reached by mouse or by keyboard
 */
const openCellSelectionColorMenu = async (modality: 'pointer' | 'keyboard'): Promise<void> => {
  const grid = document.createElement('div');
  const row = document.createElement('div');

  Array.from({ length: 2 }, (_, index) => {
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

  const selection = new TableCellSelection({ grid,
    i18n,
    onColorChange: vi.fn() });

  cleanup.push(() => selection.destroy());
  selection.selectRange({ minRow: 0,
    maxRow: 0,
    minCol: 0,
    maxCol: 1 });

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

  if (modality === 'pointer') {
    pressPointerOn(colorItem);
  } else {
    restoreKeyboardModality();
  }
  fireEvent.click(colorItem);
  await Promise.resolve();
};

/**
 * Puts the tracker back in keyboard mode. A bare `Event` on `document` throws
 * inside Flipper's keydown listener, so this needs a real KeyboardEvent on an
 * element.
 */
const restoreKeyboardModality = (): void => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true,
    key: 'Shift' }));
};

describe('color picker focus follows input modality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.setAttribute('data-blok-theme', 'light');
  });

  afterEach(() => {
    cleanup.splice(0).reverse().forEach((dispose) => dispose());
    restoreKeyboardModality();
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-blok-theme');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('switching tabs inside the picker', () => {
    it('does not move focus to a tab clicked with the mouse', async () => {
      const element = mountPicker();
      const textTab = getByRole(element, 'tab', { name: 'Text color' });
      const backgroundTab = getByRole(element, 'tab', { name: 'Background' });

      textTab.focus();
      pressPointerOn(backgroundTab);
      fireEvent.click(backgroundTab);
      await Promise.resolve();

      expect(backgroundTab).not.toHaveFocus();
      expect(backgroundTab.getAttribute('aria-selected')).toBe('true');
      expect(textTab.getAttribute('aria-selected')).toBe('false');
      expect(backgroundTab.tabIndex).toBe(0);
    });

    it('moves focus to a tab activated from the keyboard', async () => {
      const element = mountPicker();
      const textTab = getByRole(element, 'tab', { name: 'Text color' });
      const backgroundTab = getByRole(element, 'tab', { name: 'Background' });

      textTab.focus();
      fireEvent.click(backgroundTab);
      await Promise.resolve();

      expect(backgroundTab).toHaveFocus();
      expect(backgroundTab.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('block-settings Color submenu', () => {
    it('leaves the tab unfocused when the row is clicked with the mouse', async () => {
      const popover = await openSubmenu(
        buildBlockColorTunes({ data: {},
          i18n,
          onPick: vi.fn() }),
        'block-color',
        'pointer'
      );

      const tab = getByRole(popover.getElement(), 'tab', { name: 'Text color' });

      expect(tab).not.toHaveFocus();
    });

    it('focuses the selected tab when the row is opened from the keyboard', async () => {
      const popover = await openSubmenu(
        buildBlockColorTunes({ data: {},
          i18n,
          onPick: vi.fn() }),
        'block-color',
        'keyboard'
      );

      const tab = getByRole(popover.getElement(), 'tab', { name: 'Text color' });

      expect(tab).toHaveFocus();
    });
  });

  describe.each(['row', 'col'] as const)('table %s grip color submenu', (type) => {
    const menuOptions = (): PopoverMenuOptions => ({
      i18n,
      getColumnCount: () => 3,
      getRowCount: () => 3,
      isHeadingRow: () => false,
      isHeadingColumn: () => false,
      onAction: vi.fn(),
      onClearContents: vi.fn(),
      onColorChange: vi.fn(),
    });

    const items = (): MenuConfig => (
      type === 'row' ? buildRowMenuItems(1, menuOptions()) : buildColumnMenuItems(1, menuOptions())
    );

    it('leaves the tab unfocused when the row is clicked with the mouse', async () => {
      const popover = await openSubmenu(items(), 'cellColor', 'pointer');
      const tab = getByRole(popover.getElement(), 'tab', { name: 'Text color' });

      expect(tab).not.toHaveFocus();
    });

    it('focuses the selected tab when the row is opened from the keyboard', async () => {
      const popover = await openSubmenu(items(), 'cellColor', 'keyboard');
      const tab = getByRole(popover.getElement(), 'tab', { name: 'Text color' });

      expect(tab).toHaveFocus();
    });
  });

  describe('table cell-selection color submenu', () => {
    it('leaves the tab unfocused when the row is clicked with the mouse', async () => {
      await openCellSelectionColorMenu('pointer');

      const tab = getByRole(document.body, 'tab', { name: 'Text color' });

      expect(tab).not.toHaveFocus();
    });

    it('focuses the selected tab when the row is opened from the keyboard', async () => {
      await openCellSelectionColorMenu('keyboard');

      const tab = getByRole(document.body, 'tab', { name: 'Text color' });

      expect(tab).toHaveFocus();
    });
  });
});
