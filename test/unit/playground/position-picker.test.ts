import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPositionPicker } from '../../../src/playground/position-picker';

// Option order differs from the grid on purpose: the picker must map by value.
const OPTIONS = [
  ['bottom-left', 'Bottom left'],
  ['bottom-right', 'Bottom right'],
  ['bottom-center', 'Bottom center'],
  ['top-left', 'Top left'],
  ['top-right', 'Top right'],
  ['top-center', 'Top center'],
];

const build = (value = 'bottom-center'): { select: HTMLSelectElement; host: HTMLElement } => {
  const select = document.createElement('select');

  OPTIONS.forEach(([optionValue, text]) => select.add(new Option(text, optionValue)));
  select.value = value;

  const host = document.createElement('div');

  document.body.append(select, host);
  mountPositionPicker(select, host);

  return { select, host };
};

const radio = (host: HTMLElement, position: string): HTMLElement => {
  const element = host.querySelector<HTMLElement>(`[role="radio"][data-position="${position}"]`);

  if (!element) {
    throw new Error(`no radio for ${position}`);
  }

  return element;
};

const checked = (host: HTMLElement): string | undefined =>
  host.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.dataset.position;

describe('mountPositionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('draws one named radio per option and checks the current value', () => {
    const { host } = build('top-right');

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Notification position');
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(6);
    expect(radio(host, 'top-left').getAttribute('aria-label')).toBe('Top left');
    expect(checked(host)).toBe('top-right');
    expect(radio(host, 'top-right').tabIndex).toBe(0);
    expect(radio(host, 'top-left').tabIndex).toBe(-1);
  });

  it('writes a click through the select so its change handler runs', () => {
    const { select, host } = build();
    const onChange = vi.fn();

    select.addEventListener('change', onChange);
    radio(host, 'top-left').click();

    expect(select.value).toBe('top-left');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checked(host)).toBe('top-left');
  });

  it('does not rebuild the editor when the checked spot is clicked again', () => {
    const { select, host } = build('bottom-center');
    const onChange = vi.fn();

    select.addEventListener('change', onChange);
    radio(host, 'bottom-center').click();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows the select when something else changes it', () => {
    const { select, host } = build();

    select.value = 'bottom-left';
    select.dispatchEvent(new Event('change'));

    expect(checked(host)).toBe('bottom-left');
  });

  it.each([
    ['bottom-center', 'ArrowRight', 'bottom-right'],
    ['bottom-center', 'ArrowLeft', 'bottom-left'],
    ['bottom-center', 'ArrowUp', 'top-center'],
    ['top-right', 'ArrowDown', 'bottom-right'],
    ['bottom-right', 'ArrowRight', 'bottom-right'],
    ['top-left', 'ArrowUp', 'top-left'],
  ])('moves from %s on %s to %s', (from, key, to) => {
    const { select, host } = build(from);

    radio(host, from).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    expect(select.value).toBe(to);
    expect(radio(host, to)).toHaveFocus();
  });
});
