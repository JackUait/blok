/**
 * The typed-speed field is the Well from the Typed Speed Lab, the same in both players.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const body = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

// Each player paints with its own colours: the well takes the colour of its − and + buttons.
const PLAYERS = [
  { tool: 'audio', well: 'var(--blok-item-hover-bg)', soft: 'var(--blok-text-secondary)', ink: 'var(--blok-text-primary)' },
  { tool: 'video', well: 'var(--blok-video-control-bg-hover)', soft: 'var(--blok-video-menu-value-fg)', ink: 'var(--blok-video-control-fg)' },
];

describe.each(PLAYERS)('$tool speed field', ({ tool, well, soft, ink }) => {
  const css = read(`${tool}.css`);
  const scope = `[data-blok-tool="${tool}"] .blok-${tool}-controls__`;
  const number = `${scope}speed-readout[role="button"]`;

  it('shows a hand over the number, not a text cursor', () => {
    expect(body(css, number)).toMatch(/cursor: pointer;/);
  });

  it('gives the number and the open field one box: the same padding, pulled back so the row keeps its height', () => {
    const box = body(css, `${number},\n${scope}speed-entry`);

    expect(box).toMatch(/padding: var\(--blok-space-0-5\) var\(--blok-space-2\);/);
    expect(box).toMatch(/margin: calc\(-1 \* var\(--blok-space-0-5\)\) 0;/);
    expect(box).toMatch(/border-radius: var\(--blok-radius-field\);/);
  });

  it('shows the well on hover and keeps it while typing', () => {
    expect(body(css, `${number}:hover,\n${scope}speed-entry`)).toMatch(new RegExp(`background: ${well.replace(/[()]/g, '\\$&')};`));
  });

  it('rings the number only for the keyboard', () => {
    expect(css).toContain(`:where(:root:not([data-blok-modality="pointer"])) ${number}:focus-visible`);
  });

  it('sizes the field from a hidden copy of its text, with the input laid over it', () => {
    expect(body(css, `${scope}speed-entry-sizer`)).toMatch(/position: relative;/);

    const copy = body(css, `${scope}speed-entry-sizer::after`);

    expect(copy).toMatch(/content: attr\(data-value\);/);
    expect(copy).toMatch(/visibility: hidden;/);
    expect(copy).toMatch(/white-space: pre;/);

    const field = body(css, `${scope}speed-entry-input`);

    expect(field).toMatch(/position: absolute;/);
    expect(field).toMatch(/inset: 0;/);
    expect(field).toMatch(/font: inherit;/);
    expect(field).toMatch(/border: 0;/);
    expect(field).toMatch(/background: transparent;/);
    expect(field).toMatch(/outline: none;/);
    expect(field).not.toMatch(/width: \d+ch/);
  });

  it('lifts the field\'s text onto the same pixels as the number', () => {
    expect(body(css, `${scope}speed-entry-sizer`)).toMatch(new RegExp(`--blok-${tool}-speed-entry-lift: 0\\.05em;`));
    expect(body(css, `${scope}speed-entry-input`)).toMatch(new RegExp(`padding: 0 0 var\\(--blok-${tool}-speed-entry-lift\\);`));
  });

  it('swaps the presets for the help line while the field is open', () => {
    const open = `[data-blok-tool="${tool}"] [data-speed-entry="open"] .blok-${tool}-controls__`;

    expect(body(css, `${open}speed-preset`)).toMatch(/opacity: 0;/);
    expect(body(css, `${open}speed-preset`)).toMatch(/pointer-events: none;/);
    expect(body(css, `${open}speed-help`)).toMatch(/opacity: 1;/);

    const help = body(css, `${scope}speed-help`);

    expect(help).toMatch(/opacity: 0;/);
    expect(help).toMatch(new RegExp(`color: ${soft.replace(/[()]/g, '\\$&')};`));
    expect(body(css, `${scope}speed-help[data-strong="true"]`)).toMatch(new RegExp(`color: ${ink.replace(/[()]/g, '\\$&')};`));
  });
});

describe('both players draw the speed field alike', () => {
  const rules = (tool: string): string[] => {
    const other = PLAYERS.find((p) => p.tool === tool);

    if (!other) throw new Error(tool);

    return [...read(`${tool}.css`).matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => /speed-entry|speed-help|speed-readout\[role="button"\]/.test(selector))
      .map(([, selector, declarations]) => `${selector.trim()} {${declarations.trim()}}`
        .replaceAll(`blok-tool="${tool}"`, 'blok-tool="PLAYER"')
        .replaceAll(`blok-${tool}-controls`, 'blok-PLAYER-controls')
        .replaceAll(`--blok-${tool}-speed-entry-lift`, '--blok-PLAYER-speed-entry-lift')
        .replaceAll(other.well, 'WELL')
        .replaceAll(other.soft, 'SOFT')
        .replaceAll(other.ink, 'INK')
        .replace(tool === 'video' ? /--blok-video-focus-ring/g : /--blok-focus-ring/g, 'RING'));
  };

  it('has the same rules in audio.css and video.css, apart from each player\'s colours', () => {
    expect(rules('audio').length).toBeGreaterThan(6);
    expect(rules('video')).toEqual(rules('audio'));
  });
});
