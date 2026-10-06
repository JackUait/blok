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

  it.each(EMBED_SCENE_KINDS)('%s gives its ids a per-instance suffix', (kind) => {
    const ids = [render(kind), render(kind)]
      .flatMap((stage) => Array.from(stage.querySelectorAll('[id]')).map((el) => el.id));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
