/**
 * Capsule: below 400px the player trades the bar for one glass capsule that is
 * the scrubber, with the few other buttons in the top corner.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(readFileSync(resolve(__dirname, '../../../src/styles/video.css'), 'utf-8'));

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));

  return match?.[1] ?? '';
};

const T = '[data-blok-tool="video"]';
const C = `${T} .blok-video-inner[data-capsule]`;
const tier = (name: string): string => `${T} .blok-video-inner[data-tier="${name}"]`;
const WRAP = '.blok-video-controls__bar .blok-video-controls__seek-wrap';

describe('video capsule — narrow player', () => {
  it('never scales controls with the player width', () => {
    expect(css).not.toMatch(/\d(cqw|cqi|cqh|cqmin|cqmax)\b/);
  });

  it('dissolves the bar, so each part can sit where the capsule needs it', () => {
    expect(block(`${C} .blok-video-controls__bar`)).toContain('display: contents');
    expect(block(`${C} .blok-video-controls__bar > *`)).toContain('position: absolute');
  });

  it('brings every part up on the same signal as the bar', () => {
    const part = block(`${C} .blok-video-controls__bar > *`);

    expect(part).toContain('opacity: var(--blok-video-bar-on, 0)');
    expect(block(`${T} .blok-video-controls__bar`)).toContain('--blok-video-bar-on: 0');
    expect(block(`${T} .blok-video-inner[data-played="true"]:hover .blok-video-controls__bar`)).toContain('--blok-video-bar-on: 1');
    expect(block(`${T} .blok-video-inner[data-controls-hidden="true"] .blok-video-controls__bar`)).toContain('--blok-video-bar-on: 0');
    expect(block(`${T} .blok-video-inner[data-theater-morphing="true"] .blok-video-controls__bar`)).toContain('--blok-video-bar-on: 0');
  });

  it('makes the scrubber the glass capsule', () => {
    const wrap = block(`${C} ${WRAP}`);

    expect(wrap).toContain('height: 36px');
    expect(wrap).toContain('inset-inline: var(--blok-space-2-5)');
    expect(wrap).toContain('bottom: var(--blok-space-2-5)');
    expect(wrap).toContain('border-radius: var(--blok-radius-pill)');
    expect(wrap).toContain('background: var(--blok-video-island-bg)');
    expect(wrap).toMatch(/(^|\s)backdrop-filter: blur\(/);
  });

  it('fills the capsule up to the playhead, cut straight', () => {
    const fill = block(`${C} ${WRAP}::before`);

    expect(fill).toContain('inset: 0');
    expect(fill).toContain('border-radius: inherit');
    expect(fill).toContain('clip-path: inset(0 calc(100% - var(--blok-seek-pct, 0%)) 0 0)');
  });

  it('lets a drag anywhere on the capsule scrub: the range covers it, unseen', () => {
    const range = block(`${C} ${WRAP} .blok-video-controls__seek`);

    expect(range).toContain('inset: 0');
    expect(range).toContain('height: 100%');
    expect(range).toContain('opacity: 0');
  });

  it('swells the capsule while it is held', () => {
    const held = block(`${C} ${WRAP}:active`);

    expect(held).toContain('height: 44px');
    expect(held).toContain('inset-inline: var(--blok-space-1-5)');
    expect(held).toContain('bottom: var(--blok-space-1-5)');
  });

  it('keeps play and the time above the capsule, and lets a drag pass through the time', () => {
    const play = block(`${C} .blok-video-controls__btn[data-action="play-toggle"]`);
    const time = block(`${C} .blok-video-controls__time`);

    expect(play).toContain('z-index: 1');
    expect(play).toContain('background: transparent');
    expect(time).toContain('z-index: 1');
    expect(time).toContain('pointer-events: none');
    expect(block(`${C} [data-role="time-total"]`)).toContain('display: none');
  });

  it('moves mute, settings and full screen to the top corner as glass buttons', () => {
    expect(block(`${C} .blok-video-controls__menu-wrap`)).toContain('top: var(--blok-space-2)');
    expect(block(`${C} .blok-video-controls__btn[data-action="gear"]`)).toContain('background: var(--blok-video-island-bg)');
    expect(block(`${C} .blok-video-controls__bar > .blok-video-controls__btn[data-action="fullscreen"]`)).toContain('inset-inline-end: var(--blok-space-2)');
  });

  it('keeps the three dots level while the card is open: only the gear turns', () => {
    expect(block(`${C} .blok-video-controls__btn[data-action="gear"][aria-expanded="true"] svg`)).toContain('transform: none');
  });

  it('drops what a capsule has no room for', () => {
    const gone = [
      '.blok-video-controls__buffered',
      '.blok-video-controls__seek-tooltip',
      '.blok-video-controls__volume',
      '.blok-video-controls__btn[data-action="theater"]',
      '.blok-video-controls__btn[data-action="picture-in-picture"]',
    ];

    for (const part of gone) {
      expect(block(`${C} ${part}`), part).toContain('display: none');
    }
  });

  it('shows the folded view modes in the settings card only in a capsule', () => {
    expect(block(`${T} .blok-video-controls__menu-row[data-action="menu-theater"]`)).toContain('display: none');
    expect(block(`${C} .blok-video-controls__menu-row[data-action="menu-theater"]`)).toContain('display: flex');
    expect(block(`${C} .blok-video-controls__menu-row[data-action="menu-pip"]`)).toContain('display: flex');
  });

  it('drops settings below 260px, then the time and mute below 180px', () => {
    expect(block(`${tier('small')} .blok-video-controls__menu-wrap`)).toContain('display: none');
    expect(block(`${tier('tiny')} .blok-video-controls__menu-wrap`)).toContain('display: none');
    expect(block(`${tier('tiny')} .blok-video-controls__time`)).toContain('display: none');
    expect(block(`${tier('tiny')} .blok-video-controls__volume-wrap`)).toContain('display: none');
    expect(block(`${tier('tiny')} ${WRAP}`)).toContain('height: 32px');
  });

  it('steps the centre play button down by tier', () => {
    expect(block(`${C} .blok-video-controls__center`)).toContain('width: 48px');
    expect(block(`${tier('small')} .blok-video-controls__center`)).toContain('width: 40px');
    expect(block(`${tier('tiny')} .blok-video-controls__center`)).toContain('width: 32px');
  });

  it('moves the centre play aside whenever the capsule is up', () => {
    const aside = block(`${C} .blok-video-controls:has(:focus-visible) .blok-video-controls__center:not(:focus-visible)`);

    expect(aside).toContain('opacity: 0');
    expect(aside).toContain('pointer-events: none');
  });
});
