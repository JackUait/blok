import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageFilterPreset } from '../../../../../types/tools/image';
import type { I18nInstance } from '../../../../../src/components/utils/tools';
import { cssFilter, FILTER_PRESETS } from '../../../../../src/tools/image/adjust';
import { createFilterStrip } from '../../../../../src/tools/image/darkroom/filter-strip';

const NAMES: Record<ImageFilterPreset, string> = {
  none: 'Original',
  vivid: 'Vivid',
  dramatic: 'Dramatic',
  warm: 'Warm',
  mono: 'Mono',
  noir: 'Noir',
  fade: 'Fade',
  sepia: 'Sepia',
};

const LABELS: Record<string, string> = {
  'tools.image.filterPresets': 'Filters',
  ...Object.fromEntries(FILTER_PRESETS.map((p) => [`tools.image.filter${p[0].toUpperCase()}${p.slice(1)}`, NAMES[p]])),
};

const i18n: I18nInstance = {
  has: (k) => k in LABELS,
  t: (k) => LABELS[k] ?? k,
};

const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

describe('createFilterStrip', () => {
  let onSelect: ReturnType<typeof vi.fn<(p: ImageFilterPreset) => void>>;
  let strip: ReturnType<typeof createFilterStrip>;

  const make = (value: ImageFilterPreset = 'none'): ReturnType<typeof createFilterStrip> => {
    strip = createFilterStrip({ i18n, url: 'https://example.com/photo.jpg', value, onSelect });
    document.body.appendChild(strip.el);

    return strip;
  };

  const chip = (p: ImageFilterPreset): HTMLElement => {
    const el = strip.el.querySelector<HTMLElement>(`[data-preset="${p}"]`);

    if (el === null) throw new Error(`no chip ${p}`);

    return el;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onSelect = vi.fn<(p: ImageFilterPreset) => void>();
  });

  afterEach(() => {
    strip.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('is a labelled radiogroup with one named chip per preset, in order', () => {
    make();

    expect(strip.el.getAttribute('role')).toBe('radiogroup');
    expect(strip.el.getAttribute('aria-label')).toBe('Filters');
    const radios = [...strip.el.querySelectorAll<HTMLElement>('[role="radio"]')];

    expect(radios.map((r) => r.getAttribute('data-preset'))).toEqual([...FILTER_PRESETS]);
    expect(radios.map((r) => r.textContent)).toEqual(FILTER_PRESETS.map((p) => NAMES[p]));
    radios.forEach((r) => expect(r.getAttribute('type')).toBe('button'));
  });

  it('each thumbnail is the photo with that preset applied, decorative to screen readers', () => {
    make();

    FILTER_PRESETS.forEach((p) => {
      const img = chip(p).querySelector('img');

      expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg');
      expect(img?.getAttribute('alt')).toBe('');
      expect(img?.getAttribute('draggable')).toBe('false');
      expect(img?.style.filter).toBe(cssFilter(p, {}));
    });
    expect(chip('mono').querySelector('img')?.style.filter).toBe('grayscale(1)');
  });

  it('marks only the current preset as checked and as the tab stop', () => {
    make('warm');

    FILTER_PRESETS.forEach((p) => {
      const on = p === 'warm';

      expect(chip(p).getAttribute('aria-checked')).toBe(String(on));
      expect(chip(p).getAttribute('data-active')).toBe(String(on));
      expect(chip(p).getAttribute('tabindex')).toBe(on ? '0' : '-1');
    });
  });

  it('a click selects and reports the preset', () => {
    make();

    chip('noir').click();
    expect(onSelect).toHaveBeenCalledWith('noir');
    expect(chip('noir').getAttribute('aria-checked')).toBe('true');
    expect(chip('none').getAttribute('aria-checked')).toBe('false');
  });

  it('clicking the current preset reports nothing', () => {
    make('fade');

    chip('fade').click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('arrow keys move and select, wrapping at the ends', () => {
    make();
    chip('none').focus();

    key(chip('none'), 'ArrowRight');
    expect(chip('vivid')).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith('vivid');
    key(chip('vivid'), 'ArrowLeft');
    key(chip('none'), 'ArrowLeft');
    expect(onSelect).toHaveBeenLastCalledWith('sepia');
    key(chip('sepia'), 'Home');
    expect(onSelect).toHaveBeenLastCalledWith('none');
  });

  it('set() selects silently', () => {
    make();

    strip.set('dramatic');
    expect(onSelect).not.toHaveBeenCalled();
    expect(chip('dramatic').getAttribute('aria-checked')).toBe('true');
    expect(chip('dramatic').getAttribute('tabindex')).toBe('0');
  });

  it('destroy() detaches click and keyboard handling', () => {
    make();

    strip.destroy();
    chip('mono').click();
    key(chip('none'), 'ArrowRight');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
