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

// Groups only place and move; shapes are what paint.
const partsOf = (root: HTMLElement): string[] =>
  [...new Set([...root.querySelectorAll('svg [data-part]:not(g)')].map((el) => el.getAttribute('data-part') ?? ''))];

describe('video toolbox preview', () => {
  // An SVG shape with no rule paints solid black in both themes.
  it('gives every drawn part a fill or stroke rule', () => {
    partsOf(renderVideoPreview()).forEach((part) => {
      expect(still, part).toContain(`[data-blok-preview='video'] [data-part='${part}']`);
    });
  });

  it('draws a night caravan crossing the dunes to a lit oasis camp', () => {
    expect(partsOf(renderVideoPreview())).toEqual(expect.arrayContaining([
      'milky-way',
      'sparkle',
      'crater',
      'halo',
      'bat-wing',
      'mesa',
      'mesa-rim',
      'mesa-lit',
      'mesa-cap',
      'mesa-gully',
      'talus',
      'spire',
      'mesa-distant',
      'haze',
      'ridge',
      'camel',
      'leg',
      'rider',
      'trunk',
      'frond',
      'pond',
      'reflection',
      'tent',
      'tent-door',
      'flame',
      'ember',
      'tuft',
      'dune-crest',
      'wind-ripple',
      'spindrift-streak',
      'twig',
      'tent-lit',
      'guy-rope',
      'stone',
      'flame-mid',
      'puff',
      'fire-rim',
      'saddle',
      'scarf',
      'lantern-glow',
      'trunk-ring',
      'bush',
      'cattail',
      'pond-bank',
      'glint',
    ]));
  });

  it('places animated figures from an outer group, so the motion never drops their position', () => {
    const preview = renderVideoPreview();

    [ 'caravan', 'crown', 'bat', 'flame' ].forEach((part) => {
      preview.querySelectorAll(`[data-part='${part}']`).forEach((el) => {
        expect(el.hasAttribute('transform'), part).toBe(false);
      });
    });
  });

  // A repeating grain pattern reads as dotted UI chrome, not sand.
  it('blows sand as wisps off the crest, not a marching dot pattern', () => {
    const preview = renderVideoPreview();

    expect(preview.querySelector("[data-part='sand-grain']")).toBeNull();
    expect(preview.querySelectorAll("[data-part='spindrift']").length).toBeGreaterThanOrEqual(4);
  });

  // Ruler-straight strata across a box read as a drawing of a shelf, not rock.
  it('breaks the strata into uneven pieces', () => {
    const strata = renderVideoPreview().querySelector("[data-part='mesa-strata']")?.getAttribute('d') ?? '';
    const lengths = [...strata.matchAll(/H(-?[\d.]+)/g)].length;

    expect(lengths).toBe(0);
    expect(strata.split('M').length - 1).toBeGreaterThanOrEqual(12);
  });

  it('shows the elapsed time apart from the duration, so the clock can run', () => {
    const preview = renderVideoPreview();

    expect(preview.querySelector("[data-part='elapsed']")).not.toBeNull();
    expect(preview.querySelector("[data-part='duration']")?.textContent).toBe('0:24');
  });
});

describe('video toolbox preview motion', () => {
  it.each([
    'star', 'sparkle', 'moon', 'cloud', 'meteor', 'bat', 'bat-wing', 'caravan', 'leg', 'lantern',
    'crown', 'flame', 'flame-mid', 'fire-glow', 'ember', 'puff', 'scarf', 'glint', 'firefly', 'reflection', 'scrub', 'spindrift',
    'layer-horizon', 'layer-far', 'layer-mid', 'layer-near', 'layer-front',
  ])(
    'moves the %s in the scene only when motion is allowed',
    (part) => {
      expect(motionRule(part)).toContain('animation:');
      expect(still).not.toMatch(new RegExp(`${ruleFor(part).source.replace('([^}]*)', '[^}]*animation:')}`));
    }
  );

  // The card restarts its animation on every open, so the first seconds are all most people see.
  it.each([ 'meteor', 'bat', 'caravan' ])('has the %s already under way when the card opens', (part) => {
    expect(motionRule(part)).toMatch(/animation:[^;]*\s-\d|animation-delay:\s*calc\(-/);
  });

  // A one-way move that restarts with the clock reads as a camera; a ping-pong reads as a slide.
  it.each([ 'layer-horizon', 'layer-far', 'layer-mid', 'layer-near', 'layer-front', 'camera' ])(
    'moves the %s one way through the clip, starting on play',
    (part) => {
      const rule = motionRule(part);

      expect(rule).toMatch(/animation:[^;]*\b24s\b[^;]*\b1s\b[^;]*\binfinite\b/);
      expect(rule).not.toContain('alternate');
    }
  );

  it.each([ 'meteor', 'ember', 'puff', 'spindrift' ])('hides the %s in the still frame', (part) => {
    expect(still.match(ruleFor(part))?.[1]).toMatch(/opacity:\s*0;/);
  });

  // The flicker keyframes pin opacity to 1, which turns a faint glow into a solid disc.
  it.each([ 'lantern-glow', 'fire-glow' ])('never flickers the %s up to full opacity', (part) => {
    expect(motionRule(part)).not.toContain('blok-preview-media-flicker');
  });

  it.each([ 'fill', 'head' ])('keeps the %s of the progress bar moving, playing on loop', (part) => {
    expect(motionRule(part)).toMatch(/animation:[^;]*\blinear\b[^;]*\binfinite\b/);
  });

  it('ticks the elapsed time once a second', () => {
    expect(motionRule('elapsed')).toMatch(/animation:[^;]*\bsteps\(24\)[^;]*\binfinite\b/);
    expect(css).toMatch(/\[data-part='elapsed'\]::before[^{]*\{[^}]*content:[^;]*counter\(/);
  });
});
