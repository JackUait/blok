import { beforeAll, describe, expect, it } from 'vitest';
import { createHighlighter, type Highlighter } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from '../../../../../src/tools/code/highlight/grammar-loader';
import { tokenizePrism } from '../../../../../src/tools/code/prism-loader';

/**
 * CSS selector and atrule, and the YAML key, tried a match at every start in
 * a run, and each try scanned to the end of the line. One exec did quadratic
 * work, which the engine's exec counter cannot see, so this test times it.
 *
 * Timing one line of 32n characters against 32 lines of n characters does
 * the same amount of text both ways. Linear work gives a ratio near 1;
 * quadratic gives about 32. Runs alternate so a GC pause hits both sides.
 */
const PIECE = 125;
const COPIES = 32;
const RUNS = 9;
const MAX_RATIO = 8;

const fill = (unit: string, length: number): string => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

const elapsed = (run: () => void): number => {
  const start = performance.now();

  run();

  return performance.now() - start;
};

const WITNESSES: Array<[string, string]> = [
  ['css', 'a .a'],
  ['css', 'a a'],
  ['css', ' a'],
  ['css', 'a\t'],
  ['css', '"a" '],
  ['css', 'a\'a\' '],
  ['css', 'a "'],
  ['css', 'a \''],
  ['css', '@a a'],
  ['css', '@a "'],
  ['yaml', 'a::'],
  ['yaml', 'a:::'],
  ['yaml', 'a::::'],
  ['yaml', 'a?:'],
  ['yaml', '-::'],
  ['yaml', '?::a'],
  ['yaml', 'a?.'],
  ['yaml', 'a:a'],
  ['yaml', '-a'],
  ['yaml', '- a'],
  ['yaml', '? a'],
  ['yaml', '-!t a'],
  ['yaml', ':!t a'],
  ['yaml', '-&'],
  ['yaml', '&-'],
  ['yaml', '-&--&'],
  ['yaml', '?*'],
];

describe('css and yaml grammars stay linear on long runs', () => {
  let hl: Highlighter;

  beforeAll(async () => {
    hl = createHighlighter();

    const load = createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: false });

    await load('css');
    await load('yaml');
  });

  it.each(WITNESSES)('%s run of %j', { timeout: 120_000 }, (language, unit) => {
    const grammar = hl.languages[language];
    const long = fill(unit, PIECE * COPIES);
    const short = fill(unit, PIECE);

    const longTimes: number[] = [];
    const shortTimes: number[] = [];

    for (let run = 0; run < RUNS; run++) {
      longTimes.push(elapsed(() => hl.tokenize(long, grammar)));
      shortTimes.push(elapsed(() => {
        for (let i = 0; i < COPIES; i++) {
          hl.tokenize(short, grammar);
        }
      }));
    }

    const longTime = Math.min(...longTimes);
    const shortTime = Math.min(...shortTimes);

    expect(longTime / Math.max(shortTime, 0.5)).toBeLessThan(MAX_RATIO);
  });
});

describe('a start the skip must not drop', () => {
  // A key after an anchor or tag whose text could chain into it.
  const cases: Array<[string, string, string]> = [
    ['yaml', '- &my-anchor key: value',
      '<span class="token punctuation">-</span> <span class="token important">&amp;my-anchor</span> <span class="token key atrule">key</span><span class="token punctuation">:</span> value'],
    ['yaml', '- !<tag:yaml.org,2002:str> foo: bar',
      '<span class="token punctuation">-</span> <span class="token tag">!&lt;tag:yaml.org,2002:str></span> <span class="token key atrule">foo</span><span class="token punctuation">:</span> bar'],
    ['yaml', '? !!str a-b: c',
      '<span class="token punctuation">?</span> <span class="token tag">!!str</span> <span class="token key atrule">a-b</span><span class="token punctuation">:</span> c'],
    ['yaml', '{a: 1, b c: 2}',
      '<span class="token punctuation">{</span><span class="token key atrule">a</span><span class="token punctuation">:</span> <span class="token number">1</span><span class="token punctuation">,</span> <span class="token key atrule">b c</span><span class="token punctuation">:</span> <span class="token number">2</span><span class="token punctuation">}</span>'],
    ['yaml', 'a::b: c',
      '<span class="token key atrule">a::b</span><span class="token punctuation">:</span> c'],
    ['css', 'a "b" c { }',
      '<span class="token selector">a "b" c</span> <span class="token punctuation">{</span> <span class="token punctuation">}</span>'],
    ['css', 'div > p.x:hover, a[href="#"] { color: red; }',
      '<span class="token selector">div > p.x:hover, a[href="#"]</span> <span class="token punctuation">{</span> <span class="token property">color</span><span class="token punctuation">:</span> red<span class="token punctuation">;</span> <span class="token punctuation">}</span>'],
    ['css', '@media screen and (min-width: 1px) { a { b: c } }',
      '<span class="token atrule"><span class="token rule">@media</span> screen <span class="token keyword">and</span> <span class="token punctuation">(</span><span class="token property">min-width</span><span class="token punctuation">:</span> 1px<span class="token punctuation">)</span></span> <span class="token punctuation">{</span> <span class="token selector">a</span> <span class="token punctuation">{</span> <span class="token property">b</span><span class="token punctuation">:</span> c <span class="token punctuation">}</span> <span class="token punctuation">}</span>'],
    ['css', '@import url("x.css") screen;',
      '<span class="token atrule"><span class="token rule">@import</span> <span class="token url"><span class="token function">url</span><span class="token punctuation">(</span><span class="token string url">"x.css"</span><span class="token punctuation">)</span></span> screen<span class="token punctuation">;</span></span>'],
  ];

  it.each(cases)('%s: %s', async (language, code, html) => {
    expect(await tokenizePrism(code, language)).toBe(html);
  });
});
