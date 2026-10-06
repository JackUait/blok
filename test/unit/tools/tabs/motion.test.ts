import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TABS_ATTR } from '../../../../src/tools/tabs/constants';
import { cascadeIn, looksTheSame, moveIndicator, panelRows } from '../../../../src/tools/tabs/motion';

interface Call {
  target: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
}

let calls: Call[] = [];

const stubAnimate = (): void => {
  Object.assign(HTMLElement.prototype, {
    animate(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
      const animation = { cancel: vi.fn(), finish: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;

      calls.push({ target: this, frames, options, animation });

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

    const content = document.createElement('div');

    row.setAttribute('data-blok-element', '');
    row.setAttribute('data-blok-id', id);
    row.setAttribute('data-blok-testid', 'block-wrapper');
    content.setAttribute('data-blok-element-content', '');
    field.setAttribute('contenteditable', 'true');
    field.textContent = id.replace(/^[^:]*:/, '');
    content.append(field);
    row.append(content);
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('moveIndicator', () => {
    const tilt = (frame: Keyframe | undefined): number => {
      const match = /rotateX\((-?[\d.]+)deg\)/.exec(String(frame?.transform ?? ''));

      return match === null ? 0 : Number(match[1]);
    };

    const strip = (): { scroller: HTMLElement; indicator: HTMLElement } => {
      const scroller = document.createElement('div');
      const indicator = document.createElement('div');

      indicator.setAttribute(TABS_ATTR.indicator, '');
      indicator.setAttribute('aria-hidden', 'true');
      scroller.append(indicator);
      document.body.append(scroller);

      return { scroller, indicator };
    };

    const ghosts = (scroller: HTMLElement): HTMLElement[] =>
      Array.from(scroller.querySelectorAll<HTMLElement>(`[${TABS_ATTR.indicator}]`)).slice(1);

    it('places the indicator under the open pill', () => {
      const { indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      expect(indicator.style.insetInlineStart).toBe('120px');
      expect(indicator.style.width).toBe('60px');
    });

    it('unfolds the new tab up out of the sheet', () => {
      const { indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const rise = calls.find(call => call.target === indicator);

      expect(Math.abs(tilt(rise?.frames[0]))).toBeGreaterThan(60);
      expect(tilt(rise?.frames[rise.frames.length - 1])).toBe(0);
      // Lying flat until it starts, never standing at full height first.
      expect(rise?.options.fill).toBe('backwards');
      expect(rise?.options.delay).toBeGreaterThan(0);
    });

    it('folds the old tab down flat where it stood', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const [ghost] = ghosts(scroller);
      const fold = calls.find(call => call.target === ghost);

      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.style.insetInlineStart).toBe('0px');
      expect(ghost.style.width).toBe('80px');
      expect(tilt(fold?.frames[0])).toBe(0);
      expect(Math.abs(tilt(fold?.frames[fold.frames.length - 1]))).toBeGreaterThan(60);
    });

    it('starts the new tab rising before the old one has finished folding', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const rise = calls.find(call => call.target === indicator);
      const fold = calls.find(call => call.target === ghosts(scroller)[0]);

      expect(rise?.options.delay).toBeLessThan(Number(fold?.options.duration));
    });

    it('removes the folded tab once it lies flat', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const [ghost] = ghosts(scroller);
      const fold = calls.find(call => call.target === ghost);

      fold?.animation.onfinish?.call(fold.animation, new Event('finish') as AnimationPlaybackEvent);

      expect(ghosts(scroller)).toHaveLength(0);
    });

    // The folded copy holds the strip's scroll width until it goes, and its removal resizes nothing.
    it('reports when the folded tab is gone, so the strip can re-measure its overflow', () => {
      const { scroller, indicator } = strip();
      const settled = vi.fn();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 }, settled);

      const fold = calls.find(call => call.target === ghosts(scroller)[0]);

      expect(settled).not.toHaveBeenCalled();
      fold?.animation.onfinish?.call(fold.animation, new Event('finish') as AnimationPlaybackEvent);

      expect(ghosts(scroller)).toHaveLength(0);
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('removes the folded tab when its fold is cut short', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const [ghost] = ghosts(scroller);
      const fold = calls.find(call => call.target === ghost);

      fold?.animation.oncancel?.call(fold.animation, new Event('cancel') as AnimationPlaybackEvent);

      expect(ghosts(scroller)).toHaveLength(0);
    });

    // A click while the tab is still rising: the fold starts from that angle, not from upright.
    it('folds a half-risen tab down from the angle it has reached', () => {
      const { scroller, indicator } = strip();

      indicator.style.transform = 'perspective(240px) rotateX(40deg)';
      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const fold = calls.find(call => call.target === ghosts(scroller)[0]);

      expect(tilt(fold?.frames[0])).toBe(40);
    });

    // A flat tab still covers the band's bottom line. Unseen, it leaves the line whole.
    it('keeps the band edge unbroken under a tab that lies flat', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const rise = calls.find(call => call.target === indicator);
      const fold = calls.find(call => call.target === ghosts(scroller)[0]);

      expect(rise?.frames[0].opacity).toBe(0);
      expect(rise?.frames[rise.frames.length - 1].opacity).toBe(1);
      expect(fold?.frames[0].opacity).toBe(1);
      expect(fold?.frames[fold.frames.length - 1].opacity).toBe(0);
    });

    it('folds a half-faded tab down from the opacity it has reached', () => {
      const { scroller, indicator } = strip();

      indicator.style.opacity = '0.4';
      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      const fold = calls.find(call => call.target === ghosts(scroller)[0]);

      expect(fold?.frames[0].opacity).toBe(0.4);
    });

    it('puts the tab in place without motion the first time', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, null, { start: 120, width: 60 });

      expect(calls).toHaveLength(0);
      expect(ghosts(scroller)).toHaveLength(0);
    });

    it('stays still when the tab does not move', () => {
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 120, width: 60 }, { start: 120, width: 60 });

      expect(calls).toHaveLength(0);
      expect(ghosts(scroller)).toHaveLength(0);
    });

    it('swaps the tab at once when the reader asks for less motion', () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const { scroller, indicator } = strip();

      moveIndicator(indicator, { start: 0, width: 80 }, { start: 120, width: 60 });

      expect(calls).toHaveLength(0);
      expect(ghosts(scroller)).toHaveLength(0);
      expect(indicator.style.insetInlineStart).toBe('120px');
    });
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

  describe('looksTheSame', () => {
    it('matches two empty tabs, whose only row is the hint', () => {
      expect(looksTheSame(panelRows(tabHolder([], true)), panelRows(tabHolder([], true)))).toBe(true);
    });

    it('matches two tabs whose blocks draw the same content under different ids', () => {
      expect(looksTheSame(panelRows(tabHolder(['a:Hello'])), panelRows(tabHolder(['b:Hello'])))).toBe(true);
    });

    it('tells tabs apart when any block draws something else', () => {
      expect(looksTheSame(panelRows(tabHolder(['a:Hello'])), panelRows(tabHolder(['b:Bye'])))).toBe(false);
    });

    it('tells tabs apart when one has more blocks', () => {
      expect(looksTheSame(panelRows(tabHolder(['a:Hello'])), panelRows(tabHolder(['b:Hello', 'c:Hello'])))).toBe(false);
    });

    it('tells an empty tab from a tab with one empty block', () => {
      expect(looksTheSame(panelRows(tabHolder([], true)), panelRows(tabHolder(['a:'])))).toBe(false);
    });
  });
});
