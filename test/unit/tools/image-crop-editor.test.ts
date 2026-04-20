import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountCropEditor } from '../../../src/tools/image/crop-editor';

const stubRect = (): void => {
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
};

describe('mountCropEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    stubRect();
  });

  it('renders stage, rect, 8 handles, toolbar', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCropEditor(host, {
      url: 'x.png',
      initial: { x: 10, y: 10, w: 80, h: 80 },
      onApply: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(host.querySelector('.blok-image-crop-editor')).not.toBeNull();
    expect(host.querySelector('.blok-image-crop-editor__rect')).not.toBeNull();
    expect(host.querySelectorAll('[data-handle]')).toHaveLength(8);
    expect(host.querySelector('[data-action="done"]')).not.toBeNull();
    expect(host.querySelector('[data-action="cancel"]')).not.toBeNull();
    expect(host.querySelector('[data-action="reset"]')).not.toBeNull();
    expect(host.querySelector('[data-action="ratio"]')).not.toBeNull();
  });

  it('Done fires onApply with current rect', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onApply = vi.fn();
    mountCropEditor(host, {
      url: 'x.png',
      initial: { x: 10, y: 10, w: 80, h: 80 },
      onApply,
      onCancel: vi.fn(),
    });
    host.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 80, h: 80 });
  });

  it('Done with full rect fires onApply(null)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onApply = vi.fn();
    mountCropEditor(host, {
      url: 'x.png',
      onApply,
      onCancel: vi.fn(),
    });
    host.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Cancel fires onCancel, no apply', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onApply = vi.fn();
    const onCancel = vi.fn();
    mountCropEditor(host, { url: 'x.png', onApply, onCancel });
    host.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Reset restores full rect, then Done applies null', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onApply = vi.fn();
    mountCropEditor(host, {
      url: 'x.png',
      initial: { x: 20, y: 20, w: 50, h: 50 },
      onApply,
      onCancel: vi.fn(),
    });
    host.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Escape key triggers onCancel', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCancel = vi.fn();
    mountCropEditor(host, { url: 'x.png', onApply: vi.fn(), onCancel });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Enter key triggers onApply', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onApply = vi.fn();
    mountCropEditor(host, {
      url: 'x.png',
      initial: { x: 10, y: 10, w: 50, h: 50 },
      onApply,
      onCancel: vi.fn(),
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 50, h: 50 });
  });

  it('circle/ellipse shape-mask lives outside rectEl so corner handles are not clipped', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCropEditor(host, {
      url: 'x.png',
      onApply: vi.fn(),
      onCancel: vi.fn(),
    });
    host.querySelector<HTMLButtonElement>('[data-ratio="circle"]')!.click();

    const rectEl = host.querySelector('.blok-image-crop-editor__rect')!;
    const shapeMask = host.querySelector('.blok-image-crop-editor__shape-mask')!;
    expect(shapeMask).not.toBeNull();
    expect(rectEl.contains(shapeMask)).toBe(false);

    const frame = host.querySelector('.blok-image-crop-editor__frame')!;
    expect(frame.contains(shapeMask)).toBe(true);

    for (const h of ['nw', 'ne', 'se', 'sw'] as const) {
      const handle = host.querySelector(`[data-handle="${h}"]`)!;
      expect(rectEl.contains(handle)).toBe(true);
    }
  });

  it('edge pill handles visible only in freeform; corner handles always visible', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCropEditor(host, {
      url: 'x.png',
      onApply: vi.fn(),
      onCancel: vi.fn(),
    });

    const edgeHandles = ['n', 'e', 's', 'w'] as const;
    const cornerHandles = ['nw', 'ne', 'se', 'sw'] as const;

    for (const h of edgeHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(false);
    }

    host.querySelector<HTMLButtonElement>('[data-ratio="1"]')!.click();
    for (const h of edgeHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(true);
    }
    for (const h of cornerHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(false);
    }

    host.querySelector<HTMLButtonElement>('[data-ratio="circle"]')!.click();
    for (const h of edgeHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(true);
    }

    host.querySelector<HTMLButtonElement>('[data-ratio="ellipse"]')!.click();
    for (const h of edgeHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(false);
    }

    host.querySelector<HTMLButtonElement>('[data-ratio="free"]')!.click();
    for (const h of edgeHandles) {
      const el = host.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
      expect(el.hidden).toBe(false);
    }
  });

  it('size pill is anchored outside the rect (above top edge), not inside', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountCropEditor(host, {
      url: 'x.png',
      onApply: vi.fn(),
      onCancel: vi.fn(),
    });
    const rectEl = host.querySelector<HTMLElement>('.blok-image-crop-editor__rect')!;
    const pill = host.querySelector<HTMLElement>('.blok-image-crop-editor__size-pill')!;
    expect(rectEl.contains(pill)).toBe(false);
    const frame = host.querySelector<HTMLElement>('.blok-image-crop-editor__frame')!;
    expect(frame.contains(pill)).toBe(true);
  });

  it('detach removes editor and unbinds keys', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCancel = vi.fn();
    const detach = mountCropEditor(host, { url: 'x.png', onApply: vi.fn(), onCancel });
    detach();
    expect(host.querySelector('.blok-image-crop-editor')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
