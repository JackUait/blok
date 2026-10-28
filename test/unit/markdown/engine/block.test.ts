import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../../src/markdown/engine';
import { MAX_CONTAINER_DEPTH } from '../../../../src/markdown/engine/block';
import { MAX_INLINE_DEPTH } from '../../../../src/markdown/engine/inline-build';
import type { Nodes, Root, RootContent } from '../../../../types/data-formats/markdown-tree';

/**
 * Block structure rules where the old parser (micromark) differs from a
 * plain reading of CommonMark, or where the rule is easy to break. Each is
 * pinned through the public entry point.
 */

/** Block types only, inline content dropped. */
const shape = (node: Nodes): unknown => {
  const { type } = node;

  if (type === 'paragraph' || type === 'heading' || type === 'tableCell' || !('children' in node)) {
    return type;
  }

  return { [type]: (node.children as RootContent[]).map(shape) };
};

const blocks = (markdown: string, gfm = true): unknown => (shape(parseMarkdown(markdown, { gfm })) as { root: unknown }).root;

/** The deepest level (the root is 0) and every node in document order, walked without recursion. */
const walk = (root: Root): { depth: number; nodes: Nodes[] } => {
  const stack: Array<{ node: Nodes; depth: number }> = [{ node: root, depth: 0 }];
  const nodes: Nodes[] = [];
  const state = { depth: 0 };

  for (const cursor = { entry: stack.pop() }; cursor.entry !== undefined; cursor.entry = stack.pop()) {
    const { node, depth } = cursor.entry;

    nodes.push(node);
    state.depth = Math.max(state.depth, depth);

    if ('children' in node) {
      stack.push(...[...(node.children as Nodes[])].reverse().map((child) => ({ node: child, depth: depth + 1 })));
    }
  }

  return { depth: state.depth, nodes };
};

/** Text values in document order. */
const textOf = (nodes: Nodes[]): string => nodes.map((node) => (node.type === 'text' ? node.value : '')).join('');

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

const countOf = (nodes: Nodes[], type: Nodes['type']): number => nodes.filter((node) => node.type === type).length;

const firstOf = <T extends Nodes['type']>(root: Root, type: T): Extract<Nodes, { type: T }> | undefined => {
  const stack: Nodes[] = [root];

  while (stack.length > 0) {
    const node = stack.shift();

    if (node?.type === type) {
      return node as Extract<Nodes, { type: T }>;
    }

    if (node !== undefined && 'children' in node) {
      stack.push(...(node.children as Nodes[]));
    }
  }

  return undefined;
};

describe('block parser', () => {
  describe('laziness and interruption', () => {
    it('lets a paragraph continue lazily into a block quote, but not a setext underline', () => {
      expect(blocks('> a\nb')).toStrictEqual([{ blockquote: ['paragraph'] }]);
      expect(blocks('> a\n---')).toStrictEqual([{ blockquote: ['paragraph'] }, 'thematicBreak']);
    });

    it('keeps an ordered list that does not start at 1 from interrupting a paragraph, even in a new block quote', () => {
      expect(blocks('a\n2. b')).toStrictEqual(['paragraph']);
      expect(blocks('a\n> 2) b')).toStrictEqual(['paragraph', { blockquote: ['paragraph'] }]);
    });

    it('treats indented code like a paragraph for list interruption', () => {
      expect(blocks('    a\n\n2) b')).toStrictEqual(['code', 'paragraph']);
      expect(blocks('    a\n- b')).toStrictEqual(['code', { list: [{ listItem: ['paragraph'] }] }]);
    });

    it('keeps a lazy HTML tag line inside the container when another line follows it', () => {
      expect(blocks('> a\n<b>\nc')).toStrictEqual([{ blockquote: ['paragraph', 'html'] }, 'paragraph']);
      expect(blocks('> a\n<b>')).toStrictEqual([{ blockquote: ['paragraph'] }, 'html']);
    });

    it('ends indented code that starts on a lazy line with that line', () => {
      expect(blocks('   1.  A\n\n      +     x\n\n       > y\n')).toStrictEqual([
        { list: [{ listItem: ['paragraph'] }] },
        'code',
        'code',
      ]);
    });
  });

  describe('paragraph text', () => {
    it('keeps the indentation of later lines for code spans, which keep it', () => {
      expect(firstOf(parseMarkdown('a `b\n\tc` d'), 'inlineCode')).toStrictEqual({ type: 'inlineCode', value: 'b\n\tc' });
    });
  });

  describe('lists', () => {
    it('ends an item that started blank once a blank line follows', () => {
      expect(blocks('-\n  a')).toStrictEqual([{ list: [{ listItem: ['paragraph'] }] }]);
      expect(blocks('-\n\n  a')).toStrictEqual([{ list: [{ listItem: [] }] }, 'paragraph']);
    });

    it('starts a new list when the bullet or delimiter changes', () => {
      expect(blocks('- a\n+ b\n1. c\n1) d')).toStrictEqual([
        { list: [{ listItem: ['paragraph'] }] },
        { list: [{ listItem: ['paragraph'] }] },
        { list: [{ listItem: ['paragraph'] }] },
        { list: [{ listItem: ['paragraph'] }] },
      ]);
    });

    it('reads task boxes only at the very start of an item\'s first paragraph', () => {
      const checked = (markdown: string): Array<boolean | null> => {
        const list = firstOf(parseMarkdown(markdown), 'list');

        return list?.children.map((item) => item.checked) ?? [];
      };

      expect(checked('- [ ] a\n- [x] b\n- [X] c\n- [x]b\n- [x]')).toStrictEqual([false, true, true, null, null]);
      expect(checked('-\n  [x] a')).toStrictEqual([true]);
      expect(checked('-  \n  [x] a')).toStrictEqual([null]);
      expect(checked('-\n   [x] a')).toStrictEqual([null]);
      expect(checked('- [x] a\n  ===')).toStrictEqual([null]);
      expect(parseMarkdown('- [x] a', { gfm: false }).children).toMatchObject([{ children: [{ checked: null }] }]);
    });

    it('reads [<tab>] as a task box only when the tab is one column wide', () => {
      const first = (markdown: string): { checked: boolean | null | undefined; text: string } => {
        const item = firstOf(parseMarkdown(markdown), 'listItem');
        const paragraph = firstOf(parseMarkdown(markdown), 'paragraph');
        const node = paragraph?.children[0];

        return { checked: item?.checked, text: node?.type === 'text' ? node.value : '' };
      };

      expect(first('- [\t] a')).toStrictEqual({ checked: false, text: 'a' });
      expect(first('* [\t] a')).toStrictEqual({ checked: false, text: 'a' });
      expect(first('- [\t]\nb')).toStrictEqual({ checked: false, text: 'b' });
      expect(first('-\n  [\t] a')).toStrictEqual({ checked: false, text: 'a' });

      for (const markdown of ['1. [\t] a', '-\t[\t] a', '- - [\t] a', '> - [\t] a', '-  [\t] a', '   - [\t] a', '1) [\t] a']) {
        expect(first(markdown)).toStrictEqual({ checked: null, text: '[\t] a' });
      }

      expect(first('1. [\t]\nb')).toStrictEqual({ checked: null, text: '[\t]\nb' });
      expect(first('1. [\t]\ta')).toStrictEqual({ checked: null, text: '[\t]\ta' });
    });
  });

  describe('GFM tables', () => {
    it('takes the paragraph\'s last line as the head when a delimiter row follows', () => {
      expect(blocks('x\na | b\n-|-\nc')).toStrictEqual([
        'paragraph',
        { table: [{ tableRow: ['tableCell', 'tableCell'] }, { tableRow: ['tableCell'] }] },
      ]);
    });

    it('needs a pipe or colon in the delimiter row and matching cell counts', () => {
      expect(blocks('| a |\n---')).toStrictEqual(['heading']);
      expect(blocks('| a | b\n| - |')).toStrictEqual(['paragraph']);
      expect(blocks('a\n:-')).toStrictEqual([{ table: [{ tableRow: ['tableCell'] }] }]);
    });

    it('gives way to a list marker, and ends at a block start, a blank line or a lazy line', () => {
      expect(blocks('a | b\n- | -')).toStrictEqual(['paragraph', { list: [{ listItem: ['paragraph'] }] }]);
      expect(blocks('|a|\n|-|\n> b')).toStrictEqual([{ table: [{ tableRow: ['tableCell'] }] }, { blockquote: ['paragraph'] }]);
      expect(blocks('> |a|\n> |-|\nb')).toStrictEqual([{ blockquote: [{ table: [{ tableRow: ['tableCell'] }] }] }, 'paragraph']);
    });

    it('never takes a lazy line right after a table, or an indented continuation line, as a head', () => {
      expect(blocks('* y\n    :-\n-|-\n|---|---|\n|---|---|')).toStrictEqual([
        { list: [{ listItem: [{ table: [{ tableRow: ['tableCell'] }] }] }] },
        'paragraph',
        { table: [{ tableRow: ['tableCell', 'tableCell'] }] },
      ]);
      expect(blocks('a\n    b|c\n-|-')).toStrictEqual(['paragraph']);
    });

    it('starts HTML instead when the head line is an HTML tag', () => {
      expect(blocks('|\n<b>\n:-')).toStrictEqual(['paragraph', 'html']);
    });

    it('keeps an escaped pipe in one cell and passes it to code as a plain pipe', () => {
      const table = firstOf(parseMarkdown('a|b\n-|-\n`c\\|d` | e'), 'table');

      expect(table?.children[1].children).toHaveLength(2);
      expect(firstOf(parseMarkdown('a|b\n-|-\n`c\\|d` | e'), 'tableCell')).toBeDefined();
    });

    it('keeps an escaped pipe as written outside code, as the old parser did', () => {
      const cell = (text: string): unknown =>
        parseMarkdown(`| h |\n| - |\n| ${text} |\n\n[a\\|b]: /u\n`).children[0];
      const body = (text: string): unknown => (cell(text) as { children: Array<{ children: Array<{ children: unknown }> }> })
        .children[1].children[0].children;

      expect(body('www.a.com\\|b')).toStrictEqual([
        { type: 'link', title: null, url: 'http://www.a.com\\|b', children: [{ type: 'text', value: 'www.a.com\\|b' }] },
      ]);
      expect(body('<a b="\\|">')).toStrictEqual([{ type: 'html', value: '<a b="\\|">' }]);
      expect(body('[a\\|b]')).toStrictEqual([
        { type: 'linkReference', identifier: 'a\\|b', label: 'a|b', referenceType: 'shortcut', children: [{ type: 'text', value: 'a|b' }] },
      ]);
      expect(body('`x\\|y`')).toStrictEqual([{ type: 'inlineCode', value: 'x|y' }]);
      expect(body('a\\|b')).toStrictEqual([{ type: 'text', value: 'a|b' }]);
    });

    it('is off without GFM', () => {
      expect(blocks('a|b\n-|-', false)).toStrictEqual(['paragraph']);
    });
  });

  describe('footnote definitions', () => {
    it('continue on blank lines and four-column indentation, and interrupt a paragraph', () => {
      expect(blocks('a\n[^x]: b\n\n\n    c\nd')).toStrictEqual(['paragraph', { footnoteDefinition: ['paragraph', 'paragraph'] }]);
    });

    it('let a nested definition continue on a line its parent took four columns from', () => {
      expect(blocks('[^a]: [^b]: c\n\n    d')).toStrictEqual([{ footnoteDefinition: [{ footnoteDefinition: ['paragraph', 'paragraph'] }] }]);
    });

    it('keep the label as written, unescaped, and the identifier normalized', () => {
      expect(parseMarkdown('[^A\\]b]: c').children[0]).toMatchObject({ type: 'footnoteDefinition', label: 'A]b', identifier: 'a\\]b' });
    });
  });

  describe('definitions', () => {
    it('keep a multi-line label as written and strip continuation indentation from a title', () => {
      expect(parseMarkdown('[a\n  b]: c \'d\n  e\'').children[0]).toStrictEqual({
        type: 'definition', identifier: 'a b', label: 'a\n  b', url: 'c', title: 'd\ne',
      });
    });

    it('turn an empty title into null', () => {
      expect(parseMarkdown('[x]: <> ""').children[0]).toMatchObject({ url: '', title: null });
    });

    it('cannot make a setext heading on their own', () => {
      expect(blocks('[a]: b\n===')).toStrictEqual(['definition', 'paragraph']);
      expect(blocks('[a]: b\nc\n===')).toStrictEqual(['definition', 'heading']);
    });
  });

  describe('raw blocks', () => {
    it('ends an HTML comment or CDATA block the way the old parser scans, without backtracking', () => {
      expect(blocks('<!-->\na')).toStrictEqual(['html', 'paragraph']);
      expect(blocks('<![CDATA[\n]]]>\na')).toStrictEqual(['html']);
    });

    it('keeps the last line ending of open raw HTML when a new container ends it', () => {
      expect(parseMarkdown('- <!--\n+ a').children[0]).toMatchObject({ children: [{ children: [{ type: 'html', value: '<!--\n' }] }] });
      expect(parseMarkdown('> <!--\n> a\n').children[0]).toMatchObject({ children: [{ type: 'html', value: '<!--\na' }] });
    });

    it.each<[string, RootContent[]]>([
      ['<img src=a/b.png>', [{ type: 'paragraph', children: [{ type: 'text', value: '<img src=a/b.png>' }] }]],
      ['<img src=/b.png>', [{ type: 'paragraph', children: [{ type: 'html', value: '<img src=/b.png>' }] }]],
      ['<a href=http://x.com>', [{ type: 'paragraph', children: [{ type: 'text', value: '<a href=' }, { type: 'link', title: null, url: 'http://x.com>', children: [{ type: 'text', value: 'http://x.com>' }] }] }]],
      ['<a href=http://x.com>\n*text*</a>', [{ type: 'paragraph', children: [{ type: 'text', value: '<a href=' }, { type: 'link', title: null, url: 'http://x.com>', children: [{ type: 'text', value: 'http://x.com>' }] }, { type: 'text', value: '\n' }, { type: 'emphasis', children: [{ type: 'text', value: 'text' }] }, { type: 'html', value: '</a>' }] }]],
      ['<x y=z/ >', [{ type: 'paragraph', children: [{ type: 'text', value: '<x y=z/ >' }] }]],
      ['<x y=z/w>', [{ type: 'paragraph', children: [{ type: 'text', value: '<x y=z/w>' }] }]],
      ['<x y=/ >', [{ type: 'paragraph', children: [{ type: 'html', value: '<x y=/ >' }] }]],
      ['<x y=a/ z>', [{ type: 'paragraph', children: [{ type: 'text', value: '<x y=a/ z>' }] }]],
      ['<x y="a" =b>', [{ type: 'paragraph', children: [{ type: 'text', value: '<x y="a" =b>' }] }]],
      ['<span a=b=c>\n**bold**', [{ type: 'html', value: '<span a=b=c>\n**bold**' }]],
      ['<x y=z=w>', [{ type: 'html', value: '<x y=z=w>' }]],
      ['<x y = z = w>', [{ type: 'html', value: '<x y = z = w>' }]],
      ['<x y=z =w>', [{ type: 'html', value: '<x y=z =w>' }]],
      ['<x y=z=w>\n|-|', [{ type: 'html', value: '<x y=z=w>\n|-|' }]],
      ['<x y=z/>', [{ type: 'html', value: '<x y=z/>' }]],
      ['<x y=/>', [{ type: 'html', value: '<x y=/>' }]],
    ])('ends an unquoted attribute value at / and = when deciding an HTML tag line: %j', (markdown, children) => {
      expect(parseMarkdown(markdown).children).toStrictEqual(children);
    });

    it('splits a fence info string into lang and meta, keeping trailing meta whitespace', () => {
      expect(parseMarkdown('``` \t a&amp;b  c d \t\nx\n```').children[0]).toStrictEqual({
        type: 'code', lang: 'a&b', meta: 'c d \t', value: 'x',
      });
    });

    it('keeps indented-code trailing lines that had four columns', () => {
      expect(parseMarkdown('    a\n      \n    \nx').children[0]).toStrictEqual({ type: 'code', lang: null, meta: null, value: 'a\n  ' });
    });

    it('parses $$ math blocks only with math on', () => {
      expect(parseMarkdown('$$ m\na\n$$', { math: true }).children[0]).toStrictEqual({ type: 'math', meta: 'm', value: 'a' });
      expect(blocks('$$ m\na\n$$')).toStrictEqual(['paragraph']);
    });
  });

  describe('nesting cap', () => {
    const N = 10_000;
    // Root, containers, then a table, row and cell (a paragraph is shallower), inline wrappers, text.
    const bound = MAX_CONTAINER_DEPTH + 3 + MAX_INLINE_DEPTH + 1;

    it('keeps the tree shallow enough for recursive consumers', () => {
      expect(bound).toBeLessThanOrEqual(250);
    });

    // Just past the cap (a list level is two containers) and far past it.
    const sizes = [MAX_CONTAINER_DEPTH / 2 + 1, MAX_CONTAINER_DEPTH + 1, N];

    it.each(sizes.flatMap((size) => [
      ['> ', 'blockquote', '>', size],
      ['- ', 'listItem', '-', size],
      ['1. ', 'listItem', '1.', size],
    ] as const))('reads %j past the cap as text (%s, %s, %i levels)', (marker, container, written, size) => {
      const { depth, nodes } = walk(parseMarkdown(`${marker.repeat(size)}a`));
      const text = textOf(nodes);

      expect(depth).toBeLessThanOrEqual(bound);
      expect(countOf(nodes, container) + occurrences(text, written)).toBe(size);
      expect(text.endsWith('a')).toBe(true);
    });

    it.each(sizes)('reads footnote definitions past the cap as text, never as a link definition (%i levels)', (size) => {
      const { depth, nodes } = walk(parseMarkdown(`${'[^a]: '.repeat(size)}a`));
      const written = countOf(nodes, 'footnoteReference') + occurrences(textOf(nodes), '[^a]');

      expect(countOf(nodes, 'definition')).toBe(0);
      expect(textOf(nodes).endsWith('a')).toBe(true);
      expect(depth).toBeLessThanOrEqual(bound);
      expect(countOf(nodes, 'footnoteDefinition') + written).toBe(size);
    });

    it('keeps link definitions that come before a refused footnote line', () => {
      const { nodes } = walk(parseMarkdown(`${'[^a]: '.repeat(MAX_CONTAINER_DEPTH)}[x]: y\n${'    '.repeat(MAX_CONTAINER_DEPTH)}[^a]: a`));

      expect(countOf(nodes, 'definition')).toBe(1);
      expect(textOf(nodes)).toContain('a');
    });

    it('keeps every line of a list indented one level per line', () => {
      const { depth, nodes } = walk(parseMarkdown(Array.from({ length: 1000 }, (_, index) => `${'  '.repeat(index)}- a`).join('\n')));

      expect(depth).toBeLessThanOrEqual(bound);
      expect(occurrences(textOf(nodes), 'a')).toBe(1000);
      expect(countOf(nodes, 'listItem') + occurrences(textOf(nodes), '-')).toBe(1000);
    });

    it('bounds containers and inline wrappers together', () => {
      const { depth, nodes } = walk(parseMarkdown(`${'> - '.repeat(N)}${'*a '.repeat(N)}b${' c*'.repeat(N)}`));

      expect(depth).toBeLessThanOrEqual(bound);
      expect(occurrences(textOf(nodes), 'a')).toBe(N);
      expect(occurrences(textOf(nodes), 'c')).toBe(N);
    });
  });

  describe('robustness', () => {
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

    /** Fastest of three samples; each repeats for 25 ms so a 1 ms parse isn't all timer noise. */
    const fastest = (run: () => void): number => Math.min(...[0, 1, 2].map(() => {
      const start = performance.now();
      const runs = { count: 0 };

      while (runs.count === 0 || performance.now() - start < 25) {
        run();
        runs.count += 1;
      }

      return (performance.now() - start) / runs.count;
    }));

    /**
     * Eight times the input must cost about eight times the parse time (~8); a
     * quadratic path costs ~64. A ratio holds on a busy machine, where a
     * wall-clock limit flakes.
     * @param make - builds an input of a given size
     * @param size - the smaller size
     */
    const expectLinear = (make: (size: number) => string, size: number): void => {
      const small = make(Math.floor(size / 4));
      const large = make(size * 2);

      parseMarkdown(small, { math: true });

      expect(bestRatio(() => fastest(() => parseMarkdown(large, { math: true })) / fastest(() => parseMarkdown(small, { math: true })))).toBeLessThan(24);
    };

    it('handles a 1 MB document', () => {
      const parts = ['# h *a*', '- item `c`', '> q [l](u)', '| a | b |\n|---|---|\n| c | d |', '```js\ncode\n```', 'text **b**', '[d]: /u "t"', '    code', '<div>\nx\n</div>'];
      const markdown = Array.from({ length: 80_000 }, (_, index) => parts[index % parts.length]).join('\n\n');
      const start = performance.now();
      const root = parseMarkdown(markdown, { math: true });

      expect(markdown.length).toBeGreaterThan(1_000_000);
      expect(root.children.length).toBeGreaterThan(70_000);
      expect(performance.now() - start).toBeLessThan(30_000);
    });

    it.each(Object.entries<(size: number) => string>({
      'words': (size) => 'a '.repeat(size / 2),
      'leading spaces': (size) => `${' '.repeat(size)}x`,
      'pipes': (size) => '|'.repeat(size),
      'open brackets': (size) => '['.repeat(size),
      'backticks': (size) => '`'.repeat(size),
      'quoted attributes': (size) => `<a ${'b="c" '.repeat(size / 7)}>`,
      'list markers': (size) => '- '.repeat(size / 2),
      'delimiter row': (size) => `a|b\n${'-|'.repeat(size / 2)}`,
      'quote markers': (size) => `${'> '.repeat(size / 2)}a`,
    }))('parses %s in linear time', (_name, make) => {
      expect(() => parseMarkdown(make(100_000), { math: true })).not.toThrow();
      expectLinear(make, 50_000);
    });
  });
});
