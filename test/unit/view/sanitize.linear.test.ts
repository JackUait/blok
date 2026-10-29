// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import { INLINE_TEXT_SANITIZE } from '../../../src/shared/inline-text-sanitize';
import type { SanitizerConfig } from '../../../types';

const SLOW = { timeout: 120_000 };

const BLOCKS: SanitizerConfig = { p: true, div: true, b: {}, i: {} };

/**
 * Blok.Server runs this on an interpreter with a 10 s call budget, so one
 * field must not cost quadratic time. Each shape forces many removals among
 * siblings (tree walk) or deep / wide redundant marks (inline normalization).
 */
const PATHOLOGICAL: Array<{ name: string; build: (n: number) => string; config: SanitizerConfig }> = [
  { name: 'comments between text', build: (n) => '<!--c-->x'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'comments only', build: (n) => '<!--c-->'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'foster-parented marks', build: (n) => `<table>${'<i>x</i>'.repeat(n)}`, config: INLINE_TEXT_SANITIZE },
  { name: 'foster-parented text', build: (n) => `<table><tr>${'<i></i>x'.repeat(n)}`, config: INLINE_TEXT_SANITIZE },
  { name: 'bold across paragraphs', build: (n) => `<b>${'<p>x</b>'.repeat(n)}`, config: BLOCKS },
  { name: 'links reopened across paragraphs', build: (n) => '<a href="u">x<p>y</a>'.repeat(n), config: { a: { href: true }, p: true } },
  { name: 'disallowed tags', build: (n) => '<foo>x</foo>'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'bare spans', build: (n) => '<span>x</span>'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'paragraphs unwrapped', build: (n) => '<p>x</p>\n'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'divs unwrapped', build: (n) => '<div>x</div> '.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'blanks between kept paragraphs', build: (n) => '<p>x</p> '.repeat(n), config: BLOCKS },
  { name: 'page references between comments', build: (n) => '<a data-blok-page-id="p">x</a><!--c-->'.repeat(n), config: INLINE_TEXT_SANITIZE },
  { name: 'alternating nested marks', build: (n) => `${'<b><i>'.repeat(n)}x${'</i></b>'.repeat(n)}`, config: INLINE_TEXT_SANITIZE },
  { name: 'nested bold chain', build: (n) => `${'<b>'.repeat(n)}x${'</b>'.repeat(n)}`, config: INLINE_TEXT_SANITIZE },
  { name: 'adjacent bold runs', build: (n) => '<b>x</b>'.repeat(n), config: INLINE_TEXT_SANITIZE },
];

type Case = (typeof PATHOLOGICAL)[number];

/** Best of five: the time of `times` runs over `html`. */
const best = (html: string, testCase: Case, times: number): number =>
  Math.min(
    ...Array.from({ length: 5 }, () => {
      const begin = performance.now();

      Array.from({ length: times }).forEach(() => sanitizeHtmlFragment(html, testCase.config));

      return performance.now() - begin;
    })
  );

/**
 * The smallest n (from 2000, doubling) whose input takes at least 2 ms, so
 * timer noise stays small next to it. An array splice per child is cheap
 * until arrays get long: below about 2000 children it hides in the noise.
 */
const calibrate = (testCase: Case): number =>
  [2000, 4000].find((n) => best(testCase.build(n), testCase, 1) >= 2) ?? 8000;

describe('sanitizeHtmlFragment time', SLOW, () => {
  // One run over 8n must cost about eight runs over n; a quadratic path costs
  // 8x more. Eight small runs against one large keeps the work, and the GC, alike.
  it.each(PATHOLOGICAL)('stays linear on $name', (testCase) => {
    const n = calibrate(testCase);
    const small = testCase.build(n);
    const large = testCase.build(8 * n);
    const ratios = Array.from({ length: 3 }).reduce<number[]>((seen) => {
      if (seen.length > 0 && seen[seen.length - 1] < 24) {
        return seen;
      }

      return [...seen, (8 * best(large, testCase, 1)) / best(small, testCase, 8)];
    }, []);

    expect(ratios[ratios.length - 1], `n ${n}, ratios ${ratios.map((r) => r.toFixed(1)).join(', ')}`).toBeLessThan(24);
  });
});

describe('sanitizeHtmlFragment URL transform', () => {
  // A link the transform changed counts as changed on every revisit, so a
  // transform run per revisit made links mixed with removals quadratic.
  it('runs once per link when every link is followed by a removal', () => {
    const n = 500;
    const calls = { count: 0 };
    const links = Array.from({ length: n }, (_, i) => i);
    const out = sanitizeHtmlFragment(links.map((i) => `<a href="${i}">l</a><!--c-->`).join(''), { a: { href: true } }, (url) => {
      calls.count += 1;

      return `${url}/`;
    });

    expect(calls.count).toBe(n);
    expect(out).toBe(links.map((i) => `<a href="${i}/">l</a>`).join(''));
  });
});
