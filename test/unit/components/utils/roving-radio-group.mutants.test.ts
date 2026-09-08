import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rovingRadioGroup } from '../../../../src/components/utils/roving-radio-group';

import type { RovingRadioGroup } from '../../../../src/components/utils/roving-radio-group';

/**
 * Mutation-coverage tests for `src/components/utils/roving-radio-group.ts`.
 *
 * Equivalence proofs for the mutants deliberately left alive:
 *
 * - L66 `selected >= 0` weakened to `selected > 0`. The two differ only when
 *   `selected === 0`, and there both arms of `selected >= 0 ? selected : 0`
 *   evaluate to 0, so the resulting tab stop is identical for every input.
 * - L73 `radios.length === 0` replaced by `false`. `move` is reachable only from
 *   the keydown handler, which returns before any move when
 *   `radios.indexOf(event.currentTarget)` is negative. A match implies at least
 *   one element, and nothing between the lookup and the guard can shrink the
 *   array, so the guard never fires on a real call.
 */

const makeRadios = (count: number): HTMLElement[] => {
  const group = document.createElement('div');
  const radios: HTMLElement[] = [];

  group.setAttribute('role', 'radiogroup');

  for (let i = 0; i < count; i++) {
    const radio = document.createElement('button');

    radio.type = 'button';
    radio.setAttribute('role', 'radio');
    group.appendChild(radio);
    radios.push(radio);
  }

  document.body.appendChild(group);

  return radios;
};

const press = (element: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  element.dispatchEvent(event);

  return event;
};

describe('roving-radio-group mutants', () => {
  let handle: RovingRadioGroup | null;

  beforeEach(() => {
    vi.clearAllMocks();
    handle = null;
  });

  afterEach(() => {
    handle?.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('both orientation', () => {
    const bothGroup = (): { radios: HTMLElement[]; selected: () => number } => {
      const radios = makeRadios(3);
      let selected = 1;

      handle = rovingRadioGroup({
        radios,
        getSelectedIndex: () => selected,
        onSelect: (index: number) => {
          selected = index;
        },
        orientation: 'both',
      });

      return { radios, selected: () => selected };
    };

    it.each(['ArrowRight', 'ArrowDown'])('%s moves to the next radio', (key) => {
      const { radios, selected } = bothGroup();

      press(radios[1], key);

      expect(selected()).toBe(2);
      expect(radios[2]).toHaveFocus();
    });

    it.each(['ArrowLeft', 'ArrowUp'])('%s moves to the previous radio', (key) => {
      const { radios, selected } = bothGroup();

      press(radios[1], key);

      expect(selected()).toBe(0);
      expect(radios[0]).toHaveFocus();
    });
  });

  it('writes the literal tabindex values, not just focusable-vs-not', () => {
    // A <button> reports tabIndex 0 for an invalid attribute value too, so the
    // attribute text is the only thing that pins the roving tab stop.
    const radios = makeRadios(3);

    handle = rovingRadioGroup({ radios, getSelectedIndex: () => 2, onSelect: () => {} });

    expect(radios.map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('ignores a keydown from an element no longer in the group array', () => {
    const radios = makeRadios(3);
    const onSelect = vi.fn();

    handle = rovingRadioGroup({ radios, getSelectedIndex: () => 0, onSelect });

    const [removed] = radios.splice(1, 1);
    const event = press(removed, 'ArrowRight');

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['ArrowLeft', 'Home', 'End'])('prevents the default action of %s', (key) => {
    const radios = makeRadios(3);

    handle = rovingRadioGroup({ radios, getSelectedIndex: () => 1, onSelect: () => {} });

    expect(press(radios[1], key).defaultPrevented).toBe(true);
  });
});
