import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makePreview, springHome } from '../../../../src/components/utils/media-empty-preview';

const isKeyframeList = (value: unknown): value is Keyframe[] => Array.isArray(value);

describe('springHome — the file dog-ear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('springs the flap home along its fold, not as a matrix blend', () => {
    const stage = makePreview('file');

    document.body.appendChild(stage);
    stage.setAttribute('data-hover', '');

    const calls = new Map<Element, Keyframe[]>();

    Object.defineProperty(stage, 'getAnimations', { value: () => [], configurable: true });

    stage.querySelectorAll('svg *').forEach((el) => {
      const folded = el.matches('.blok-media-preview__flap, .blok-media-preview__crease');

      Object.defineProperty(el, 'getAnimations', {
        value: () => (folded ? [{ animationName: 'blok-media-preview-flap' }] : []),
        configurable: true,
      });
      Object.defineProperty(el, 'animate', {
        value: (keyframes: unknown) => {
          if (isKeyframeList(keyframes)) calls.set(el, keyframes);

          return { cancel: vi.fn() };
        },
        configurable: true,
      });
    });

    // The flap caught mid-flip: rotate(45deg) scaleY(-0.45) rotate(-45deg).
    const real = window.getComputedStyle.bind(window);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      const folded = el.matches('.blok-media-preview__flap, .blok-media-preview__crease');
      const caught = folded && stage.hasAttribute('data-hover');

      return new Proxy(style, {
        get: (target, key) => {
          if (key === 'transform') return caught ? 'matrix(0.275, 0.725, 0.725, 0.275, 0, 0)' : 'none';

          const value: unknown = Reflect.get(target, key);

          return value;
        },
      });
    });

    springHome(stage);

    for (const selector of ['.blok-media-preview__flap', '.blok-media-preview__crease']) {
      const el = stage.querySelector(selector);
      const keyframes = el ? calls.get(el) : undefined;

      expect(keyframes?.map((frame) => frame.transform)).toEqual([
        'rotate(45deg) scaleY(-0.45) rotate(-45deg)',
        'rotate(45deg) scaleY(1) rotate(-45deg)',
      ]);
    }
  });
});
