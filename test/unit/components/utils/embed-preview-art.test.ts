import { describe, it, expect } from 'vitest';
import { embedPreviewSvg, EMBED_SCENE_KINDS } from '../../../../src/components/utils/media-preview-art';

const render = (kind: (typeof EMBED_SCENE_KINDS)[number]): HTMLElement => {
  const stage = document.createElement('span');

  stage.innerHTML = embedPreviewSvg(kind);

  return stage;
};

const byHref = (stage: HTMLElement, use: Element | null): Element | null => {
  const id = use?.getAttribute('href')?.slice(1);

  return id ? stage.querySelector(`[id="${id}"]`) : null;
};

const depthOf = (el: Element | null): number => {
  const layer = el?.closest<SVGElement>('.blok-media-preview__layer');

  return layer ? parseFloat(layer.style.getPropertyValue('--d')) : Number.NaN;
};

describe('embed preview scenes', () => {
  it('draws a scene for every kind the embed window can show', () => {
    expect([...EMBED_SCENE_KINDS].sort()).toEqual([
      'audio', 'calendar', 'chart', 'code', 'design', 'document', 'form',
      'generic', 'idle', 'image', 'map', 'social', 'table', 'video',
    ]);
  });

  it.each(EMBED_SCENE_KINDS)('%s sits on the 200x120 media preview canvas', (kind) => {
    const svg = render(kind).querySelector('svg');

    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 120');
  });

  it.each(EMBED_SCENE_KINDS)('%s casts its floor shadows from a body inside a layer', (kind) => {
    const stage = render(kind);
    const casts = Array.from(stage.querySelectorAll('.blok-media-preview__ground use'));

    expect(casts).toHaveLength(2);
    for (const cast of casts) {
      const body = byHref(stage, cast);

      expect(body?.closest('.blok-media-preview__layer')).not.toBeNull();
    }
  });

  it.each(EMBED_SCENE_KINDS)('%s floats a part above the layer that catches its shadow', (kind) => {
    const stage = render(kind);
    const drop = stage.querySelector('use.blok-media-preview__drop');

    expect(depthOf(byHref(stage, drop))).toBeGreaterThan(depthOf(drop));
  });

  // media-preview-3d.ts samples each shape as one outline and would join subpaths.
  it.each(EMBED_SCENE_KINDS)('%s draws every path as a single outline', (kind) => {
    const paths = Array.from(render(kind).querySelectorAll('path'));

    for (const path of paths) {
      expect(path.getAttribute('d')?.match(/m/gi) ?? []).toHaveLength(1);
    }
  });

  const num = (el: Element | null, name: string): number => parseFloat(el?.getAttribute(name) ?? 'NaN');

  const floatCircle = (stage: HTMLElement): { cx: number; cy: number; r: number } => {
    const circle = stage.querySelector('[id$="-f"] > circle.blok-media-preview__frame');

    return { cx: num(circle, 'cx'), cy: num(circle, 'cy'), r: num(circle, 'r') };
  };

  // A badge that almost touches the card edge reads as a mistake, so it must hang clearly over the corner.
  it('generic hangs its round badge over the card corner', () => {
    const stage = render('generic');
    const card = stage.querySelector('[id$="-s"]');
    const { cx, cy, r } = floatCircle(stage);

    expect(cx + r - (num(card, 'x') + num(card, 'width'))).toBeGreaterThanOrEqual(6);
    expect(cy + r - (num(card, 'y') + num(card, 'height'))).toBeGreaterThanOrEqual(6);
  });

  it('social keeps the heart button inside the post card, off its edges', () => {
    const stage = render('social');
    const card = stage.querySelector('[id$="-s"]');
    const { cx, cy, r } = floatCircle(stage);

    expect(cx - r - num(card, 'x')).toBeGreaterThanOrEqual(4);
    expect(cy - r - num(card, 'y')).toBeGreaterThanOrEqual(4);
    expect(num(card, 'x') + num(card, 'width') - (cx + r)).toBeGreaterThanOrEqual(4);
    expect(num(card, 'y') + num(card, 'height') - (cy + r)).toBeGreaterThanOrEqual(4);
  });

  it('social tucks the heart button into the card\'s bottom corner, past the picture\'s edge', () => {
    const stage = render('social');
    const card = stage.querySelector('[id$="-s"]');
    const picture = stage.querySelector('rect.blok-media-preview__screen');
    const { cx, cy, r } = floatCircle(stage);
    const rightGap = num(card, 'x') + num(card, 'width') - (cx + r);
    const bottomGap = num(card, 'y') + num(card, 'height') - (cy + r);

    expect(cx + r).toBeGreaterThan(num(picture, 'x') + num(picture, 'width'));
    expect(rightGap).toBe(bottomGap);
  });

  it('social keeps the heart badge clear of the picture and the text', () => {
    const stage = render('social');
    const { cx, cy, r } = floatCircle(stage);
    const parts = Array.from(stage.querySelectorAll('rect.blok-media-preview__screen, rect.blok-media-preview__line'));

    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const nearX = Math.min(Math.max(cx, num(part, 'x')), num(part, 'x') + num(part, 'width'));
      const nearY = Math.min(Math.max(cy, num(part, 'y')), num(part, 'y') + num(part, 'height'));

      expect(Math.hypot(cx - nearX, cy - nearY)).toBeGreaterThanOrEqual(r + 3);
    }
  });

  it('social draws its picture like the image scene: two hills, a sun and an edge on top', () => {
    const stage = render('social');

    expect(stage.querySelectorAll('.blok-media-preview__hill')).toHaveLength(2);
    expect(stage.querySelector('.blok-media-preview__sun')).not.toBeNull();
    expect(stage.querySelector('.blok-media-preview__screen-edge')).not.toBeNull();
  });

  interface Box { left: number; top: number; right: number; bottom: number }

  const boxOf = (el: Element | null): Box => ({
    left: num(el, 'x'),
    top: num(el, 'y'),
    right: num(el, 'x') + num(el, 'width'),
    bottom: num(el, 'y') + num(el, 'height'),
  });

  const floatTile = (stage: HTMLElement): Box => boxOf(stage.querySelector('[id$="-f"] > rect.blok-media-preview__frame'));

  // A tile that almost touches the card edge reads as a mistake: it sits inside, off the edges.
  it.each(['form', 'code'] as const)('%s keeps its floating tile inside the card, with the same gap to the side and the bottom', (kind) => {
    const stage = render(kind);
    const card = boxOf(stage.querySelector('[id$="-s"]'));
    const tile = floatTile(stage);

    expect(card.right - tile.right).toBeGreaterThanOrEqual(5);
    expect(card.bottom - tile.bottom).toBe(card.right - tile.right);
  });

  it('form keeps the tick tile clear of the fields and the button', () => {
    const stage = render('form');
    const tile = floatTile(stage);
    const parts = Array.from(stage.querySelectorAll('rect.blok-media-preview__screen, rect.blok-media-preview__button')).map(boxOf);

    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const apart = part.right + 4 <= tile.left || tile.right + 4 <= part.left || part.bottom + 4 <= tile.top || tile.bottom + 4 <= part.top;

      expect(apart).toBe(true);
    }
  });

  it('design draws no tag beside the pointer', () => {
    expect(render('design').querySelector('.blok-media-preview__tag')).toBeNull();
  });

  it('calendar opens the event chip right under its day, inside the card', () => {
    const stage = render('calendar');
    const card = boxOf(stage.querySelector('[id$="-s"]'));
    const day = boxOf(stage.querySelector('.blok-media-preview__layer > rect.blok-media-preview__glyph'));
    const chip = floatTile(stage);

    expect(chip.top - day.bottom).toBeGreaterThanOrEqual(2);
    expect(chip.top - day.bottom).toBeLessThanOrEqual(5);
    expect(chip.left).toBeLessThanOrEqual(day.left);
    expect(chip.right).toBeGreaterThan(day.right);
    expect(card.right - chip.right).toBeGreaterThanOrEqual(5);
    expect(card.bottom - chip.bottom).toBeGreaterThanOrEqual(5);
  });

  // Roads and the park are clipped on the screen's edge line, so they cover the inner half of its outline.
  it('map draws the screen outline again over the roads', () => {
    const stage = render('map');
    const clipped = stage.querySelector('g[clip-path]');
    const edge = stage.querySelector('.blok-media-preview__screen-edge');

    expect(edge).not.toBeNull();
    expect(clipped?.compareDocumentPosition(edge as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(boxOf(edge)).toEqual(boxOf(stage.querySelector('rect.blok-media-preview__screen')));
  });

  it.each(EMBED_SCENE_KINDS)('%s gives its ids a per-instance suffix', (kind) => {
    const ids = [render(kind), render(kind)]
      .flatMap((stage) => Array.from(stage.querySelectorAll('[id]')).map((el) => el.id));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
