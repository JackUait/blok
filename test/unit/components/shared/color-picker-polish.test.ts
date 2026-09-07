import { fireEvent, getByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import type { I18n } from '../../../../types/api';

const translations: Record<string, string> = {
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
  'tools.colorPicker.colorSwatchLabel': '{color} {mode}',
  'tools.marker.default': 'Default',
  'tools.marker.textColor': 'Text color',
  'tools.marker.backgroundColor': 'Background color',
  'tools.colorPicker.color.red': 'Red',
};

const i18n: I18n = {
  t: (key: string) => translations[key] ?? key,
  has: () => false,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
};

describe('color picker polish', () => {
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

  it.each([
    { section: 'text', label: 'Default text color', mode: 'color', color: null },
    { section: 'background', label: 'Default background color', mode: 'background-color', color: null },
    { section: 'text', label: 'Red text color', mode: 'color', color: '#d44c47' },
    { section: 'background', label: 'Red background color', mode: 'background-color', color: '#fdebec' },
    { section: 'recent', label: 'Red text color', mode: 'color', color: '#d44c47' },
    { section: 'recent', label: 'Red background color', mode: 'background-color', color: '#fdebec' },
  ])('selects $label from $section without submitting a host form', ({ section, label, mode, color }) => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([
      { name: 'red', field: 'text' },
      { name: 'red', field: 'bg' },
    ]));
    const onColorSelect = vi.fn();
    const picker = createColorPicker({
      i18n,
      testIdPrefix: 'polish',
      modes: [
        { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
        { key: 'background-color', labelKey: 'tools.marker.backgroundColor', presetField: 'bg' },
      ],
      onColorSelect,
    });
    const form = document.createElement('form');
    const onSubmit = vi.fn((event: Event) => event.preventDefault());

    form.addEventListener('submit', onSubmit);
    form.appendChild(picker.element);
    document.body.appendChild(form);

    if (section === 'background') {
      fireEvent.click(getByRole(picker.element, 'tab', { name: 'Background color' }));
    }

    const sectionKey = section === 'recent' ? 'recent' : mode;
    const sectionElement = queryByAttribute('data-blok-testid', picker.element, `polish-section-${sectionKey}`);

    if (!(sectionElement instanceof HTMLElement)) {
      throw new Error('Missing picker section');
    }

    const swatch = getByRole(sectionElement, 'button', { name: label });

    swatch.click();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onColorSelect).toHaveBeenCalledExactlyOnceWith(color, mode);
  });

  it('keeps selection state scoped to its mode across updates and reset', () => {
    const picker = createColorPicker({
      i18n,
      testIdPrefix: 'polish',
      modes: [
        { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
        { key: 'background-color', labelKey: 'tools.marker.backgroundColor', presetField: 'bg' },
      ],
      onColorSelect: vi.fn(),
    });
    const red = COLOR_PRESETS.find((preset) => preset.name === 'red');

    if (red === undefined) {
      throw new Error('Missing red preset');
    }

    document.body.appendChild(picker.element);
    picker.setActiveColor(red.bg, 'background-color');

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Background color' }));

    expect(getByRole(picker.element, 'button', { name: 'Red background color', pressed: true })).toBeTruthy();
    expect(getByRole(picker.element, 'button', { name: 'Default background color', pressed: false })).toBeTruthy();

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Text color' }));

    expect(getByRole(picker.element, 'button', { name: 'Default text color', pressed: true })).toBeTruthy();

    picker.reset();

    expect(getByRole(picker.element, 'button', { name: 'Default text color', pressed: true })).toBeTruthy();

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Background color' }));

    expect(getByRole(picker.element, 'button', { name: 'Red background color', pressed: false })).toBeTruthy();
    expect(getByRole(picker.element, 'button', { name: 'Default background color', pressed: true })).toBeTruthy();
  });
});
