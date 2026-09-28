import { fireEvent, getAllByRole, getByRole, queryAllByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { ColorPickerOptions } from '../../../../src/components/shared/color-picker';
import type { I18n } from '../../../../types/api';

const translations: Record<string, string> = {
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.colorPicker.recentlyUsed': 'Recently used',
  'tools.marker.default': 'Default',
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
  'tools.colorPicker.color.red': 'Red',
  'tools.colorPicker.color.blue': 'Blue',
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
    testIdPrefix: 'redesign',
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

describe('color picker, one untabbed panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.setAttribute('data-blok-theme', 'light');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    document.documentElement.removeAttribute('data-blok-theme');
    localStorage.clear();
  });

  it('shows the text and background sections at once, with no tabs', () => {
    const { element } = mountPicker();

    expect(queryAllByRole(element, 'tablist')).toHaveLength(0);
    expect(queryAllByRole(element, 'tab')).toHaveLength(0);
    expect(queryByAttribute('data-blok-testid', element, 'redesign-section-color')?.hidden).toBe(false);
    expect(queryByAttribute('data-blok-testid', element, 'redesign-section-background-color')?.hidden).toBe(false);
  });

  it('titles each section and labels it as a group', () => {
    const { element } = mountPicker();

    expect(getByRole(element, 'group', { name: 'Text color' })).toBe(
      queryByAttribute('data-blok-testid', element, 'redesign-section-color')
    );
    expect(getByRole(element, 'group', { name: 'Background' })).toBe(
      queryByAttribute('data-blok-testid', element, 'redesign-section-background-color')
    );
  });

  it('keeps ten swatches per section: default plus nine colors', () => {
    const { element } = mountPicker();

    expect(element.querySelectorAll('[data-blok-testid^="redesign-swatch-color-"]')).toHaveLength(10);
    expect(element.querySelectorAll('[data-blok-testid^="redesign-swatch-background-color-"]')).toHaveLength(10);
  });

  it('has no selected-color row and no reset button; the default swatch resets', () => {
    const onColorSelect = vi.fn();
    const { element } = mountPicker({ onColorSelect, initialActiveColors: { color: '#d44c47' } });

    expect(element.querySelector('[data-blok-testid^="redesign-reset-"]')).toBeNull();
    expect(element.querySelector('[data-blok-testid^="redesign-preview-"]')).toBeNull();

    fireEvent.click(getByRole(element, 'button', { name: 'Default text color' }));

    expect(onColorSelect).toHaveBeenCalledExactlyOnceWith(null, 'color');
  });

  it('rings the swatches of the colors already applied', () => {
    const { element } = mountPicker({ initialActiveColors: { color: '#d44c47', 'background-color': null } });

    expect(getByRole(element, 'button', { name: 'Red text color' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole(element, 'button', { name: 'Default background' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts recently used colors above the sections', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([ { name: 'red', field: 'text' } ]));
    const { element } = mountPicker();
    const recent = queryByAttribute('data-blok-testid', element, 'redesign-section-recent');
    const text = queryByAttribute('data-blok-testid', element, 'redesign-section-color');

    if (recent === null || text === null) {
      throw new Error('Missing picker sections');
    }

    expect(recent.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('preserves focused swatches when callbacks update selection and when the handle resets', () => {
    const onColorSelect = vi.fn((color: string | null, mode: string) => picker.setActiveColor(color, mode));
    const picker = mountPicker({ onColorSelect });
    const red = getByRole(picker.element, 'button', { name: 'Red text color' });

    red.focus();
    red.click();

    expect(red).toHaveFocus();
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(onColorSelect).toHaveBeenCalledExactlyOnceWith('#d44c47', 'color');

    picker.reset();

    expect(red).toHaveFocus();
    expect(red.getAttribute('aria-pressed')).toBe('false');
  });

  it('applies a recent color on its own axis while keeping the recent control focused', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([
      { name: 'red', field: 'text' },
      { name: 'blue', field: 'bg' },
    ]));
    const onColorSelect = vi.fn((color: string | null, mode: string) => picker.setActiveColor(color, mode));
    const picker = mountPicker({ onColorSelect });
    const recentSection = queryByAttribute('data-blok-testid', picker.element, 'redesign-section-recent');

    if (recentSection === null) {
      throw new Error('Missing recent section');
    }

    const blue = getByRole(recentSection, 'button', { name: 'Blue background' });

    blue.focus();
    blue.click();

    expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('redesign-swatch-recent-bg-blue');
    expect(onColorSelect).toHaveBeenCalledExactlyOnceWith('#e7f3f8', 'background-color');
    expect(JSON.parse(localStorage.getItem('blok-recent-colors') ?? '[]')).toEqual([
      { name: 'blue', field: 'bg' },
      { name: 'red', field: 'text' },
    ]);
    expect(getByRole(getByRole(picker.element, 'group', { name: 'Background' }), 'button', { name: 'Blue background' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps section labels local when pickers share a test prefix', () => {
    const first = mountPicker();
    const second = mountPicker();
    const firstLabel = queryByAttribute('data-blok-testid', first.element, 'redesign-section-color')?.getAttribute('aria-labelledby');
    const secondLabel = queryByAttribute('data-blok-testid', second.element, 'redesign-section-color')?.getAttribute('aria-labelledby');

    expect(firstLabel).toBeTruthy();
    expect(firstLabel).not.toBe(secondLabel);
  });

  it('never submits a containing form from swatches or recents', () => {
    const form = document.createElement('form');
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const picker = mountPicker();

    form.addEventListener('submit', onSubmit);
    form.appendChild(picker.element);
    document.body.appendChild(form);
    fireEvent.click(getByRole(picker.element, 'button', { name: 'Red text color' }));

    for (const button of getAllByRole(picker.element, 'button', { hidden: true })) {
      expect(button.getAttribute('type')).toBe('button');
      fireEvent.click(button);
    }

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
