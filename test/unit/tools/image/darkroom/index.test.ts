import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDarkroom, type OpenDarkroomOptions } from '../../../../../src/tools/image/darkroom';
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

  it('a photo that fails to load shows the error state and keeps Cancel', () => {
    const onCancel = vi.fn();

    track(openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel, clock: fakeFrameClock().clock }));
    document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

    expect(document.querySelector('[data-role="error-state"]')).not.toBeNull();
    expect(button('done').disabled).toBe(true);
    button('cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
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
