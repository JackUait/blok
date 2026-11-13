import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpeedEntry, parseRate } from '../../../../src/tools/video/speed-entry';

describe('parseRate', () => {
  it('reads a plain number, a comma decimal and a trailing x', () => {
    expect(parseRate('1.5')).toBe(1.5);
    expect(parseRate(' 2,7 ')).toBe(2.7);
    expect(parseRate('1.25x')).toBe(1.25);
    expect(parseRate('3×')).toBe(3);
    expect(parseRate('.5')).toBe(0.5);
  });

  it('keeps a typed speed between 0.1x and 3x', () => {
    expect(parseRate('5')).toBe(3);
    expect(parseRate('0')).toBe(0.1);
    expect(parseRate('0.05')).toBe(0.1);
    expect(parseRate('1.333')).toBe(1.33);
  });

  it('gives null for text that is not a speed', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate('fast')).toBeNull();
    expect(parseRate('1.2.3')).toBeNull();
    expect(parseRate('-1')).toBeNull();
  });
});

describe('createSpeedEntry', () => {
  const setup = (rate = 1) => {
    const row = document.createElement('div');
    const readout = document.createElement('div');

    readout.className = 'p__speed-readout';
    readout.setAttribute('aria-hidden', 'true');
    readout.innerHTML = '<span class="p__speed-readout-digits">1</span><span class="p__speed-readout-unit">×</span>';
    row.append(readout);
    document.body.append(row);

    const state = { rate };
    const onRate = vi.fn((next: number) => { state.rate = next; });
    const entry = createSpeedEntry({ readout, classPrefix: 'p', label: 'Playback speed', rate: () => state.rate, onRate });
    const field = (): HTMLInputElement | null => row.querySelector('input');
    const key = (target: Element, name: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

      target.dispatchEvent(event);

      return event;
    };

    return { row, readout, entry, onRate, field, key, state };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('opens a field holding the current speed when the number is clicked', () => {
    const ui = setup(1.5);

    ui.readout.click();

    const input = ui.field();

    expect(input).not.toBeNull();
    expect(input?.value).toBe('1.5');
    expect(input).toHaveFocus();
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(3);
    expect(ui.readout.isConnected).toBe(false);
  });

  it('is a keyboard button with a name', () => {
    const ui = setup();

    expect(ui.readout.getAttribute('role')).toBe('button');
    expect(ui.readout.tabIndex).toBe(0);
    expect(ui.readout.getAttribute('aria-label')).toBe('Playback speed');
    expect(ui.readout.hasAttribute('aria-hidden')).toBe(false);

    ui.key(ui.readout, 'Enter');
    expect(ui.field()).not.toBeNull();
  });

  it('opens from Space too, without scrolling the page', () => {
    const ui = setup();
    const event = ui.key(ui.readout, ' ');

    expect(event.defaultPrevented).toBe(true);
    expect(ui.field()).not.toBeNull();
  });

  it('keeps the field\'s keys away from the editor', () => {
    const ui = setup();

    ui.readout.click();
    expect(ui.field()?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(ui.readout.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(ui.field()?.inputMode).toBe('decimal');
    expect(ui.field()?.getAttribute('aria-label')).toBe('Playback speed');
  });

  it('keeps typed keys inside the field, away from the player\'s own shortcuts', () => {
    const ui = setup();
    const player = vi.fn();

    ui.row.addEventListener('keydown', player);
    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');

    const digit = ui.key(input, '2');

    ui.key(input, 'k');
    ui.key(input, 'ArrowLeft');

    expect(player).not.toHaveBeenCalled();
    expect(digit.defaultPrevented).toBe(false);
  });

  it('sets the typed speed on Enter and gives focus back to the number', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.7';
    ui.key(input, 'Enter');

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(2.7);
    expect(ui.field()).toBeNull();
    expect(ui.readout.isConnected).toBe(true);
    expect(ui.readout).toHaveFocus();
  });

  it('keeps the speed as it was on Escape, and stops Escape there', () => {
    const ui = setup();
    const outer = vi.fn();

    ui.row.addEventListener('keydown', outer);
    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.7';
    ui.key(input, 'Escape');

    expect(ui.onRate).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(ui.field()).toBeNull();
    expect(ui.readout).toHaveFocus();
  });

  it('sets the typed speed when the field loses focus', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '0.1';
    input.blur();

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(ui.field()).toBeNull();
  });

  it('keeps the speed as it was when the text is not a speed', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = 'fast';
    ui.key(input, 'Enter');

    expect(ui.onRate).not.toHaveBeenCalled();
    expect(ui.field()).toBeNull();
  });

  it('commit() sets an open field\'s speed once, and does nothing when none is open', () => {
    const ui = setup();

    ui.entry.commit();
    expect(ui.onRate).not.toHaveBeenCalled();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '2.5';
    ui.entry.commit();
    input.blur();
    ui.entry.commit();

    expect(ui.onRate).toHaveBeenCalledExactlyOnceWith(2.5);
    expect(ui.field()).toBeNull();
  });

  it('sets the speed after Enter only once, though the field then blurs', () => {
    const ui = setup();

    ui.readout.click();

    const input = ui.field();

    if (!input) throw new Error('no field');
    input.value = '1.75';
    ui.key(input, 'Enter');
    input.dispatchEvent(new FocusEvent('blur'));

    expect(ui.onRate).toHaveBeenCalledTimes(1);
  });

  it('opens again after it closed', () => {
    const ui = setup();

    ui.readout.click();
    ui.entry.commit();
    ui.readout.click();

    expect(ui.field()?.value).toBe('1');
  });
});
