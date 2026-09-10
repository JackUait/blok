import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { mountCropEditor } from '../../../../src/tools/image/crop-editor';
import { FULL_RECT } from '../../../../src/tools/image/crop-math';
import type { ImageCrop } from '../../../../types/tools/image';
import type { I18nInstance } from '../../../../src/components/utils/tools';

const echoI18n = (): I18nInstance => ({
  has: () => true,
  t: (key: string) => `i18n:${key}`,
});

interface Mounted {
  container: HTMLElement;
  root: HTMLElement;
  frame: HTMLElement;
  rectEl: HTMLElement;
  pill: HTMLElement;
  img: HTMLImageElement;
  onApply: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  unmount: () => void;
  button: (action: string) => HTMLButtonElement;
  handle: (name: string) => HTMLElement;
  chip: (key: string) => HTMLButtonElement;
}

/** The frame is measured for every drag; jsdom reports a zero box without this. */
const STAGE = { left: 0, top: 0, width: 200, height: 100 };

/** A stage that does not start at the viewport origin: a sign error in the
 *  stage-to-percent conversion only shows up when `left`/`top` are non-zero. */
const OFFSET_STAGE = { left: 40, top: 20, width: 200, height: 100 };

interface MountOptions {
  initial?: ImageCrop;
  /** `null` mounts the editor with no alt text at all. */
  alt?: string | null;
  stage?: typeof STAGE;
}

const mount = (options: MountOptions = {}): Mounted => {
  const { initial, alt = 'a picture', stage = STAGE } = options;
  const container = document.createElement('div');

  document.body.appendChild(container);

  const onApply = vi.fn();
  const onCancel = vi.fn();
  const unmount = mountCropEditor(container, {
    url: 'https://example.test/i.png',
    alt: alt ?? undefined,
    initial,
    onApply,
    onCancel,
    i18n: echoI18n(),
  });

  const root = container.querySelector<HTMLElement>('.blok-image-crop-editor');
  const frame = container.querySelector<HTMLElement>('.blok-image-crop-editor__frame');
  const rectEl = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect');
  const pill = container.querySelector<HTMLElement>('.blok-image-crop-editor__size-pill');
  const img = container.querySelector<HTMLImageElement>('img');

  if (root === null || frame === null || rectEl === null || pill === null || img === null) {
    throw new Error('the crop editor did not mount');
  }

  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
    ...stage,
    right: stage.left + stage.width,
    bottom: stage.top + stage.height,
    x: stage.left,
    y: stage.top,
    toJSON: () => stage,
  });

  return {
    container,
    root,
    frame,
    rectEl,
    pill,
    img,
    onApply,
    onCancel,
    unmount,
    button: (action) => {
      const el = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

      if (el === null) {
        throw new Error(`no ${action} button`);
      }

      return el;
    },
    handle: (name) => {
      const el = root.querySelector<HTMLElement>(`[data-handle="${name}"]`);

      if (el === null) {
        throw new Error(`no ${name} handle`);
      }

      return el;
    },
    chip: (key) => {
      const el = root.querySelector<HTMLButtonElement>(`[data-ratio="${key}"]`);

      if (el === null) {
        throw new Error(`no ${key} chip`);
      }

      return el;
    },
  };
};

const pointer = (type: string, clientX: number, clientY: number): PointerEvent =>
  new PointerEvent(type, { clientX, clientY, bubbles: true, cancelable: true });

const drag = (from: HTMLElement, start: [number, number], to: [number, number]): void => {
  from.dispatchEvent(pointer('pointerdown', start[0], start[1]));
  window.dispatchEvent(pointer('pointermove', to[0], to[1]));
  window.dispatchEvent(pointer('pointerup', to[0], to[1]));
};

describe('crop editor mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('what it mounts', () => {
    it('builds eight handles, four of them corners carrying two strokes each', () => {
      const { root } = mount();

      expect(root.querySelectorAll('[data-handle]')).toHaveLength(8);
      expect(root.querySelectorAll('.blok-image-crop-editor__handle--corner')).toHaveLength(4);
      expect(root.querySelectorAll('.blok-image-crop-editor__handle--edge')).toHaveLength(4);
      expect(root.querySelectorAll('.blok-image-crop-editor__handle-stroke')).toHaveLength(8);
    });

    it('labels the region through i18n and shows the source image', () => {
      const { root } = mount();
      const image = root.querySelector('img');

      expect(root.getAttribute('role')).toBe('region');
      expect(root.getAttribute('aria-label')).toBe('i18n:tools.image.cropDialogLabel');
      expect(image?.getAttribute('src')).toBe('https://example.test/i.png');
      expect(image?.getAttribute('alt')).toBe('a picture');
      expect(image?.draggable).toBe(false);
    });

    it('draws the rule-of-thirds grid', () => {
      const { rectEl } = mount();

      expect(rectEl.querySelectorAll('.blok-image-crop-editor__grid-line')).toHaveLength(4);
    });

    it('starts on the rect shape for a plain crop', () => {
      const { rectEl } = mount();

      expect(rectEl.getAttribute('data-shape')).toBe('rect');
    });

    it('starts on the shape the incoming crop carries', () => {
      const { rectEl } = mount({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      expect(rectEl.getAttribute('data-shape')).toBe('circle');
    });

    it('keeps an ellipse as an ellipse rather than falling back to a plain rect', () => {
      const { rectEl, chip } = mount({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'ellipse' } });

      expect(rectEl.getAttribute('data-shape')).toBe('ellipse');
      expect(chip('ellipse').getAttribute('data-active')).toBe('true');
    });

    it('draws a dimming mask of its own class directly over the image', () => {
      const { frame } = mount();
      const mask = frame.querySelector<HTMLElement>('.blok-image-crop-editor__mask');

      expect(mask).not.toBeNull();
      expect(mask?.className).toBe('blok-image-crop-editor__mask');
      expect(mask?.parentElement).toBe(frame);
    });

    it('hides the shape-mask clip from assistive tech', () => {
      const { frame } = mount();
      const clip = frame.querySelector<HTMLElement>('.blok-image-crop-editor__shape-mask-clip');

      expect(clip?.getAttribute('aria-hidden')).toBe('true');
    });

    it('gives the footer toolbar its toolbar role', () => {
      const { root } = mount();
      const toolbar = root.querySelector<HTMLElement>('.blok-image-crop-editor__toolbar');

      expect(toolbar?.getAttribute('role')).toBe('toolbar');
    });

    it('marks the ratio chips as a labelled radiogroup', () => {
      const { root } = mount();
      const group = root.querySelector<HTMLElement>('.blok-image-crop-editor__ratio-group');

      expect(group).not.toBeNull();
      expect(group?.className).toBe('blok-image-crop-editor__ratio-group');
      expect(group?.getAttribute('role')).toBe('radiogroup');
      expect(group?.getAttribute('data-action')).toBe('ratio');
    });

    it('gives every ratio chip a button type and a chip class', () => {
      const { root } = mount();
      const chips = root.querySelectorAll<HTMLButtonElement>('[data-ratio]');

      expect(chips).toHaveLength(6);

      for (const chip of chips) {
        expect(chip.tagName).toBe('BUTTON');
        expect(chip.type).toBe('button');
        expect(chip.className).toBe('blok-image-crop-editor__ratio-chip');
      }
    });

    it('names the actions row', () => {
      const { root } = mount();
      const actions = root.querySelector<HTMLElement>('.blok-image-crop-editor__actions');

      expect(actions).not.toBeNull();
      expect(actions?.className).toBe('blok-image-crop-editor__actions');
    });

    it('puts two side-specific strokes inside each corner and none on an edge', () => {
      const { handle } = mount();
      const corner = handle('nw');

      expect(corner.querySelector('.blok-image-crop-editor__handle-stroke--a')).not.toBeNull();
      expect(corner.querySelector('.blok-image-crop-editor__handle-stroke--b')).not.toBeNull();
      expect(handle('n').querySelector('.blok-image-crop-editor__handle-stroke')).toBeNull();
    });

    it('leaves the alt attribute empty when the caller gives no alt text', () => {
      const { img } = mount({ alt: null });

      expect(img.getAttribute('alt')).toBe('');
    });

    it('starts with only the incoming shape chip selected', () => {
      const { chip } = mount({ initial: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });

      expect(chip('circle').getAttribute('data-active')).toBe('true');
      expect(chip('circle').getAttribute('aria-checked')).toBe('true');
      expect(chip('free').getAttribute('data-active')).toBe('false');
      expect(chip('free').getAttribute('aria-checked')).toBe('false');
    });

    it('keeps a chip click from reaching the toolbar behind it', () => {
      const { root, chip } = mount();
      const toolbar = root.querySelector<HTMLElement>('.blok-image-crop-editor__toolbar');
      const bubbled = vi.fn();

      toolbar?.addEventListener('click', bubbled);
      chip('1').click();

      expect(bubbled).not.toHaveBeenCalled();
    });

    it('refuses to mount when the action buttons cannot be found', () => {
      vi.spyOn(Element.prototype, 'querySelector').mockReturnValue(null);
      const container = document.createElement('div');

      document.body.appendChild(container);

      expect(() => mountCropEditor(container, {
        url: 'https://example.test/i.png',
        onApply: vi.fn(),
        onCancel: vi.fn(),
      })).toThrowError(new Error('CropEditor: missing done button'));
    });

    it('refuses to mount when the cancel button alone is missing', () => {
      const container = document.createElement('div');

      vi.spyOn(Element.prototype, 'querySelector')
        .mockReturnValueOnce(document.createElement('button'))
        .mockReturnValueOnce(null);
      document.body.appendChild(container);

      expect(() => mountCropEditor(container, {
        url: 'https://example.test/i.png',
        onApply: vi.fn(),
        onCancel: vi.fn(),
      })).toThrowError(new Error('CropEditor: missing cancel button'));
    });

    it('refuses to mount when the reset button alone is missing', () => {
      const container = document.createElement('div');

      vi.spyOn(Element.prototype, 'querySelector')
        .mockReturnValueOnce(document.createElement('button'))
        .mockReturnValueOnce(document.createElement('button'))
        .mockReturnValueOnce(null);
      document.body.appendChild(container);

      expect(() => mountCropEditor(container, {
        url: 'https://example.test/i.png',
        onApply: vi.fn(),
        onCancel: vi.fn(),
      })).toThrowError(new Error('CropEditor: missing reset button'));
    });
  });

  describe('painting the geometry', () => {
    it('writes the rect, the pill and the shape mask as percentages of the stage', () => {
      const { rectEl, pill, frame } = mount({ initial: { x: 10, y: 20, w: 30, h: 40 } });
      const shapeMask = frame.querySelector<HTMLElement>('.blok-image-crop-editor__shape-mask');

      expect(rectEl.style.left).toBe('10%');
      expect(rectEl.style.top).toBe('20%');
      expect(rectEl.style.width).toBe('30%');
      expect(rectEl.style.height).toBe('40%');

      expect(pill.style.left).toBe('25%');
      expect(pill.style.top).toBe('20%');

      expect(shapeMask?.style.left).toBe('10%');
      expect(shapeMask?.style.top).toBe('20%');
      expect(shapeMask?.style.width).toBe('30%');
      expect(shapeMask?.style.height).toBe('40%');
    });

    it('clips the dimming mask to the inverse of the crop rectangle', () => {
      const { frame } = mount({ initial: { x: 10, y: 20, w: 30, h: 40 } });
      const mask = frame.querySelector<HTMLElement>('.blok-image-crop-editor__mask');

      expect(mask?.style.clipPath).toBe(`polygon(
      0 0, 100% 0, 100% 100%, 0 100%, 0 0,
      10% 20%,
      10% 60%,
      40% 60%,
      40% 20%,
      10% 20%
    )`);
    });

    it('repaints the size pill when a resize changes the crop', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      Object.defineProperty(fixture.img, 'naturalWidth', { configurable: true, get: () => 200 });
      Object.defineProperty(fixture.img, 'naturalHeight', { configurable: true, get: () => 100 });

      drag(fixture.handle('se'), [0, 0], [20, 20]);

      expect(fixture.pill.textContent).toBe('120 × 70 px');
    });

    it('hides the size pill when the image reports no height yet', () => {
      const fixture = mount({ initial: { x: 0, y: 0, w: 50, h: 50 } });

      Object.defineProperty(fixture.img, 'naturalWidth', { configurable: true, get: () => 200 });
      Object.defineProperty(fixture.img, 'naturalHeight', { configurable: true, get: () => 0 });

      fixture.img.dispatchEvent(new Event('load'));

      expect(fixture.pill.hidden).toBe(true);
    });
  });

  describe('applying', () => {
    it('reports no crop when the rect still covers the whole image', () => {
      const { button, onApply } = mount();

      button('done').click();

      expect(onApply).toHaveBeenCalledWith(null);
    });

    it('reports the rect when it has been narrowed', () => {
      const { button, onApply } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });

      button('done').click();

      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply.mock.calls[0][0]).toMatchObject({ x: 10, y: 20, w: 50, h: 40 });
    });

    it('always reports a shaped crop, even at full size', () => {
      const { button, onApply } = mount({ initial: { ...FULL_RECT, shape: 'circle' } });

      button('done').click();

      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply.mock.calls[0][0]).toMatchObject({ shape: 'circle' });
    });

    it('applies on Enter as well as on the button', () => {
      const { onApply } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      document.dispatchEvent(event);

      expect(onApply).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('ignores every other key', () => {
      const { onApply } = mount();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));

      expect(onApply).not.toHaveBeenCalled();
    });
  });

  describe('cancelling and resetting', () => {
    it('cancels without applying', () => {
      const { button, onApply, onCancel } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });

      button('cancel').click();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();
    });

    it('resets the rect back to the whole image without applying', () => {
      const { button, onApply } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });

      button('reset').click();
      expect(onApply).not.toHaveBeenCalled();

      button('done').click();
      expect(onApply).toHaveBeenCalledWith(null);
    });
  });

  describe('aspect ratio and handles', () => {
    const EDGES = ['n', 'e', 's', 'w'];
    const CORNERS = ['nw', 'ne', 'se', 'sw'];

    it('shows the edge handles while the crop is freeform', () => {
      const fixture = mount();

      for (const edge of EDGES) {
        expect(fixture.handle(edge).hidden).toBe(false);
      }
    });

    it('hides the edge handles as soon as the crop has a fixed ratio', () => {
      const fixture = mount({ initial: { x: 0, y: 0, w: 100, h: 100, shape: 'circle' } });

      for (const edge of EDGES) {
        expect(fixture.handle(edge).hidden).toBe(true);
      }

      for (const corner of CORNERS) {
        expect(fixture.handle(corner).hidden).toBe(false);
      }
    });

    it('hides the edge handles after a fixed ratio is picked and keeps the corners', () => {
      const fixture = mount();

      fixture.chip('1').click();

      for (const edge of EDGES) {
        expect(fixture.handle(edge).hidden).toBe(true);
      }

      for (const corner of CORNERS) {
        expect(fixture.handle(corner).hidden).toBe(false);
      }
    });

    it('moves the selected chip to the one that was clicked', () => {
      const fixture = mount();

      expect(fixture.chip('free').getAttribute('data-active')).toBe('true');

      fixture.chip('1').click();

      expect(fixture.chip('1').getAttribute('data-active')).toBe('true');
      expect(fixture.chip('1').getAttribute('aria-checked')).toBe('true');
      expect(fixture.chip('free').getAttribute('data-active')).toBe('false');
    });

    it('reshapes the crop to the ratio that was picked', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 30, h: 40 } });

      fixture.chip('1').click();

      expect(fixture.rectEl.style.height).toBe('30%');
      expect(fixture.rectEl.style.top).toBe('15%');
    });
  });

  describe('dragging', () => {
    it('moves the whole rect when its body is dragged', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      drag(fixture.rectEl, [0, 0], [20, 10]);
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBeCloseTo(20, 5);
      expect(applied.y).toBeCloseTo(20, 5);
      expect(applied.w).toBeCloseTo(50, 5);
      expect(applied.h).toBeCloseTo(50, 5);
    });

    it('resizes from a handle rather than moving the rect', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      drag(fixture.handle('e'), [0, 0], [20, 0]);
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBeCloseTo(10, 5);
      expect(applied.w).toBeGreaterThan(50);
    });

    it('leaves the rect alone once the pointer is released', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      drag(fixture.rectEl, [0, 0], [20, 0]);
      window.dispatchEvent(pointer('pointermove', 100, 100));
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBeCloseTo(20, 5);
    });

    it('does not start a body drag from a handle inside the rect', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });
      const handle = fixture.handle('nw');

      fixture.rectEl.appendChild(handle);
      handle.dispatchEvent(pointer('pointerdown', 0, 0));
      window.dispatchEvent(pointer('pointermove', 20, 0));
      window.dispatchEvent(pointer('pointerup', 20, 0));
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.y).toBeCloseTo(10, 5);
    });

    it('resizes only — rather than moving — when the drag starts on an edge handle', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      drag(fixture.handle('n'), [0, 0], [20, 0]);
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBe(10);
      expect(applied.y).toBe(10);
      expect(applied.w).toBe(50);
      expect(applied.h).toBe(50);
    });

    it('moves the rect by the pointer delta measured against a stage away from the origin', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 }, stage: OFFSET_STAGE });

      drag(fixture.rectEl, [140, 70], [160, 80]);
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBe(20);
      expect(applied.y).toBe(20);
      expect(applied.w).toBe(50);
      expect(applied.h).toBe(50);
    });

    it('resizes by the pointer delta measured against a stage away from the origin', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 }, stage: OFFSET_STAGE });

      drag(fixture.handle('se'), [140, 70], [160, 90]);
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.x).toBe(10);
      expect(applied.y).toBe(10);
      expect(applied.w).toBe(60);
      expect(applied.h).toBe(70);
    });

    it('claims the pointerdown on a handle and does not let it reach the rect', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });
      const reachedRect = vi.fn();
      const down = pointer('pointerdown', 0, 0);

      fixture.rectEl.addEventListener('pointerdown', reachedRect);
      fixture.handle('e').dispatchEvent(down);

      expect(down.defaultPrevented).toBe(true);
      expect(reachedRect).not.toHaveBeenCalled();
    });

    it('claims the pointerdown on the rect body', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });
      const down = pointer('pointerdown', 0, 0);

      fixture.rectEl.dispatchEvent(down);

      expect(down.defaultPrevented).toBe(true);
    });

    it('stops resizing from a handle once the pointer is released', () => {
      const fixture = mount({ initial: { x: 10, y: 10, w: 50, h: 50 } });

      drag(fixture.handle('e'), [0, 0], [20, 0]);
      window.dispatchEvent(pointer('pointermove', 60, 0));
      fixture.button('done').click();

      const applied = fixture.onApply.mock.calls[0][0] as ImageCrop;

      expect(applied.w).toBeCloseTo(60, 5);
    });
  });

  describe('unmounting', () => {
    it('removes the editor and stops listening for Enter', () => {
      const { container, unmount, onApply } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });

      unmount();

      expect(container.querySelector('.blok-image-crop-editor')).toBeNull();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(onApply).not.toHaveBeenCalled();
    });

    it('stops listening to the image once unmounted', () => {
      const fixture = mount({ initial: { x: 0, y: 0, w: 50, h: 50 } });

      Object.defineProperty(fixture.img, 'naturalWidth', { configurable: true, get: () => 200 });
      Object.defineProperty(fixture.img, 'naturalHeight', { configurable: true, get: () => 100 });

      fixture.unmount();
      fixture.img.dispatchEvent(new Event('load'));

      expect(fixture.pill.textContent).toBe('');
    });

    it('stops the ratio chips from navigating on arrow keys once unmounted', () => {
      const fixture = mount();

      expect(fixture.chip('1').getAttribute('data-active')).toBe('false');

      fixture.unmount();
      fixture.chip('free').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );

      expect(fixture.chip('1').getAttribute('data-active')).toBe('false');
    });
  });
});
