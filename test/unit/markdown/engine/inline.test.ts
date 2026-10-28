import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../../src/markdown/engine';
import type { InlineContext } from '../../../../src/markdown/engine/inline';
import { parseInline } from '../../../../src/markdown/engine/inline';
import type { PhrasingContent } from '../../../../types/data-formats/markdown-tree';

/**
 * The inline parser on its own: a leaf's content in, phrasing nodes out.
 * Expected trees are the ones Blok's old parser (micromark + mdast) built.
 */

const inline = (raw: string, context: Partial<InlineContext> = {}): PhrasingContent[] =>
  parseInline(raw, { definitions: new Set(), footnotes: new Set(), gfm: true, math: false, ...context });

const text = (value: string): PhrasingContent => ({ type: 'text', value });

const link = (url: string, children: PhrasingContent[], title: string | null = null): PhrasingContent => ({ type: 'link', url, title, children });

describe('parseInline', () => {
  describe('escapes and references', () => {
    it('makes a backslash before ASCII punctuation literal and keeps any other backslash', () => {
      expect(inline('a\\*b \\q')).toStrictEqual([text('a*b \\q')]);
    });

    it('decodes named and numeric references, turns code 0 into U+FFFD and keeps unknown names', () => {
      expect(inline('&amp; &#35; &#x41; &#0; &bogus; &copy')).toStrictEqual([text('& # A � &bogus; &copy')]);
    });

    it('reads NUL as U+FFFD', () => {
      expect(inline('a\0b')).toStrictEqual([text('a�b')]);
    });
  });

  describe('line endings', () => {
    it('keeps a soft break inside the text and drops the next line\'s indent', () => {
      expect(inline('a \n   b')).toStrictEqual([text('a\nb')]);
    });

    it('makes a hard break from two trailing spaces, but not when a tab is among them', () => {
      expect(inline('a  \nb')).toStrictEqual([text('a'), { type: 'break' }, text('b')]);
      expect(inline('a \t \nb')).toStrictEqual([text('a\nb')]);
    });

    it('makes a hard break from a backslash and keeps the spaces before it', () => {
      expect(inline('a  \\\nb')).toStrictEqual([text('a  '), { type: 'break' }, text('b')]);
    });

    it('counts a decoded space toward the text but not toward a hard break', () => {
      expect(inline('a&#32;\nb')).toStrictEqual([text('a \nb')]);
    });
  });

  describe('code spans', () => {
    it('takes precedence over emphasis and over a link that would end inside it', () => {
      expect(inline('`*a*` *b*')).toStrictEqual([{ type: 'inlineCode', value: '*a*' }, text(' '), { type: 'emphasis', children: [text('b')] }]);
      expect(inline('[x`]`](u)')).toStrictEqual([link('u', [text('x'), { type: 'inlineCode', value: ']' }])]);
    });

    it('strips one padding space each side, keeps all-space content and keeps line endings and indents', () => {
      expect(inline('` a ` `  ` `a\n  b`')).toStrictEqual([
        { type: 'inlineCode', value: 'a' },
        text(' '),
        { type: 'inlineCode', value: '  ' },
        text(' '),
        { type: 'inlineCode', value: 'a\n  b' },
      ]);
    });

    it('leaves a run without a closer of the same size as text', () => {
      expect(inline('``a`')).toStrictEqual([text('``a`')]);
    });

    it('unescapes pipes in a table cell\'s code, as the old table support did', () => {
      expect(inline('`a\\|b\\\\|`', { inTable: true })).toStrictEqual([{ type: 'inlineCode', value: 'a|b\\\\|' }]);
      expect(inline('`a\\|b`')).toStrictEqual([{ type: 'inlineCode', value: 'a\\|b' }]);
    });
  });

  describe('emphasis', () => {
    it('nests *** as emphasis around strong', () => {
      expect(inline('***a***')).toStrictEqual([{ type: 'emphasis', children: [{ type: 'strong', children: [text('a')] }] }]);
    });

    it('applies the rule of 3 to runs that can both open and close', () => {
      expect(inline('*foo**bar*')).toStrictEqual([{ type: 'emphasis', children: [text('foo**bar')] }]);
    });

    it('does not open or close `_` inside a word', () => {
      expect(inline('foo_bar_ _foo_bar')).toStrictEqual([text('foo_bar_ _foo_bar')]);
    });

    it('needs whitespace or punctuation on the far side when a run touches punctuation', () => {
      expect(inline('a*"foo"*')).toStrictEqual([text('a*"foo"*')]);
    });

    it('lets a neighbouring delimiter character loosen flanking, as the old parser did', () => {
      expect(inline('a*_*')).toStrictEqual([text('a'), { type: 'emphasis', children: [text('_')] }]);
    });

    it('lets a link win over emphasis that would cross it', () => {
      expect(inline('*[a*](u)')).toStrictEqual([text('*'), link('u', [text('a*')])]);
      expect(inline('[a *b](u) c*')).toStrictEqual([link('u', [text('a *b')]), text(' c*')]);
    });
  });

  describe('strikethrough', () => {
    it('pairs one or two tildes of the same size and leaves longer runs as text', () => {
      expect(inline('~a~ ~~b~~ ~~~c~~~')).toStrictEqual([
        { type: 'delete', children: [text('a')] },
        text(' '),
        { type: 'delete', children: [text('b')] },
        text(' ~~~c~~~'),
      ]);
    });

    it('resolves whichever of emphasis and strikethrough appears first, and never crosses them', () => {
      expect(inline('*a ~~b* c~~')).toStrictEqual([{ type: 'emphasis', children: [text('a ~~b')] }, text(' c~~')]);
      expect(inline('~~a *b~~ c*')).toStrictEqual([{ type: 'delete', children: [text('a *b')] }, text(' c*')]);
    });

    it('resolves strikethrough first inside a link label', () => {
      expect(inline('[*a ~~b* c~~](u)')).toStrictEqual([link('u', [text('*a '), { type: 'delete', children: [text('b* c')] }])]);
    });

    it('is text without GFM', () => {
      expect(inline('~~a~~', { gfm: false })).toStrictEqual([text('~~a~~')]);
    });
  });

  describe('links and images', () => {
    it('reads an enclosed destination and a title, and makes an empty title null', () => {
      expect(inline('[a](<b c> "t") [d](e "")')).toStrictEqual([link('b c', [text('a')], 't'), text(' '), link('e', [text('d')])]);
    });

    it('allows an unescaped ( inside a parenthesised title', () => {
      expect(inline('[a](b (c(d)))')).toStrictEqual([link('b', [text('a')], 'c(d'), text(')')]);
    });

    it('drops the indent of a title\'s continuation line', () => {
      expect(inline('[a](b "\n  c")')).toStrictEqual([link('b', [text('a')], '\nc')]);
    });

    it('does not nest links: an inner link deactivates the outer bracket', () => {
      expect(inline('[a [b](c) d](e)')).toStrictEqual([text('[a '), link('c', [text('b')]), text(' d](e)')]);
    });

    it('lets an image hold a link and flattens its content into alt', () => {
      expect(inline('[![a *b* `c`](i "t")](u)')).toStrictEqual([link('u', [{ type: 'image', url: 'i', title: 't', alt: 'a b c' }])]);
    });

    it('resolves full, collapsed and shortcut references only to defined labels', () => {
      const definitions = new Set(['a', 'foo bar']);

      expect(inline('[x][A] [Foo\n  Bar][] [a] [c] [d][c]', { definitions })).toStrictEqual([
        { type: 'linkReference', identifier: 'a', label: 'A', referenceType: 'full', children: [text('x')] },
        text(' '),
        { type: 'linkReference', identifier: 'foo bar', label: 'Foo\n  Bar', referenceType: 'collapsed', children: [text('Foo\nBar')] },
        text(' '),
        { type: 'linkReference', identifier: 'a', label: 'a', referenceType: 'shortcut', children: [text('a')] },
        text(' [c] [d][c]'),
      ]);
    });

    it('keeps a defined label followed by an undefined full reference as text', () => {
      expect(inline('[a][b]', { definitions: new Set(['a']) })).toStrictEqual([text('[a][b]')]);
    });
  });

  describe('autolinks and HTML', () => {
    it('links <scheme:…> and <email> without decoding them', () => {
      expect(inline('<http://a.b?c&amp;> <a@b.co>')).toStrictEqual([
        link('http://a.b?c&amp;', [text('http://a.b?c&amp;')]),
        text(' '),
        link('mailto:a@b.co', [text('a@b.co')]),
      ]);
    });

    it('keeps tags, comments and instructions as html nodes', () => {
      expect(inline('<a href="x">y</a><!-- c --><?p?>')).toStrictEqual([
        { type: 'html', value: '<a href="x">' },
        text('y'),
        { type: 'html', value: '</a>' },
        { type: 'html', value: '<!-- c -->' },
        { type: 'html', value: '<?p?>' },
      ]);
    });

    it('drops up to three columns of a continuation line\'s indent inside HTML', () => {
      expect(inline('a <x\n    y>')).toStrictEqual([text('a '), { type: 'html', value: '<x\n y>' }]);
    });
  });

  describe('footnote calls', () => {
    it('makes [^x] a call only when x is a footnote definition', () => {
      expect(inline('[^X] [^y]', { footnotes: new Set(['x']) })).toStrictEqual([
        { type: 'footnoteReference', identifier: 'x', label: 'X' },
        text(' [^y]'),
      ]);
    });

    it('reads ![^x] that is no image as `!` and a call', () => {
      expect(inline('![^x]', { footnotes: new Set(['x']) })).toStrictEqual([text('!'), { type: 'footnoteReference', identifier: 'x', label: 'x' }]);
    });
  });

  describe('GFM autolink literals', () => {
    it('links www. and http(s):// and leaves trailing punctuation outside', () => {
      expect(inline('www.a.com/b(c)). https://a.b/c?d=e.')).toStrictEqual([
        link('http://www.a.com/b(c)', [text('www.a.com/b(c)')]),
        text('). '),
        link('https://a.b/c?d=e', [text('https://a.b/c?d=e')]),
        text('.'),
      ]);
    });

    it('leaves an entity-like trail outside the link', () => {
      expect(inline('www.a.com&amp;')).toStrictEqual([link('http://www.a.com', [text('www.a.com')]), text('&')]);
    });

    it('does not start an email right after a slash', () => {
      expect(inline('/a.b@c.d')).toStrictEqual([text('/a.'), link('mailto:b@c.d', [text('b@c.d')])]);
    });

    it('links a literal the scanner refused, from the finished text', () => {
      expect(inline('\\\\www.a.com')).toStrictEqual([text('\\'), link('http://www.a.com', [text('www.a.com')])]);
    });

    it('does not link inside link text', () => {
      expect(inline('[www.a.com](u)')).toStrictEqual([link('u', [text('www.a.com')])]);
    });

    it('does nothing without GFM', () => {
      expect(inline('www.a.com', { gfm: false })).toStrictEqual([text('www.a.com')]);
    });
  });

  describe('math', () => {
    it('parses $…$ and $$…$$ and strips padding', () => {
      expect(inline('$x$ $$ y $$', { math: true })).toStrictEqual([{ type: 'inlineMath', value: 'x' }, text(' '), { type: 'inlineMath', value: 'y' }]);
    });

    it('keeps prices as text and still finds a formula after them (price guard)', () => {
      expect(inline('costs $5 and later $x^2$', { math: true })).toStrictEqual([text('costs $5 and later '), { type: 'inlineMath', value: 'x^2' }]);
      expect(inline('$5/$month', { math: true })).toStrictEqual([text('$5/$month')]);
    });

    it('is text when math is off', () => {
      expect(inline('$x$')).toStrictEqual([text('$x$')]);
    });
  });

  describe('through parseMarkdown', () => {
    it('resolves a reference to a definition elsewhere in the document', () => {
      expect(parseMarkdown('[a]\n\n[a]: /u').children[0]).toStrictEqual({
        type: 'paragraph',
        children: [{ type: 'linkReference', identifier: 'a', label: 'a', referenceType: 'shortcut', children: [text('a')] }],
      });
    });
  });

  describe('adversarial input stays fast and never throws', () => {
    const N = 20_000;
    const cases: Record<string, string> = {
      'open brackets': '['.repeat(N),
      'nested labels': `${'['.repeat(N)}${']'.repeat(N)}`,
      'nested links': `${'['.repeat(N)}a${'](b)'.repeat(N)}`,
      'image openers': `${'!['.repeat(N)}${'[a](b)'.repeat(N)}`,
      'star runs': '*a'.repeat(N),
      'deep emphasis': `${'*a '.repeat(N)}b${' a*'.repeat(N)}`,
      'rule of 3 misses': `${'a*'.repeat(N)}${'a**'.repeat(N)}`,
      'deep strikethrough': `${'~~a '.repeat(N)}b${' a~~'.repeat(N)}`,
      'backticks': '`'.repeat(N),
      'backtick runs': '`a``b'.repeat(N),
      'dollar runs': '$a$$b'.repeat(N),
      'less-than signs': '<'.repeat(N),
      'open comments': '<!--'.repeat(N),
      'open quoted attributes': '<a b="'.repeat(N),
      'ampersands': '&amp'.repeat(N),
      'long www label': `www.${'a'.repeat(N)}`,
      'www dots': `www.a${'.'.repeat(N)}b`,
      'url parens': `www.a.com/${'('.repeat(N)}`,
      'destination parens': `[a](${'('.repeat(N)}`,
      'open titles': '[a](b ('.repeat(N),
      'email runs': `${'a.'.repeat(N)}@`,
      'rejected urls': 'éwww.a.b'.repeat(N),
      'hard breaks': 'a  \n'.repeat(N),
      // These two need more input: without their memo they are quadratic but cheap per step.
      'www with many dots': `www.a${'.'.repeat(N * 10)}b`,
      'closers that never find an opener': `${'_a '.repeat(N * 5)}${'a* '.repeat(N * 5)}`,
    };

    it.each(Object.entries(cases))('%s', (_name, src) => {
      const started = performance.now();

      expect(() => inline(src, { definitions: new Set(['a']), footnotes: new Set(['1']), math: true })).not.toThrow();
      expect(performance.now() - started).toBeLessThan(2000);
    });
  });
});
