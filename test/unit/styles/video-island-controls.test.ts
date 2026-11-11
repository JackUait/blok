/**
 * Island controls: the bar floats as one glass capsule inset from the frame
 * edges instead of a full-width dark scrim. jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(readFileSync(resolve(__dirname, '../../../src/styles/video.css'), 'utf-8'));
const colors = strip(readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf-8'));

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));

  return match?.[1] ?? '';
};

const T = '[data-blok-tool="video"]';
const BAR = `${T} .blok-video-controls__bar`;

describe('video island controls', () => {
  it('floats the bar as a glass capsule inset from the frame edges', () => {
    const bar = block(BAR);

    expect(bar).toContain('left: var(--blok-space-3-5)');
    expect(bar).toContain('right: var(--blok-space-3-5)');
    expect(bar).toContain('bottom: var(--blok-space-3-5)');
    expect(bar).toContain('border-radius: var(--blok-radius-pill)');
    expect(bar).toContain('background: var(--blok-video-island-bg)');
    expect(bar).toMatch(/(^|\s)backdrop-filter: blur\(/);
    expect(bar).not.toContain('linear-gradient');
  });

  it('springs the capsule up from below when it appears', () => {
    expect(block(BAR)).toMatch(/transform: translateY\(\d+px\) scale\(0\.\d+\)/);
    expect(block(BAR)).toContain('var(--blok-ease-spring-island)');
    expect(block(`${T} .blok-video-inner[data-controls-hidden="true"] .blok-video-controls__bar`))
      .toMatch(/transform: translateY\(\d+px\) scale\(0\.\d+\)/);
  });

  it('gives the bar play button a solid light disc', () => {
    const play = block(`${T} .blok-video-controls__btn[data-action="play-toggle"]`);

    expect(play).toContain('background: var(--blok-video-island-play-bg)');
    expect(play).toContain('color: var(--blok-video-island-play-fg)');
  });

  it('makes the centre play a frosted glass disc', () => {
    const center = block(`${T} .blok-video-controls__center`);

    expect(center).toContain('background: var(--blok-video-island-bg)');
    expect(center).toContain('box-shadow: var(--blok-video-island-shadow)');
  });

  it('hides the scrubber knob until the scrubber is hovered or focused', () => {
    expect(block(`${T} .blok-video-controls__seek::-webkit-slider-thumb`)).toContain('transform: scale(0)');
    expect(css).toMatch(/\.blok-video-controls__seek-wrap:hover \.blok-video-controls__seek::-webkit-slider-thumb[^{]*\{[^}]*transform: scale\(1\)/);
  });

  it('defines every island token once in the palette', () => {
    ['--blok-video-island-bg', '--blok-video-island-play-bg', '--blok-video-island-play-fg', '--blok-video-island-shadow', '--blok-ease-spring-island']
      .forEach((token) => expect(colors).toMatch(new RegExp(`${token}:`)));
  });
});
