import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rovingRadioGroup } from '../../../../src/components/utils/roving-radio-group';

function makeGroup(count: number, selected = 0): { group: HTMLElement; radios: HTMLElement[] } {
  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  const radios: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const radio = document.createElement('button');
    radio.type = 'button';
    radio.setAttribute('role', 'radio');
    radio.setAttribute('aria-checked', String(i === selected));
    group.appendChild(radio);
    radios.push(radio);
  }
  document.body.appendChild(group);
  return { group, radios };
}

function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('rovingRadioGroup', () => {
  let cleanup: (() => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup = null;
  });

  afterEach(() => {
    cleanup?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('makes only the selected radio a tab stop (single tab stop)', () => {
    const { radios } = makeGroup(3, 1);
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => 1, onSelect: () => {} });
    cleanup = handle.destroy;

    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('falls back to the first radio as the tab stop when nothing is selected', () => {
    const { radios } = makeGroup(3);
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => -1, onSelect: () => {} });
    cleanup = handle.destroy;

    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('ArrowRight moves selection to the next radio and follows focus', () => {
    const { radios } = makeGroup(3, 0);
    let selected = 0;
    const onSelect = vi.fn((i: number) => { selected = i; });
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect });
    cleanup = handle.destroy;

    press(radios[0], 'ArrowRight');

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('ArrowLeft moves to the previous radio', () => {
    const { radios } = makeGroup(3, 1);
    let selected = 1;
    const onSelect = vi.fn((i: number) => { selected = i; });
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect });
    cleanup = handle.destroy;

    press(radios[1], 'ArrowLeft');

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(radios[0]);
  });

  it('ArrowRight wraps from the last radio to the first', () => {
    const { radios } = makeGroup(3, 2);
    let selected = 2;
    const onSelect = vi.fn((i: number) => { selected = i; });
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect });
    cleanup = handle.destroy;

    press(radios[2], 'ArrowRight');

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(document.activeElement).toBe(radios[0]);
  });

  it('Home selects the first radio and End selects the last', () => {
    const { radios } = makeGroup(4, 2);
    let selected = 2;
    const onSelect = vi.fn((i: number) => { selected = i; });
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect });
    cleanup = handle.destroy;

    press(radios[2], 'Home');
    expect(onSelect).toHaveBeenLastCalledWith(0);
    expect(document.activeElement).toBe(radios[0]);

    press(radios[0], 'End');
    expect(onSelect).toHaveBeenLastCalledWith(3);
    expect(document.activeElement).toBe(radios[3]);
  });

  it('supports vertical orientation via ArrowDown/ArrowUp', () => {
    const { radios } = makeGroup(3, 0);
    let selected = 0;
    const onSelect = vi.fn((i: number) => { selected = i; });
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect, orientation: 'vertical' });
    cleanup = handle.destroy;

    press(radios[0], 'ArrowDown');
    expect(onSelect).toHaveBeenLastCalledWith(1);
    press(radios[1], 'ArrowUp');
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it('prevents default on navigation keys', () => {
    const { radios } = makeGroup(3, 0);
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => 0, onSelect: () => {} });
    cleanup = handle.destroy;

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    radios[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores unrelated keys', () => {
    const { radios } = makeGroup(3, 0);
    const onSelect = vi.fn();
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => 0, onSelect });
    cleanup = handle.destroy;

    press(radios[0], 'Tab');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refresh() re-applies the tab stop after an external selection change', () => {
    const { radios } = makeGroup(3, 0);
    let selected = 0;
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => selected, onSelect: () => {} });
    cleanup = handle.destroy;

    selected = 2;
    handle.refresh();
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('destroy() removes keyboard handling', () => {
    const { radios } = makeGroup(3, 0);
    const onSelect = vi.fn();
    const handle = rovingRadioGroup({ radios, getSelectedIndex: () => 0, onSelect });
    handle.destroy();

    press(radios[0], 'ArrowRight');
    expect(onSelect).not.toHaveBeenCalled();
    cleanup = null;
  });
});
