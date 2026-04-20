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

  it('renders 6 segmented ratio chips with Free active by default', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const group = container.querySelector<HTMLElement>('[data-action="ratio"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    const chips = group.querySelectorAll<HTMLButtonElement>('[role="radio"][data-ratio]');
    expect(chips).toHaveLength(6);
    const keys = Array.from(chips).map((c) => c.getAttribute('data-ratio'));
    expect(keys).toEqual(['free', '1', String(4 / 3), String(16 / 9), 'circle', 'ellipse']);
    const active = group.querySelectorAll('[role="radio"][data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('data-ratio')).toBe('free');
    expect(active[0].getAttribute('aria-checked')).toBe('true');
  });

  it('does not render apply/cancel kbd hint', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    expect(container.querySelector('.blok-image-crop-editor__kbd-hint')).toBeNull();
  });

  it('clicking Circle chip activates it and emits shape=circle on apply', () => {
    const onApply = vi.fn();
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply,
      onCancel: () => {},
    });
    const chip = container.querySelector<HTMLButtonElement>('[data-ratio="circle"]')!;
    chip.click();
    expect(chip.getAttribute('data-active')).toBe('true');
    expect(chip.getAttribute('aria-checked')).toBe('true');
    container.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0];
    expect(arg).toMatchObject({ shape: 'circle' });
  });

  it('clicking Oval chip emits shape=ellipse on apply', () => {
    const onApply = vi.fn();
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply,
      onCancel: () => {},
    });
    const chip = container.querySelector<HTMLButtonElement>('[data-ratio="ellipse"]')!;
    chip.click();
    expect(chip.getAttribute('data-active')).toBe('true');
    container.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0];
    expect(arg).toMatchObject({ shape: 'ellipse' });
  });

  it('clicking Free chip after Circle drops shape from payload', () => {
    const onApply = vi.fn();
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply,
      onCancel: () => {},
    });
    container.querySelector<HTMLButtonElement>('[data-ratio="circle"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-ratio="free"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-action="done"]')!.click();
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('restores circle shape from initial', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      initial: { x: 25, y: 25, w: 50, h: 50, shape: 'circle' },
      onApply: () => {},
      onCancel: () => {},
    });
    const active = container.querySelector('[data-ratio="circle"][data-active="true"]');
    expect(active).not.toBeNull();
  });

  it('rect preview has data-shape attribute matching selected shape chip', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const rect = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect')!;
    expect(rect.getAttribute('data-shape')).toBe('rect');
    container.querySelector<HTMLButtonElement>('[data-ratio="circle"]')!.click();
    expect(rect.getAttribute('data-shape')).toBe('circle');
    container.querySelector<HTMLButtonElement>('[data-ratio="ellipse"]')!.click();
    expect(rect.getAttribute('data-shape')).toBe('ellipse');
    container.querySelector<HTMLButtonElement>('[data-ratio="free"]')!.click();
    expect(rect.getAttribute('data-shape')).toBe('rect');
  });

  it('renders inner shape-mask overlay element inside rect for corner coverage', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const rect = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect')!;
    const shapeMask = rect.querySelector<HTMLElement>('.blok-image-crop-editor__shape-mask');
    expect(shapeMask).not.toBeNull();
  });

  it('rect preview is round when mounted with initial shape circle', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      initial: { x: 10, y: 10, w: 60, h: 60, shape: 'circle' },
      onApply: () => {},
      onCancel: () => {},
    });
    const rect = container.querySelector<HTMLElement>('.blok-image-crop-editor__rect')!;
    expect(rect.getAttribute('data-shape')).toBe('circle');
  });

  it('clicking a ratio chip moves the active state to that chip', () => {
    detach = mountCropEditor(container, {
      url: 'x.png',
      onApply: () => {},
      onCancel: () => {},
    });
    const chip = container.querySelector<HTMLButtonElement>('[role="radio"][data-ratio="1"]')!;
    chip.click();
    expect(chip.getAttribute('data-active')).toBe('true');
    expect(chip.getAttribute('aria-checked')).toBe('true');
    const active = container.querySelectorAll('[role="radio"][data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(chip);
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
