import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

/* jsdom loads no stylesheet, so these read the source. */
const CSS = readFileSync(resolve(__dirname, '../../../src/styles/ask-ai-icons.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCE = readFileSync(resolve(__dirname, '../../../src/components/modules/assistant/skill-icons.ts'), 'utf8');

const MOTION = CSS.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
const STILL = CSS.replace(MOTION, '').replace(/@keyframes[\s\S]*$/, '');

/** The body of every rule whose selector list holds `selector` exactly. */
const bodyOf = (selector: string, source = CSS): string =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').map((part) => part.trim()).includes(selector))
    .map(([, , body]) => body)
    .join(';');

const TRIGGERS = [
  '[data-blok-assistant-action]:hover',
  '[data-blok-assistant-action]:focus-visible',
  '[data-blok-ask-ai-skill]:hover',
  '[data-blok-ask-ai-skill][data-blok-focused="true"]',
];

describe('Ask AI skill icon CSS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ships in the main stylesheet', () => {
    expect(readMainCss()).toContain('[data-blok-ask-ai-part="explain-q"]');
  });

  it('swaps the ink for the coloured copy on a hovered chip or menu skill, and on keyboard focus', () => {
    const trigger = STILL.match(/:is\(([^{]*?)\) \[data-blok-ask-ai-hue\] \{/)?.[1] ?? '';

    expect(bodyOf('[data-blok-ask-ai-hue]')).toMatch(/opacity:\s*0\b/);
    expect(trigger.split(',').map((part) => part.trim())).toEqual(TRIGGERS);
  });

  it('moves every part the dresser names, and names no part the dresser lacks', () => {
    const named = [...SOURCE.matchAll(/\['([a-zA-Z]+-[a-z0-9]+)'(?:, '(in|out)')?\]/g)];
    const parts = new Set(named.map(([, part]) => part));
    const styled = new Set([...CSS.matchAll(/\[data-blok-ask-ai-part="([^"]+)"\]/g)].map(([, part]) => part));

    expect(parts.size).toBeGreaterThan(20);
    // A part that neither draws in nor erases moves only by a rule of its own.
    named.filter(([, , draw]) => draw === undefined).forEach(([, part]) => expect(styled, part).toContain(part));
    styled.forEach((part) => expect(parts, part).toContain(part));
  });

  it('shows each act\'s end on hover even with reduced motion', () => {
    expect(STILL).toMatch(/\[data-blok-ask-ai-draw="in"\] \{\s*stroke-dashoffset:\s*0/);
    expect(STILL).toMatch(/\[data-blok-ask-ai-draw="out"\][^{]*\{\s*opacity:\s*0/);
  });

  it('keeps every animation and transition inside the motion block', () => {
    expect(MOTION).toMatch(/animation:/);
    expect(STILL).not.toMatch(/animation|transition/);
  });

  it('fades an erased stroke at its end, so its round cap leaves no dot', () => {
    const undraw = CSS.match(/@keyframes blok-ask-ai-undraw \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(undraw).toMatch(/to \{[^}]*opacity:\s*0/);
  });

  it('stops a chip icon that acts from also tilting', () => {
    expect(bodyOf('[data-blok-assistant-action]:hover [data-blok-assistant-action-icon]:has([data-blok-ask-ai-hue])')).toMatch(/transform:\s*none/);
  });

  it('draws each chip icon in as the row opens, one after another', () => {
    expect(MOTION).toMatch(/\[data-blok-assistant-action\] \[data-blok-ask-ai-ink\] \[pathLength="1"\] \{[^}]*animation-delay:\s*calc\(var\(--blok-assistant-action-index\)/);
  });

  it('has no glow', () => {
    expect(CSS).not.toMatch(/filter|drop-shadow|text-shadow|box-shadow/);
  });
});
