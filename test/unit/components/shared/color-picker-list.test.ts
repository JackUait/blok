import { fireEvent, getAllByRole, getByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import * as tooltipModule from '../../../../src/components/utils/tooltip';
import type { I18n } from '../../../../types/api';

const translations: Record<string, string> = {
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.colorPicker.recentlyUsed': 'Recently used',
  'tools.colorPicker.backgroundColor': 'Background color',
  'tools.marker.default': 'Default',
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
  ...Object.fromEntries(COLOR_PRESETS.map(({ name }) => [`tools.colorPicker.color.${name}`, name[0].toUpperCase() + name.slice(1)])),
};

const i18n: I18n = {
  t: (key: string) => translations[key] ?? key,
  has: () => false,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
};

const mountPicker = (options: Partial<ColorPickerOptions> = {}) => {
  const picker = createColorPicker({
    i18n,
    testIdPrefix: 'list',
    modes: [
      { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
      { key: 'background-color', labelKey: 'tools.marker.background', presetField: 'bg' },
    ],
    onColorSelect: vi.fn(),
    ...options,
  });

  document.body.appendChild(picker.element);

  return picker;
};

const byTestId = (root: HTMLElement, id: string): HTMLElement => {
  const found = queryByAttribute('data-blok-testid', root, id);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`No element with test id ${id}`);
  }

  return found;
};

const recentIds = (root: HTMLElement): string[] => {
  const section = queryByAttribute('data-blok-testid', root, 'list-section-recent');

  return section === null ? [] : getAllByRole(section, 'button').map((button) => button.getAttribute('data-blok-testid') ?? '');
};

const hasCheck = (row: HTMLElement): boolean => !byTestId(row, 'list-check').hidden;

const red = COLOR_PRESETS.find((preset) => preset.name === 'red');

if (red === undefined) {
  throw new Error('red preset missing');
}

describe('color picker, named rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.setAttribute('data-blok-theme', 'light');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-blok-theme');
    localStorage.clear();
  });

  it('marks the picked row with a checkmark, with no fill and the same ink as other rows', () => {
    const { element } = mountPicker({ initialActiveColors: { color: red.text } });
    const picked = byTestId(element, 'list-swatch-color-red');
    const other = byTestId(element, 'list-swatch-color-blue');

    expect(picked.className).toBe(other.className);
    expect(hasCheck(picked)).toBe(true);
    expect(byTestId(picked, 'list-check')).not.toBeEmptyDOMElement();
    expect(hasCheck(other)).toBe(false);
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    expect(other).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves the checkmark when the active color changes', () => {
    const picker = mountPicker();
    const defaultRow = byTestId(picker.element, 'list-swatch-color-default');
    const redRow = byTestId(picker.element, 'list-swatch-color-red');

    expect(hasCheck(defaultRow)).toBe(true);

    picker.setActiveColor(red.text, 'color');

    expect(hasCheck(redRow)).toBe(true);
    expect(hasCheck(defaultRow)).toBe(false);
  });

  it('writes the color name on every row', () => {
    const { element } = mountPicker();

    expect(byTestId(byTestId(element, 'list-swatch-color-default'), 'list-name').textContent).toBe('Default');
    expect(byTestId(byTestId(element, 'list-swatch-color-red'), 'list-name').textContent).toBe('Red');
    expect(byTestId(byTestId(element, 'list-swatch-background-color-default'), 'list-name').textContent).toBe('Default');
    expect(byTestId(byTestId(element, 'list-swatch-background-color-purple'), 'list-name').textContent).toBe('Purple');
  });

  it('draws a small tile before the name: a colored CSS letter for text, a fill for background', () => {
    const { element } = mountPicker();
    const textTile = byTestId(byTestId(element, 'list-swatch-color-red'), 'list-tile');
    const bgTile = byTestId(byTestId(element, 'list-swatch-background-color-red'), 'list-tile');

    expect(textTile).toHaveClass("before:content-['A']");
    expect(bgTile).not.toHaveClass("before:content-['A']");
    expect(textTile).toHaveStyle({ color: red.text });
    expect(bgTile).toHaveTextContent('');
    expect(bgTile).toHaveStyle({ backgroundColor: red.bg });
  });

  it('hides the sample tiles from assistive tech, so a row is named by its label alone', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([{ name: 'blue', field: 'text' }]));
    const { element } = mountPicker();

    expect(byTestId(byTestId(element, 'list-swatch-color-red'), 'list-tile')).toHaveAttribute('aria-hidden', 'true');
    expect(byTestId(byTestId(element, 'list-swatch-recent-text-blue'), 'list-tile')).toHaveAttribute('aria-hidden', 'true');
    expect(getByRole(element, 'button', { name: 'Red text color' })).toBe(byTestId(element, 'list-swatch-color-red'));
  });

  it('titles the background column "Background color"', () => {
    const { element } = mountPicker();

    expect(getByRole(element, 'group', { name: 'Background color' })).toBe(byTestId(element, 'list-section-background-color'));
    expect(getByRole(element, 'group', { name: 'Text color' })).toBe(byTestId(element, 'list-section-color'));
  });

  it('keeps the recently used row as it was while the picker stays open', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([{ name: 'blue', field: 'text' }]));
    const { element } = mountPicker();

    fireEvent.click(byTestId(element, 'list-swatch-color-red'));
    fireEvent.click(byTestId(element, 'list-swatch-background-color-green'));

    expect(recentIds(element)).toEqual(['list-swatch-recent-text-blue']);
  });

  it('does not add a recently used row to an open picker that had none', () => {
    const { element } = mountPicker();

    fireEvent.click(byTestId(element, 'list-swatch-color-red'));

    expect(recentIds(element)).toEqual([]);
  });

  it('shows the new picks first on the next open', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([{ name: 'blue', field: 'text' }]));
    const first = mountPicker();

    fireEvent.click(byTestId(first.element, 'list-swatch-color-red'));
    first.element.remove();

    expect(recentIds(mountPicker().element)).toEqual(['list-swatch-recent-text-red', 'list-swatch-recent-text-blue']);
  });

  it('catches up when a kept picker is reset for its next open', () => {
    const picker = mountPicker();

    fireEvent.click(byTestId(picker.element, 'list-swatch-color-red'));
    picker.reset();

    expect(recentIds(picker.element)).toEqual(['list-swatch-recent-text-red']);
  });

  it('remembers eight recently used colors', () => {
    const first = mountPicker();

    for (const { name } of COLOR_PRESETS) {
      fireEvent.click(byTestId(first.element, `list-swatch-color-${name}`));
    }
    first.element.remove();

    const ids = recentIds(mountPicker().element);

    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe(`list-swatch-recent-text-${COLOR_PRESETS[COLOR_PRESETS.length - 1].name}`);
  });

  it('gives hover hints to the nameless recent tiles only', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([{ name: 'blue', field: 'text' }]));
    const onHoverSpy = vi.spyOn(tooltipModule, 'onHover');
    const { element } = mountPicker();
    const hinted = onHoverSpy.mock.calls.map(([target]) => target.getAttribute('data-blok-testid'));

    expect(hinted).toEqual(['list-swatch-recent-text-blue']);
    expect(element).toBeInTheDocument();
  });

  describe('arrow keys', () => {
    const press = (key: string): void => {
      const target = document.activeElement;

      if (!(target instanceof HTMLElement)) {
        throw new Error('nothing is focused');
      }
      fireEvent.keyDown(target, { key });
    };

    const focused = (): string | null => document.activeElement?.getAttribute('data-blok-testid') ?? null;

    it('moves down and up a column', () => {
      const { element } = mountPicker();

      byTestId(element, 'list-swatch-color-default').focus();
      press('ArrowDown');
      expect(focused()).toBe('list-swatch-color-gray');
      press('ArrowUp');
      expect(focused()).toBe('list-swatch-color-default');
    });

    it('moves across to the same row of the other column', () => {
      const { element } = mountPicker();

      byTestId(element, 'list-swatch-color-red').focus();
      press('ArrowRight');
      expect(focused()).toBe('list-swatch-background-color-red');
      press('ArrowLeft');
      expect(focused()).toBe('list-swatch-color-red');
    });

    it('moves between the recent tiles and the columns under them', () => {
      localStorage.setItem('blok-recent-colors', JSON.stringify([
        { name: 'blue', field: 'text' },
        { name: 'red', field: 'bg' },
      ]));
      const { element } = mountPicker();

      byTestId(element, 'list-swatch-color-default').focus();
      press('ArrowUp');
      expect(focused()).toBe('list-swatch-recent-text-blue');
      press('ArrowRight');
      expect(focused()).toBe('list-swatch-recent-bg-red');
      press('ArrowLeft');
      expect(focused()).toBe('list-swatch-recent-text-blue');
      press('ArrowDown');
      expect(focused()).toBe('list-swatch-color-default');
    });

    it('stays put at an edge and leaves other keys alone', () => {
      const { element } = mountPicker();
      const last = byTestId(element, 'list-swatch-background-color-red');

      last.focus();
      press('ArrowDown');
      press('ArrowRight');
      expect(focused()).toBe('list-swatch-background-color-red');
      expect(fireEvent.keyDown(last, { key: 'Escape' })).toBe(true);
      expect(fireEvent.keyDown(last, { key: 'ArrowDown' })).toBe(false);
    });
  });
});
