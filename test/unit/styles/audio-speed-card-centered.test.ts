/**
 * The audio speed card opens centered over the gear that opens it.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/audio.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));

  return match?.[1] ?? '';
};

describe('audio speed card', () => {
  const menu = rule('[data-blok-tool="audio"] .blok-audio-controls__speed-menu');

  it('centers on the gear: its middle sits on the gear\'s middle', () => {
    expect(menu).toMatch(/(^|;)\s*left: 50%;/);
    expect(menu).toMatch(/transform: translateX\(-50%\);/);
    expect(menu).not.toMatch(/inset-inline-start/);
  });
});
