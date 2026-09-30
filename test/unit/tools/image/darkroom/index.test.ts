import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDarkroom, type OpenDarkroomOptions } from '../../../../../src/tools/image/darkroom';
import { cameraToRect, fitFrame } from '../../../../../src/tools/image/darkroom/camera';
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

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Done keeps an existing crop, rounded to 3 decimals', () => {
    const { onApply } = open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

    button('done').click();

    expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 60, h: 60 });
  });

  it('Circle saves the shape and a crop that is square in pixels', () => {
    const { onApply, advance } = open();

    document.querySelector<HTMLButtonElement>('[data-ratio="circle"]')?.click();
    advance(3000);
    button('done').click();

    const saved = onApply.mock.calls[0][0];

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

  it('shows the size readout from the natural size', () => {
    open({ initial: { x: 0, y: 0, w: 50, h: 50 } });

    expect(document.querySelector('[data-role="darkroom-readout"]')?.textContent).toBe('400 × 267 px');
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

  it('an SVG with no intrinsic size still opens with finite transforms and no readout', () => {
    const { clock, advance } = fakeFrameClock();

    track(openDarkroom({ url: 'x.svg', onApply: vi.fn(), onCancel: vi.fn(), clock }));
    const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

    photo?.dispatchEvent(new Event('load'));
    advance(3000);

    expect(photo?.style.transform).not.toContain('NaN');
    expect(photo?.style.transform).not.toContain('Infinity');
    expect(document.querySelector<HTMLElement>('[data-role="darkroom-readout"]')?.hidden).toBe(true);
  });
});

const NATURAL = { w: 800, h: 534 };

const px = (v: string): number => Number.parseFloat(v);

/** Camera and frame as painted on the DOM. */
const painted = (): { cam: { s: number; tx: number; ty: number }; frame: { x: number; y: number; w: number; h: number } } => {
  const photo = document.querySelector<HTMLElement>('[data-role="darkroom-photo"]');
  const frame = document.querySelector<HTMLElement>('[data-role="darkroom-frame"]');
  const p = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(photo?.style.transform ?? '');
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
      const want = fitFrame(NATURAL.w / NATURAL.h, { w: 1200, h: 800 }, { top: 72, right: 32, bottom: 104, left: 32 });
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
      expect(painted().frame.w).toBeLessThan(fitFrame(NATURAL.w / NATURAL.h, { w: 1200, h: 800 }, { top: 72, right: 32, bottom: 104, left: 32 }).w - 1);
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
      const saved = onApply.mock.calls[0][0];

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
      const fast = quick.onApply.mock.calls[0][0];

      const slow = open({ initial: { x: 25, y: 25, w: 50, h: 50 } });

      key(stageEl(), { key: 'ArrowLeft' });
      slow.advance(3000);
      key(stageEl(), { key: 'ArrowLeft' });
      slow.advance(3000);
      button('done').click();

      const slowSaved: { x: number } = slow.onApply.mock.calls[0][0];

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

      expect(onApply).toHaveBeenCalledWith({ x: 25, y: 25, w: 50, h: 50 });
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

      expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 50, h: 50, shape: 'circle' });
    });

    it('Done with no edits keeps an old circle that is not square in pixels exactly', () => {
      const { onApply } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      button('done').click();

      expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 50, h: 50, shape: 'circle' });
    });

    it('one pan on an old circle squares it in pixels', () => {
      const { onApply, advance } = open({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      pointer('pointerdown', 600, 400);
      pointer('pointermove', 620, 410);
      pointer('pointerup', 620, 410);
      advance(3000);
      button('done').click();
      const saved = onApply.mock.calls[0][0];

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
      const saved = onApply.mock.calls[0][0];

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
      const saved = onApply.mock.calls[0][0];

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
      const saved = onApply.mock.calls[0][0];

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
      const saved = onApply.mock.calls[0][0];

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
      const saved: Record<string, unknown> = onApply.mock.calls[0][0];

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

      expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 60, h: 60 });
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
