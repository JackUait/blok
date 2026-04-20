import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountCropEditor } from '../../../../src/tools/image/crop-editor';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function setNatural(img: HTMLImageElement, w: number, h: number): void {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
}

describe('crop-editor', () => {
  let container: HTMLElement;
  let detach: (() => void) | null;

  beforeEach(() => {
    container = makeContainer();
    detach = null;
  });

  afterEach(() => {
    detach?.();
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders 8 handles with unique data-handle values', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const handles = container.querySelectorAll('[data-handle]');
    expect(handles).toHaveLength(8);
    const names = Array.from(handles).map((h) => h.getAttribute('data-handle'));
    expect(new Set(names).size).toBe(8);
    expect(names.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('corner handles contain bracket stroke children; edge handles do not', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const getH = (h: string): HTMLElement =>
      container.querySelector<HTMLElement>(`[data-handle="${h}"]`)!;
    for (const corner of ['nw', 'ne', 'se', 'sw']) {
      const strokes = getH(corner).querySelectorAll('.blok-image-crop-editor__handle-stroke');
      expect(strokes, `corner ${corner}`).toHaveLength(2);
    }
    for (const edge of ['n', 'e', 's', 'w']) {
      const strokes = getH(edge).querySelectorAll('.blok-image-crop-editor__handle-stroke');
      expect(strokes, `edge ${edge}`).toHaveLength(0);
    }
  });

  it('renders 4 rule-of-thirds grid lines inside the crop rect', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const rect = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect')!;
    const lines = rect.querySelectorAll('.blok-image-crop-editor__grid-line');
    expect(lines).toHaveLength(4);
  });

  it('size pill is hidden before the image loads and shows pixel dimensions after load', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const pill = container.querySelector<HTMLElement>('.blok-image-crop-editor__size-pill')!;
    expect(pill).not.toBeNull();
    expect(pill.hidden).toBe(true);

    const img = container.querySelector<HTMLImageElement>('.blok-image-crop-editor__source')!;
    setNatural(img, 2000, 1000);
    img.dispatchEvent(new Event('load'));

    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('2000 × 1000 px');
  });

  it('size pill updates when the crop rect changes', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      initial: { x: 0, y: 0, w: 50, h: 25 },
      onApply: () => {},
      onCancel: () => {},
    });
    const pill = container.querySelector<HTMLElement>('.blok-image-crop-editor__size-pill')!;
    const img = container.querySelector<HTMLImageElement>('.blok-image-crop-editor__source')!;
    setNatural(img, 2000, 1000);
    img.dispatchEvent(new Event('load'));
    expect(pill.textContent).toBe('1000 × 250 px');
  });

  it('ratio menu marks the active option with a checkmark', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const trigger = container.querySelector<HTMLButtonElement>('[data-action="ratio"]')!;
    trigger.click();

    const activeBtns = container.querySelectorAll(
      '[role="menuitem"][data-active="true"]'
    );
    expect(activeBtns).toHaveLength(1);
    expect(activeBtns[0].querySelector('.blok-image-crop-editor__ratio-check')).not.toBeNull();
    expect(activeBtns[0].getAttribute('data-ratio')).toBe('free');
  });

  it('ratio menu trigger uses an inline chevron svg, not the ▾ character', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const trigger = container.querySelector<HTMLButtonElement>('[data-action="ratio"]')!;
    expect(trigger.textContent).not.toContain('▾');
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('toolbar is a direct child of the editor root and carries the footer modifier', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const root = container.querySelector<HTMLElement>('.blok-image-crop-editor')!;
    const stage = container.querySelector<HTMLElement>('.blok-image-crop-editor__stage')!;
    const toolbar = container.querySelector<HTMLElement>('.blok-image-crop-editor__toolbar')!;
    expect(toolbar.parentElement).toBe(root);
    expect(stage.contains(toolbar)).toBe(false);
    expect(toolbar.classList.contains('blok-image-crop-editor__toolbar--footer')).toBe(true);
  });
});
