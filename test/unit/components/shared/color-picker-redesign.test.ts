import { fireEvent, getAllByRole, getByRole, queryByAttribute, queryByRole } from '@testing-library/dom';
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

describe('color picker segmented modes', () => {
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

  it('shows only the selected mode and switches without applying or persisting a color', () => {
    const onColorSelect = vi.fn();
    const { element } = mountPicker({ onColorSelect });
    const textTab = getByRole(element, 'tab', { name: 'Text color', selected: true });
    const backgroundTab = getByRole(element, 'tab', { name: 'Background', selected: false });
    const textPanel = getByRole(element, 'tabpanel', { name: 'Text color' });

    expect(getAllByRole(element, 'tabpanel')).toHaveLength(1);
    expect(textTab.getAttribute('aria-controls')).toBe(textPanel.id);
    expect(textPanel.getAttribute('aria-labelledby')).toBe(textTab.id);
    expect(textTab.tabIndex).toBe(0);
    expect(backgroundTab.tabIndex).toBe(-1);

    backgroundTab.click();

    const backgroundPanel = getByRole(element, 'tabpanel', { name: 'Background' });

    expect(textPanel.hidden).toBe(true);
    expect(queryByRole(element, 'tabpanel', { name: 'Text color' })).toBeNull();
    expect(getAllByRole(element, 'tabpanel')).toHaveLength(1);
    expect(backgroundTab.getAttribute('aria-controls')).toBe(backgroundPanel.id);
    expect(backgroundPanel.getAttribute('aria-labelledby')).toBe(backgroundTab.id);
    expect(backgroundTab.getAttribute('aria-selected')).toBe('true');
    expect(textTab.getAttribute('aria-selected')).toBe('false');
    expect(textTab.tabIndex).toBe(-1);
    expect(backgroundTab.tabIndex).toBe(0);
    expect(onColorSelect).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    { start: 'Text color', key: 'ArrowRight', target: 'Background' },
    { start: 'Text color', key: 'ArrowLeft', target: 'Background' },
    { start: 'Background', key: 'ArrowRight', target: 'Text color' },
    { start: 'Background', key: 'ArrowLeft', target: 'Text color' },
    { start: 'Background', key: 'Home', target: 'Text color' },
    { start: 'Text color', key: 'End', target: 'Background' },
  ])('$key from $start activates and focuses $target without reaching parent navigation', ({ start, key, target }) => {
    const { element, setActiveColor, reset } = mountPicker();
    const startTab = getByRole(element, 'tab', { name: start });

    startTab.click();
    startTab.focus();

    const parentKeyDown = vi.fn();

    element.addEventListener('keydown', parentKeyDown, { once: true });

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

    startTab.dispatchEvent(event);

    const targetTab = getByRole(element, 'tab', { name: target, selected: true });

    expect(targetTab).toHaveFocus();
    expect(getAllByRole(element, 'tabpanel')).toHaveLength(1);
    expect(getByRole(element, 'tabpanel', { name: target })).toBeTruthy();
    expect(event.defaultPrevented).toBe(true);
    expect(parentKeyDown).not.toHaveBeenCalled();

    setActiveColor('#d44c47', 'color');
    reset();

    expect(targetTab).toHaveFocus();
    expect(getByRole(element, 'tab', { name: target, selected: true })).toBe(targetTab);
    element.removeEventListener('keydown', parentKeyDown);
  });

  it('does not move editor focus or selection when a mode is clicked', () => {
    const editor = document.createElement('div');

    editor.contentEditable = 'true';
    editor.tabIndex = 0;
    editor.textContent = 'Selected text';
    document.body.appendChild(editor);
    editor.focus();

    const range = document.createRange();
    const selection = window.getSelection();

    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const { element } = mountPicker();
    const backgroundTab = getByRole(element, 'tab', { name: 'Background' });

    expect(fireEvent.mouseDown(backgroundTab)).toBe(false);
    backgroundTab.click();

    expect(editor).toHaveFocus();
    expect(selection?.toString()).toBe('Selected text');
    expect(getByRole(element, 'tab', { name: 'Background', selected: true })).toBe(backgroundTab);
  });

  it('moves existing picker focus to a pointer-selected tab without applying a color', () => {
    const onColorSelect = vi.fn();
    const { element } = mountPicker({ onColorSelect });
    const textTab = getByRole(element, 'tab', { name: 'Text color' });
    const backgroundTab = getByRole(element, 'tab', { name: 'Background' });

    textTab.focus();
    fireEvent.mouseDown(backgroundTab);
    fireEvent.click(backgroundTab);

    expect(backgroundTab).toHaveFocus();
    expect(backgroundTab).toHaveAttribute('aria-selected', 'true');
    expect(onColorSelect).not.toHaveBeenCalled();
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

  it('keeps both previews independent and clears only the active mode with its explicit reset', () => {
    const onColorSelect = vi.fn((color: string | null, mode: string) => picker.setActiveColor(color, mode));
    const picker = mountPicker({
      onColorSelect,
      initialActiveColors: { color: 'rgb(212, 76, 71)', 'background-color': '#e7f3f8' },
    });
    const textPanel = getByRole(picker.element, 'tabpanel', { name: 'Text color' });

    expect(getByRole(textPanel, 'status').textContent).toBe('Red');

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Background' }));

    const backgroundPanel = getByRole(picker.element, 'tabpanel', { name: 'Background' });
    const reset = getByRole(backgroundPanel, 'button', { name: 'Default' });

    expect(getByRole(backgroundPanel, 'status').textContent).toBe('Blue');

    picker.setActiveColor('#d44c47', 'color');

    expect(getByRole(backgroundPanel, 'status').textContent).toBe('Blue');
    reset.focus();
    reset.click();

    expect(onColorSelect).toHaveBeenCalledExactlyOnceWith(null, 'background-color');
    expect(reset).toHaveFocus();
    expect(getByRole(backgroundPanel, 'status').textContent).toBe('Default');
    expect(getByRole(backgroundPanel, 'button', { name: 'Default background', pressed: true })).toBeTruthy();

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Text color' }));

    expect(getByRole(textPanel, 'status').textContent).toBe('Red');
    expect(getByRole(textPanel, 'button', { name: 'Red text color', pressed: true })).toBeTruthy();

    picker.setActiveColor('#123456', 'color');

    expect(getByRole(textPanel, 'status').textContent).toBe('#123456');

    picker.reset();

    expect(getByRole(textPanel, 'status').textContent).toBe('Default');
  });

  it('renders the applied preview in the active theme and updates it through the public handle', () => {
    document.documentElement.setAttribute('data-blok-theme', 'dark');
    const picker = mountPicker({ initialActiveColors: { color: '#dd5e5a', 'background-color': '#123a54' } });
    const preview = queryByAttribute('data-blok-testid', picker.element, 'redesign-preview-color');

    expect(preview?.style.color).toBe('rgb(221, 94, 90)');
    expect(preview?.getAttribute('aria-hidden')).toBe('true');

    picker.setActiveColor(null, 'color');

    expect(preview?.style.color).toBe('var(--blok-text-primary)');

    fireEvent.click(getByRole(picker.element, 'tab', { name: 'Background' }));

    const backgroundPreview = queryByAttribute('data-blok-testid', picker.element, 'redesign-preview-background-color');

    expect(backgroundPreview?.style.backgroundColor).toBe('rgb(18, 58, 84)');
  });

  it('reuses recent colors across modes while keeping the selected recent control focused', () => {
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
    expect(getByRole(picker.element, 'tab', { name: 'Background', selected: true })).toBeTruthy();
    expect(getByRole(getByRole(picker.element, 'tabpanel', { name: 'Background' }), 'status').textContent).toBe('Blue');
  });

  it('keeps tab state and panel relationships local when pickers share a test prefix', () => {
    const first = mountPicker();
    const second = mountPicker();
    const firstBackground = getByRole(first.element, 'tab', { name: 'Background' });

    firstBackground.click();

    expect(getByRole(second.element, 'tab', { name: 'Text color', selected: true })).toBeTruthy();
    expect(firstBackground.getAttribute('aria-controls')).not.toBe(
      getByRole(second.element, 'tab', { name: 'Background' }).getAttribute('aria-controls')
    );
  });

  it('never submits a containing form from tabs, reset, swatches, or recents', () => {
    const form = document.createElement('form');
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const picker = mountPicker();

    form.addEventListener('submit', onSubmit);
    form.appendChild(picker.element);
    document.body.appendChild(form);
    fireEvent.click(getByRole(picker.element, 'button', { name: 'Red text color' }));

    const buttons = [
      ...getAllByRole(picker.element, 'tab'),
      ...getAllByRole(picker.element, 'button', { hidden: true }),
    ];

    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
      fireEvent.click(button);
    }

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
