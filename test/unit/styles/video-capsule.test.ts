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

  it('keeps the three dots at every size', () => {
    expect(css).not.toMatch(/data-tier="(small|tiny)"\][^{]*__menu-wrap[^{]*\{[^}]*display: none/);
  });

  it('moves the three dots next to full screen below 180px, where mute is gone', () => {
    expect(block(`${tier('tiny')} .blok-video-controls__bar > .blok-video-controls__menu-wrap`)).toContain('inset-inline-end: calc(var(--blok-space-2) + 34px)');
  });

  it('fades the time and mute out below 180px, and takes them out of reach', () => {
    for (const part of ['.blok-video-controls__time', '.blok-video-controls__volume-wrap']) {
      const gone = block(`${tier('tiny')} ${part}`);

      expect(gone, part).toContain('opacity: 0');
      expect(gone, part).toContain('visibility: hidden');
      expect(gone, part).not.toContain('display: none');
    }
    expect(block(`${tier('tiny')} ${WRAP}`)).toContain('height: 32px');
  });

  it('steps the centre play button down by tier', () => {
    expect(block(`${C} .blok-video-controls__center`)).toContain('width: 48px');
    expect(block(`${tier('small')} .blok-video-controls__center`)).toContain('width: 40px');
    expect(block(`${tier('tiny')} .blok-video-controls__center`)).toContain('width: 32px');
  });

  it('glides the centre play from one size to the next', () => {
    const disc = block(`${T} .blok-video-controls__center`);
    const glyph = block(`${T} .blok-video-controls__center svg`);

    expect(disc).toMatch(/transition:[^;]*\bwidth \d+ms[^;]*\bheight \d+ms/);
    expect(glyph).toMatch(/transition:[^;]*\bwidth \d+ms[^;]*\bheight \d+ms/);
  });

  it('glides the capsule parts between tiers: size and place', () => {
    const part = block(`${C} .blok-video-controls__bar > *`);

    expect(part).toMatch(/transition:[^;]*\binset \d+ms/);
    expect(part).toMatch(/transition:[^;]*\bwidth \d+ms[^;]*\bheight \d+ms/);
  });

  it('fades the new controls in when the player crosses 400px, so the old ones never flash', () => {
    expect(css).toMatch(/@keyframes blok-video-tier-in\s*\{\s*from\s*\{\s*opacity: 0;\s*\}\s*\}/);
    expect(block(`${C} .blok-video-controls__bar > *`)).toMatch(/animation: blok-video-tier-in \d+ms/);
    expect(block(`${tier('full')} .blok-video-controls__bar`)).toMatch(/animation: blok-video-tier-in \d+ms/);
  });

  it('does not fade the tier swap under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reduced).toMatch(/__bar > \*[^{]*\{[^}]*animation: none/);
    expect(reduced).toMatch(/data-tier="full"\] \.blok-video-controls__bar[^{]*\{[^}]*animation: none/);
    expect(reduced).toMatch(/__center[^{]*\{[^}]*transition: none/);
  });

  it('moves the centre play aside whenever the capsule is up', () => {
    const aside = block(`${C} .blok-video-controls:has(:focus-visible) .blok-video-controls__center:not(:focus-visible)`);

    expect(aside).toContain('opacity: 0');
    expect(aside).toContain('pointer-events: none');
  });
});

const SHEET = '.blok-video-controls__sheet';
const MENU = `${SHEET} .blok-video-controls__menu`;
const at = (attr: string): string => `${T} .blok-video-inner[${attr}]`;

describe('video capsule — the flash on a small player', () => {
  it('leaves the centre flash alone outside a small player', () => {
    const base = block(`${T} .blok-video-controls__burst`);

    expect(base).toContain('width: 78px');
    expect(css).not.toMatch(/data-capsule\][^{]*__burst[^{]*\{/);
  });

  it('hides the flash and pops the play button where it is stamped', () => {
    expect(block(`${at('data-flash="pop"')} .blok-video-controls__burst`)).toContain('display: none');
    expect(block(`${at('data-flash="pop"')} .blok-video-controls__btn[data-action="play-toggle"].is-pop`)).toContain('animation: blok-video-pop-disc 420ms ease-out');
    expect(block(`${at('data-flash="pop"')} .blok-video-controls__btn[data-action="play-toggle"].is-pop svg`)).toContain('animation: blok-video-pop-glyph 420ms');
  });

  it('does not animate the pop under reduced motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reduced).toContain('.is-pop');
  });
});

describe('video capsule — the settings sheet', () => {
  it('lays a dimmed layer over the whole frame, with the card at the bottom', () => {
    const sheet = block(`${T} ${SHEET}`);

    expect(sheet).toContain('position: absolute');
    expect(sheet).toContain('inset: 0');
    expect(sheet).toContain('justify-content: flex-end');
    expect(sheet).toContain('padding: var(--blok-space-2)');
    expect(sheet).toContain('pointer-events: auto');
    expect(block(`${T} ${SHEET}[hidden]`)).toContain('display: none');
  });

  it('lets the frame size the card: no fixed width, and it scrolls before it leaves the frame', () => {
    const card = block(`${T} ${MENU}`);

    expect(card).toContain('position: relative');
    expect(card).toContain('width: auto');
    expect(card).toContain('min-width: 0');
    expect(card).toContain('max-height: 100%');
    expect(card).toContain('overflow-y: auto');
  });

  it('puts the close button in the top corner, as glass', () => {
    const close = block(`${T} .blok-video-controls__sheet-close`);

    expect(close).toContain('top: var(--blok-space-2)');
    expect(close).toContain('inset-inline-end: var(--blok-space-2)');
    expect(close).toContain('width: 30px');
    expect(close).toContain('background: var(--blok-video-island-bg)');
  });

  it('takes the capsule and the corner buttons away while it is open', () => {
    const open = block(`${C} .blok-video-controls:has(${SHEET}:not([hidden])) .blok-video-controls__bar`);

    expect(open).toContain('--blok-video-bar-on: 0');
  });

  it('fills the frame when the player is too short for a bottom card', () => {
    expect(block(`${at('data-sheet="frame"')} ${SHEET}`)).toContain('padding: 0');
    expect(block(`${at('data-sheet="frame"')} ${SHEET}`)).toContain('background: none');
    const card = block(`${at('data-sheet="frame"')} ${MENU}`);

    expect(card).toContain('flex: 1 1 auto');
    expect(card).toContain('border-radius: 0');
    expect(card).toContain('justify-content: safe center');
  });

  it('stops the rows short of the close button in a frame sheet', () => {
    expect(block(`${at('data-sheet="frame"')}[data-sheet-content="rows"] ${MENU}`)).toContain('padding-inline-end: 44px');
  });

  it('swaps the panes for a grid of tiles where it is stamped, and drops the close button', () => {
    const TILES = at('data-sheet-content="tiles"');

    expect(block(`${T} .blok-video-controls__tiles`)).toContain('display: none');
    expect(block(`${TILES} .blok-video-controls__tiles`)).toContain('display: grid');
    expect(block(`${TILES} .blok-video-controls__tiles`)).toContain('grid-template-columns: repeat(3, 1fr)');
    expect(block(`${TILES} .blok-video-controls__menu-pane`)).toContain('display: none');
    expect(block(`${TILES} .blok-video-controls__sheet-close`)).toContain('display: none');
  });

  it('marks a tile that is on with white, never blue', () => {
    const on = block(`${T} .blok-video-controls__tile[aria-checked="true"]`);

    expect(on).toContain('background: var(--blok-video-island-play-bg)');
    expect(on).toContain('color: var(--blok-video-island-play-fg)');
  });

  it('tightens the rows under 300px: smaller type, no chevron', () => {
    const TIGHT = at('data-sheet-rows="tight"');

    expect(block(`${TIGHT} .blok-video-controls__menu-row`)).toContain('font-size: 12px');
    expect(block(`${TIGHT} [data-role="menu-main"] .blok-video-controls__menu-chevron`)).toContain('display: none');
  });

  it('drops the speed value before it shortens a long translated label', () => {
    const row = block(`${T} ${SHEET} .blok-video-controls__menu-row[data-action="open-speed"]`);

    expect(row).toContain('flex-wrap: wrap');
    expect(row).toContain('height: 32px');
    expect(row).toContain('overflow: hidden');
  });

  it('shows the speed presets as a plain grid in the sheet, without the wire', () => {
    expect(block(`${T} ${SHEET} .blok-video-controls__speed-stepper`)).toContain('display: none');
    const presets = block(`${T} ${SHEET} .blok-video-controls__speed-presets`);

    expect(presets).toContain('display: grid');
    expect(block(`${T} ${SHEET} .blok-video-controls__speed-preset`)).toContain('position: static');
  });
});
