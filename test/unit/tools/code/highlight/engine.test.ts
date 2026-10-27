import { describe, expect, it } from 'vitest';
import {
  createHighlighter,
  insideOf,
  Token,
  tokenOf,
  type Grammar,
  type TokenStream,
} from '../../../../../src/tools/code/highlight/engine';

/** Same shape as Prism's test helper: whitespace-only strings are dropped. */
type Simple = string | [string, string | Simple[]];

const simplify = (stream: TokenStream): Simple[] => stream
  .map((item): Simple => {
    if (typeof item === 'string') {
      return item;
    }

    return [item.type, typeof item.content === 'string' ? item.content : simplify(item.content)];
  })
  .filter((item) => !(typeof item === 'string' && item.trim() === ''));

const tokens = (grammar: Grammar, code: string): Simple[] => {
  const hl = createHighlighter();

  hl.languages.test = grammar;

  return simplify(hl.tokenize(code, grammar));
};

// Ported from Prism 1.30.0 tests/core/greedy.js
describe('greedy matching', () => {
  it('handles tokens with the same name', () => {
    expect(tokens({
      comment: [
        /\/\/.*/,
        { pattern: /\/\*[\s\S]*?(?:\*\/|$)/, greedy: true },
      ],
    }, '// /*\n/* comment */')).toEqual([
      ['comment', '// /*'],
      ['comment', '/* comment */'],
    ]);
  });

  it('supports top-level alternatives that do not contain the lookbehind group', () => {
    expect(tokens({
      a: /'[^']*'/,
      b: { pattern: /foo|(^|[^\\])"[^"]*"/, lookbehind: true, greedy: true },
    }, 'foo "bar" \'baz\'')).toEqual([
      ['b', 'foo'],
      ['b', '"bar"'],
      ['a', "'baz'"],
    ]);
  });

  it('rematches tokens', () => {
    expect(tokens({
      a: { pattern: /'[^'\r\n]*'/ },
      b: { pattern: /"[^"\r\n]*"/, greedy: true },
      c: { pattern: /<[^>\r\n]*>/, greedy: true },
    }, '<\'> \'\' \'\'\n<"> "" ""')).toEqual([
      ['c', "<'>"],
      " '",
      ['a', "' '"],
      "'\n",
      ['c', '<">'],
      ['b', '""'],
      ['b', '""'],
    ]);
  });

  it('always matches greedy tokens against the whole text', () => {
    expect(tokens({
      a: /a/,
      b: { pattern: /^b/, greedy: true },
    }, 'bab')).toEqual([
      ['b', 'b'],
      ['a', 'a'],
      'b',
    ]);
  });

  it('drops an empty greedy token at the end of the text (issue 3052)', () => {
    expect(tokens({ 'oh-no': { pattern: /$/, greedy: true } }, 'foo')).toEqual(['foo']);
  });
});

describe('tokenize', () => {
  it('cuts the lookbehind group off the match', () => {
    expect(tokens({ b: { pattern: /(x)y/, lookbehind: true } }, 'xy')).toEqual(['x', ['b', 'y']]);
  });

  it('tokenizes inside a match with the inside grammar', () => {
    expect(tokens({
      tag: { pattern: /<\w+>/, inside: { punctuation: /[<>]/ } },
    }, '<a>')).toEqual([
      ['tag', [['punctuation', '<'], 'a', ['punctuation', '>']]],
    ]);
  });

  it('merges rest into the grammar', () => {
    expect(tokens({ a: /a/, rest: { b: /b/ } }, 'ab')).toEqual([['a', 'a'], ['b', 'b']]);
  });

  it('skips empty grammar entries', () => {
    const grammar: Grammar = { a: /a/ };

    Object.assign(grammar, { b: undefined });

    expect(tokens(grammar, 'ab')).toEqual([['a', 'a'], 'b']);
  });

  it('keeps the matched length on the token', () => {
    const hl = createHighlighter();
    const [token] = hl.tokenize('abc', { word: /abc/ });

    expect(token).toBeInstanceOf(Token);
    expect(token instanceof Token && token.length).toBe(3);
  });

  it('keeps the flags of a greedy pattern', () => {
    expect(tokens({ a: { pattern: /A/i, greedy: true } }, 'a')).toEqual([['a', 'a']]);
  });
});

describe('extend', () => {
  it('copies the base grammar, keeping shared references shared', () => {
    const hl = createHighlighter();
    const shared: Grammar = { x: /x/ };

    hl.languages.base = { a: { pattern: /a/, inside: shared }, b: { pattern: /b/, inside: shared } };

    const child = hl.extend('base', { c: /c/ });
    const a = child.a;
    const b = child.b;

    expect(a).not.toBe(hl.languages.base.a);
    expect(a && 'inside' in a && b && 'inside' in b && a.inside === b.inside).toBe(true);
    expect(Object.keys(child)).toEqual(['a', 'b', 'c']);
    expect(Object.keys(hl.languages.base)).toEqual(['a', 'b']);
  });

  it('keeps a grammar that refers to itself', () => {
    const hl = createHighlighter();
    const self: Grammar = { a: /a/ };

    self.rest = self;
    hl.languages.loop = self;

    const copy = hl.extend('loop', {});

    expect(copy.rest).toBe(copy);
  });
});

describe('insertBefore', () => {
  it('puts the new tokens before the named one', () => {
    const hl = createHighlighter();

    hl.languages.lang = { a: /a/, c: /c/ };
    hl.insertBefore('lang', 'c', { b: /b/ });

    expect(Object.keys(hl.languages.lang)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a token that already exists instead of duplicating it', () => {
    const hl = createHighlighter();
    const replacement = /B/;

    hl.languages.lang = { a: /a/, b: /b/, c: /c/ };
    hl.insertBefore('lang', 'a', { b: replacement });

    expect(Object.keys(hl.languages.lang)).toEqual(['b', 'a', 'c']);
    expect(hl.languages.lang.b).toBe(replacement);
  });

  it('points every other reference at the new grammar', () => {
    const hl = createHighlighter();

    hl.languages.lang = { a: /a/ };
    hl.languages.alias = hl.languages.lang;
    hl.languages.other = { wrapped: { pattern: /w/, inside: hl.languages.lang } };

    const next = hl.insertBefore('lang', 'a', { z: /z/ });
    const wrapped = hl.languages.other.wrapped;

    expect(hl.languages.alias).toBe(next);
    expect(wrapped && 'inside' in wrapped && wrapped.inside).toBe(next);
  });

  it('works on a nested grammar given as root', () => {
    const hl = createHighlighter();
    const tag: Grammar = { punctuation: /</ };

    hl.languages.markup = { tag: { pattern: /<\w+/, inside: tag } };

    const root = { inside: tag };

    hl.insertBefore('inside', 'punctuation', { name: /\w+/ }, root);

    expect(Object.keys(root.inside)).toEqual(['name', 'punctuation']);
  });
});

describe('highlight', () => {
  it('escapes & and < and turns no-break spaces into spaces', () => {
    const hl = createHighlighter();

    expect(hl.highlight('a&b<c>d e', {}, 'x')).toBe('a&amp;b&lt;c>d e');
  });

  it('wraps tokens in spans with their type and aliases as classes', () => {
    const hl = createHighlighter();

    expect(hl.highlight('ab', {
      a: { pattern: /a/, alias: 'x' },
      b: { pattern: /b/, alias: ['y', 'z'] },
    }, 'x')).toBe('<span class="token a x">a</span><span class="token b y z">b</span>');
  });

  it('escapes text inside nested tokens', () => {
    const hl = createHighlighter();

    expect(hl.highlight('<&>', { tag: { pattern: /.+/, inside: { p: /</ } } }, 'x'))
      .toBe('<span class="token tag"><span class="token p">&lt;</span>&amp;></span>');
  });

  it('lets a wrap hook add attributes, escaping their quotes', () => {
    const hl = createHighlighter();

    hl.hooks.add('wrap', (env) => {
      Object.assign(env.attributes, { title: `"${env.content}"` });
    });

    expect(hl.highlight('a', { a: /a/ }, 'x')).toBe('<span class="token a" title="&quot;a&quot;">a</span>');
  });

  it('runs before-tokenize and after-tokenize with the language', () => {
    const hl = createHighlighter();
    const seen: string[] = [];

    hl.hooks.add('before-tokenize', (env) => {
      seen.push(`before:${env.language}:${env.code}`);
      Object.assign(env, { code: 'b' });
    });
    hl.hooks.add('after-tokenize', (env) => {
      seen.push(`after:${env.tokens.length}`);
    });

    expect(hl.highlight('a', { b: /b/ }, 'lang')).toBe('<span class="token b">b</span>');
    expect(seen).toEqual(['before:lang:a', 'after:1']);
  });

  it('throws when a before-tokenize hook leaves no grammar', () => {
    const hl = createHighlighter();

    hl.hooks.add('before-tokenize', (env) => {
      Object.assign(env, { grammar: undefined });
    });

    expect(() => hl.highlight('a', {}, 'lang')).toThrow('The language "lang" has no grammar.');
  });
});

describe('tokenOf / insideOf', () => {
  it('returns the token object under a name, or inside an array of them', () => {
    const plain = { pattern: /a/ };
    const second = { pattern: /c/, inside: { x: /x/ } };
    const grammar: Grammar = { a: plain, list: [/b/, second] };

    expect(tokenOf(grammar, 'a')).toBe(plain);
    expect(tokenOf(grammar, 'list', 1)).toBe(second);
    expect(insideOf(grammar, 'list', 1)).toBe(second.inside);
  });

  it('throws on a missing token, a bare pattern, or a token with no inside grammar', () => {
    const grammar: Grammar = { bare: /a/, flat: { pattern: /b/ } };

    expect(() => tokenOf(grammar, 'missing')).toThrow('"missing"');
    expect(() => tokenOf(grammar, 'bare')).toThrow('"bare"');
    expect(() => insideOf(grammar, 'flat')).toThrow('"flat"');
    expect(() => tokenOf(undefined, 'a')).toThrow('"a"');
  });
});

describe('tokenizeWithHooks', () => {
  it('returns the tokens the hooks leave, without stringifying them', () => {
    const hl = createHighlighter();

    hl.hooks.add('after-tokenize', (env) => {
      env.tokens.push('!');
    });

    expect(simplify(hl.tokenizeWithHooks('a', { a: /a/ }, 'x'))).toEqual([['a', 'a'], '!']);
  });
});

describe('isolation', () => {
  it('keeps languages and hooks per instance', () => {
    const first = createHighlighter();
    const second = createHighlighter();

    first.languages.only = { a: /a/ };
    first.hooks.add('wrap', (env) => {
      env.classes.push('first');
    });

    expect(second.languages.only).toBeUndefined();
    expect(second.highlight('a', { a: /a/ }, 'x')).toBe('<span class="token a">a</span>');
  });

  it('has no inherited names in the language registry', () => {
    const hl = createHighlighter();

    expect(hl.languages.constructor).toBeUndefined();
    expect(hl.languages.toString).toBeUndefined();
    expect(hl.languages.extend).toBeUndefined();
  });

  it('sets no global', () => {
    createHighlighter();

    expect('Prism' in globalThis).toBe(false);
  });
});
