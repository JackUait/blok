// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Tokenizer } from '../../../src/html/tokenizer';
import { TokenType, TokenizerMode, type Token } from '../../../src/html/token';
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

/** Every token object the tokenizer hands out, in order. */
const record = (html: string, state = TokenizerMode.DATA): Token[] => {
  const tokens: Token[] = [];
  const push = (token: Token): void => {
    tokens.push(token);
  };
  const tokenizer = new Tokenizer({
    onCharacter: push, onNullCharacter: push, onWhitespaceCharacter: push, onStartTag: push,
    onEndTag: push, onComment: push, onDoctype: push, onEof: push,
  });

  tokenizer.state = state;
  tokenizer.write(html);

  return tokens;
};

describe('Tokenizer contract with the tree builder', () => {
  it('hands out a new object for every token and attribute, since the tree builder keeps and edits them', () => {
    const tokens = record('<a b="1" c=2>x y<a b="1">&amp;<!--c--><!--c--><!DOCTYPE html><!DOCTYPE html></a>\0\0 x');
    const attrs = tokens.flatMap((token) => ('attrs' in token ? token.attrs : []));

    expect(new Set(tokens).size).toBe(tokens.length);
    expect(new Set(tokens.flatMap((token) => ('attrs' in token ? [token.attrs] : []))).size).toBe(tokens.filter((token) => 'attrs' in token).length);
    expect(new Set(attrs).size).toBe(attrs.length);
  });

  it('emits a NUL run as one token', () => {
    expect(record('a\0\0\0b').map((token) => ('chars' in token ? token.chars : token.type))).toEqual(['a', '\0\0\0', 'b', TokenType.EOF]);
  });

  it('never closes text with an end tag when no start tag was seen', () => {
    const tokens = record('</textarea>x</title >', TokenizerMode.RCDATA);

    expect(tokens.map((token) => token.type)).toEqual([TokenType.CHARACTER, TokenType.WHITESPACE_CHARACTER, TokenType.CHARACTER, TokenType.EOF]);
  });

  it('sets state to DATA before a start tag, keeps a switch made for it and remembers its name', () => {
    const seen: Array<[string, TokenizerMode, string]> = [];
    const tokenizer: Tokenizer = new Tokenizer({
      ...NOOP_HANDLER,
      onStartTag: (token) => {
        seen.push([token.tagName, tokenizer.state, tokenizer.lastStartTagName]);
        if (token.tagName === 'textarea') {
          tokenizer.state = TokenizerMode.RCDATA;
        }
      },
      onCharacter: (token) => {
        seen.push([token.chars, -1, tokenizer.lastStartTagName]);
      },
    });

    tokenizer.write('<x>a<textarea><b></textarea><i>');

    expect(seen).toEqual([
      ['x', TokenizerMode.DATA, 'x'],
      ['a', -1, 'x'],
      ['textarea', TokenizerMode.DATA, 'textarea'],
      ['<b>', -1, 'textarea'],
      ['i', TokenizerMode.DATA, 'i'],
    ]);
  });

  it('does not throw on lone or doubled surrogates anywhere', () => {
    const odd = ['\udc00\udc00', '\ud800', '\udc00', '\ud800\ud800', '\ud83d\ude00'];
    const places = (text: string): string[] => [
      text, `<${text}>`, `<a${text}>`, `<a ${text}=${text}>`, `<a b="${text}">`, `<!--${text}-->`, `<!DOCTYPE ${text}>`,
      `<!${text}>`, `</${text}>`, `&${text};`, `<?${text}>`,
    ];

    expect(() => odd.flatMap(places).forEach((html) => record(html))).not.toThrow();
  });
});


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

const tokenize = (html: string, start: { state?: TokenizerMode; lastStartTagName?: string; foreign?: boolean }): void => {
  const tokenizer = new Tokenizer(NOOP_HANDLER);

  tokenizer.state = start.state ?? TokenizerMode.DATA;
  tokenizer.lastStartTagName = start.lastStartTagName ?? '';
  tokenizer.inForeignNode = start.foreign ?? false;
  tokenizer.write(html);
};

/** Best of five: the time of `times` runs over `html`. */
const best = (html: string, start: Parameters<typeof tokenize>[1], times: number): number =>
  Math.min(
    ...Array.from({ length: 5 }, () => {
      const begin = performance.now();

      Array.from({ length: times }).forEach(() => tokenize(html, start));

      return performance.now() - begin;
    })
  );

/** The smallest n (from 1000, doubling) whose input takes at least 0.5 ms, so timer noise stays small next to it. */
const calibrate = (testCase: (typeof PATHOLOGICAL)[number]): number =>
  [1000, 2000, 4000, 8000].find((n) => best(testCase.build(n), testCase, 1) >= 0.5) ?? 16000;

describe('Tokenizer time', () => {
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
