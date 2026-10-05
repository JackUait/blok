import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TABS_ATTR } from '../../../../src/tools/tabs/constants';
import { cascadeIn, panelRows } from '../../../../src/tools/tabs/motion';

interface Call {
  target: HTMLElement;
  options: KeyframeAnimationOptions;
  animation: Animation;
}

let calls: Call[] = [];

const stubAnimate = (): void => {
  Object.assign(HTMLElement.prototype, {
    animate(this: HTMLElement, _frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
      const animation = { cancel: vi.fn(), finish: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;

      calls.push({ target: this, options, animation });

      return animation;
    },
    getAnimations(this: HTMLElement): Animation[] {
      return calls.filter(call => call.target === this).map(call => call.animation);
    },
  });
};

/** A tab holder as core mounts it: holder → tab root → child slot + empty hint. */
const tabHolder = (rows: string[], empty = false): HTMLElement => {
  const holder = document.createElement('div');
  const root = document.createElement('div');
  const slot = document.createElement('div');
  const hint = document.createElement('div');

  root.setAttribute(TABS_ATTR.tab, '');
  slot.setAttribute(TABS_ATTR.tabChildren, '');
  hint.setAttribute(TABS_ATTR.empty, '');
  hint.textContent = 'Empty tab.';
  hint.classList.toggle('hidden', !empty);
  rows.forEach((id) => {
    const row = document.createElement('div');
    const field = document.createElement('div');

    row.setAttribute('data-blok-element', '');
    row.setAttribute('data-blok-id', id);
    row.setAttribute('data-blok-testid', 'block-wrapper');
    field.setAttribute('contenteditable', 'true');
    field.id = `field-${id}`;
    field.textContent = id;
    row.append(field);
    slot.append(row);
  });
  root.append(slot, hint);
  holder.append(root);

  return holder;
};

describe('tabs switch motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    stubAnimate();
  });

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<{ animate: unknown }>).animate;
    delete (HTMLElement.prototype as Partial<{ getAnimations: unknown }>).getAnimations;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('panelRows', () => {
    it('lists the child blocks of a tab in order', () => {
      const rows = panelRows(tabHolder(['a', 'b', 'c']));

      expect(rows.map(row => row.getAttribute('data-blok-id'))).toEqual(['a', 'b', 'c']);
    });

    it('treats the empty hint as the only row of an empty tab', () => {
      const rows = panelRows(tabHolder([], true));

      expect(rows).toHaveLength(1);
      expect(rows[0].hasAttribute(TABS_ATTR.empty)).toBe(true);
    });
  });

  describe('cascadeIn', () => {
    // A delay before the first row leaves the open tab blank.
    it('starts the first row at once', () => {
      const rows = panelRows(tabHolder(['a', 'b']));

      cascadeIn(rows);

      expect(calls.find(call => call.target === rows[0])?.options.delay).toBe(0);
    });

    it('drops each row in after the one above it', () => {
      const rows = panelRows(tabHolder(['a', 'b', 'c']));

      cascadeIn(rows);

      const delays = rows.map(row => calls.find(call => call.target === row)?.options.delay);

      expect(delays.every(delay => typeof delay === 'number')).toBe(true);
      expect(delays[1]).toBeGreaterThan(delays[0] as number);
      expect(delays[2]).toBeGreaterThan(delays[1] as number);
    });

    it('stops staggering after eight rows so a long tab never makes the reader wait', () => {
      const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
      const rows = panelRows(tabHolder(ids));

      cascadeIn(rows);

      const delays = rows.map(row => calls.find(call => call.target === row)?.options.delay as number);

      expect(delays[7]).toBeGreaterThan(delays[6]);
      expect(new Set(delays.slice(7)).size).toBe(1);
    });

    it('cancels a running cascade before starting a new one', () => {
      const rows = panelRows(tabHolder(['a']));

      cascadeIn(rows);
      const first = calls[0].animation;

      cascadeIn(rows);

      expect(first.cancel).toHaveBeenCalled();
    });
  });
});
