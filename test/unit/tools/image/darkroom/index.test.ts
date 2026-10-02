import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageCrop, ImageMarkup } from '../../../../../types/tools/image';
import { openDarkroom, type DarkroomResult, type OpenDarkroomOptions } from '../../../../../src/tools/image/darkroom';
import { cameraToRect, fitFrame } from '../../../../../src/tools/image/darkroom/camera';
import { resolveFilters } from '../../../../../src/tools/image/adjust';
import { coverCrop } from '../../../../../src/tools/image/geometry';
import { fakeFrameClock } from '../../../helpers/fake-frame-clock';

// jsdom lacks the Popover API that promoteToTopLayer calls.
const stubPopover = (): void => {
  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
    });
  }
  const proto = HTMLElement.prototype as unknown as { showPopover?: () => void; hidePopover?: () => void };

  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function showPopover() {};
    proto.hidePopover = function hidePopover() {};
  }
};

const setNatural = (img: HTMLImageElement, w: number, h: number): void => {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
};

// Closing unregisters each dialog's dismiss layer so tests stay independent.
const closers: Array<() => void> = [];

const track = (close: () => void): (() => void) => {
  closers.push(close);

  return close;
};

const open = (over: Partial<OpenDarkroomOptions> = {}) => {
  const { clock, advance } = fakeFrameClock();
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const close = track(openDarkroom({ url: 'x.png', onApply, onCancel, clock, ...over }));
  const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

  if (!photo) throw new Error('no photo');
  setNatural(photo, 800, 534);
  photo.dispatchEvent(new Event('load'));
  advance(3000);

  return { close, onApply, onCancel, advance };
};

const dialog = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');

  if (!el) throw new Error('no dialog');

  return el;
};

const button = (action: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

  if (!el) throw new Error(`no ${action}`);

  return el;
};

describe('openDarkroom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('owns the keyboard so Cmd+Z never reaches the document', () => {
    open();

    expect(dialog().hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(dialog().getAttribute('aria-label')).toBe('Crop image');
  });

  it('the stage label names the keys it answers to', () => {
    open();

    expect(stageEl()?.getAttribute('aria-label'))
      .toBe('Photo. Arrow keys move, plus and minus zoom, hold backslash to see the original, Enter applies');
  });

  it('a press on the dark surround does not cancel', () => {
    const { onCancel } = open();
    const backdrop = document.querySelector<HTMLElement>('[data-blok-testid="image-crop-backdrop"]');

    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('one Escape cancels exactly once', () => {
    const { onCancel } = open();

    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Done on an untouched full image saves no crop', () => {
    const { onApply } = open();

    button('done').click();

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: null }));
  });

  it('Done keeps an existing crop, rounded to 3 decimals', () => {
    const { onApply } = open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

    button('done').click();

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: { x: 10, y: 10, w: 60, h: 60 } }));
  });

  it('Circle saves the shape and a crop that is square in pixels', () => {
    const { onApply, advance } = open();

    document.querySelector<HTMLButtonElement>('[data-ratio="circle"]')?.click();
    advance(3000);
    button('done').click();

    const saved = onApply.mock.calls[0][0].crop;

    expect(saved.shape).toBe('circle');
    expect((saved.w * 800) / (saved.h * 534)).toBeCloseTo(1, 2);
  });

  it('Enter on the stage applies', () => {
    const { onApply } = open();

    document.querySelector('[data-role="darkroom-stage"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Z undoes a shape change inside the Darkroom', () => {
    const { advance } = open();
    const circle = document.querySelector<HTMLButtonElement>('[data-ratio="circle"]');

    circle?.click();
    advance(3000);
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    advance(3000);

    expect(circle?.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-ratio="free"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('marks the stage settled once the view is at rest', () => {
    open();

    expect(document.querySelector('[data-role="darkroom-stage"]')?.hasAttribute('data-settled')).toBe(true);
  });

  it('shows no pixel readout: the bar holds the lead buttons and Done only', () => {
    open({ initial: { x: 0, y: 0, w: 50, h: 50 } });
    const bar = button('done').parentElement;

    expect(document.querySelector('[data-role="darkroom-readout"]')).toBeNull();
    expect(bar?.textContent).not.toMatch(/px/);
    expect([...(bar?.children ?? [])]).toEqual([button('cancel').parentElement, button('done')]);
  });

  it('screen readers still hear the crop size once it settles', () => {
    open({ initial: { x: 0, y: 0, w: 50, h: 50 } });

    expect(document.querySelector('[data-role="darkroom-live"]')?.textContent).toBe('400 × 267 px');
  });

  it('a photo that fails to load moves focus from the hidden Done to Cancel', () => {
    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock: fakeFrameClock().clock }));

    expect(button('done')).toHaveFocus();
    document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

    expect(button('cancel')).toHaveFocus();
  });

  it('a failed load still moves focus to Cancel where hiding Done drops focus first', () => {
    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock: fakeFrameClock().clock }));
    const done = button('done');

    // Browsers blur a focused control the moment it is disabled or hidden; jsdom does not.
    for (const prop of ['disabled', 'hidden'] as const) {
      Object.defineProperty(done, prop, {
        configurable: true,
        get: () => done.hasAttribute(prop),
        set: (v: boolean) => {
          if (v) done.blur();
          done.toggleAttribute(prop, v);
        },
      });
    }
    expect(done).toHaveFocus();
    document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

    expect(button('cancel')).toHaveFocus();
  });

  it('a photo that fails to load shows the error state and keeps Cancel', () => {
    const onCancel = vi.fn();

    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel, clock: fakeFrameClock().clock }));
    document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

    expect(document.querySelector('[data-role="error-state"]')).not.toBeNull();
    expect(button('done').disabled).toBe(true);
    expect(button('done').hidden).toBe(true);
    expect(button('reset').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[role="radiogroup"]')?.hidden).toBe(true);
    expect(button('cancel').hidden).toBe(false);
    button('cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a block image scrolled off-screen fades the photo in instead of flying it', () => {
    const source = document.createElement('div');

    document.body.appendChild(source);
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, -600, 200, 150));
    open({ sourceEl: source });

    expect(dialog().getAttribute('data-entering')).toBe('fade');
    expect(source.style.visibility).toBe('');
  });

  it('a photo that loads after Cancel leaves the block image visible', () => {
    const source = document.createElement('div');

    document.body.appendChild(source);
    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock: fakeFrameClock().clock, sourceEl: source }));
    const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

    if (!photo) throw new Error('no photo');
    button('cancel').click();
    setNatural(photo, 800, 534);
    photo.dispatchEvent(new Event('load'));

    expect(source.style.visibility).toBe('');
    expect(document.querySelector('[class^="blok-darkroom"]')).toBeNull();
  });

  it('an SVG with no intrinsic size still opens with finite transforms and announces no size', () => {
    const { clock, advance } = fakeFrameClock();

    track(openDarkroom({ url: 'x.svg', onApply: vi.fn(), onCancel: vi.fn(), clock }));
    const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

    photo?.dispatchEvent(new Event('load'));
    advance(3000);

    const plane = document.querySelector<HTMLElement>('[data-role="image-plane"]');

    expect(plane?.style.transform).toMatch(/scale/);
    expect(plane?.style.transform).not.toContain('NaN');
    expect(plane?.style.transform).not.toContain('Infinity');
    expect(document.querySelector('[data-role="darkroom-live"]')?.textContent).toBe('');
  });
});

const NATURAL = { w: 800, h: 534 };
// Room the Darkroom leaves for the top bar and the bottom dock.
const PAD = { top: 72, right: 32, bottom: 200, left: 32 };

const px = (v: string): number => Number.parseFloat(v);

/** Camera and frame as painted on the DOM. */
const painted = (): { cam: { s: number; tx: number; ty: number }; frame: { x: number; y: number; w: number; h: number } } => {
  const plane = document.querySelector<HTMLElement>('[data-role="darkroom-stage"] [data-role="image-plane"]');
  const frame = document.querySelector<HTMLElement>('[data-role="darkroom-frame"]');
  const p = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(plane?.style.transform ?? '');
  const f = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(frame?.style.transform ?? '');

  if (!p || !f || !frame) throw new Error('no paint');

  return {
    cam: { s: Number(p[3]), tx: Number(p[1]), ty: Number(p[2]) },
    frame: { x: Number(f[1]), y: Number(f[2]), w: px(frame.style.width), h: px(frame.style.height) },
  };
};

const pointer = (type: string, x: number, y: number): void => {
  document.querySelector('[data-role="darkroom-stage"]')
    ?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
};

const key = (target: Element | null, init: KeyboardEventInit): void => {
  target?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
};

const stageEl = (): Element | null => document.querySelector('[data-role="darkroom-stage"]');

describe('openDarkroom fix round 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('with a stage that has size only once mounted', () => {
    const source = document.createElement('div');
    const observers: Array<() => void> = [];

    beforeEach(() => {
      observers.length = 0;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
        if (this === source) return new DOMRect(100, 100, 200, 150);

        return this.isConnected ? new DOMRect(0, 0, 1200, 800) : new DOMRect(0, 0, 0, 0);
      });
      // Browsers deliver a first observation right after observe().
      vi.stubGlobal('ResizeObserver', class {
        constructor(private readonly cb: () => void) {}
        observe(): void { observers.push(() => this.cb()); }
        disconnect(): void {}
      });
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(NATURAL.w);
      vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(NATURAL.h);
    });

    it('a cached photo is fitted against the mounted stage', () => {
      const { clock } = fakeFrameClock();

      track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock }));
      const want = fitFrame(NATURAL.w / NATURAL.h, { w: 1200, h: 800 }, PAD);
      const got = painted().frame;

      expect(got.w).toBeCloseTo(want.w, 3);
      expect(got.h).toBeCloseTo(want.h, 3);
      expect(got.x).toBeCloseTo(want.x, 3);
      expect(got.y).toBeCloseTo(want.y, 3);
    });

    it('the fly-in of an old circle starts from its saved rect, not a squared one', () => {
      const { clock } = fakeFrameClock();

      document.body.appendChild(source);
      track(openDarkroom({
        url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock, sourceEl: source,
        initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' },
      }));

      // The 200 px source box shows 50% of the 800 px photo.
      expect(painted().cam.s).toBeCloseTo(200 / (0.5 * NATURAL.w), 3);
    });

    it('the fly-in from the block keeps animating through the first resize observation', () => {
      const { clock, advance } = fakeFrameClock();

      document.body.appendChild(source);
      track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock, sourceEl: source }));
      advance(16);
      observers.forEach((fire) => fire());
      advance(16);

      expect(stageEl()?.hasAttribute('data-settled')).toBe(false);
      expect(painted().frame.w).toBeLessThan(fitFrame(NATURAL.w / NATURAL.h, { w: 1200, h: 800 }, PAD).w - 1);
    });
  });

  describe('with a loaded photo', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
    });

    describe('the dark surround on the way out', () => {
      const veil = (): Element | null => document.querySelector('[data-role="darkroom-veil"]');
      const withTarget = (): Partial<OpenDarkroomOptions> => {
        const target = document.createElement('div');

        document.body.appendChild(target);

        return { initial: { x: 10, y: 10, w: 60, h: 60 }, getTargetEl: () => target };
      };

      it('Done leaves a veil that fades with the flight and is gone once it lands', () => {
        const promoted: Element[] = [];

        vi.spyOn(HTMLElement.prototype, 'showPopover').mockImplementation(function show(this: HTMLElement) { promoted.push(this); });
        const { advance } = open(withTarget());

        button('done').click();

        expect(veil()).not.toBeNull();
        expect(veil()?.getAttribute('aria-hidden')).toBe('true');
        expect(veil()?.hasAttribute('data-blok-testid')).toBe(false);
        expect(document.querySelector('[data-blok-testid="image-crop-backdrop"]')).toBeNull();
        advance(64);
        const flight = document.querySelector('[data-role="darkroom-flight"]');
        const shown = veil();

        if (!flight || !shown) throw new Error('flight or veil missing mid-flight');
        // Top-layer order is promotion order: the clone must paint over the veil.
        expect(promoted.indexOf(flight)).toBeGreaterThan(promoted.indexOf(shown));
        advance(3000);

        expect(veil()).toBeNull();
        expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
      });

      it('under reduced motion Done leaves no veil behind', () => {
        vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
        open(withTarget());

        button('done').click();

        expect(veil()).toBeNull();
      });

      it('an onApply that throws still takes the veil down and rethrows', () => {
        const boom = new Error('host failed');
        const { clock } = fakeFrameClock();
        const target = document.createElement('div');

        document.body.appendChild(target);
        track(openDarkroom({
          url: 'x.png', onCancel: vi.fn(), clock, initial: { x: 10, y: 10, w: 60, h: 60 },
          getTargetEl: () => target,
          onApply: () => { throw boom; },
        }));
        const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

        if (!photo) throw new Error('no photo');
        setNatural(photo, NATURAL.w, NATURAL.h);
        photo.dispatchEvent(new Event('load'));
        const done = button('done');
        const errors: unknown[] = [];

        // A listener's throw is reported, not raised, by dispatchEvent; capture it here.
        const onError = (e: ErrorEvent): void => { errors.push(e.error); e.preventDefault(); };

        window.addEventListener('error', onError);
        done.click();
        window.removeEventListener('error', onError);

        expect(veil()).toBeNull();
        expect(errors).toEqual([boom]);
      });

      it('an onApply that throws still shows the block image again', () => {
        const source = document.createElement('div');
        const { clock } = fakeFrameClock();

        document.body.appendChild(source);
        track(openDarkroom({
          url: 'x.png', onCancel: vi.fn(), clock, sourceEl: source,
          onApply: () => { throw new Error('host failed'); },
        }));
        const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

        if (!photo) throw new Error('no photo');
        setNatural(photo, NATURAL.w, NATURAL.h);
        photo.dispatchEvent(new Event('load'));
        expect(source.style.visibility).toBe('hidden');
        const onError = (e: ErrorEvent): void => { e.preventDefault(); };

        window.addEventListener('error', onError);
        button('done').click();
        window.removeEventListener('error', onError);

        expect(source.style.visibility).toBe('');
      });

      it('Cancel without a landing target leaves no veil', () => {
        open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

        button('cancel').click();

        expect(veil()).toBeNull();
      });

      it('Cancel after a load error leaves no veil', () => {
        track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock: fakeFrameClock().clock, getTargetEl: () => null }));
        document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

        button('cancel').click();

        expect(veil()).toBeNull();
      });
    });

    it('a pan that starts mid-spring keeps the ratio and saves the rect it shows at rest', () => {
      const { onApply, advance } = open({ initial: { x: 20, y: 20, w: 50, h: 50 } });

      document.querySelector<HTMLButtonElement>(`[data-ratio="${String(16 / 9)}"]`)?.click();
      advance(48);
      pointer('pointerdown', 600, 400);
      pointer('pointermove', 640, 420);
      pointer('pointerup', 640, 420);
      advance(3000);
      const rest = painted();
      const want = cameraToRect(rest.cam, NATURAL, rest.frame);

      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect(Math.abs((saved.w * NATURAL.w) / (saved.h * NATURAL.h) - 16 / 9)).toBeLessThan(0.01);
      expect(saved.x).toBeCloseTo(want.x, 2);
      expect(saved.y).toBeCloseTo(want.y, 2);
      expect(saved.w).toBeCloseTo(want.w, 2);
      expect(saved.h).toBeCloseTo(want.h, 2);
    });

    it('two quick arrow nudges move as far as two slow ones', () => {
      const quick = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });

      key(stageEl(), { key: 'ArrowLeft' });
      key(stageEl(), { key: 'ArrowLeft' });
      quick.advance(3000);
      button('done').click();
      const fast = quick.onApply.mock.calls[0][0].crop;

      const slow = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });

      key(stageEl(), { key: 'ArrowLeft' });
      slow.advance(3000);
      key(stageEl(), { key: 'ArrowLeft' });
      slow.advance(3000);
      button('done').click();

      const slowSaved: { x: number } = slow.onApply.mock.calls[0][0].crop;

      expect(fast.x).toBeCloseTo(slowSaved.x, 2);
    });

    it('Cmd+Z right after a nudge undoes that nudge, not the one before', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });
      const shown = (): number => {
        const rest = painted();

        return cameraToRect(rest.cam, NATURAL, rest.frame).x;
      };

      key(stageEl(), { key: 'ArrowLeft' });
      vi.advanceTimersByTime(1000);
      advance(3000);
      const afterFirst = shown();

      key(stageEl(), { key: 'ArrowLeft' });
      key(dialog(), { key: 'z', metaKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);

      expect(shown()).toBeCloseTo(afterFirst, 2);

      key(dialog(), { key: 'z', metaKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);
      button('done').click();

      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: { x: 25, y: 25, w: 50, h: 50 } }));
    });

    it('a handle drag right after a nudge is one undo step', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { advance } = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });
      const handle = document.querySelector('[data-handle="se"]');
      const drag = (type: string, x: number, y: number): void => {
        handle?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
      };
      const shown = (): number => {
        const rest = painted();

        return cameraToRect(rest.cam, NATURAL, rest.frame).w;
      };

      key(stageEl(), { key: 'ArrowLeft' });
      drag('pointerdown', 900, 600);
      drag('pointermove', 850, 560);
      vi.advanceTimersByTime(1000);
      drag('pointermove', 800, 520);
      drag('pointerup', 800, 520);
      advance(3000);
      key(dialog(), { key: 'z', metaKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);

      expect(shown()).toBeCloseTo(50, 2);
    });

    it('undoing back to the first step restores a saved circle exactly', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      document.querySelector<HTMLButtonElement>('[data-ratio="free"]')?.click();
      advance(3000);
      key(dialog(), { key: 'z', metaKey: true });
      key(dialog(), { key: 'z', metaKey: true });
      advance(3000);
      button('done').click();

      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } }));
    });

    it('Done with no edits keeps an old circle that is not square in pixels exactly', () => {
      const { onApply } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      button('done').click();

      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } }));
    });

    it('one pan on an old circle squares it in pixels', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      pointer('pointerdown', 600, 400);
      pointer('pointermove', 620, 410);
      pointer('pointerup', 620, 410);
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect(saved.shape).toBe('circle');
      expect((saved.w * NATURAL.w) / (saved.h * NATURAL.h)).toBeCloseTo(1, 2);
    });

    it('one arrow nudge on an old circle squares it in pixels', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      key(stageEl(), { key: 'ArrowLeft' });
      vi.advanceTimersByTime(1000);
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect((saved.w * NATURAL.w) / (saved.h * NATURAL.h)).toBeCloseTo(1, 2);
    });

    it('Reset before load still saves an old circle square in pixels', () => {
      const { clock, advance } = fakeFrameClock();
      const onApply = vi.fn();

      track(openDarkroom({ url: 'x.png', onApply, onCancel: vi.fn(), clock, initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } }));
      button('reset').click();
      const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

      if (!photo) throw new Error('no photo');
      setNatural(photo, NATURAL.w, NATURAL.h);
      photo.dispatchEvent(new Event('load'));
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect(saved.shape).toBe('circle');
      expect(Math.abs(saved.w * NATURAL.w - saved.h * NATURAL.h)).toBeLessThan(0.01 * NATURAL.w);
    });

    it('Circle picked again before load still squares an old circle in pixels', () => {
      const { clock, advance } = fakeFrameClock();
      const onApply = vi.fn();

      track(openDarkroom({ url: 'x.png', onApply, onCancel: vi.fn(), clock, initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } }));
      document.querySelector<HTMLButtonElement>('[data-ratio="free"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-ratio="circle"]')?.click();
      const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

      if (!photo) throw new Error('no photo');
      setNatural(photo, NATURAL.w, NATURAL.h);
      photo.dispatchEvent(new Event('load'));
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect(saved.shape).toBe('circle');
      expect((saved.w * NATURAL.w) / (saved.h * NATURAL.h)).toBeCloseTo(1, 2);
    });

    it('a ratio picked before the photo loads is square in pixels', () => {
      const { clock, advance } = fakeFrameClock();
      const onApply = vi.fn();

      track(openDarkroom({ url: 'x.png', onApply, onCancel: vi.fn(), clock }));
      document.querySelector<HTMLButtonElement>('[data-ratio="1"]')?.click();
      const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

      if (!photo) throw new Error('no photo');
      setNatural(photo, NATURAL.w, NATURAL.h);
      photo.dispatchEvent(new Event('load'));
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0].crop;

      expect(saved).not.toBeNull();
      expect((saved.w * NATURAL.w) / (saved.h * NATURAL.h)).toBeCloseTo(1, 2);
    });

    it('a pinch that starts on one point never saves a broken crop', () => {
      const { onApply, advance } = open({ initial: { x: 20, y: 20, w: 50, h: 50 } });
      const touch = (type: string, pointerId: number, x: number): void => {
        stageEl()?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientX: x, clientY: 400 }));
      };

      touch('pointerdown', 1, 600);
      touch('pointerdown', 2, 600);
      touch('pointermove', 2, 600);
      touch('pointermove', 2, 700);
      touch('pointerup', 2, 700);
      touch('pointerup', 1, 600);
      advance(3000);
      button('done').click();
      const saved: Record<string, unknown> = onApply.mock.calls[0][0].crop;

      for (const k of ['x', 'y', 'w', 'h']) expect(Number.isFinite(saved[k])).toBe(true);
    });

    it('a backslash peek ends when focus leaves the stage', () => {
      open();

      key(stageEl(), { key: '\\' });
      expect(dialog().hasAttribute('data-peek')).toBe(true);
      stageEl()?.dispatchEvent(new FocusEvent('blur'));

      expect(dialog().hasAttribute('data-peek')).toBe(false);
    });

    describe('a nudge still waiting to commit', () => {
      const shownX = (): number => {
        const rest = painted();

        return cameraToRect(rest.cam, NATURAL, rest.frame).x;
      };
      const nudgedThen = (act: () => void): { nudged: number; afterUndo: number } => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { advance } = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });

        key(stageEl(), { key: 'ArrowLeft' });
        advance(3000);
        const nudged = shownX();

        act();
        advance(3000);
        key(dialog(), { key: 'z', metaKey: true });
        vi.advanceTimersByTime(1000);
        advance(3000);

        return { nudged, afterUndo: shownX() };
      };

      it('is its own undo step before a chip click', () => {
        const { nudged, afterUndo } = nudgedThen(() => {
          document.querySelector<HTMLButtonElement>('[data-ratio="1"]')?.click();
        });

        expect(afterUndo).toBeCloseTo(nudged, 2);
        expect(document.querySelector('[data-ratio="free"]')?.getAttribute('aria-checked')).toBe('true');
      });

      it('is its own undo step before an arrow key in the chips', () => {
        const { nudged, afterUndo } = nudgedThen(() => {
          key(document.querySelector('[data-ratio="free"]'), { key: 'ArrowRight' });
        });

        expect(afterUndo).toBeCloseTo(nudged, 2);
        expect(document.querySelector('[data-ratio="free"]')?.getAttribute('aria-checked')).toBe('true');
      });

      it('is its own undo step before Reset', () => {
        const { nudged, afterUndo } = nudgedThen(() => button('reset').click());

        expect(afterUndo).toBeCloseTo(nudged, 2);
      });
    });

    it('Cancel after Circle flies back square-cornered, like the block it lands on', () => {
      const { advance } = open({ initial: { x: 20, y: 20, w: 50, h: 50 } });
      const frame = document.querySelector<HTMLElement>('[data-role="darkroom-frame"]');

      document.querySelector<HTMLButtonElement>('[data-ratio="circle"]')?.click();
      advance(3000);
      expect(frame?.style.getPropertyValue('--blok-radius-darkroom-frame')).toBe('50%');
      button('cancel').click();

      expect(frame?.style.getPropertyValue('--blok-radius-darkroom-frame')).toBe('0%');
    });

    it.each([
      { name: 'Ctrl+Y', init: { key: 'y', ctrlKey: true } },
      { name: 'Ctrl+Y on a non-Latin layout', init: { key: 'н', code: 'KeyY', ctrlKey: true } },
      { name: 'Cmd+Shift+Z', init: { key: 'z', metaKey: true, shiftKey: true } },
    ])('$name redoes an undone shape change', ({ init }) => {
      const { advance } = open();
      const circle = document.querySelector<HTMLButtonElement>('[data-ratio="circle"]');

      circle?.click();
      advance(3000);
      key(dialog(), { key: 'z', metaKey: true });
      advance(3000);
      expect(circle?.getAttribute('aria-checked')).toBe('false');
      key(dialog(), init);
      advance(3000);

      expect(circle?.getAttribute('aria-checked')).toBe('true');
    });

    it('Reset is an undo entry: Cmd+Z brings back the crop it cleared', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

      button('reset').click();
      advance(3000);
      key(dialog(), { key: 'z', metaKey: true });
      advance(3000);
      button('done').click();

      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ crop: { x: 10, y: 10, w: 60, h: 60 } }));
    });

    it('Cmd+Z works on a non-Latin keyboard layout', () => {
      const { advance } = open();
      const circle = document.querySelector<HTMLButtonElement>('[data-ratio="circle"]');

      circle?.click();
      advance(3000);
      key(dialog(), { key: 'я', code: 'KeyZ', metaKey: true });
      advance(3000);

      expect(circle?.getAttribute('aria-checked')).toBe('false');
    });

    it('a Latin layout that puts another letter on the Z key does not undo', () => {
      const { advance } = open();
      const circle = document.querySelector<HTMLButtonElement>('[data-ratio="circle"]');

      circle?.click();
      advance(3000);
      key(dialog(), { key: ';', code: 'KeyZ', metaKey: true });
      advance(3000);

      expect(circle?.getAttribute('aria-checked')).toBe('true');
    });
  });
});

describe('openDarkroom geometry, adjust and filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const IDENTITY_RESULT = {
    geometry: { rotation: 0, flipX: false, straighten: 0 },
    filter: 'none',
    strength: 100,
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    markup: [],
  };
  const undo = (): void => key(dialog(), { key: 'z', metaKey: true });
  const result = (onApply: ReturnType<typeof vi.fn>): DarkroomResult => {
    const call: unknown = onApply.mock.calls.at(-1)?.[0];

    if (typeof call !== 'object' || call === null || !('geometry' in call)) throw new Error('no result');

    return call as DarkroomResult;
  };
  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);

    if (!found) throw new Error(`no ${selector}`);

    return found;
  };
  const photoImg = (): HTMLImageElement => q<HTMLImageElement>('[data-role="darkroom-photo"]');
  const plane = (): HTMLElement => q('[data-role="darkroom-stage"] [data-role="image-plane"]');
  // The turned content covers the crop iff fitting it inside that content changes nothing.
  const isCovered = (crop: ImageCrop, o: { w: number; h: number }, theta: number): boolean => {
    const fitted = coverCrop(crop, o, theta);

    return ['x', 'y', 'w', 'h'].every((k) => Math.abs(fitted[k as 'x'] - crop[k as 'x']) < 0.01);
  };

  describe('mode tabs', () => {
    it('a tablist of Crop, Adjust, Filters and Markup, each tab controlling its panel', () => {
      open();
      const list = q('[role="tablist"][aria-label="Edit modes"]');
      const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];

      expect(tabs.map((t) => t.textContent)).toEqual(['Crop', 'Adjust', 'Filters', 'Markup']);
      tabs.forEach((tab) => {
        const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');

        expect(panel?.getAttribute('role')).toBe('tabpanel');
      });
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('the crop panel holds the ratio pill and the straighten dial; other panels are hidden', () => {
      open();
      const cropPanel = q('[role="tab"][data-mode="crop"]').getAttribute('aria-controls') ?? '';
      const panel = document.getElementById(cropPanel);

      expect(panel?.querySelector('[data-ratio="free"]')).not.toBeNull();
      expect(panel?.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('Straighten');
      expect(document.getElementById(q('[role="tab"][data-mode="adjust"]').getAttribute('aria-controls') ?? '')?.hidden).toBe(true);
    });

    it('picking Adjust shows its panel and hides the crop panel', () => {
      open();
      q<HTMLButtonElement>('[role="tab"][data-mode="adjust"]').click();

      const panelOf = (mode: string): HTMLElement | null =>
        document.getElementById(q(`[role="tab"][data-mode="${mode}"]`).getAttribute('aria-controls') ?? '');

      expect(panelOf('adjust')?.hidden).toBe(false);
      expect(panelOf('crop')?.hidden).toBe(true);
      expect(panelOf('adjust')?.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Adjustments');
    });

    it('the selected tab, tool and preset carry only the neutral active hook, no inline paint', () => {
      open();
      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
      q<HTMLButtonElement>('[data-preset="mono"]').click();

      for (const selected of [q('[role="tab"][data-mode="filters"]'), q('[data-preset="mono"]'), q('[data-tool="brightness"]')]) {
        expect(selected.getAttribute('data-active')).toBe('true');
        expect(selected.style.background).toBe('');
        expect(selected.style.color).toBe('');
      }
    });
  });

  describe('outside Crop mode', () => {
    const tab = (mode: string): void => q<HTMLButtonElement>(`[role="tab"][data-mode="${mode}"]`).click();

    it.each(['adjust', 'filters', 'markup'])('the surface says it is in %s mode, and Crop again on return', (mode) => {
      open();

      expect(dialog().getAttribute('data-mode')).toBe('crop');
      tab(mode);
      expect(dialog().getAttribute('data-mode')).toBe(mode);
      tab('crop');
      expect(dialog().getAttribute('data-mode')).toBe('crop');
    });

    it('pan, wheel, handle drag and arrow nudges leave the crop alone', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const initial = { x: 25, y: 25, w: 50, h: 50 };
      const { onApply, advance } = open({ initial });
      const handle = q('[data-handle="se"]');

      tab('adjust');
      pointer('pointerdown', 600, 400);
      pointer('pointermove', 700, 480);
      pointer('pointerup', 700, 480);
      stageEl()?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -400, clientX: 600, clientY: 400 }));
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 900, clientY: 600 }));
      handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 700, clientY: 450 }));
      handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: 700, clientY: 450 }));
      key(stageEl(), { key: 'ArrowLeft' });
      key(stageEl(), { key: '+' });
      vi.advanceTimersByTime(1000);
      advance(3000);
      button('done').click();

      expect(result(onApply).crop).toEqual(initial);
    });

    it('a pan outside Crop mode does not fade the chrome', () => {
      open();
      tab('filters');
      pointer('pointerdown', 600, 400);
      pointer('pointermove', 700, 480);

      expect(q('[role="tablist"]').closest<HTMLElement>('[data-darkroom-chrome]')?.style.opacity).toBe('');
    });

    it('hold-to-peek is off outside Crop mode', () => {
      open();
      tab('adjust');
      key(stageEl(), { key: '\\' });

      expect(dialog().hasAttribute('data-peek')).toBe(false);
    });

    it('back in Crop mode a pan moves the crop again', () => {
      const initial = { x: 25, y: 25, w: 50, h: 50 };
      const { onApply, advance } = open({ initial });

      tab('adjust');
      tab('crop');
      pointer('pointerdown', 600, 400);
      pointer('pointermove', 700, 480);
      pointer('pointerup', 700, 480);
      advance(3000);
      button('done').click();

      expect(result(onApply).crop).not.toEqual(initial);
    });
  });

  describe('rotate and flip', () => {
    it('both buttons lead the top bar after Reset, labelled, with icons', () => {
      open();
      const lead = button('reset').parentElement;
      const actions = [...(lead?.children ?? [])].map((c) => c.getAttribute('data-action'));

      expect(actions).toEqual(['cancel', 'reset', 'rotate-left', 'flip']);
      expect(button('rotate-left').getAttribute('aria-label')).toBe('Rotate left');
      expect(button('flip').getAttribute('aria-label')).toBe('Flip');
      expect(button('rotate-left').querySelector('svg')).not.toBeNull();
      expect(button('flip').querySelector('svg')).not.toBeNull();
    });

    it('rotate left turns the crop with the photo and Done returns the quarter turn', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      button('rotate-left').click();
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: { x: 20, y: 60, w: 40, h: 30 }, geometry: { rotation: 270, flipX: false, straighten: 0 } });
    });

    it('flip mirrors the crop and Done returns flipX', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      button('flip').click();
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: { x: 60, y: 20, w: 30, h: 40 }, geometry: { rotation: 0, flipX: true, straighten: 0 } });
    });

    it('a rotation alone, on an uncropped photo, still saves no crop', () => {
      const { onApply, advance } = open();

      button('rotate-left').click();
      advance(3000);
      button('done').click();

      expect(result(onApply).crop).toBeNull();
      expect(result(onApply).geometry.rotation).toBe(270);
    });

    it('rotate and flip are one undo step each', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      button('rotate-left').click();
      advance(3000);
      button('flip').click();
      advance(3000);
      undo();
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry).toEqual({ rotation: 270, flipX: false, straighten: 0 });
    });

    it('undo after a rotate brings back the unturned crop', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      button('rotate-left').click();
      advance(3000);
      undo();
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: { x: 10, y: 20, w: 30, h: 40 } });
    });

    it('the photo becomes the oriented plane: a quarter turn swaps its size', () => {
      const { advance } = open();

      button('rotate-left').click();
      advance(3000);

      expect(plane().style.width).toBe(`${NATURAL.h}px`);
      expect(plane().style.height).toBe(`${NATURAL.w}px`);
      expect(photoImg().style.transform).toContain('rotate(270deg)');
    });

    it('rotate springs the photo through a quarter turn and lands at rest', () => {
      const { advance } = open();

      button('rotate-left').click();

      expect(plane().style.transform).toContain('rotate(90deg)');
      expect(stageEl()?.hasAttribute('data-settled')).toBe(false);
      advance(3000);

      expect(plane().style.transform).not.toContain('rotate(');
      expect(stageEl()?.hasAttribute('data-settled')).toBe(true);
    });

    it('under reduced motion rotate jumps straight to the turned state', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
      open();

      button('rotate-left').click();

      expect(plane().style.transform).not.toContain('rotate(');
      expect(stageEl()?.hasAttribute('data-settled')).toBe(true);
    });

    it('a quarter turn under a fixed wide ratio switches to Free so the turned crop keeps its pixels', () => {
      const { onApply, advance } = open();

      q<HTMLButtonElement>(`[data-ratio="${String(16 / 9)}"]`).click();
      advance(3000);
      button('rotate-left').click();
      advance(3000);

      expect(q('[data-ratio="free"]').getAttribute('aria-checked')).toBe('true');
      button('done').click();
      const crop = result(onApply).crop;

      if (!crop) throw new Error('no crop');
      expect((crop.w * NATURAL.h) / (crop.h * NATURAL.w)).toBeCloseTo(9 / 16, 2);
    });

    it('the announced size is the crop in turned pixels', () => {
      open({ initial: { x: 0, y: 0, w: 50, h: 50 }, initialGeometry: { rotation: 90, flipX: false, straighten: 0 } });

      expect(q('[data-role="darkroom-live"]').textContent).toBe('267 × 400 px');
    });
  });

  describe('straighten dial', () => {
    const slider = (): HTMLElement => q('[role="slider"][aria-label="Straighten"]');

    it('is a slider from -45 to 45 that starts at the saved straighten', () => {
      open({ initialGeometry: { rotation: 0, flipX: false, straighten: 7 }, initial: { x: 30, y: 30, w: 30, h: 30 } });

      expect(slider().getAttribute('aria-valuemin')).toBe('-45');
      expect(slider().getAttribute('aria-valuemax')).toBe('45');
      expect(slider().getAttribute('aria-valuenow')).toBe('7');
    });

    it('turns the photo under the frame and keeps the crop covered', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open();

      key(slider(), { key: 'ArrowRight', shiftKey: true });
      key(slider(), { key: 'ArrowRight', shiftKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);

      expect(photoImg().style.transform).toContain('rotate(10deg)');
      button('done').click();
      const { crop, geometry } = result(onApply);

      expect(geometry.straighten).toBe(10);
      if (!crop) throw new Error('a straightened photo always saves a crop');
      expect(isCovered(crop, NATURAL, 10)).toBe(true);
    });

    it('a Shift drag on the dial snaps the straighten to 15° steps', () => {
      const { onApply, advance } = open();
      const drag = (type: string, x: number, shiftKey: boolean): void => {
        slider().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, shiftKey }));
      };

      drag('pointerdown', 0, true);
      drag('pointermove', -6 * 20, true);
      drag('pointerup', -6 * 20, true);
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry.straighten).toBe(15);
    });

    it('a straightened view still shows a covered crop after a pan', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open();

      key(slider(), { key: 'ArrowRight', shiftKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);
      pointer('pointerdown', 600, 400);
      pointer('pointermove', 900, 650);
      pointer('pointerup', 900, 650);
      advance(3000);
      button('done').click();
      const { crop } = result(onApply);

      if (!crop) throw new Error('no crop');
      expect(isCovered(crop, NATURAL, 5)).toBe(true);
    });

    it('a handle drag on a straightened photo saves a covered crop', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open();
      const drag = (type: string, x: number, y: number): void => {
        q('[data-handle="se"]').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
      };

      key(slider(), { key: 'ArrowRight', shiftKey: true });
      key(slider(), { key: 'ArrowRight', shiftKey: true });
      key(slider(), { key: 'ArrowRight', shiftKey: true });
      vi.advanceTimersByTime(1000);
      advance(3000);
      drag('pointerdown', 900, 600);
      drag('pointermove', 1400, 1000);
      drag('pointerup', 1400, 1000);
      advance(3000);
      button('done').click();
      const { crop } = result(onApply);

      if (!crop) throw new Error('no crop');
      expect(isCovered(crop, NATURAL, 15)).toBe(true);
    });

    it('a key burst is one undo step', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open();

      key(slider(), { key: 'ArrowRight' });
      key(slider(), { key: 'ArrowRight' });
      key(slider(), { key: 'ArrowRight' });
      vi.advanceTimersByTime(1000);
      advance(3000);
      undo();
      advance(3000);

      expect(slider().getAttribute('aria-valuenow')).toBe('0');
      button('done').click();
      expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: null });
    });

    it('scrubbing back to 0 in one burst gives the crop back unshrunk', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

      key(slider(), { key: 'ArrowRight', shiftKey: true });
      key(slider(), { key: 'Home' });
      vi.advanceTimersByTime(1000);
      advance(3000);
      button('done').click();

      expect(result(onApply).crop).toEqual({ x: 10, y: 10, w: 60, h: 60 });
    });

    it('Done right after a key, before the burst commits, keeps the straighten', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply } = open();

      key(slider(), { key: 'ArrowLeft' });
      button('done').click();

      expect(result(onApply).geometry.straighten).toBe(-1);
    });

    it.each([3, 7, 10, 23, 37, 45])('a crop straightened %s degrees reopens and saves unchanged', (degrees) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = open();

      for (let i = 0; i < degrees; i++) key(slider(), { key: i % 2 === 0 ? 'ArrowRight' : 'ArrowUp' });
      vi.advanceTimersByTime(1000);
      first.advance(3000);
      button('done').click();
      const saved = result(first.onApply);

      if (!saved.crop) throw new Error('no crop');
      const again = open({ initial: saved.crop, initialGeometry: saved.geometry });

      button('done').click();

      expect(result(again.onApply)).toEqual(saved);
    });

    it('an untouched straightened, turned photo round-trips exactly', () => {
      const initial = { x: 40, y: 40, w: 20, h: 20 };
      const initialGeometry = { rotation: 90 as const, flipX: false, straighten: 10 };
      const { onApply } = open({ initial, initialGeometry, initialFilter: 'warm', initialAdjust: { brightness: 5, contrast: 0, saturation: -10 } });

      button('done').click();

      expect(result(onApply)).toEqual({
        crop: initial, geometry: initialGeometry, filter: 'warm', strength: 100, adjust: { brightness: 5, contrast: 0, saturation: -10 }, markup: [],
      });
    });
  });

  describe('adjust and filters', () => {
    it('an adjust dial change shows live on the photo and lands in the result', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply } = open();

      q<HTMLButtonElement>('[role="tab"][data-mode="adjust"]').click();
      q<HTMLButtonElement>('[data-tool="contrast"]').click();
      key(q('[role="slider"][aria-label="Contrast"]'), { key: 'ArrowRight', shiftKey: true });
      vi.advanceTimersByTime(1000);

      expect(photoImg().style.filter).toBe('contrast(1.025)');
      button('done').click();

      expect(result(onApply).adjust).toEqual({ brightness: 0, contrast: 5, saturation: 0 });
    });

    it('a filter preset applies live, saves, and is one undo step', () => {
      const { onApply, advance } = open();

      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
      q<HTMLButtonElement>('[data-preset="noir"]').click();

      expect(photoImg().style.filter).toBe('grayscale(1) contrast(1.4) brightness(0.9)');
      q<HTMLButtonElement>('[data-preset="mono"]').click();
      undo();
      advance(3000);

      expect(q('[data-preset="noir"]').getAttribute('aria-checked')).toBe('true');
      button('done').click();
      expect(result(onApply).filter).toBe('noir');
    });

    it('undo walks back across modes: preset, then rotate, then crop chip', () => {
      const { onApply, advance } = open();

      q<HTMLButtonElement>('[data-ratio="1"]').click();
      advance(3000);
      button('rotate-left').click();
      advance(3000);
      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
      q<HTMLButtonElement>('[data-preset="sepia"]').click();
      undo();
      undo();
      advance(3000);

      expect(photoImg().style.filter).toBe('');
      expect(q('[data-ratio="1"]').getAttribute('aria-checked')).toBe('true');
      button('done').click();
      expect(result(onApply).geometry.rotation).toBe(0);
      expect(result(onApply).filter).toBe('none');
    });

    it('the photo opens with the saved filter and adjustments applied', () => {
      open({ initialFilter: 'mono', initialAdjust: { brightness: 20, contrast: 0, saturation: 0 } });

      expect(photoImg().style.filter).toBe('grayscale(1) brightness(1.1)');
    });

    it('the strength slider scales the look live, saves, and is one undo step', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onApply, advance } = open();

      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
      q<HTMLButtonElement>('[data-preset="mono"]').click();
      for (let i = 0; i < 10; i++) key(q('[role="slider"][aria-label="Strength"]'), { key: 'ArrowLeft', shiftKey: true });
      vi.advanceTimersByTime(1000);

      expect(photoImg().style.filter).toBe('grayscale(0.5)');
      undo();
      advance(3000);
      expect(photoImg().style.filter).toBe('grayscale(1)');
      key(dialog(), { key: 'z', metaKey: true, shiftKey: true });
      advance(3000);
      expect(q('[role="slider"][aria-label="Strength"]').getAttribute('aria-valuenow')).toBe('50');
      button('done').click();
      expect(result(onApply)).toMatchObject({ filter: 'mono', strength: 50 });
    });

    it('opening Filters scrolls the strip to the selected look', () => {
      open({ initialFilter: 'retro' });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.matches('[data-preset="retro"]') ? new DOMRect(1500, 0, 60, 80) : new DOMRect(0, 0, 1200, 800);
      });

      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();

      expect(q('[role="radiogroup"][aria-label="Filters"]').scrollLeft).toBe(930);
    });

    it('opens with the saved strength applied', () => {
      open({ initialFilter: 'mono', initialStrength: 30 });

      expect(photoImg().style.filter).toBe('grayscale(0.3)');
    });

    it('offers the host filters and renders their look', () => {
      const { onApply } = open({ filters: resolveFilters([{ name: 'brand', title: 'Brand', css: 'sepia(0.6)' }, 'noir']) });

      q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
      expect([...document.querySelectorAll('[data-preset]')].map((c) => c.getAttribute('data-preset'))).toEqual(['none', 'brand', 'noir']);
      q<HTMLButtonElement>('[data-preset="brand"]').click();
      expect(photoImg().style.filter).toBe('sepia(0.6)');
      button('done').click();
      expect(result(onApply).filter).toBe('brand');
    });

    it('has no Filters tab when the host offers no filters', () => {
      open({ filters: resolveFilters([]) });

      expect(document.querySelector('[role="tab"][data-mode="filters"]')).toBeNull();
      expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Crop', 'Adjust', 'Markup']);
    });

    it('keeps the Filters tab when the image uses a look the empty host list leaves out', () => {
      open({ filters: resolveFilters([]), initialFilter: 'noir' });

      expect(document.querySelector('[role="tab"][data-mode="filters"]')).not.toBeNull();
    });
  });

  it('Reset clears crop, geometry, filter and adjustments in one undo step', () => {
    const initial = { x: 40, y: 40, w: 20, h: 20 };
    const opts = {
      initial,
      initialGeometry: { rotation: 90 as const, flipX: true, straighten: 10 },
      initialFilter: 'noir' as const,
      initialStrength: 40,
      initialAdjust: { brightness: 20, contrast: 0, saturation: 0 },
    };
    const { onApply, advance } = open(opts);

    button('reset').click();
    advance(3000);

    expect(photoImg().style.filter).toBe('');
    expect(q('[role="slider"][aria-label="Straighten"]').getAttribute('aria-valuenow')).toBe('0');
    button('done').click();
    expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: null });
  });

  it('undo after Reset brings every edit back', () => {
    const initial = { x: 40, y: 40, w: 20, h: 20 };
    const initialGeometry = { rotation: 90 as const, flipX: true, straighten: 10 };
    const { onApply, advance } = open({ initial, initialGeometry, initialFilter: 'noir' });

    button('reset').click();
    advance(3000);
    undo();
    advance(3000);
    button('done').click();

    expect(result(onApply)).toEqual({ ...IDENTITY_RESULT, crop: initial, geometry: initialGeometry, filter: 'noir' });
  });

  it('the chrome dissolve fades the dock by opacity and never touches hidden or aria-hidden', () => {
    open();
    const chrome = [...document.querySelectorAll<HTMLElement>('[data-darkroom-chrome], [data-darkroom-chrome] *')];
    const flags = (): string[] => chrome.map((n) => `${n.hidden}|${n.getAttribute('aria-hidden')}`);
    const before = flags();

    pointer('pointerdown', 600, 400);
    pointer('pointermove', 640, 420);

    expect(q('[role="tablist"]').closest<HTMLElement>('[data-darkroom-chrome]')?.style.opacity).toBe('0');
    expect(flags()).toEqual(before);
    pointer('pointerup', 640, 420);
    expect(flags()).toEqual(before);
  });

  it('a photo that fails to load hides rotate, flip and the dock', () => {
    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel: vi.fn(), clock: fakeFrameClock().clock }));
    photoImg().dispatchEvent(new Event('error'));

    expect(button('rotate-left').hidden).toBe(true);
    expect(button('flip').hidden).toBe(true);
    expect(q('[role="tablist"]').closest<HTMLElement>('[data-darkroom-chrome]')?.hidden).toBe(true);
  });

  it('the fly-out clone carries the new geometry and filter', () => {
    const target = document.createElement('div');

    document.body.appendChild(target);
    const { advance } = open({ getTargetEl: () => target });

    button('rotate-left').click();
    advance(3000);
    q<HTMLButtonElement>('[role="tab"][data-mode="filters"]').click();
    q<HTMLButtonElement>('[data-preset="mono"]').click();
    button('done').click();
    advance(16);
    const img = q<HTMLImageElement>('[data-role="darkroom-flight"] [data-role="image-plane"] img');

    expect(img.style.transform).toContain('rotate(270deg)');
    expect(img.style.filter).toBe('grayscale(1)');
  });

  it('Cancel flies back with the geometry the block still has', () => {
    const target = document.createElement('div');

    document.body.appendChild(target);
    const { advance } = open({ getTargetEl: () => target, initialGeometry: { rotation: 180, flipX: false, straighten: 0 } });

    button('rotate-left').click();
    advance(3000);
    button('cancel').click();
    advance(16);

    expect(q<HTMLImageElement>('[data-role="darkroom-flight"] [data-role="image-plane"] img').style.transform).toContain('rotate(180deg)');
  });
});

describe('openDarkroom local resets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);

    if (!found) throw new Error(`no ${selector}`);

    return found;
  };
  const named = (name: string): HTMLButtonElement => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent === name);

    if (!found) throw new Error(`no button ${name}`);

    return found;
  };
  const shown = (name: string): boolean => named(name).getAttribute('data-shown') === 'true';
  const result = (onApply: ReturnType<typeof vi.fn>): DarkroomResult => {
    const call: unknown = onApply.mock.calls.at(-1)?.[0];

    if (typeof call !== 'object' || call === null || !('geometry' in call)) throw new Error('no result');

    return call as DarkroomResult;
  };
  const undo = (): void => key(dialog(), { key: 'z', metaKey: true });
  const tab = (mode: string): void => q<HTMLButtonElement>(`[role="tab"][data-mode="${mode}"]`).click();
  const edited = {
    initial: { x: 40, y: 40, w: 20, h: 20 },
    initialGeometry: { rotation: 90 as const, flipX: true, straighten: 10 },
    initialFilter: 'noir' as const,
    initialAdjust: { brightness: 20, contrast: -15, saturation: 0 },
  };

  it('every local reset has its own accessible name', () => {
    open(edited);
    const names = ['Reset straighten', 'Reset crop', 'Reset brightness', 'Reset adjustments', 'Reset filter'];

    names.forEach((n) => expect(named(n)).toBeInstanceOf(HTMLButtonElement));
    expect(new Set(names.map((n) => named(n))).size).toBe(names.length);
    expect(button('reset').textContent).toBe('Reset');
  });

  it('each one shows only while its state is off default', () => {
    open();

    for (const n of ['Reset straighten', 'Reset crop', 'Reset brightness', 'Reset adjustments', 'Reset filter']) {
      expect(shown(n), n).toBe(false);
      expect(named(n).hidden, n).toBe(false);
    }
  });

  describe('straighten reset', () => {
    it('sets straighten to 0 in one undo step and leaves the rest', () => {
      const { onApply, advance } = open(edited);

      expect(shown('Reset straighten')).toBe(true);
      named('Reset straighten').click();
      advance(3000);

      expect(shown('Reset straighten')).toBe(false);
      expect(q('[role="slider"][aria-label="Straighten"]').getAttribute('aria-valuenow')).toBe('0');
      undo();
      advance(3000);
      expect(q('[role="slider"][aria-label="Straighten"]').getAttribute('aria-valuenow')).toBe('10');
      key(dialog(), { key: 'z', metaKey: true, shiftKey: true });
      advance(3000);
      button('done').click();

      const r = result(onApply);

      expect(r.geometry).toEqual({ rotation: 90, flipX: true, straighten: 0 });
      expect(r.filter).toBe('noir');
      expect(r.adjust).toEqual(edited.initialAdjust);
    });

    it('a double-click on the dial does the same', () => {
      const { onApply } = open(edited);

      q('[role="slider"][aria-label="Straighten"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      button('done').click();

      expect(result(onApply).geometry.straighten).toBe(0);
    });
  });

  describe('crop reset', () => {
    it('clears rect, ratio and geometry in one step; filter and adjust stay', () => {
      const { onApply, advance } = open({ ...edited, initial: { ...edited.initial, shape: 'circle' } });

      expect(shown('Reset crop')).toBe(true);
      named('Reset crop').click();
      advance(3000);

      expect(shown('Reset crop')).toBe(false);
      expect(q('[data-ratio="free"]').getAttribute('aria-checked')).toBe('true');
      expect(q<HTMLImageElement>('[data-role="darkroom-photo"]').style.filter).toBe('grayscale(1) contrast(1.4) brightness(0.9) brightness(1.1) contrast(0.925)');
      button('done').click();

      expect(result(onApply)).toEqual({
        crop: null,
        geometry: { rotation: 0, flipX: false, straighten: 0 },
        filter: 'noir',
        strength: 100,
        adjust: edited.initialAdjust,
        markup: [],
      });
    });

    it('is one undo step', () => {
      const { onApply, advance } = open(edited);

      named('Reset crop').click();
      advance(3000);
      undo();
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ crop: edited.initial, geometry: edited.initialGeometry, filter: 'noir', strength: 100, adjust: edited.initialAdjust, markup: [] });
    });

    it('shows after a rotate alone', () => {
      const { advance } = open();

      button('rotate-left').click();
      advance(3000);

      expect(shown('Reset crop')).toBe(true);
    });

    it('a focused reset that disappears hands focus to the selected ratio chip', () => {
      const { advance } = open(edited);

      named('Reset crop').focus();
      named('Reset crop').click();
      advance(3000);

      expect(q('[data-ratio="free"]')).toHaveFocus();
    });
  });

  describe('adjust resets', () => {
    it('a chip reset clears only its tool, in one step', () => {
      const { onApply, advance } = open(edited);

      tab('adjust');
      expect(shown('Reset brightness')).toBe(true);
      named('Reset brightness').click();

      expect(shown('Reset brightness')).toBe(false);
      expect(q('[data-tool="contrast"]').getAttribute('data-changed')).toBe('true');
      undo();
      advance(3000);
      expect(q('[role="slider"][aria-label="Brightness"]').getAttribute('aria-valuenow')).toBe('20');
      key(dialog(), { key: 'z', metaKey: true, shiftKey: true });
      advance(3000);
      button('done').click();

      const r = result(onApply);

      expect(r.adjust).toEqual({ brightness: 0, contrast: -15, saturation: 0 });
      expect(r.filter).toBe('noir');
      expect(r.geometry).toEqual(edited.initialGeometry);
    });

    it('every changed tool has its own reset whichever tool is selected, and using one keeps the selection', () => {
      open(edited);
      tab('adjust');

      expect(shown('Reset brightness')).toBe(true);
      expect(shown('Reset contrast')).toBe(true);
      expect(shown('Reset saturation')).toBe(false);
      named('Reset contrast').click();

      expect(q('[role="radio"][data-tool="brightness"]').getAttribute('aria-checked')).toBe('true');
      expect(q('[role="radio"][data-tool="contrast"]').getAttribute('data-changed')).toBe('false');
      expect(q('[role="radio"][data-tool="brightness"]').getAttribute('data-changed')).toBe('true');
    });

    it('the adjust dial has no reset of its own; straighten keeps its', () => {
      open(edited);

      expect(document.querySelectorAll('[data-role="dial-reset"]')).toHaveLength(1);
      expect(q('[data-role="dial-reset"]').getAttribute('aria-label')).toBe('Reset straighten');
    });

    it('Reset adjustments clears all three in one step and leaves filter and geometry', () => {
      const { onApply, advance } = open(edited);

      tab('adjust');
      expect(shown('Reset adjustments')).toBe(true);
      named('Reset adjustments').click();

      expect(shown('Reset adjustments')).toBe(false);
      expect(q<HTMLImageElement>('[data-role="darkroom-photo"]').style.filter).toBe('grayscale(1) contrast(1.4) brightness(0.9)');
      undo();
      advance(3000);
      expect(shown('Reset adjustments')).toBe(true);
      key(dialog(), { key: 'z', metaKey: true, shiftKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ crop: edited.initial, geometry: edited.initialGeometry, filter: 'noir', strength: 100, adjust: { brightness: 0, contrast: 0, saturation: 0 }, markup: [] });
    });

    it('a focused Reset adjustments that disappears hands focus to the adjust dial', () => {
      open(edited);
      tab('adjust');
      named('Reset adjustments').focus();
      named('Reset adjustments').click();

      expect(q('[role="slider"][aria-label="Brightness"]')).toHaveFocus();
    });
  });

  describe('filter reset', () => {
    it('sets the preset to none in one step and leaves adjust and geometry', () => {
      const { onApply, advance } = open(edited);

      tab('filters');
      expect(shown('Reset filter')).toBe(true);
      named('Reset filter').click();

      expect(shown('Reset filter')).toBe(false);
      expect(q('[data-preset="none"]').getAttribute('aria-checked')).toBe('true');
      undo();
      advance(3000);
      expect(q('[data-preset="noir"]').getAttribute('aria-checked')).toBe('true');
      key(dialog(), { key: 'z', metaKey: true, shiftKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply)).toEqual({ crop: edited.initial, geometry: edited.initialGeometry, filter: 'none', strength: 100, adjust: edited.initialAdjust, markup: [] });
    });

    it('brings the strength back to full', () => {
      const { onApply } = open({ ...edited, initialStrength: 40 });

      tab('filters');
      named('Reset filter').click();

      expect(q('[role="slider"][aria-label="Strength"]').getAttribute('aria-valuenow')).toBe('100');
      button('done').click();
      expect(result(onApply).strength).toBe(100);
    });

    it('a focused reset that disappears hands focus to the selected preset', () => {
      open(edited);
      tab('filters');
      named('Reset filter').focus();
      named('Reset filter').click();

      expect(q('[data-preset="none"]')).toHaveFocus();
    });

    it('shows once a preset is picked', () => {
      open();
      tab('filters');
      q<HTMLButtonElement>('[data-preset="fade"]').click();

      expect(shown('Reset filter')).toBe(true);
    });
  });
});

describe('openDarkroom frame room', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('fits the frame between the measured top bar and bottom dock, so the dock never covers it', () => {
    // A tall dock (ratio pill, dial, reset, tabs) and a 60px bar inside an 800px stage.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(this: HTMLElement) {
      if (this.classList.contains('blok-darkroom__bar')) return 60;
      if (this.classList.contains('blok-darkroom__dock')) return 300;
      if (this.classList.contains('blok-darkroom__stage')) return 800;

      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function top(this: HTMLElement) {
      return this.classList.contains('blok-darkroom__dock') ? 480 : 0;
    });
    open();
    const { frame } = painted();

    expect(frame.y + frame.h).toBeLessThanOrEqual(480);
    expect(frame.y).toBeGreaterThanOrEqual(60);
  });
});

describe('openDarkroom markup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Every rect is 1200 × 800 at the origin and O is 800 × 534: screen px are O px × 1.5.
  const S = 1.5;
  const PEN: ImageMarkup = { id: 'p1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5], size: 0.012 };
  const RECT: ImageMarkup = { id: 'r1', type: 'rect', color: '#0a84ff', x1: 0.25, y1: 0.25, x2: 0.5, y2: 0.5, size: 0.012 };

  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);

    if (!found) throw new Error(`no ${selector}`);

    return found;
  };
  const tab = (mode: string): void => q<HTMLButtonElement>(`[role="tab"][data-mode="${mode}"]`).click();
  const layer = (): HTMLElement => q('[data-role="markup-layer"]');
  const at = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
    layer().dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, pressure: 0.5, clientX: x * S, clientY: y * S, ...init,
    }));
  };
  const strokeO = (from: [number, number], to: [number, number]): void => {
    at('pointerdown', ...from);
    at('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    at('pointermove', ...to);
    at('pointerup', ...to);
  };
  const clickO = (x: number, y: number): void => {
    at('pointerdown', x, y);
    at('pointerup', x, y);
  };
  const tool = (name: string): void => q<HTMLButtonElement>(`[data-blok-testid="markup-tool-${name}"]`).click();
  const result = (onApply: ReturnType<typeof vi.fn>): DarkroomResult => {
    const call: unknown = onApply.mock.calls.at(-1)?.[0];

    if (typeof call !== 'object' || call === null || !('markup' in call)) throw new Error('no result');

    return call as DarkroomResult;
  };
  const planeMarks = (): Element[] => [...document.querySelectorAll('[data-role="darkroom-stage"] svg[data-role="image-markup"] [data-markup-id]')];
  const textarea = (): HTMLTextAreaElement | null => document.querySelector('[data-role="markup-text-editor"]');
  const typeText = (value: string): void => {
    const ta = textarea();

    if (!ta) throw new Error('no text editor');
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const openText = (x: number, y: number): void => {
    tool('text');
    clickO(x, y);
  };

  it('Markup mode gives the stage its own label, and Crop gives the crop label back', () => {
    open();
    tab('markup');
    expect(stageEl()?.getAttribute('aria-label')).toContain('V selects, P pen');
    tab('crop');

    expect(stageEl()?.getAttribute('aria-label')).toContain('Arrow keys move');
  });

  it('the drawing layer takes pointers only in Markup mode', () => {
    open();
    expect(layer().hidden).toBe(true);
    tab('markup');

    expect(layer().hidden).toBe(false);
  });

  it('the saved marks show on the photo in every mode', () => {
    open({ initialMarkup: [PEN] });

    expect(planeMarks().map((m) => m.getAttribute('data-markup-id'))).toEqual(['p1']);
  });

  it('Done with no marks returns an empty markup list', () => {
    const { onApply } = open();

    button('done').click();

    expect(result(onApply).markup).toEqual([]);
  });

  it('a pen stroke lands in the result and leaves the crop alone', () => {
    const { onApply } = open();

    tab('markup');
    strokeO([100, 100], [300, 200]);
    button('done').click();

    const r = result(onApply);

    expect(r.crop).toBeNull();
    expect(r.markup).toHaveLength(1);
    expect(r.markup[0]).toMatchObject({ type: 'pen', color: '#ff3b30' });
  });

  it('each mark is one undo step, and redo brings it back', () => {
    open();
    tab('markup');
    strokeO([100, 100], [300, 200]);
    strokeO([100, 300], [300, 400]);
    expect(planeMarks()).toHaveLength(2);
    key(dialog(), { key: 'z', metaKey: true });
    expect(planeMarks()).toHaveLength(1);
    key(dialog(), { key: 'z', metaKey: true, shiftKey: true });

    expect(planeMarks()).toHaveLength(2);
  });

  it('rotate left and flip move the marks with the picture', () => {
    const { onApply, advance } = open({ initialMarkup: [RECT] });

    button('rotate-left').click();
    advance(3000);
    button('flip').click();
    advance(3000);
    button('done').click();

    // Rotate: (x, y) → (y, 1 − x); flip: (x, y) → (1 − x, y).
    expect(result(onApply).markup[0]).toMatchObject({ x1: 0.5, y1: 0.5, x2: 0.75, y2: 0.75 });
  });

  it('Reset clears the marks in one undo step; Reset crop keeps them', () => {
    const { onApply } = open({ initialMarkup: [PEN] });

    button('reset-crop').click();
    expect(planeMarks()).toHaveLength(1);
    button('reset').click();
    expect(planeMarks()).toHaveLength(0);
    key(dialog(), { key: 'z', metaKey: true });
    expect(planeMarks()).toHaveLength(1);
    button('reset').click();
    button('done').click();

    expect(result(onApply).markup).toEqual([]);
  });

  it('the Clear markup reset clears every mark in one step', () => {
    open({ initialMarkup: [PEN, RECT] });
    tab('markup');
    q<HTMLButtonElement>('[data-blok-testid="markup-reset"]').click();
    expect(planeMarks()).toHaveLength(0);
    key(dialog(), { key: 'z', metaKey: true });

    expect(planeMarks()).toHaveLength(2);
  });

  it('Cancel flies back with the marks the block still has', () => {
    const target = document.createElement('div');

    document.body.appendChild(target);
    const { advance, onCancel } = open({ getTargetEl: () => target, initialMarkup: [PEN] });

    tab('markup');
    strokeO([100, 100], [300, 200]);
    button('cancel').click();
    advance(16);

    expect(onCancel).toHaveBeenCalledTimes(1);
    const flown = [...document.querySelectorAll('[data-role="darkroom-flight"] [data-markup-id]')];

    expect(flown.map((m) => m.getAttribute('data-markup-id'))).toEqual(['p1']);
  });

  it('Done flies out with the new marks', () => {
    const target = document.createElement('div');

    document.body.appendChild(target);
    const { advance } = open({ getTargetEl: () => target });

    tab('markup');
    strokeO([100, 100], [300, 200]);
    button('done').click();
    advance(16);

    expect(document.querySelectorAll('[data-role="darkroom-flight"] [data-markup-type="pen"]')).toHaveLength(1);
  });

  it('a photo that fails to load hides the markup panel and the drawing layer', () => {
    open();
    tab('markup');
    const photo = q<HTMLImageElement>('[data-role="darkroom-photo"]');
    const panel = q('[data-blok-testid="markup-tool-pen"]');

    photo.dispatchEvent(new Event('error'));

    expect(panel.closest('[hidden]')).not.toBeNull();
    expect(document.querySelector('[data-role="markup-layer"]:not([hidden])')).toBeNull();
  });

  it('a tool key on the stage picks the tool in the panel', () => {
    open();
    tab('markup');
    key(stageEl(), { key: 'r' });

    expect(q('[data-blok-testid="markup-tool-shapes"]').getAttribute('aria-checked')).toBe('true');
    expect(q('[data-blok-testid="markup-tool-shapes"]').getAttribute('data-shape')).toBe('rect');
  });

  it('the eraser key swaps in the eraser size and the pen key swaps the pen size back', () => {
    open();
    tab('markup');
    q<HTMLButtonElement>('[data-blok-testid="markup-size-2"]').click();
    key(stageEl(), { key: 'e' });
    expect(q('[data-blok-testid="markup-size-1"]').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-role="markup-layer"]')?.getAttribute('data-size')).toBe('1');
    key(stageEl(), { key: 'p' });

    expect(q('[data-blok-testid="markup-size-2"]').getAttribute('aria-checked')).toBe('true');
  });

  it('selecting a mark shows its colour in the panel, and the Delete button removes it', () => {
    open({ initialMarkup: [RECT] });
    tab('markup');
    tool('select');
    clickO(200, 200);
    expect(q('[data-blok-testid="markup-color-0a84ff"]').getAttribute('aria-checked')).toBe('true');
    q<HTMLButtonElement>('[data-blok-testid="markup-delete"]').click();

    expect(planeMarks()).toHaveLength(0);
  });

  it('leaving Markup mode commits an open text and drops the selection', () => {
    const { onApply } = open();

    tab('markup');
    openText(400, 267);
    typeText('Hello');
    tab('crop');
    expect(textarea()).toBeNull();
    expect(document.querySelector('[data-role="markup-selection"]')).toBeNull();
    button('done').click();

    expect(result(onApply).markup[0]).toMatchObject({ type: 'text', text: 'Hello' });
  });

  describe('the text editor owns its keys', () => {
    it('Enter in the text editor types a newline and does not close the darkroom', () => {
      const { onApply } = open();

      tab('markup');
      openText(400, 267);
      typeText('Hi');
      textarea()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(onApply).not.toHaveBeenCalled();
      expect(textarea()).not.toBeNull();
    });

    it('Cmd+Z in the text editor does not run the darkroom undo', () => {
      open();
      tab('markup');
      strokeO([100, 100], [300, 200]);
      openText(400, 400);
      typeText('Hi');
      textarea()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));

      expect(planeMarks()).toHaveLength(1);
      expect(textarea()).not.toBeNull();
    });

    it('Escape commits the text, a second Escape deselects, a third cancels', () => {
      const { onCancel, onApply } = open();

      tab('markup');
      openText(400, 267);
      typeText('Hi');
      key(dialog(), { key: 'Escape' });
      expect(textarea()).toBeNull();
      expect(document.querySelector('[data-role="markup-selection"]')).not.toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
      key(dialog(), { key: 'Escape' });
      expect(document.querySelector('[data-role="markup-selection"]')).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
      key(dialog(), { key: 'Escape' });

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();
    });

    it('Cmd+Enter in the text editor commits the text, not the darkroom', () => {
      const { onApply } = open();

      tab('markup');
      openText(400, 267);
      typeText('Hi');
      textarea()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));

      expect(textarea()).toBeNull();
      expect(onApply).not.toHaveBeenCalled();
      expect(planeMarks()).toHaveLength(1);
    });
  });
});

describe('openDarkroom photo editor keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    closers.splice(0).forEach((close) => close());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const MARK: ImageMarkup = { id: 'p1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5], size: 0.012 };
  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);

    if (!found) throw new Error(`no ${selector}`);

    return found;
  };
  const tabOf = (mode: string): HTMLElement => q(`[role="tab"][data-mode="${mode}"]`);
  const result = (onApply: ReturnType<typeof vi.fn>): DarkroomResult => {
    const call: unknown = onApply.mock.calls.at(-1)?.[0];

    if (typeof call !== 'object' || call === null || !('geometry' in call)) throw new Error('no result');

    return call as DarkroomResult;
  };
  const photoImg = (): HTMLImageElement => q<HTMLImageElement>('[data-role="darkroom-photo"]');
  const keyup = (target: Element | null, init: KeyboardEventInit): void => {
    target?.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
  };

  describe('C, A and F pick a tab, as in Apple Photos', () => {
    it.each([['a', 'adjust'], ['f', 'filters'], ['c', 'crop']])('%s opens %s', (letter, mode) => {
      open();
      if (mode === 'crop') tabOf('adjust').click();
      key(stageEl(), { key: letter });

      expect(tabOf(mode).getAttribute('aria-selected')).toBe('true');
      expect(dialog().getAttribute('data-mode')).toBe(mode);
    });

    it('the key does the same work as a click: the filter strip is revealed and the stage relabelled', () => {
      open();
      const cropLabel = stageEl()?.getAttribute('aria-label');

      key(stageEl(), { key: 'f' });

      expect(document.getElementById(tabOf('filters').getAttribute('aria-controls') ?? '')?.hidden).toBe(false);
      tabOf('markup').click();
      expect(stageEl()?.getAttribute('aria-label')).not.toBe(cropLabel);
      key(stageEl(), { key: 'c' });
      expect(stageEl()?.getAttribute('aria-label')).toBe(cropLabel);
    });

    it('Cmd+C, Ctrl+F and Alt+A are not tab keys', () => {
      open();
      key(stageEl(), { key: 'c', metaKey: true });
      key(stageEl(), { key: 'f', ctrlKey: true });
      key(stageEl(), { key: 'a', altKey: true });

      expect(dialog().getAttribute('data-mode')).toBe('crop');
    });

    it('a non-Latin layout uses the physical key', () => {
      open();
      key(stageEl(), { key: 'ф', code: 'KeyA' });

      expect(dialog().getAttribute('data-mode')).toBe('adjust');
    });

    it('typing in a text field never switches tabs', () => {
      open();
      const input = document.createElement('input');

      dialog().appendChild(input);
      key(input, { key: 'a' });

      expect(dialog().getAttribute('data-mode')).toBe('crop');
    });

    it('in Markup, A is the Arrow tool, even when Arrow is already picked', () => {
      open();
      tabOf('markup').click();
      key(stageEl(), { key: 'a' });
      key(stageEl(), { key: 'a' });
      key(stageEl(), { key: 'ф', code: 'KeyA' });

      expect(dialog().getAttribute('data-mode')).toBe('markup');
      expect(q('[data-blok-testid="markup-tool-shapes"]').getAttribute('aria-checked')).toBe('true');
      expect(q('[data-blok-testid="markup-tool-shapes"]').getAttribute('data-shape')).toBe('arrow');
    });

    it('C and F still leave Markup', () => {
      open();
      tabOf('markup').click();
      key(stageEl(), { key: 'f' });

      expect(dialog().getAttribute('data-mode')).toBe('filters');
    });

    it('F does nothing when there are no filters to offer', () => {
      open({ filters: resolveFilters([]) });
      key(stageEl(), { key: 'f' });

      expect(dialog().getAttribute('data-mode')).toBe('crop');
    });

    it('focus on a control in the panel being hidden moves to the new tab, not to <body>', () => {
      open();
      const chip = q<HTMLButtonElement>('[data-ratio="free"]');

      chip.focus();
      key(chip, { key: 'a' });

      expect(tabOf('adjust')).toHaveFocus();
    });

    it('focus on the stage stays on the stage', () => {
      open();
      const stage = q('[data-role="darkroom-stage"]');

      stage.focus();
      key(stage, { key: 'a' });

      expect(stage).toHaveFocus();
    });

    it('each tab names its key', () => {
      open();

      expect(['crop', 'adjust', 'filters'].map((m) => tabOf(m).getAttribute('aria-keyshortcuts'))).toEqual(['C', 'A', 'F']);
      expect(tabOf('adjust').getAttribute('title')).toBe('Adjust (A)');
    });
  });

  describe('hold M to see the original, as in Apple Photos', () => {
    it('while M is down the photo shows no look and no marks; letting go brings them back', () => {
      open({ initialFilter: 'mono', initialAdjust: { brightness: 40, contrast: 0, saturation: 0 }, initialMarkup: [MARK] });
      const look = photoImg().style.filter;

      expect(look).not.toBe('');
      key(stageEl(), { key: 'm' });
      expect(photoImg().style.filter).toBe('');
      expect(dialog().hasAttribute('data-original')).toBe(true);
      keyup(stageEl(), { key: 'm' });

      expect(photoImg().style.filter).toBe(look);
      expect(dialog().hasAttribute('data-original')).toBe(false);
    });

    it('works in every tab, on a non-Latin layout too', () => {
      open({ initialFilter: 'mono' });
      tabOf('markup').click();
      key(stageEl(), { key: 'ь', code: 'KeyM' });

      expect(photoImg().style.filter).toBe('');
      keyup(stageEl(), { key: 'ь', code: 'KeyM' });
      expect(photoImg().style.filter).not.toBe('');
    });

    it('leaving the window while M is held brings the edits back', () => {
      open({ initialFilter: 'mono' });
      key(stageEl(), { key: 'm' });
      window.dispatchEvent(new Event('blur'));

      expect(photoImg().style.filter).not.toBe('');
      expect(dialog().hasAttribute('data-original')).toBe(false);
    });

    it('is a view, not an edit: Done after a peek keeps the look, and undo has nothing to take back', () => {
      const { onApply } = open({ initialFilter: 'mono' });

      key(stageEl(), { key: 'm' });
      key(stageEl(), { key: 'm', repeat: true });
      keyup(stageEl(), { key: 'm' });
      key(dialog(), { key: 'z', metaKey: true });
      button('done').click();

      expect(result(onApply).filter).toBe('mono');
    });

    it('Cmd+M is not a peek', () => {
      open({ initialFilter: 'mono' });
      key(stageEl(), { key: 'm', metaKey: true });

      expect(photoImg().style.filter).not.toBe('');
    });
  });

  describe('Cmd/Ctrl+[ and ] turn the photo, as in Lightroom', () => {
    it('Cmd+] turns right: the crop turns with it and Done returns a quarter turn clockwise', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      key(stageEl(), { key: ']', code: 'BracketRight', metaKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry).toEqual({ rotation: 90, flipX: false, straighten: 0 });
      expect(result(onApply).crop).toEqual({ x: 40, y: 10, w: 40, h: 30 });
    });

    it('Ctrl+[ turns left, like the button', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      key(stageEl(), { key: '[', code: 'BracketLeft', ctrlKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry.rotation).toBe(270);
      expect(result(onApply).crop).toEqual({ x: 20, y: 60, w: 40, h: 30 });
    });

    it('right then left is where it started, marks included', () => {
      const initial = { x: 10, y: 20, w: 30, h: 40 };
      const { onApply, advance } = open({ initial, initialMarkup: [MARK] });

      key(stageEl(), { key: ']', code: 'BracketRight', metaKey: true });
      advance(3000);
      key(stageEl(), { key: '[', code: 'BracketLeft', metaKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply).crop).toEqual(initial);
      expect(result(onApply).geometry.rotation).toBe(0);
      expect(result(onApply).markup[0]).toMatchObject({ points: MARK.points });
    });

    it('a right turn is one undo step and springs the other way', () => {
      const { onApply, advance } = open();

      key(stageEl(), { key: ']', code: 'BracketRight', metaKey: true });
      expect(q('[data-role="darkroom-stage"] [data-role="image-plane"]').style.transform).toContain('rotate(-90deg)');
      advance(3000);
      key(dialog(), { key: 'z', metaKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry.rotation).toBe(0);
    });

    it('the bracket keys work by physical key and in every tab', () => {
      const { onApply, advance } = open();

      tabOf('markup').click();
      key(stageEl(), { key: 'х', code: 'BracketLeft', metaKey: true });
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry.rotation).toBe(270);
    });

    it('the rotate button names its key', () => {
      open();

      expect(button('rotate-left').getAttribute('aria-keyshortcuts')).toBe('Meta+[ Control+[');
    });
  });

  describe('Shift+H flips the photo', () => {
    it('flips like the button, in any tab, and leaves the markup tool alone', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 20, w: 30, h: 40 } });

      tabOf('markup').click();
      const toolBefore = q('[data-blok-testid^="markup-tool-"][aria-checked="true"]').getAttribute('data-blok-testid');

      key(stageEl(), { key: 'H', code: 'KeyH', shiftKey: true });
      advance(3000);

      expect(q('[data-blok-testid^="markup-tool-"][aria-checked="true"]').getAttribute('data-blok-testid')).toBe(toolBefore);
      button('done').click();
      expect(result(onApply).geometry.flipX).toBe(true);
      expect(result(onApply).crop).toEqual({ x: 60, y: 20, w: 30, h: 40 });
    });

    it('plain H is not a flip', () => {
      const { onApply, advance } = open();

      key(stageEl(), { key: 'h', code: 'KeyH' });
      advance(3000);
      button('done').click();

      expect(result(onApply).geometry.flipX).toBe(false);
    });

    it('works on a non-Latin layout, and the flip button names its key', () => {
      const { onApply, advance } = open();

      key(stageEl(), { key: 'Р', code: 'KeyH', shiftKey: true });
      advance(3000);
      expect(button('flip').getAttribute('aria-keyshortcuts')).toBe('Shift+H');
      button('done').click();

      expect(result(onApply).geometry.flipX).toBe(true);
    });

    it('Shift with a tab letter is not a tab key', () => {
      open();
      key(stageEl(), { key: 'A', code: 'KeyA', shiftKey: true });

      expect(dialog().getAttribute('data-mode')).toBe('crop');
    });
  });

  describe('[ and ] change the markup size, as in Photoshop', () => {
    const size = (): string | null => q('[data-blok-testid^="markup-size-"][aria-checked="true"]').getAttribute('data-size');

    it('] steps up, [ steps down, and both stop at the ends', () => {
      open();
      tabOf('markup').click();
      q<HTMLButtonElement>('[data-blok-testid="markup-tool-pen"]').click();

      expect(size()).toBe('1');
      key(stageEl(), { key: ']', code: 'BracketRight' });
      key(stageEl(), { key: ']', code: 'BracketRight' });
      expect(size()).toBe('2');
      key(stageEl(), { key: '[', code: 'BracketLeft' });
      key(stageEl(), { key: 'х', code: 'BracketLeft' });
      key(stageEl(), { key: '[', code: 'BracketLeft' });

      expect(size()).toBe('0');
      expect(document.querySelector('[data-role="markup-layer"]')?.getAttribute('data-size')).toBe('0');
    });

    it('outside Markup the brackets do nothing', () => {
      open();
      key(stageEl(), { key: ']', code: 'BracketRight' });
      tabOf('markup').click();

      expect(size()).toBe('1');
    });
  });
});
