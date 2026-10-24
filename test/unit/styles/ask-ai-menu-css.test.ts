import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

/* jsdom loads no stylesheet, so these read the source. */
const CSS = readFileSync(resolve(__dirname, '../../../src/styles/ask-ai-menu.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of every rule whose selector list holds `selector` exactly. */
const bodyOf = (selector: string, source = CSS): string =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').map((part) => part.trim()).includes(selector))
    .map(([, , body]) => body)
    .join(';');

describe('Ask AI menu CSS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ships in the main stylesheet', () => {
    expect(readMainCss()).toContain('[data-blok-ask-ai-open]');
  });

  it('runs the bar\'s light round the rose while Ask AI is hovered or focused, with no glow', () => {
    for (const state of [':hover', '[data-blok-focused="true"]']) {
      const body = bodyOf(`[data-blok-ask-ai-open]${state} [data-blok-assistant-light]`);

      expect(body).toMatch(/display:\s*inline/);
      expect(body).toMatch(/animation:\s*blok-assistant-light\b/);
    }
    expect(CSS).not.toMatch(/filter|drop-shadow|text-shadow|box-shadow/);
  });

  it('eases the rose into its hover look instead of snapping', () => {
    for (const state of [':hover', '[data-blok-focused="true"]']) {
      expect(bodyOf(`[data-blok-ask-ai-open]${state} [data-blok-assistant-light]`)).toMatch(/blok-ask-ai-light-in\s+\d+ms/);
    }
    expect(CSS).toMatch(/@keyframes blok-ask-ai-light-in\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}/);
    expect(bodyOf('[data-blok-ask-ai-open] [data-blok-ask-ai-glyph] path:not([data-blok-assistant-light])')).toMatch(/transition:\s*opacity\s+\d+ms/);
  });

  it('leaves the skill icons\' acts to ask-ai-icons.css, which the bar\'s chips share', () => {
    expect(CSS).not.toMatch(/data-blok-ask-ai-(act|hue|scribble|spark)\b/);
  });

  it('cascades the skills in by their place in the list', () => {
    expect(bodyOf('[data-blok-ask-ai-skill]')).toMatch(/animation-delay:\s*calc\(var\(--blok-ask-ai-index\)/);
  });

  it('keeps the AI colours where the menu can read them', () => {
    expect(bodyOf('[data-blok-ask-ai]')).toMatch(/--blok-ai-hue-1:/);
  });

  it('opens with no light along the rule and no shine on the label', () => {
    expect(CSS).not.toMatch(/data-blok-ask-ai-seam|blok-ask-ai-sweep|blok-ask-ai-shine|text-fill-color/);
  });

  it('lays no colour wash under the open skills', () => {
    expect(CSS).not.toMatch(/\[data-blok-ask-ai-skills\]::before/);
  });

  it('keeps every animation and transition inside the motion block, so reduced motion is still', () => {
    const motion = CSS.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
    const outside = CSS.replace(motion, '').replace(/@keyframes[\s\S]*$/, '');

    expect(motion).toMatch(/animation:/);
    expect(outside).not.toMatch(/animation|transition/);
  });
});
