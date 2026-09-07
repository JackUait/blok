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
  onApply: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  unmount: () => void;
  button: (action: string) => HTMLButtonElement;
  handle: (name: string) => HTMLElement;
}

/** The frame is measured for every drag; jsdom reports a zero box without this. */
const STAGE = { left: 0, top: 0, width: 200, height: 100 };

const mount = ({ initial = undefined as ImageCrop | undefined } = {}): Mounted => {
  const container = document.createElement('div');

  document.body.appendChild(container);

  const onApply = vi.fn();
  const onCancel = vi.fn();
  const unmount = mountCropEditor(container, {
    url: 'https://example.test/i.png',
    alt: 'a picture',
    initial,
    onApply,
    onCancel,
    i18n: echoI18n(),
  });

  const root = container.querySelector<HTMLElement>('.blok-image-crop-editor');
  const frame = container.querySelector<HTMLElement>('.blok-image-crop-editor__frame');
  const rectEl = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect');

  if (root === null || frame === null || rectEl === null) {
    throw new Error('the crop editor did not mount');
  }

  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
    ...STAGE,
    right: STAGE.left + STAGE.width,
    bottom: STAGE.top + STAGE.height,
    x: STAGE.left,
    y: STAGE.top,
    toJSON: () => STAGE,
  });

  return {
    container,
    root,
    frame,
    rectEl,
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
  });

  describe('unmounting', () => {
    it('removes the editor and stops listening for Enter', () => {
      const { container, unmount, onApply } = mount({ initial: { x: 10, y: 20, w: 50, h: 40 } });

      unmount();

      expect(container.querySelector('.blok-image-crop-editor')).toBeNull();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(onApply).not.toHaveBeenCalled();
    });
  });
});
