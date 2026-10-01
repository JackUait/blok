import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageFilterPreset } from '../../../../../types/tools/image';
import type { I18nInstance } from '../../../../../src/components/utils/tools';
import { cssFilter, FILTER_PRESETS, resolveFilters, type FilterSet } from '../../../../../src/tools/image/adjust';
import { createFilterStrip } from '../../../../../src/tools/image/darkroom/filter-strip';

const pascal = (p: string): string => p.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const NAMES: Record<ImageFilterPreset, string> = Object.fromEntries(
  FILTER_PRESETS.map((p) => [p, p === 'none' ? 'Original' : pascal(p)])
) as Record<ImageFilterPreset, string>;

const LABELS: Record<string, string> = {
  'tools.image.filterPresets': 'Filters',
  'tools.image.filterGroups': 'Filter groups',
  'tools.image.filterGroupVivid': 'Vivid',
  'tools.image.filterGroupDramatic': 'Dramatic',
  'tools.image.filterGroupTone': 'Warm & Cool',
  'tools.image.filterGroupSoft': 'Soft',
  'tools.image.filterGroupVintage': 'Vintage',
  'tools.image.filterGroupBlackWhite': 'B&W',
  'tools.image.filterGroupCustom': 'Custom',
  'tools.image.filterStrength': 'Strength',
  ...Object.fromEntries(FILTER_PRESETS.map((p) => [`tools.image.filter${pascal(p)}`, NAMES[p]])),
};

const i18n: I18nInstance = {
  has: (k) => k in LABELS,
  t: (k) => LABELS[k] ?? k,
};

const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

describe('createFilterStrip', () => {
  let onSelect: ReturnType<typeof vi.fn<(p: string) => void>>;
  let onStrengthInput: ReturnType<typeof vi.fn<(s: number) => void>>;
  let onStrengthCommit: ReturnType<typeof vi.fn<(s: number) => void>>;
  let strip: ReturnType<typeof createFilterStrip>;

  const make = (value = 'none', more: { filters?: FilterSet; strength?: number } = {}): ReturnType<typeof createFilterStrip> => {
    strip = createFilterStrip({
      i18n,
      url: 'https://example.com/photo.jpg',
      value,
      strength: more.strength ?? 100,
      filters: more.filters,
      onSelect,
      onStrengthInput,
      onStrengthCommit,
    });
    document.body.appendChild(strip.el);

    return strip;
  };

  const group = (): HTMLElement => {
    const el = strip.el.querySelector<HTMLElement>('[role="radiogroup"]');

    if (el === null) throw new Error('no radiogroup');

    return el;
  };

  const slider = (): HTMLElement => {
    const el = strip.el.querySelector<HTMLElement>('[role="slider"]');

    if (el === null) throw new Error('no slider');

    return el;
  };

  const visible = (): string[] => [...group().querySelectorAll<HTMLElement>('[role="radio"]')]
    .filter((c) => !c.hidden)
    .map((c) => c.getAttribute('data-preset') ?? '');

  const familyTabs = (): HTMLElement[] => [...strip.el.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];

  const family = (key: string): HTMLElement => {
    const el = strip.el.querySelector<HTMLElement>(`[role="tab"][data-mode="${key}"]`);

    if (el === null) throw new Error(`no family ${key}`);

    return el;
  };

  const chip = (p: string): HTMLElement => {
    const el = strip.el.querySelector<HTMLElement>(`[data-preset="${p}"]`);

    if (el === null) throw new Error(`no chip ${p}`);

    return el;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onSelect = vi.fn<(p: string) => void>();
    onStrengthInput = vi.fn<(s: number) => void>();
    onStrengthCommit = vi.fn<(s: number) => void>();
  });

  afterEach(() => {
    strip.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('is a labelled radiogroup with one named chip per preset, in order', () => {
    make();

    expect(group().getAttribute('aria-label')).toBe('Filters');
    const radios = [...group().querySelectorAll<HTMLElement>('[role="radio"]')];

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
    // Arrows stay inside the open family: Original wraps to its last look.
    expect(onSelect).toHaveBeenLastCalledWith('lomo');
    key(chip('lomo'), 'Home');
    expect(onSelect).toHaveBeenLastCalledWith('none');
  });

  it('set() selects silently', () => {
    make();

    strip.set('dramatic', 100);
    expect(onSelect).not.toHaveBeenCalled();
    expect(chip('dramatic').getAttribute('aria-checked')).toBe('true');
    expect(chip('dramatic').getAttribute('tabindex')).toBe('0');
  });

  it('names each chip once, with kebab names read as words', () => {
    make();

    expect(chip('vivid-warm').textContent).toBe('VividWarm');
    expect(chip('high-key').textContent).toBe('HighKey');
  });

  it('offers only the configured filters, in the configured order, Original first', () => {
    make('none', { filters: resolveFilters(['noir', 'vivid']) });

    expect([...group().querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('data-preset')))
      .toEqual(['none', 'noir', 'vivid']);
  });

  it('shows a host filter with its title and its look', () => {
    make('none', { filters: resolveFilters([{ name: 'brand', title: 'Brand', css: 'sepia(0.5)' }]) });

    expect(chip('brand').textContent).toBe('Brand');
    expect(chip('brand').querySelector('img')?.style.filter).toBe('sepia(0.5)');
  });

  it('still shows the current look when the host list leaves it out', () => {
    make('sepia', { filters: resolveFilters(['vivid']) });

    expect(chip('sepia').getAttribute('aria-checked')).toBe('true');
    expect(chip('sepia').textContent).toBe('Sepia');
  });

  it('shows an unknown current look under its saved name, unfiltered', () => {
    make('other-host', { filters: resolveFilters(['vivid']) });

    expect(chip('other-host').getAttribute('aria-checked')).toBe('true');
    expect(chip('other-host').textContent).toBe('other-host');
    expect(chip('other-host').querySelector('img')?.style.filter).toBe('');
  });

  it('hides the strength slider for Original and shows it for a look', () => {
    make();

    expect(slider().closest('[hidden]')).not.toBeNull();
    chip('noir').click();
    expect(slider().closest('[hidden]')).toBeNull();
    expect(slider().getAttribute('aria-label')).toBe('Strength');
    expect(slider().getAttribute('aria-valuemin')).toBe('0');
    expect(slider().getAttribute('aria-valuemax')).toBe('100');
  });

  it('starts the slider at the saved strength', () => {
    make('noir', { strength: 40 });

    expect(slider().getAttribute('aria-valuenow')).toBe('40');
  });

  it('a new look starts at full strength', () => {
    make('noir', { strength: 40 });

    chip('vivid').click();
    expect(slider().getAttribute('aria-valuenow')).toBe('100');
  });

  it('reports strength while it moves and when it settles', () => {
    vi.useFakeTimers();
    make('noir');

    key(slider(), 'ArrowLeft');
    expect(onStrengthInput).toHaveBeenLastCalledWith(99);
    strip.flush();
    expect(onStrengthCommit).toHaveBeenLastCalledWith(99);
    vi.useRealTimers();
  });

  it('a double-click on the slider brings the look back to full strength', () => {
    make('noir', { strength: 40 });

    slider().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onStrengthCommit).toHaveBeenLastCalledWith(100);
  });

  it('set() moves the slider silently', () => {
    make('noir');

    strip.set('noir', 30);
    expect(slider().getAttribute('aria-valuenow')).toBe('30');
    strip.set('none', 100);
    expect(slider().closest('[hidden]')).not.toBeNull();
    expect(onStrengthInput).not.toHaveBeenCalled();
    expect(onStrengthCommit).not.toHaveBeenCalled();
  });

  it('reveal() scrolls the strip so the selected chip sits in the middle', () => {
    make('retro');
    vi.spyOn(group(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 80));
    vi.spyOn(chip('retro'), 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 0, 60, 80));
    group().scrollLeft = 100;

    strip.reveal();
    // Chip centre 930, strip centre 200: scroll 730 further right.
    expect(group().scrollLeft).toBe(830);
  });

  describe('families', () => {
    it('a labelled tab row names the six built-in families', () => {
      make();

      expect(strip.el.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Filter groups');
      expect(familyTabs().map((t) => t.textContent)).toEqual(['Vivid', 'Dramatic', 'Warm & Cool', 'Soft', 'Vintage', 'B&W']);
      familyTabs().forEach((t) => expect(t.getAttribute('aria-controls')).toBe(group().id));
    });

    it('shows Original and the open family only', () => {
      make();

      expect(family('vivid').getAttribute('aria-selected')).toBe('true');
      expect(visible()).toEqual(['none', 'vivid', 'vivid-warm', 'vivid-cool', 'chrome', 'lomo']);
    });

    it('opens on the family of the current look', () => {
      make('retro');

      expect(family('vintage').getAttribute('aria-selected')).toBe('true');
      expect(visible()).toEqual(['none', 'film', 'vintage', 'retro', 'sepia']);
    });

    it('switching family shows its looks and keeps the current one', () => {
      make('retro');

      family('bw').click();
      expect(visible()).toEqual(['none', 'mono', 'silvertone', 'noir', 'high-key']);
      expect(onSelect).not.toHaveBeenCalled();
      expect(chip('retro').getAttribute('aria-checked')).toBe('true');
    });

    it('a hidden chip is never a tab stop; Original is when the current look is elsewhere', () => {
      make('retro');

      family('bw').click();
      expect(chip('retro').getAttribute('tabindex')).toBe('-1');
      expect(chip('none').getAttribute('tabindex')).toBe('0');
    });

    it('set() opens the family of the look it selects', () => {
      make();

      strip.set('noir', 100);
      expect(family('bw').getAttribute('aria-selected')).toBe('true');
      expect(visible()).toContain('noir');
    });

    it('puts host filters under Custom', () => {
      make('none', { filters: resolveFilters([...FILTER_PRESETS, { name: 'brand', title: 'Brand', css: 'sepia(1)' }]) });

      family('custom').click();
      expect(family('custom').textContent).toBe('Custom');
      expect(visible()).toEqual(['none', 'brand']);
    });

    it('a short list shows every look in one row, without family tabs', () => {
      make('none', { filters: resolveFilters(['vivid', 'noir', 'sepia', 'fade']) });

      expect(strip.el.querySelector('[role="tablist"]')).toBeNull();
      expect(visible()).toEqual(['none', 'vivid', 'noir', 'sepia', 'fade']);
    });

    it('reveal() also scrolls the family row to the open family', () => {
      make('noir');
      const row = strip.el.querySelector<HTMLElement>('[role="tablist"]');

      if (row === null) throw new Error('no family row');
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 30));
      vi.spyOn(family('bw'), 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 0, 40, 30));

      strip.reveal();
      // Tab centre 520, row centre 150.
      expect(row.scrollLeft).toBe(370);
    });

    it('a divider sets Original apart, hidden from screen readers', () => {
      make();
      const divider = group().querySelector('[data-role="filter-divider"]');

      expect(divider?.previousElementSibling).toBe(chip('none'));
      expect(divider?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('destroy() detaches click and keyboard handling', () => {
    make();

    strip.destroy();
    chip('mono').click();
    key(chip('none'), 'ArrowRight');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
