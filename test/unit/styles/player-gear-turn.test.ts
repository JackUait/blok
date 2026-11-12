/**
 * The players' settings gear turns a notch while its menu is open.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string =>
  readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

describe.each([
  ['video', 'video.css', '[data-blok-tool="video"] .blok-video-controls__btn[data-action="gear"]'],
  ['audio', 'audio.css', '[data-blok-tool="audio"] .blok-audio-controls button[data-role="audio-speed"]'],
])('%s settings gear', (_name, file, button) => {
  const css = read(file);
  const escaped = button.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('turns a sixth of a turn while its menu is open: one tooth takes the next one\'s place', () => {
    expect(css).toMatch(new RegExp(`${escaped}\\[aria-expanded="true"\\] svg\\s*\\{[^}]*transform: rotate\\(60deg\\)`));
  });

  it('eases the turn only when motion is allowed', () => {
    const allowed = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g) ?? [];

    expect(allowed.some((block) => new RegExp(`${escaped} svg\\s*\\{[^}]*transition: transform 420ms`).test(block))).toBe(true);
  });
});
