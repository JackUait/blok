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
    const setDate = vi.fn();
    document.body.append(title);
    const unbind = bindTitleDateMention(title, {
      getDate: () => undefined, getDisplay: () => ({}), setDate, setDisplay: vi.fn(), i18n: { t: (key) => key },
    });

    title.textContent = '@today';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-today]')?.textContent).toContain('Aujourd’hui');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    title.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(setDate).toHaveBeenCalledWith('2026-11-11');
    expect(document.querySelector('[data-desktop-title-date-menu]')).toBeNull();
    unbind.destroy();
  });

  it('closes the picker when the title stops being a date query', () => {
    const title = document.createElement('h1');
    document.body.append(title);
    const unbind = bindTitleDateMention(title, {
      getDate: () => undefined, getDisplay: () => ({}), setDate: vi.fn(), setDisplay: vi.fn(), i18n: { t: (key) => key },
    });
    title.textContent = '@';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-menu]')).not.toBeNull();
    title.textContent = 'Meeting notes';
    title.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-desktop-title-date-menu]')).toBeNull();
    unbind.destroy();
  });

  it('renders a date as one non-editable token inside the title', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 17));
    const title = document.createElement('h1');
    title.textContent = '@Aujourd’hui';
    document.body.append(title);
    const unbind = bindTitleDateMention(title, {
      getDate: () => '2026-11-11', getDisplay: () => ({}), setDate: vi.fn(), setDisplay: vi.fn(), i18n: { t: (key) => key },
    });
    const token = title.querySelector('[data-desktop-title-date-token]');
    expect(token?.getAttribute('contenteditable')).toBe('false');
    expect(token?.textContent).toBe('@Aujourd’hui');
    expect(title.textContent).toBe('@Aujourd’hui');
    unbind.destroy();
  });

  it('keeps editable text after the atomic date token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 17));
    const title = document.createElement('h1');
    title.textContent = '@Aujourd’hui notes';
    document.body.append(title);
    const binding = bindTitleDateMention(title, {
      getDate: () => '2026-11-11', getDisplay: () => ({}), setDate: vi.fn(), setDisplay: vi.fn(), i18n: { t: (key) => key },
    });
    expect(title.firstChild).toHaveProperty('nodeName', 'SPAN');
    expect(title.firstChild?.textContent).toBe('@Aujourd’hui');
    expect(title.lastChild).toBeInstanceOf(Text);
    expect(title.lastChild?.textContent).toBe(' notes');
    binding.destroy();
  });

  it('restores the date token when the relative label changes overnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 17));
    const title = document.createElement('h1');
    title.textContent = '@Aujourd’hui';
    document.body.append(title);
    const binding = bindTitleDateMention(title, {
      getDate: () => '2026-11-11', getDisplay: () => ({}), setDate: vi.fn(), setDisplay: vi.fn(), i18n: { t: (key) => key },
    });
    vi.setSystemTime(new Date(2026, 10, 12, 0, 1));
    title.textContent = '@Hier';
    binding.refresh();
    expect(title.querySelector('[data-desktop-title-date-token]')?.textContent).toBe('@Hier');
    binding.destroy();
  });
});
