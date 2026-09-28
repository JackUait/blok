import { describe, it, expect } from 'vitest';
import { makePreview } from '../../../../src/components/utils/media-empty-preview';

const KINDS = ['video', 'audio', 'image', 'file'] as const;

const byHref = (stage: HTMLElement, use: Element | null): Element | null => {
  const id = use?.getAttribute('href')?.slice(1);
  return id ? stage.querySelector(`[id="${id}"]`) : null;
};

const depthOf = (el: Element | null): number => {
  const layer = el?.closest<SVGElement>('.blok-media-preview__layer');
  return layer ? parseFloat(layer.style.getPropertyValue('--d')) : Number.NaN;
};

describe('media preview shadows', () => {
  it.each(KINDS)('%s casts a contact and an ambient shadow from its own outline', (kind) => {
    const stage = makePreview(kind);
    const casts = Array.from(stage.querySelectorAll('.blok-media-preview__ground use'));

    expect(casts).toHaveLength(2);
    for (const cast of casts) {
      const body = byHref(stage, cast);
      expect(body).not.toBeNull();
      expect(body?.closest('.blok-media-preview__ground')).toBeNull();
      expect(body?.closest('.blok-media-preview__layer')).not.toBeNull();
    }
  });

  it.each(KINDS)('%s drops a shadow from its floating part onto the layer below it', (kind) => {
    const stage = makePreview(kind);
    const drop = stage.querySelector('use.blok-media-preview__drop');
    const part = byHref(stage, drop);

    expect(part).not.toBeNull();
    expect(depthOf(part)).toBeGreaterThan(depthOf(drop));
  });

  it('gives every shadow filter an id of its own, so two previews never share one', () => {
    const ids = [makePreview('video'), makePreview('video')]
      .flatMap((stage) => Array.from(stage.querySelectorAll('filter')).map((f) => f.id));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
