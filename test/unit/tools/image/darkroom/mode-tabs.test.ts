import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModeTabs } from '../../../../../src/tools/image/darkroom/mode-tabs';

const MODES = [
  { key: 'crop', label: 'Crop' },
  { key: 'adjust', label: 'Adjust' },
  { key: 'filters', label: 'Filters' },
];

const key = (el: HTMLElement, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

describe('createModeTabs', () => {
  let onSelect: ReturnType<typeof vi.fn<(key: string) => void>>;
  let panels: Record<string, HTMLElement>;
  let tabs: ReturnType<typeof createModeTabs>;

  const make = (selected = 'crop'): ReturnType<typeof createModeTabs> => {
    panels = {
      crop: document.createElement('div'),
      adjust: document.createElement('div'),
      filters: document.createElement('div'),
    };
    tabs = createModeTabs({ modes: MODES, panels, selected, label: 'Edit modes', onSelect });
    document.body.append(tabs.el, ...Object.values(panels));

    return tabs;
  };

  const tab = (k: string): HTMLElement => {
    const el = tabs.el.querySelector<HTMLElement>(`[data-mode="${k}"]`);

    if (el === null) throw new Error(`no tab ${k}`);

    return el;
  };

  const state = (): Array<[string, string | null, string | null, boolean]> =>
    MODES.map((m) => [m.key, tab(m.key).getAttribute('aria-selected'), tab(m.key).getAttribute('tabindex'), panels[m.key].hidden === true]);

  beforeEach(() => {
    vi.clearAllMocks();
    onSelect = vi.fn<(key: string) => void>();
  });

  afterEach(() => {
    tabs.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('is a labelled tablist of buttons wired to their panels', () => {
    make();

    expect(tabs.el.getAttribute('role')).toBe('tablist');
    expect(tabs.el.getAttribute('aria-label')).toBe('Edit modes');
    MODES.forEach((m) => {
      const t = tab(m.key);

      expect(t.tagName).toBe('BUTTON');
      expect(t.getAttribute('type')).toBe('button');
      expect(t.getAttribute('role')).toBe('tab');
      expect(t.textContent).toBe(m.label);
      expect(t.id).not.toBe('');
      expect(panels[m.key].getAttribute('role')).toBe('tabpanel');
      expect(panels[m.key].id).not.toBe('');
      expect(t.getAttribute('aria-controls')).toBe(panels[m.key].id);
      expect(panels[m.key].getAttribute('aria-labelledby')).toBe(t.id);
    });
  });

  it('only the selected tab is a tab stop and only its panel shows', () => {
    make('adjust');

    expect(state()).toEqual([
      ['crop', 'false', '-1', true],
      ['adjust', 'true', '0', false],
      ['filters', 'false', '-1', true],
    ]);
  });

  it('ids are unique across instances', () => {
    make();
    const first = tab('crop').id;
    const firstPanel = panels.crop.id;

    tabs.destroy();
    document.body.replaceChildren();
    make();
    expect(tab('crop').id).not.toBe(first);
    expect(panels.crop.id).not.toBe(firstPanel);
  });

  it('a click selects and reports the mode', () => {
    make();

    tab('filters').click();
    expect(onSelect).toHaveBeenCalledWith('filters');
    expect(state()[2]).toEqual(['filters', 'true', '0', false]);
    expect(panels.crop.hidden).toBe(true);
  });

  it('clicking the selected tab reports nothing', () => {
    make();

    tab('crop').click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Right and Left move focus and select, wrapping at the ends', () => {
    make();
    tab('crop').focus();

    key(tab('crop'), 'ArrowRight');
    expect(tab('adjust')).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith('adjust');
    key(tab('adjust'), 'ArrowLeft');
    key(tab('crop'), 'ArrowLeft');
    expect(tab('filters')).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith('filters');
    expect(panels.filters.hidden).toBe(false);
  });

  it('Home and End jump to the first and last tab', () => {
    make('adjust');

    key(tab('adjust'), 'End');
    expect(tab('filters')).toHaveFocus();
    expect(onSelect).toHaveBeenLastCalledWith('filters');
    key(tab('filters'), 'Home');
    expect(tab('crop')).toHaveFocus();
    expect(state()[0]).toEqual(['crop', 'true', '0', false]);
  });

  it('select() switches silently', () => {
    make();

    tabs.select('adjust');
    expect(onSelect).not.toHaveBeenCalled();
    expect(state()).toEqual([
      ['crop', 'false', '-1', true],
      ['adjust', 'true', '0', false],
      ['filters', 'false', '-1', true],
    ]);
  });

  it('marks the selected tab with data-active for the neutral selected style', () => {
    make();

    expect(tab('crop').getAttribute('data-active')).toBe('true');
    expect(tab('adjust').getAttribute('data-active')).toBe('false');
  });

  it('destroy() detaches keyboard and click handling', () => {
    make();

    tabs.destroy();
    key(tab('crop'), 'ArrowRight');
    tab('filters').click();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
