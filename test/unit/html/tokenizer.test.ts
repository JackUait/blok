// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Tokenizer } from '../../../src/html/tokenizer';
import { TokenizerMode } from '../../../src/html/token';
import { Collector, type Collected } from './token-collector';

const SUITE = join(__dirname, '..', '..', 'fixtures', 'html5lib', 'tokenizer');

interface Html5libTest {
  description: string;
  input: string;
  output: unknown[][];
  initialStates?: string[];
  lastStartTag?: string;
  doubleEscaped?: boolean;
}

const unescape = (text: string): string =>
  text.replace(/\\[Uu]\w{4}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)));

// CDATA section is no TokenizerMode the tree builder can set: those cases run
// after `<![CDATA[` with inForeignNode on, which reaches the same state with nothing emitted.
const STATES: Record<string, { state: TokenizerMode; prefix: string }> = {
  'Data state': { state: TokenizerMode.DATA, prefix: '' },
  'PLAINTEXT state': { state: TokenizerMode.PLAINTEXT, prefix: '' },
  'RCDATA state': { state: TokenizerMode.RCDATA, prefix: '' },
  'RAWTEXT state': { state: TokenizerMode.RAWTEXT, prefix: '' },
  'Script data state': { state: TokenizerMode.SCRIPT_DATA, prefix: '' },
  'CDATA section state': { state: TokenizerMode.DATA, prefix: '<![CDATA[' },
};

/** Our output in html5lib's shape: one Character entry per run of text of any kind, no EOF. */
const toHtml5lib = (tokens: Collected): unknown[][] =>
  tokens.reduce<unknown[][]>((out, token) => {
    const [kind] = token;
    const last = out[out.length - 1];

    if (kind === 'Character' || kind === 'Whitespace' || kind === 'Null') {
      if (last !== undefined && last[0] === 'Character') {
        last[1] = `${String(last[1])}${String(token[1])}`;
      } else {
        out.push(['Character', token[1]]);
      }
    } else if (kind === 'StartTag') {
      const attrs = Object.fromEntries(token[2] as string[][]);

      out.push(token[3] === true ? ['StartTag', token[1], attrs, true] : ['StartTag', token[1], attrs]);
    } else if (kind === 'EndTag') {
      out.push(['EndTag', token[1]]);
    } else if (kind === 'DOCTYPE') {
      out.push(['DOCTYPE', token[1], token[2], token[3], token[4] !== true]);
    } else if (kind === 'Comment') {
      out.push(token);
    }

    return out;
  }, []);

const files = readdirSync(SUITE).filter((name) => name.endsWith('.test'));
const cases = files.flatMap((file) => {
  const suite = JSON.parse(readFileSync(join(SUITE, file), 'utf8')) as { tests?: Html5libTest[] };

  // xmlViolation.test keeps its cases under `xmlViolationTests`, for XML
  // serializers; parse5's harness skips it the same way.
  return (suite.tests ?? []).flatMap((test) =>
    (test.initialStates ?? ['Data state']).map((stateName) => ({ file, test, stateName }))
  );
});

describe('Tokenizer on the html5lib tokenizer suite', () => {
  it('reads all 13 files with cases, in every listed initial state', () => {
    expect(files).toHaveLength(14);
    expect(cases).toHaveLength(7032);
  });

  it('produces the expected tokens for every case', () => {
    const failures = cases.filter(({ test, stateName }) => {
      const input = test.doubleEscaped === true ? unescape(test.input) : test.input;
      const expected = test.doubleEscaped === true
        ? test.output.map((entry) => (typeof entry[1] === 'string' ? [entry[0], unescape(entry[1]), ...entry.slice(2)] : entry))
        : test.output;
      const { state, prefix } = STATES[stateName];
      const collector = new Collector(true);
      const tokenizer = new Tokenizer(collector);

      tokenizer.state = state;
      tokenizer.inForeignNode = prefix !== '';
      if (test.lastStartTag !== undefined) {
        tokenizer.lastStartTagName = test.lastStartTag;
      }
      tokenizer.write(prefix + input);

      return !collector.sawEof || collector.mixed.length > 0 || JSON.stringify(toHtml5lib(collector.tokens)) !== JSON.stringify(expected);
    });

    expect(failures.map(({ file, test, stateName }) => `${file}: ${test.description} (${stateName})`)).toEqual([]);
  });
});

const noop = (): void => undefined;
const NOOP_HANDLER = {
  onCharacter: noop, onNullCharacter: noop, onWhitespaceCharacter: noop, onStartTag: noop,
  onEndTag: noop, onComment: noop, onDoctype: noop, onEof: noop,
};

const PATHOLOGICAL: Array<{ name: string; build: (n: number) => string; state?: TokenizerMode; lastStartTagName?: string; foreign?: boolean }> = [
  { name: '<a repeated', build: (n) => '<a'.repeat(n) },
  { name: '& repeated', build: (n) => '&'.repeat(n) },
  { name: '&# repeated', build: (n) => '&#'.repeat(n) },
  { name: '&#x repeated', build: (n) => '&#x'.repeat(n) },
  { name: 'x& repeated', build: (n) => 'x&'.repeat(n) },
  { name: '&amp; repeated', build: (n) => '&amp;'.repeat(n) },
  { name: '&amp repeated', build: (n) => '&amp'.repeat(n) },
  { name: '&notin repeated', build: (n) => '&notin'.repeat(n) },
  { name: 'long reference name', build: (n) => `&${'a'.repeat(n)}` },
  { name: 'long numeric reference', build: (n) => `&#${'9'.repeat(n)};` },
  { name: '<!-- repeated', build: (n) => '<!--'.repeat(n) },
  { name: '<!-- - repeated', build: (n) => `<!--${'-'.repeat(n)}` },
  { name: '<! repeated', build: (n) => '<!'.repeat(n) },
  { name: '</ repeated', build: (n) => '</'.repeat(n) },
  { name: '<!DOCTYPE repeated', build: (n) => '<!DOCTYPE'.repeat(n) },
  { name: 'long doctype', build: (n) => `<!DOCTYPE html PUBLIC "${'x'.repeat(n)}`},
  { name: 'long attribute value', build: (n) => `<a b="${'x'.repeat(n)}` },
  { name: 'attribute value of references', build: (n) => `<a b="${'&amp;'.repeat(n)}">` },
  { name: 'unclosed quotes repeated', build: (n) => '<a b="'.repeat(n) },
  { name: 'unclosed single quotes repeated', build: (n) => "<a b='".repeat(n) },
  { name: 'many distinct attributes', build: (n) => `<a ${Array.from({ length: n }, (_, i) => `a${i}`).join(' ')}>` },
  { name: 'many repeated attributes', build: (n) => `<a ${'b '.repeat(n)}>` },
  { name: 'long tag name', build: (n) => `<${'a'.repeat(n)}` },
  { name: 'whitespace and words', build: (n) => 'ab '.repeat(n) },
  { name: 'NUL repeated', build: (n) => 'a\0'.repeat(n) },
  { name: 'CR LF repeated', build: (n) => 'a\r\n\r'.repeat(n) },
  { name: 'CDATA repeated', build: (n) => '<![CDATA['.repeat(n), foreign: true },
  { name: 'CDATA brackets', build: (n) => `<![CDATA[${']'.repeat(n)}`, foreign: true },
  { name: 'textarea end tags', build: (n) => '</textarea'.repeat(n), state: TokenizerMode.RCDATA, lastStartTagName: 'textarea' },
  { name: 'textarea near end tags', build: (n) => '</textareax'.repeat(n), state: TokenizerMode.RCDATA, lastStartTagName: 'textarea' },
  { name: 'script escapes', build: (n) => `<!--${'<script>'.repeat(n)}`, state: TokenizerMode.SCRIPT_DATA, lastStartTagName: 'script' },
  { name: 'script escape dashes', build: (n) => `<!--<script>${'-'.repeat(n)}`, state: TokenizerMode.SCRIPT_DATA, lastStartTagName: 'script' },
];

const timeOnce = (html: string, start: { state?: TokenizerMode; lastStartTagName?: string; foreign?: boolean }): number => {
  const tokenizer = new Tokenizer(NOOP_HANDLER);

  tokenizer.state = start.state ?? TokenizerMode.DATA;
  tokenizer.lastStartTagName = start.lastStartTagName ?? '';
  tokenizer.inForeignNode = start.foreign ?? false;
  const begin = performance.now();

  tokenizer.write(html);

  return performance.now() - begin;
};

const best = (html: string, start: Parameters<typeof timeOnce>[1]): number =>
  Math.min(...Array.from({ length: 3 }, () => timeOnce(html, start)));

describe('Tokenizer time', () => {
  // 8x the input must cost about 8x the time; a quadratic path costs 64x.
  it.each(PATHOLOGICAL)('stays linear on $name', (testCase) => {
    const n = 4000;
    const small = testCase.build(n);
    const large = testCase.build(8 * n);
    const ratios = Array.from({ length: 3 }).reduce<number[]>((seen) => {
      if (seen.length > 0 && seen[seen.length - 1] < 24) {
        return seen;
      }

      return [...seen, best(large, testCase) / Math.max(best(small, testCase), 0.05)];
    }, []);

    expect(ratios[ratios.length - 1]).toBeLessThan(24);
  });
});
