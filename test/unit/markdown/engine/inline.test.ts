import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../../src/markdown/engine';
import type { InlineContext } from '../../../../src/markdown/engine/inline';
import { parseInline } from '../../../../src/markdown/engine/inline';
import { MAX_INLINE_DEPTH } from '../../../../src/markdown/engine/inline-build';
import type { Nodes, PhrasingContent } from '../../../../types/data-formats/markdown-tree';

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
      expect(parseMarkdown('a\0b').children[0]).toStrictEqual({ type: 'paragraph', children: [text('a�b')] });
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

    it('measures those three columns from where the line really starts, after its container prefix', () => {
      const html = (markdown: string): unknown => {
        const stack: unknown[] = [parseMarkdown(markdown)];

        while (stack.length > 0) {
          const node = stack.pop() as { type: string; value?: string; children?: unknown[] };

          if (node.type === 'html') {
            return node.value;
          }

          stack.push(...[...(node.children ?? [])].reverse());
        }

        return undefined;
      };

      expect(html('- x <a\n\t\t> y')).toBe('<a\n   >');
      expect(html('> x <a\n> \t\t> y')).toBe('<a\n   >');
      expect(html('> x <a\n>\t\t> y')).toBe('<a\n   >');
      expect(html('- x <!--\n\t\ta\n\t-->')).toBe('<!--\n   a\n-->');
      expect(html('1. x <a\n\t\t\t> y')).toBe('<a\n  \t>');
      expect(html('- x <a\nb\n\t\t> y')).toBe('<a\nb\n   >');
      expect(html('x <a\n\t\t> y')).toBe('<a\n \t>');
      expect(html('- - x <a\n\t\t\t> y')).toBe('<a\n \t>');
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

  describe('nesting cap', () => {
    const N = 10_000;

    /** Deepest level below the paragraph (the paragraph is 0) and the text in order. */
    const measure = (markdown: string): { depth: number; text: string } => {
      const stack: Array<{ node: Nodes; depth: number }> = [{ node: parseMarkdown(markdown), depth: -1 }];
      const state = { depth: 0, text: '' };

      for (const cursor = { entry: stack.pop() }; cursor.entry !== undefined; cursor.entry = stack.pop()) {
        const { node, depth } = cursor.entry;

        state.depth = Math.max(state.depth, depth);
        state.text += node.type === 'text' ? node.value : '';

        if ('children' in node) {
          stack.push(...[...(node.children as Nodes[])].reverse().map((child) => ({ node: child, depth: depth + 1 })));
        }
      }

      return state;
    };

    const count = (text: string, part: string): number => text.split(part).length - 1;

    it.each(['**', '*', '~~'].flatMap((marker) => [[marker, MAX_INLINE_DEPTH + 1], [marker, N]] as const))('drops %j spans past the cap and keeps their text (%i levels)', (marker, size) => {
      const { depth, text } = measure(`${`${marker}a `.repeat(size)}b${` c${marker}`.repeat(size)}`);

      expect(depth).toBeLessThanOrEqual(MAX_INLINE_DEPTH + 1);
      expect([count(text, 'a'), count(text, 'b'), count(text, 'c')]).toStrictEqual([size, 1, size]);
    });

    it('keeps nested link brackets shallow', () => {
      const { depth, text } = measure(`${'['.repeat(N)}a${'](u)'.repeat(N)}`);

      expect(depth).toBeLessThanOrEqual(MAX_INLINE_DEPTH + 1);
      expect(count(text, 'a')).toBe(1);
      expect(count(text, '](u)')).toBe(N - 1);
    });

    it('drops spans inside links past the cap', () => {
      const { depth, text } = measure(`${'*a [b '.repeat(N)}c${'](u) d*'.repeat(N)}`);

      expect(depth).toBeLessThanOrEqual(MAX_INLINE_DEPTH + 1);
      expect([count(text, 'a'), count(text, 'b'), count(text, 'c'), count(text, 'd')]).toStrictEqual([N, N, 1, N]);
    });
  });

  describe('adversarial input stays linear and never throws', () => {
    const N = 20_000;
    const context = { definitions: new Set(['a']), footnotes: new Set(['1']), math: true };
    const cases: Record<string, (n: number) => string> = {
      'open brackets': (n) => '['.repeat(n),
      'nested labels': (n) => `${'['.repeat(n)}${']'.repeat(n)}`,
      'nested links': (n) => `${'['.repeat(n)}a${'](b)'.repeat(n)}`,
      'image openers': (n) => `${'!['.repeat(n)}${'[a](b)'.repeat(n)}`,
      'star runs': (n) => '*a'.repeat(n),
      'deep emphasis': (n) => `${'*a '.repeat(n)}b${' a*'.repeat(n)}`,
      'rule of 3 misses': (n) => `${'a*'.repeat(n)}${'a**'.repeat(n)}`,
      'deep strikethrough': (n) => `${'~~a '.repeat(n)}b${' a~~'.repeat(n)}`,
      'backticks': (n) => '`'.repeat(n),
      'backtick runs': (n) => '`a``b'.repeat(n),
      'dollar runs': (n) => '$a$$b'.repeat(n),
      'less-than signs': (n) => '<'.repeat(n),
      'open comments': (n) => '<!--'.repeat(n),
      'open quoted attributes': (n) => '<a b="'.repeat(n),
      'ampersands': (n) => '&amp'.repeat(n),
      'long www label': (n) => `www.${'a'.repeat(n)}`,
      'www dots': (n) => `www.a${'.'.repeat(n)}b`,
      'url parens': (n) => `www.a.com/${'('.repeat(n)}`,
      'destination parens': (n) => `[a](${'('.repeat(n)}`,
      'open titles': (n) => '[a](b ('.repeat(n),
      'email runs': (n) => `${'a.'.repeat(n)}@`,
      'rejected urls': (n) => 'éwww.a.b'.repeat(n),
      'hard breaks': (n) => 'a  \n'.repeat(n),
      // These two need more input: without their memo they are quadratic but cheap per step.
      'www with many dots': (n) => `www.a${'.'.repeat(n * 10)}b`,
      'closers that never find an opener': (n) => `${'_a '.repeat(n * 5)}${'a* '.repeat(n * 5)}`,
    };

    /** Fastest of three samples; each repeats for 25 ms so a 1 ms parse isn't all timer noise. */
    const fastest = (src: string): number => Math.min(...[0, 1, 2].map(() => {
      const start = performance.now();
      const runs = { count: 0 };

      while (runs.count === 0 || performance.now() - start < 25) {
        inline(src, context);
        runs.count += 1;
      }

      return (performance.now() - start) / runs.count;
    }));

    /**
     * The lowest of up to three ratio attempts, stopping at the first under 24.
     * A GC pause spikes one attempt; a quadratic path fails all three.
     * @param ratio - measures one ratio
     */
    const bestRatio = (ratio: () => number): number => {
      const attempts = [ratio()];

      while (attempts[attempts.length - 1] >= 24 && attempts.length < 3) {
        attempts.push(ratio());
      }

      return Math.min(...attempts);
    };

    // Eight times the input must cost about eight times the time (~8); a quadratic
    // path costs ~64. A ratio holds on a busy machine, where a wall-clock limit flakes.
    it.each(Object.entries(cases))('%s', (_name, make) => {
      const small = make(Math.floor(N / 4));
      const large = make(N * 2);

      expect(() => inline(small, context)).not.toThrow();
      expect(bestRatio(() => fastest(large) / fastest(small))).toBeLessThan(24);
    });
  });
});
