import { describe, it, expect } from 'vitest';
import { makePreview } from '../../../../src/components/utils/media-empty-preview';

describe('file preview drawing', () => {
  it('fans out three different kinds of file: a spreadsheet, a slide and a document', () => {
    const stage = makePreview('file');

    expect(stage.querySelectorAll('.blok-media-preview__sheet--back .blok-media-preview__cell').length).toBeGreaterThanOrEqual(4);
    expect(stage.querySelectorAll('.blok-media-preview__sheet--mid .blok-media-preview__chart-bar').length).toBeGreaterThanOrEqual(3);
    const front = stage.querySelector('.blok-media-preview__sheet--front');
    expect(front?.querySelector('.blok-media-preview__line--title')).not.toBeNull();
    expect(front?.querySelectorAll('.blok-media-preview__line--write').length).toBeGreaterThanOrEqual(4);
    expect(front?.querySelector('.blok-media-preview__chip')).not.toBeNull();
  });

  it('folds the corner down as a dog-ear that casts a soft shadow along the crease', () => {
    const stage = makePreview('file');
    const front = stage.querySelector('.blok-media-preview__sheet--front');
    const crease = front?.querySelector('.blok-media-preview__crease');
    const filterId = crease?.getAttribute('filter')?.match(/#([^)]+)/)?.[1];

    expect(front?.querySelector('.blok-media-preview__flap')).not.toBeNull();
    expect(filterId && stage.querySelector(`filter[id="${filterId}"]`)).toBeTruthy();
  });

  it('numbers the lines so they write in one after another', () => {
    const stage = makePreview('file');
    const rows = Array.from(stage.querySelectorAll<SVGElement>('.blok-media-preview__line--write'))
      .map((line) => line.style.getPropertyValue('--row'));

    expect(rows).toEqual(rows.map((_, i) => String(i)));
  });
});
