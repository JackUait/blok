import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderVideoPreview } from '../../../../src/tools/video/preview';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/block-preview/media.css'), 'utf8');
const MOTION = '@media (prefers-reduced-motion: no-preference)';
const motion = css.slice(css.indexOf(MOTION));
const still = css.slice(0, css.indexOf(MOTION));

const ruleFor = (part: string, pseudo = ''): RegExp =>
  new RegExp(`\\[data-blok-preview='video'\\] \\[data-part='${part}'\\]${pseudo}[^{]*\\{([^}]*)\\}`);

const motionRule = (part: string, pseudo = ''): string => motion.match(ruleFor(part, pseudo))?.[1] ?? '';

const partsOf = (root: HTMLElement): string[] =>
  [...new Set([...root.querySelectorAll('svg [data-part]')].map((el) => el.getAttribute('data-part') ?? ''))];

describe('video toolbox preview', () => {
  // An SVG shape with no rule paints solid black in both themes.
  it('gives every drawn part a fill or stroke rule', () => {
    partsOf(renderVideoPreview()).forEach((part) => {
      expect(still, part).toContain(`[data-blok-preview='video'] [data-part='${part}']`);
    });
  });

  it('shows the elapsed time apart from the duration, so the clock can run', () => {
    const preview = renderVideoPreview();

    expect(preview.querySelector("[data-part='elapsed']")).not.toBeNull();
    expect(preview.querySelector("[data-part='duration']")?.textContent).toBe('0:24');
  });
});

describe('video toolbox preview motion', () => {
  it.each([ 'star', 'moon', 'cloud', 'meteor', 'dune', 'dune-far' ])(
    'moves the %s in the scene only when motion is allowed',
    (part) => {
      expect(motionRule(part)).toContain('animation:');
      expect(still).not.toMatch(new RegExp(`${ruleFor(part).source.replace('([^}]*)', '[^}]*animation:')}`));
    }
  );

  it.each([ 'fill', 'head' ])('keeps the %s of the progress bar moving, playing on loop', (part) => {
    expect(motionRule(part)).toMatch(/animation:[^;]*\blinear\b[^;]*\binfinite\b/);
  });

  it('ticks the elapsed time once a second', () => {
    expect(motionRule('elapsed')).toMatch(/animation:[^;]*\bsteps\(24\)[^;]*\binfinite\b/);
    expect(css).toMatch(/\[data-part='elapsed'\]::before[^{]*\{[^}]*content:[^;]*counter\(/);
  });
});
