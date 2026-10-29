import { beforeAll, describe, expect, it } from 'vitest';
import { createHighlighter, type Grammar, type Highlighter } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from '../../../../../src/tools/code/highlight/grammar-loader';
import { tokenizePrism } from '../../../../../src/tools/code/prism-loader';

/**
 * The title and url-reference patterns tried a match at every start on a
 * line, and each try scanned to the end of the line. One exec did quadratic work, which the
 * engine's exec counter cannot see, so this test times it.
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

// ![\n\n is for url-reference: its [^\]]+ crosses the blank lines that stop url.
const WITNESSES = ['a?.', 'import a.a', '**/r', '//;**/', '![\n\n'];

describe('markdown grammar stays linear on long hostile lines', () => {
  let hl: Highlighter;
  let markdown: Grammar;

  beforeAll(async () => {
    hl = createHighlighter();
    await createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: true })('markdown');
    markdown = hl.languages.markdown;
  });

  it.each(WITNESSES)('a run of %j', { timeout: 120_000 }, (unit) => {
    const long = fill(unit, PIECE * COPIES);
    const short = fill(unit, PIECE);

    const longTimes: number[] = [];
    const shortTimes: number[] = [];

    for (let run = 0; run < RUNS; run++) {
      longTimes.push(elapsed(() => hl.tokenize(long, markdown)));
      shortTimes.push(elapsed(() => {
        for (let i = 0; i < COPIES; i++) {
          hl.tokenize(short, markdown);
        }
      }));
    }

    const longTime = Math.min(...longTimes);
    const shortTime = Math.min(...shortTimes);

    expect(longTime / Math.max(shortTime, 0.5)).toBeLessThan(MAX_RATIO);
  });
});

describe('markdown titles and link references keep their tokens', () => {
  const cases: Array<[string, string]> = [
    ['Title\n===',
      '<span class="token title important">Title\n<span class="token punctuation">===</span></span>'],
    ['a b\n---',
      '<span class="token title important">a b\n<span class="token punctuation">---</span></span>'],
    ['> x\n---',
      '<span class="token blockquote punctuation">></span> <span class="token title important">x\n<span class="token punctuation">---</span></span>'],
    ['  Title  \r\n--',
      '  <span class="token title important">Title  \r\n<span class="token punctuation">--</span></span>'],
    // A line separator ends what `.` can cross, so the title starts after it.
    ['x y\n==',
      'x <span class="token title important">y\n<span class="token punctuation">==</span></span>'],
    // The reference starts at the first [ that reaches the ]: part.
    ['a [x [id]: http://e.com "t"',
      'a <span class="token url-reference url"><span class="token punctuation">[</span><span class="token variable">x [id</span><span class="token punctuation">]</span><span class="token punctuation">:</span> http://e.com <span class="token string">"t"</span></span>'],
    ['see [x]\n[id]: <http://e.com> (t)',
      'see [x]\n<span class="token url-reference url"><span class="token punctuation">[</span><span class="token variable">id</span><span class="token punctuation">]</span><span class="token punctuation">:</span> <span class="token punctuation">&lt;</span>http://e.com<span class="token punctuation">></span> <span class="token string">(t)</span></span>'],
    ['`[` [a](b)',
      '<span class="token code-snippet code keyword">`[`</span> <span class="token url">[<span class="token content">a</span>](<span class="token url">b</span>)</span>'],
  ];

  it.each(cases)('%j', async (code, html) => {
    expect(await tokenizePrism(code, 'markdown')).toBe(html);
  });
});
