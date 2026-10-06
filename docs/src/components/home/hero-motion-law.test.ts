import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest returns '' for CSS imports, so read the stylesheet from disk.
const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

const reducedMotionBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
  .map((m) => m[1])
  .join('\n');

/** Every `.hero-*` class whose own rule starts an animation. */
const animatedHeroClasses = (): string[] => {
  const names = new Set<string>();
  for (const rule of css.matchAll(/(^|\n)([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
    if (!/(^|\s)animation(-name)?\s*:/.test(rule[3]) || /animation:\s*none/.test(rule[3])) continue;
    for (const cls of rule[2].matchAll(/\.(hero-[\w-]+)/g)) names.add(cls[1]);
  }
  return [...names];
};

describe('hero motion law', () => {
  it('turns off every hero animation under reduced motion', () => {
    const missing = animatedHeroClasses().filter((name) => !reducedMotionBlocks.includes(`.${name}`));

    expect(missing).toEqual([]);
  });

  // Snap views (heroFormations SNAP_VIEWS) hold blocks flush, so the ±9px wander would
  // knock them into each other. The wander is scaled by --hero-drift, which the stack
  // eases to 0 while a snap view holds.
  it('scales the card wander by --hero-drift and zeroes it on a snapped stack', () => {
    const wander = [...css.matchAll(/@keyframes hero-wander(-alt)? \{([\s\S]*?)\n\}/g)].map((m) => m[2]);
    expect(wander).toHaveLength(2);
    for (const body of wander) {
      for (const decl of body.matchAll(/(translate|rotate):([^;]+);/g)) {
        if (/^\s*0(px|deg)?(\s+0(px)?)?\s*$/.test(decl[2])) continue;
        expect(decl[2], decl[0]).toContain('var(--hero-drift)');
      }
    }
    expect(css).toMatch(/@property --hero-drift \{[^}]*inherits: true/);
    expect(css).toMatch(/\.hero-stack\[data-hero-snap\] \{[^}]*--hero-drift: 0;/);
  });
});
