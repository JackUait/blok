/**
 * Law: under prefers-reduced-motion, nothing in a database moves.
 *
 * Notion's rule: movement (slides, scales, turns, size changes) goes away,
 * instant state changes stay. So a transition or animation that changes a
 * moving property must be switched off by a later
 * `@media (prefers-reduced-motion: reduce)` rule on the same selector.
 * A transition of color, background or opacity only may stay.
 *
 * jsdom has no CSS, so this reads the authored source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

/** Comments blanked out, newlines kept so line numbers stay true. */
const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

interface Rule {
  line: number;
  selectors: string[];
  body: string;
  reduced: boolean;
}

/** Every style rule, with the at-rules around it folded into `reduced`. */
const parseRules = (css: string): Rule[] => {
  const source = stripComments(css);
  const stack: Array<{ prelude: string; line: number }> = [];
  const state = { from: 0, line: 1 };

  return [ ...source.matchAll(/[{}]/g) ].flatMap((brace): Rule[] => {
    const chunk = source.slice(state.from, brace.index);
    const line = state.line + (chunk.slice(0, Math.max(0, chunk.search(/\S/))).match(/\n/g) ?? []).length;

    state.from = brace.index + 1;
    state.line += (chunk.match(/\n/g) ?? []).length;

    const opening = brace[0] === '{';

    stack.push(...opening ? [ { prelude: chunk.trim(), line } ] : []);

    const open = opening ? undefined : stack.pop();

    return open === undefined || open.prelude.startsWith('@')
      ? []
      : [ {
        line: open.line,
        selectors: open.prelude.replace(/\s+/g, ' ').split(/,(?![^(]*\))/).map((part) => part.trim()),
        body: chunk.replace(/\s+/g, ' '),
        reduced: stack.some((outer) => /^@media \(prefers-reduced-motion: ?reduce\)/.test(outer.prelude)),
      } ];
  });
};

const declaration = (body: string, name: string): string | null =>
  body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;

/** Properties whose change moves or resizes something on screen. */
const MOVING = /^(all|transform|translate|scale|rotate|width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|inset(-[a-z-]+)?|margin(-[a-z-]+)?|padding(-[a-z-]+)?|grid-template-[a-z]+|flex(-basis)?|offset(-[a-z-]+)?)$/;

/** The properties a `transition` shorthand animates. A bare duration means `all`. */
const transitioned = (value: string): string[] =>
  value.split(/,(?![^(]*\))/).map((part) => {
    const first = part.trim().split(/\s+/)[0];

    return /^[\d.]/.test(first) ? 'all' : first;
  });

const keyframes = (css: string): Map<string, string> =>
  new Map([ ...stripComments(css).matchAll(/@keyframes ([\w-]+) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g) ]
    .map((match) => [ match[1], match[2] ]));

const DATABASE_CSS = 'src/styles/database.css';
const KEYFRAMES = keyframes(read('src/styles/keyframes.css'));
const MOVING_KEYFRAME = /(?:^|[;{\s])(transform|translate|scale|rotate|width|height|top|left|right|bottom|margin[a-z-]*|inset[a-z-]*)\s*:/;

/**
 * Motion allowed to run under reduced motion, keyed by `selector: property`.
 * Every entry needs a reason.
 */
const EXEMPT: Record<string, string> = {};

interface Motion {
  line: number;
  selector: string;
  kind: 'transition' | 'animation';
  what: string;
}

/** Every moving transition or animation outside a reduced-motion block. */
const movingMotion = (css: string): Motion[] =>
  parseRules(css).filter((rule) => !rule.reduced).flatMap((rule) => {
    const transition = declaration(rule.body, 'transition');
    const movingProps = transition === null || transition === 'none'
      ? []
      : transitioned(transition).filter((property) => MOVING.test(property));
    const animation = declaration(rule.body, 'animation');
    const animationName = animation === null || animation === 'none'
      ? null
      : animation.split(/\s+/).find((word) => KEYFRAMES.has(word)) ?? null;
    const movingAnimation = animationName !== null && MOVING_KEYFRAME.test(KEYFRAMES.get(animationName) ?? '');

    return rule.selectors.flatMap((selector) => [
      ...movingProps.length > 0
        ? [ { line: rule.line, selector, kind: 'transition' as const, what: movingProps.join(', ') } ]
        : [],
      ...movingAnimation && animationName !== null
        ? [ { line: rule.line, selector, kind: 'animation' as const, what: animationName } ]
        : [],
    ]);
  });

/** True when a reduced-motion rule after `line` sets `kind: none` on `selector`. */
const stoodDown = (css: string, motion: Motion): boolean =>
  parseRules(css).some((rule) =>
    rule.reduced
    && rule.line > motion.line
    && rule.selectors.includes(motion.selector)
    && /^none(\s*!important)?$/.test(declaration(rule.body, motion.kind) ?? ''));

describe('database reduced-motion law', () => {
  it('finds the moving motion it guards (the scan is not blind)', () => {
    const found = movingMotion(read(DATABASE_CSS)).map((motion) => `${motion.selector}: ${motion.kind}`);

    expect(found).toContain('[data-blok-database-drawer]: transition');
    expect(found).toContain('[data-blok-database-confirm-dialog]: animation');
    expect(found).toContain('[data-blok-database-switch-track] > span: transition');
  });

  it('lets a color or opacity fade stay', () => {
    const found = movingMotion(read(DATABASE_CSS)).map((motion) => motion.selector);

    expect(found).not.toContain('[data-blok-database-card]');
    expect(found).not.toContain('[data-blok-database-drop-line]');
  });

  it('turns off every moving transition and animation in database.css', () => {
    const css = read(DATABASE_CSS);
    const uncovered = movingMotion(css)
      .filter((motion) => EXEMPT[`${motion.selector}: ${motion.kind}`] === undefined)
      .filter((motion) => !stoodDown(css, motion))
      .map((motion) => `database.css:${motion.line} ${motion.selector} — ${motion.kind} ${motion.what}`);

    expect(uncovered).toEqual([]);
  });

  it('every exemption still matches real motion', () => {
    const live = new Set(movingMotion(read(DATABASE_CSS)).map((motion) => `${motion.selector}: ${motion.kind}`));

    expect(Object.keys(EXEMPT).filter((key) => !live.has(key))).toEqual([]);
  });
});

const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return tsFiles(path);
    }

    return name.endsWith('.ts') ? [ path ] : [];
  });

describe('database script motion', () => {
  it('asks prefersReducedMotion before any WAAPI animation or smooth scroll', () => {
    const offenders = tsFiles(resolve(root, 'src/tools/database'))
      .filter((path) => {
        const code = readFileSync(path, 'utf8');

        return /\.animate\(|behavior: ?'smooth'/.test(code) && !code.includes('prefersReducedMotion()');
      })
      .map((path) => path.slice(root.length + 1));

    expect(offenders).toEqual([]);
  });
});
