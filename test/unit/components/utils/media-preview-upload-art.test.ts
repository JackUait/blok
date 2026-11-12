/**
 * Each drawing shows an upload in its own way: the picture scans in, the video
 * is scrubbed, the wave is drawn, the file arrives in pieces.
 */
import { describe, it, expect } from 'vitest';
import postcss from 'postcss';

import { clearPreviewProgress, makePreview, setPreviewProgress } from '../../../../src/components/utils/media-empty-preview';
import { readMainCss } from '../../styles/helpers/read-main-css';

const part = (name: string): string => `.blok-media-preview__${name}`;
const box = (el: Element | null): Array<string | null> => ['x', 'y', 'width', 'height'].map((attr) => el?.getAttribute(attr) ?? null);

describe('upload parts in the drawings', () => {
  it('image: a veil over the picture and a scan line across its top edge', () => {
    const stage = makePreview('image');

    expect(box(stage.querySelector(`${part('photo')} ${part('veil')}`))).toEqual(['42', '14', '120', '70']);
    expect(box(stage.querySelector(`${part('photo')} ${part('scan')}`))).toEqual(['42', '13.5', '120', '2']);
  });

  it('video: a veil over the screen and a playhead at its left edge', () => {
    const stage = makePreview('video');

    expect(box(stage.querySelector(part('veil')))).toEqual(['32', '16', '136', '62']);
    expect(box(stage.querySelector(part('playhead')))).toEqual(['31.5', '16', '2', '62']);
  });

  it('audio: the two title lines can write in, in order', () => {
    const rows = Array.from(makePreview('audio').querySelectorAll<SVGElement>(part('line--write')))
      .map((line) => line.style.getPropertyValue('--row'));

    expect(rows).toEqual(['0', '1']);
  });

  it('file: a 5x5 grid of pieces on the front page, numbered in reading order', () => {
    const stage = makePreview('file');
    const chunks = Array.from(stage.querySelectorAll<SVGElement>(`${part('sheet--front')} ${part('chunks')} ${part('chunk')}`));

    expect(chunks).toHaveLength(25);
    expect(chunks.map((chunk) => chunk.style.getPropertyValue('--n'))).toEqual(chunks.map((_, n) => String(n)));
    expect(box(chunks[0])).toEqual(['78', '42', '7', '7']);
    expect(box(chunks[6])).toEqual(['87.75', '52', '7', '7']);
    expect(box(chunks[24])).toEqual(['117', '82', '7', '7']);
  });

  it('file: the written lines and the badge are one group, so they can step aside for the pieces', () => {
    const text = makePreview('file').querySelector(`${part('sheet--front')} ${part('page-text')}`);

    expect(text?.querySelectorAll(part('line--write'))).toHaveLength(4);
    expect(text?.querySelector(part('chip'))).not.toBeNull();
  });

  it('file: the page no longer fills with a wash', () => {
    expect(makePreview('file').querySelector(part('fill'))).toBeNull();
  });

  it.each(['image', 'video', 'audio', 'file'] as const)('%s: every shape is one outline, as the 3D drawing needs', (kind) => {
    const paths = Array.from(makePreview(kind).querySelectorAll('path')).map((path) => path.getAttribute('d') ?? '');

    expect(paths.filter((d) => (d.match(/m/gi) ?? []).length > 1)).toEqual([]);
  });
});

describe('upload progress on a drawing', () => {
  it('marks the drawing done at 100% and only then', () => {
    const stage = makePreview('file');

    setPreviewProgress(stage, 99.4);
    expect(stage.hasAttribute('data-done')).toBe(false);

    setPreviewProgress(stage, 100);
    expect(stage.hasAttribute('data-done')).toBe(true);
    expect(stage.style.getPropertyValue('--blok-media-progress')).toBe('1');

    setPreviewProgress(stage, 40);
    expect(stage.hasAttribute('data-done')).toBe(false);
  });

  it('clears the done mark with the progress', () => {
    const stage = makePreview('image');

    setPreviewProgress(stage, 100);
    clearPreviewProgress(stage);

    expect(stage.hasAttribute('data-done')).toBe(false);
    expect(stage.hasAttribute('data-uploading')).toBe(false);
  });
});

describe('upload animations (CSS)', () => {
  const root = postcss.parse(readMainCss());
  const decl = (match: (selector: string) => boolean, prop: string): string => {
    const values: string[] = [];
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' || !rule.selector.split(',').some((s) => match(s.trim()))) return;
      rule.walkDecls(prop, (d) => {
        values.push(d.value.replace(/\s+/g, ' '));
      });
    });
    return values.join(' | ');
  };
  const uploading = (kind: string, name: string) => (selector: string): boolean =>
    selector.includes('[data-uploading]') && !selector.includes('[data-done]') && selector.includes(`[data-blok-media-preview="${kind}"]`) && selector.endsWith(part(name));

  it('hides the upload parts at rest', () => {
    expect(decl((s) => s === part('scan') || s === part('playhead'), 'opacity')).toBe('0');
    expect(decl((s) => s === part('chunks'), 'opacity')).toBe('0');
    expect(decl((s) => s === `[data-blok-media-preview="image"] ${part('veil')}`, 'transform')).toBe('scaleY(0)');
    expect(decl((s) => s === `[data-blok-media-preview="video"] ${part('veil')}`, 'transform')).toBe('scaleX(0)');
  });

  it('image: the veil shrinks down the picture behind an accent scan line', () => {
    expect(decl(uploading('image', 'veil'), 'transform')).toBe('scaleY(calc(1 - var(--p)))');
    expect(decl((s) => s === `[data-blok-media-preview="image"] ${part('veil')}`, 'transform-origin')).toBe('50% 100%');
    expect(decl(uploading('image', 'scan'), 'transform')).toBe('translateY(calc(var(--p) * 69px))');
    expect(decl((s) => s === part('scan'), 'fill')).toBe('var(--blok-color-accent)');
    expect(decl(uploading('image', 'scene'), 'opacity')).toBe('1');
  });

  it('video: a playhead crosses the screen, the picture appears behind it, and the play button waits', () => {
    expect(decl(uploading('video', 'veil'), 'transform')).toBe('scaleX(calc(1 - var(--p)))');
    expect(decl((s) => s === `[data-blok-media-preview="video"] ${part('veil')}`, 'transform-origin')).toBe('100% 50%');
    expect(decl(uploading('video', 'playhead'), 'transform')).toBe('translateX(calc(var(--p) * 135px))');
    expect(decl(uploading('video', 'knob-group'), 'opacity')).toBe('0');
    // the hidden button must not leave its shadow on the screen
    expect(decl(uploading('video', 'drop'), 'opacity')).toBe('0');
    expect(decl(uploading('video', 'scene'), 'opacity')).toBe('1');
  });

  it('audio: bars are drawn from dots, and stop breathing', () => {
    expect(decl(uploading('audio', 'bar'), 'transform')).toBe('scaleY(calc(0.1 + var(--lit) * 0.9))');
    expect(decl(uploading('audio', 'bar'), 'animation')).toBe('none');
    expect(decl(uploading('audio', 'bar'), 'fill')).toContain('var(--blok-color-accent)');
  });

  it('file: the text steps aside, the pieces fill in, and the sheets stay where they are', () => {
    expect(decl(uploading('file', 'line--write'), 'transform')).toBe('none');
    expect(decl(uploading('file', 'chunk'), 'transform')).toBe('scale(calc(0.45 + var(--lit) * 0.55))');
    expect(decl(uploading('file', 'chunk'), 'fill')).toContain('var(--blok-color-accent)');
    expect(decl(uploading('file', 'chunks'), 'opacity')).toContain('var(--p)');
    expect(decl(uploading('file', 'page-text'), 'opacity')).toContain('var(--p)');
    expect(decl((s) => s.includes('[data-uploading]') && /sheet--(back|mid)/.test(s), 'transform')).toBe('');
  });

  it('lands with one bounce when the upload is done', () => {
    expect(decl((s) => s.includes('[data-done]') && s.includes('"audio"') && s.endsWith(part('bar')), 'fill')).toBe('currentColor');
    expect(decl((s) => s.includes('[data-done]') && s.includes('"video"') && s.endsWith(part('knob-group')), 'opacity')).toBe('1');
    expect(decl((s) => s === '.blok-media-preview[data-uploading][data-done]', 'animation')).toContain('blok-media-preview-land');
  });

  it('leaves the other drawings (embed scenes, search) on the shared rules', () => {
    expect(decl((s) => s === `.blok-media-preview[data-uploading] ${part('line--write')}`, 'transform')).toContain('var(--row)');
    expect(decl((s) => s === `.blok-media-preview[data-uploading] ${part('scene')}`, 'opacity')).toContain('var(--p)');
  });
});
