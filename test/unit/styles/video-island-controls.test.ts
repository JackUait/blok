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

  it('moves the centre play aside while a played video is hovered, since the bar is showing', () => {
    const aside = block(`${T} .blok-video-inner[data-played="true"]:hover .blok-video-controls__center:not(:focus-visible)`);

    expect(aside).toContain('opacity: 0');
    expect(aside).toContain('pointer-events: none');
    // A never-played video keeps it on hover: there the bar stays hidden.
    expect(css).not.toMatch(/data-played="false"\][^{]*blok-video-controls__center[^{]*\{[^}]*opacity: 0/);
  });

  it('hides the scrubber knob until the scrubber is hovered or focused', () => {
    expect(block(`${T} .blok-video-controls__seek::-webkit-slider-thumb`)).toContain('transform: scale(0)');
    expect(css).toMatch(/\.blok-video-controls__seek-wrap:hover \.blok-video-controls__seek::-webkit-slider-thumb[^{]*\{[^}]*transform: scale\(1\)/);
  });

  it('defines every island token once in the palette', () => {
    ['--blok-video-island-bg', '--blok-video-island-play-bg', '--blok-video-island-play-fg', '--blok-video-island-shadow', '--blok-ease-spring-island']
      .forEach((token) => expect(colors).toMatch(new RegExp(`${token}:`)));
  });

  it('keeps the island out of a resting player: only hover or keyboard focus shows it', () => {
    const shown = css.match(/([^{}]+)\{\s*opacity: 1;\s*transform: none;\s*\}/g) ?? [];
    const barShowRules = shown.filter((rule) => rule.includes('.blok-video-controls__bar'));

    expect(barShowRules.length).toBeGreaterThan(0);
    barShowRules.forEach((rule) => expect(rule).not.toContain('data-playing'));
  });

  it('plays the play/pause burst without a rippling ring', () => {
    expect(css).not.toContain('.blok-video-controls__burst::after');
    expect(css).not.toMatch(/@keyframes blok-video-burst-ring\b/);
  });

  it('hides the island while the theater card morphs, with no fade to catch it mid-shrink', () => {
    const rule = block(`${T} .blok-video-inner[data-theater-morphing="true"] .blok-video-controls__bar`);

    expect(rule).toContain('opacity: 0');
    expect(rule).toContain('transition: none');
  });

  it('shows the hand cursor only over controls, not over the picture', () => {
    expect(css).not.toMatch(/\.blok-video-media video\s*\{[^}]*cursor: pointer/);
  });

  it('keeps the default playing glow faint and close to the frame', () => {
    const minimal = block(`${T} .blok-video-controls__ambient[data-glow="minimal"][data-active="true"]`);
    const opacity = Number(minimal.match(/opacity: ([\d.]+)/)?.[1]);
    const scale = Number(block(`${T} .blok-video-controls__ambient`).match(/transform: scale\(([\d.]+)\)/)?.[1]);

    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.15);
    expect(scale).toBeLessThanOrEqual(1.03);
  });

  it('rounds the player frame with its own radius role', () => {
    expect(colors).toMatch(/--blok-radius-player: var\(--blok-radius-20\);/);
  });

  it('never shows the thin progress line when the island hides', () => {
    expect(block(`${T} .blok-video-controls__mini`)).toContain('display: none');
    expect(css).not.toMatch(/\.blok-video-controls__mini\s*\{\s*opacity: 1/);
  });

  // Chrome clips the video layer and the box behind it separately, so a dark
  // box behind the picture bleeds through as a dark rim on the rounded corners.
  it('rounds the picture itself, with no dark box behind it to bleed at the corners', () => {
    expect(block(`${T} .blok-video-media video`)).toContain('border-radius: inherit');
    expect(block(`${T} .blok-video-media`)).not.toContain('background:');
  });
});
