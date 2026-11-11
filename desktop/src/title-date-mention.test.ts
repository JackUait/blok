import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTitleDateMention, titleDateLabel } from './title-date-mention';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('date mentions in page titles', () => {
  it('shows the same fixed date as yesterday on the next day', () => {
    expect(titleDateLabel('2026-11-11', new Date(2026, 10, 12, 9))).toMatch(/hier/i);
  });
  it('offers Today after @today and saves a fixed calendar date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 17));
    const title = document.createElement('h1');
    const chooseDate = vi.fn();
    document.body.append(title);
    const unbind = bindTitleDateMention(title, { getDate: () => undefined, chooseDate });

    title.textContent = '@today';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-today]')?.textContent).toContain('Aujourd’hui');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    title.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(chooseDate).toHaveBeenCalledWith('2026-11-11', titleDateLabel('2026-11-11'));
    expect(document.querySelector('[data-desktop-title-date-menu]')).toBeNull();
    unbind();
  });

  it('closes the picker when the title stops being a date query', () => {
    const title = document.createElement('h1');
    document.body.append(title);
    const unbind = bindTitleDateMention(title, { getDate: () => undefined, chooseDate: vi.fn() });
    title.textContent = '@';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-menu]')).not.toBeNull();
    title.textContent = 'Meeting notes';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-menu]')).toBeNull();
    unbind();
  });
});
