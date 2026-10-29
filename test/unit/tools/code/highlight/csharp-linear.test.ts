import { beforeAll, describe, expect, it } from 'vitest';
import { createHighlighter, type Grammar, type Highlighter } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from '../../../../../src/tools/code/highlight/grammar-loader';
import { tokenizePrism } from '../../../../../src/tools/code/prism-loader';

/**
 * A long dotted name made C# highlighting quadratic: the return-type and
 * variable-declaration patterns tried a match at every name in the chain, and
 * each try re-scanned the rest of it. One long line froze the page.
 *
 * Timing one line of 32n characters against 32 lines of n characters does
 * the same amount of text both ways. Linear work gives a ratio near 1;
 * quadratic gives about 32. Runs alternate so a GC pause hits both sides.
 */
const PIECE = 125;
const COPIES = 32;
const RUNS = 9;
const MAX_RATIO = 8;

const fill = (prefix: string, unit: string, length: number): string => {
  return prefix + unit.repeat(Math.ceil((length - prefix.length) / unit.length));
};

const elapsed = (run: () => void): number => {
  const start = performance.now();

  run();

  return performance.now() - start;
};

const WITNESSES: Array<[string, string]> = [
  ['', 'a.'],
  ['a ', 'a.'],
  ['(', 'a.'],
  ['[', 'a.'],
  ['$"{', 'a.'],
  ['new ', 'a.'],
  [': ', 'a.'],
  ['class X : ', 'a.'],
  ['', 'a<b>.'],
  ['', 'a .'],
  ['', 'this.a.'],
  ['', 'A.'],
  ['', '@a.'],
];

describe('csharp grammar stays linear on long dotted names', () => {
  let hl: Highlighter;
  let csharp: Grammar;

  beforeAll(async () => {
    hl = createHighlighter();
    await createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: false })('csharp');
    csharp = hl.languages.csharp;
  });

  it.each(WITNESSES)('prefix %j, chain of %j', { timeout: 120_000 }, (prefix, unit) => {
    const long = `${fill(prefix, unit, PIECE * COPIES)}a `;
    const short = `${fill(prefix, unit, PIECE)}a `;

    const longTimes: number[] = [];
    const shortTimes: number[] = [];

    for (let run = 0; run < RUNS; run++) {
      longTimes.push(elapsed(() => hl.tokenize(long, csharp)));
      shortTimes.push(elapsed(() => {
        for (let i = 0; i < COPIES; i++) {
          hl.tokenize(short, csharp);
        }
      }));
    }

    const longTime = Math.min(...longTimes);
    const shortTime = Math.min(...shortTimes);

    expect(longTime / Math.max(shortTime, 0.5)).toBeLessThan(MAX_RATIO);
  });
});

describe('csharp type names next to a dotted chain', () => {
  // A name right after a keyword, ?. or .. still starts its own type.
  const cases: Array<[string, string]> = [
    ['System.Text.StringBuilder sb = new();',
      '<span class="token class-name">System<span class="token punctuation">.</span>Text<span class="token punctuation">.</span>StringBuilder</span> sb <span class="token operator">=</span> <span class="token keyword">new</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>'],
    ['this.Foo bar;',
      '<span class="token keyword">this</span><span class="token punctuation">.</span><span class="token class-name">Foo</span> bar<span class="token punctuation">;</span>'],
    ['@this.Foo bar;',
      '@<span class="token keyword">this</span><span class="token punctuation">.</span><span class="token class-name">Foo</span> bar<span class="token punctuation">;</span>'],
    ['base.Foo Bar() => 0;',
      '<span class="token keyword">base</span><span class="token punctuation">.</span><span class="token return-type class-name">Foo</span> <span class="token function">Bar</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token operator">=></span> <span class="token number">0</span><span class="token punctuation">;</span>'],
    ['Foo<int>.Bar baz;',
      '<span class="token class-name">Foo<span class="token punctuation">&lt;</span><span class="token keyword">int</span><span class="token punctuation">></span><span class="token punctuation">.</span>Bar</span> baz<span class="token punctuation">;</span>'],
    ['IFoo.Bar.Baz Qux() { }',
      '<span class="token return-type class-name">IFoo<span class="token punctuation">.</span>Bar<span class="token punctuation">.</span>Baz</span> <span class="token function">Qux</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span> <span class="token punctuation">}</span>'],
    ['a?.Foo bar;',
      'a<span class="token punctuation">?.</span><span class="token class-name">Foo</span> bar<span class="token punctuation">;</span>'],
    ['x..Foo bar;',
      'x<span class="token range operator">..</span><span class="token class-name">Foo</span> bar<span class="token punctuation">;</span>'],
    ['value.Foo bar = 1;',
      '<span class="token keyword">value</span><span class="token punctuation">.</span><span class="token class-name">Foo</span> bar <span class="token operator">=</span> <span class="token number">1</span><span class="token punctuation">;</span>'],
  ];

  it.each(cases)('%s', async (code, html) => {
    expect(await tokenizePrism(code, 'csharp')).toBe(html);
  });
});
