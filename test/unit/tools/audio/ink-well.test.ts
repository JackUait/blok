import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWellMotion,
  renderInkWell,
  WELL_FLOOD_MS,
  WELL_HOLD_MS,
  WELL_OPEN_MS,
  type InkWellElement,
} from '../../../../src/tools/audio/ink-well';

const LABELS = {
  title: 'Give the drop a picture',
  hint: 'Drop an image on it, or pick one.',
  chooseFile: 'Choose file',
  linkPlaceholder: 'or paste a link',
  linkAria: 'Image URL',
  submit: 'Insert',
  wellAria: 'Set cover image',
};

describe('createWellMotion', () => {
  const settle = (motion: ReturnType<typeof createWellMotion>, input: { dragging: boolean; near: boolean }, from = 0): ReturnType<ReturnType<typeof createWellMotion>['step']> =>
    Array.from({ length: 120 }, (_, i) => motion.step(from + i * 16, input))[119];

  it('rests as a drop a fifth of the well wide, standing straight', () => {
    const shape = settle(createWellMotion(), { dragging: false, near: false });

    expect(shape.mode).toBe('idle');
    expect(shape.radius).toBeCloseTo(0.19, 2);
    expect(shape.lean).toBeCloseTo(0, 2);
  });

  it('leans a little toward a pointer, and reaches for a dragged file', () => {
    const near = settle(createWellMotion(), { dragging: false, near: true });
    const dragging = settle(createWellMotion(), { dragging: true, near: true });

    expect(near.lean).toBeCloseTo(0.35, 2);
    expect(dragging.lean).toBeCloseTo(1, 2);
    expect(dragging.radius).toBeCloseTo(0.25, 2);
  });

  it('floods the well, then opens onto the picture, then is done', () => {
    const motion = createWellMotion();
    const still = { dragging: false, near: false };

    settle(motion, still);
    motion.take(2000);

    const flooding = motion.step(2000 + WELL_FLOOD_MS / 2, still);

    expect(flooding.mode).toBe('flood');
    expect(flooding.radius).toBeGreaterThan(0.19);
    expect(flooding.radius).toBeLessThan(0.78);

    // The frame that ends the flood covers the whole well.
    expect(motion.step(2000 + WELL_FLOOD_MS, still).radius).toBeCloseTo(0.78, 5);

    const opening = motion.step(2000 + WELL_FLOOD_MS + WELL_OPEN_MS / 2, still);

    expect(opening.mode).toBe('open');
    expect(opening.hole).toBeGreaterThan(0.39);
    expect(opening.hole).toBeLessThan(0.78);

    expect(motion.step(2000 + WELL_FLOOD_MS + WELL_OPEN_MS + 16, still).mode).toBe('open');
    expect(motion.step(2000 + WELL_FLOOD_MS + WELL_OPEN_MS + 32, still).mode).toBe('done');
    expect(motion.busy()).toBe(false);
  });

  it('is busy from the take until the picture is fully open', () => {
    const motion = createWellMotion();

    expect(motion.busy()).toBe(false);
    motion.take(0);
    expect(motion.busy()).toBe(true);
  });

  it('goes back to the drop on reset', () => {
    const motion = createWellMotion();

    motion.take(0);
    motion.reset();

    expect(motion.step(16, { dragging: false, near: false }).mode).toBe('idle');
    expect(motion.busy()).toBe(false);
  });

  it('shows the picture at once when asked to skip the motion', () => {
    const motion = createWellMotion();

    motion.show();

    expect(motion.step(0, { dragging: false, near: false }).mode).toBe('done');
  });
});

/** An Image that loads (or fails) on the next microtask, like a cached one. */
const stubImage = (ok = true): void => {
  class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public width = 10;
    public height = 10;
    public set src(_value: string) {
      void Promise.resolve().then(() => (ok ? this.onload?.() : this.onerror?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);
};

const frames: FrameRequestCallback[] = [];
const runFrames = (from: number, to: number): void => {
  Array.from({ length: Math.ceil((to - from) / 16) + 1 }, (_, i) => from + i * 16).forEach((now) => {
    frames.splice(0).forEach((cb) => cb(now));
  });
};

describe('renderInkWell', () => {
  const wells: InkWellElement[] = [];
  const setup = (over: Partial<Parameters<typeof renderInkWell>[0]> = {}): { el: InkWellElement; onFile: ReturnType<typeof vi.fn>; onUrl: ReturnType<typeof vi.fn> } => {
    const onFile = vi.fn();
    const onUrl = vi.fn();
    const el = renderInkWell({ acceptTypes: ['image/*'], labels: LABELS, onFile, onUrl, ...over });

    wells.push(el);
    document.body.append(el);

    return { el, onFile, onUrl };
  };
  const part = <T extends HTMLElement>(el: HTMLElement, role: string): T => {
    const found = el.querySelector<T>(`[data-role="${role}"]`);

    if (!found) throw new Error(`no ${role}`);

    return found;
  };
  const pick = (el: HTMLElement, file: File): void => {
    const input = part<HTMLInputElement>(el, 'ink-well-file');

    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
  };
  const png = (): File => new File(['x'], 'cover.png', { type: 'image/png' });

  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    stubImage();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  });

  afterEach(() => {
    wells.splice(0).forEach((el) => el.destroy());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('shows the well, the heading, one button and the link field together, with no tabs', () => {
    const { el } = setup();
    const well = part(el, 'ink-well');

    expect(well.getAttribute('role')).toBe('button');
    expect(well.tabIndex).toBe(0);
    expect(well.getAttribute('aria-label')).toBe('Set cover image');
    expect(well.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(part(el, 'ink-well-title').textContent).toBe('Give the drop a picture');
    expect(part(el, 'ink-well-hint').textContent).toBe('Drop an image on it, or pick one.');
    expect(part(el, 'ink-well-choose').textContent).toContain('Choose file');
    expect(part<HTMLInputElement>(el, 'ink-well-link').placeholder).toBe('or paste a link');
    expect(part(el, 'ink-well-submit').getAttribute('aria-label')).toBe('Insert');
    expect(part<HTMLInputElement>(el, 'ink-well-file').accept).toBe('image/*');
    expect(el.querySelector('[role="tab"], [data-tab]')).toBeNull();
  });

  it('opens the file chooser from the well, by click or keyboard, and from the button', () => {
    const { el } = setup();
    const open = vi.spyOn(part<HTMLInputElement>(el, 'ink-well-file'), 'click').mockImplementation(() => undefined);

    part(el, 'ink-well').click();
    part(el, 'ink-well').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    part(el, 'ink-well').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    part(el, 'ink-well-choose').click();

    expect(open).toHaveBeenCalledTimes(4);
  });

  it('hands a chosen file over', () => {
    const { el, onFile } = setup();
    const file = png();

    pick(el, file);

    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('hands a dropped file over, and shows where it will land while it hovers', () => {
    const { el, onFile } = setup();
    const file = png();
    const drag = (type: string): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });

      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
      Object.defineProperties(event, { clientX: { value: 30 }, clientY: { value: 40 } });

      return event;
    };

    el.dispatchEvent(drag('dragenter'));
    el.dispatchEvent(drag('dragover'));
    expect(part(el, 'ink-well').classList.contains('is-dragover')).toBe(true);

    el.dispatchEvent(drag('drop'));

    expect(part(el, 'ink-well').classList.contains('is-dragover')).toBe(false);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('hands a pasted link over, trimmed, and ignores an empty one', () => {
    const { el, onUrl } = setup();
    const input = part<HTMLInputElement>(el, 'ink-well-link');
    const form = input.closest('form');

    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onUrl).not.toHaveBeenCalled();

    input.value = '  https://cdn/cover.png ';
    form?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(onUrl).toHaveBeenCalledWith('https://cdn/cover.png');
  });

  it('settles only after the picture has opened', async () => {
    const { el } = setup();
    const done = vi.fn();

    pick(el, png());
    void el.settle().then(done);
    // Let the image load, then run the flood and most of the opening.
    await Promise.resolve();
    await Promise.resolve();
    runFrames(1000, 1000 + WELL_FLOOD_MS + WELL_OPEN_MS - 100);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    // Open now, but held so the picture is seen before the picker closes.
    runFrames(1000 + WELL_FLOOD_MS + WELL_OPEN_MS - 100, 1000 + WELL_FLOOD_MS + WELL_OPEN_MS + WELL_HOLD_MS - 60);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    runFrames(1000 + WELL_FLOOD_MS + WELL_OPEN_MS + WELL_HOLD_MS - 60, 1000 + WELL_FLOOD_MS + WELL_OPEN_MS + WELL_HOLD_MS + 120);
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('settles at once when nothing is opening', async () => {
    const { el } = setup();
    const done = vi.fn();

    await el.settle().then(done);

    expect(done).toHaveBeenCalledTimes(1);
  });

  it('settles at once when the picture cannot be shown', async () => {
    stubImage(false);
    const { el } = setup();
    const done = vi.fn();

    pick(el, png());
    void el.settle().then(done);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledTimes(1);
  });

  it('skips the motion under reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { el } = setup();
    const done = vi.fn();

    pick(el, png());
    void el.settle().then(done);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledTimes(1);
  });

  it('an error is read out, ends the opening, and clears when the link is edited', async () => {
    const { el } = setup();
    const error = part(el, 'ink-well-error');
    const done = vi.fn();

    expect(error.hidden).toBe(true);

    pick(el, png());
    void el.settle().then(done);
    el.setError('Upload failed');
    await Promise.resolve();

    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Upload failed');
    expect(error.getAttribute('role')).toBe('alert');
    expect(done).toHaveBeenCalledTimes(1);

    part(el, 'ink-well-link').dispatchEvent(new Event('input'));
    expect(error.hidden).toBe(true);
  });

  it('never loads a script link as a picture', () => {
    const { el, onUrl } = setup();
    const input = part<HTMLInputElement>(el, 'ink-well-link');
    const loaded: string[] = [];

    class SpyImage {
      public set src(value: string) { loaded.push(value); }
    }
    vi.stubGlobal('Image', SpyImage);

    input.value = 'javascript:alert(1)';
    input.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(onUrl).toHaveBeenCalledWith('javascript:alert(1)');
    expect(loaded).toEqual([]);
  });

  it('frees the local picture and stops drawing on destroy', async () => {
    const { el } = setup();

    pick(el, png());
    await Promise.resolve();
    el.destroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
    expect(frames).toHaveLength(0);
  });
});
