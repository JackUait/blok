import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../../src/markdown/engine';
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

/** Levels down to the first (or last) paragraph, counting it; walked without recursion. */
const depthOf = (root: Root, last = false): number => {
  const cursor: { node: Nodes; depth: number } = { node: root, depth: 0 };

  while ('children' in cursor.node && cursor.node.type !== 'paragraph' && cursor.node.children.length > 0) {
    cursor.node = cursor.node.children[last ? cursor.node.children.length - 1 : 0];
    cursor.depth++;
  }

  return cursor.depth;
};

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

  describe('robustness', () => {
    const quick = (markdown: string): Root => {
      const start = performance.now();
      const root = parseMarkdown(markdown, { math: true });

      expect(performance.now() - start).toBeLessThan(5000);

      return root;
    };

    it('handles 10 000 nested block quotes', () => {
      expect(depthOf(quick(`${'> '.repeat(10_000)}a`))).toBe(10_001);
    });

    it('handles 10 000 nested list items', () => {
      expect(depthOf(quick(`${'- '.repeat(10_000)}a`))).toBe(20_001);
      expect(depthOf(quick(Array.from({ length: 1000 }, (_, index) => `${'  '.repeat(index)}- a`).join('\n')), true)).toBe(2001);
    });

    it('handles a 1 MB document', () => {
      const parts = ['# h *a*', '- item `c`', '> q [l](u)', '| a | b |\n|---|---|\n| c | d |', '```js\ncode\n```', 'text **b**', '[d]: /u "t"', '    code', '<div>\nx\n</div>'];
      const markdown = Array.from({ length: 80_000 }, (_, index) => parts[index % parts.length]).join('\n\n');

      expect(markdown.length).toBeGreaterThan(1_000_000);
      expect(quick(markdown).children.length).toBeGreaterThan(70_000);
    });

    it('handles lines of 100 000 characters', () => {
      for (const line of ['a '.repeat(50_000), `${' '.repeat(100_000)}x`, '|'.repeat(100_000), '['.repeat(100_000), '`'.repeat(100_000), `<a ${'b="c" '.repeat(15_000)}>`, '- '.repeat(50_000), `a|b\n${'-|'.repeat(50_000)}`]) {
        expect(() => quick(line)).not.toThrow();
      }
    });
  });
});
