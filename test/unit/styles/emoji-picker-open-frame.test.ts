/**
 * The emoji picker's first open frame must already show its emoji.
 * A fade from opacity 0 paints a blank picker on the frame after the click.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

function fromFrame(name: string): string {
  const keyframes = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  const from = keyframes === null ? null : /(?:from|0%)\s*\{([^}]*)\}/.exec(keyframes[1]);

  if (from === null) {
    throw new Error(`Missing from frame of @keyframes ${name}`);
  }

  return from[1];
}

describe('emoji picker open animation', () => {
  it('starts visible, so the first frame shows the emoji', () => {
    expect(fromFrame('blok-emoji-picker-in')).not.toMatch(/opacity/);
  });

  it('keeps a small entrance motion', () => {
    expect(fromFrame('blok-emoji-picker-in')).toMatch(/transform:\s*translateY\(4px\) scale\(0\.96\)/);
  });
});
