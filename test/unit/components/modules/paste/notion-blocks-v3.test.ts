import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  parseNotionBlocksV3,
  NOTION_BLOCKS_V3_MIME,
} from '../../../../../src/components/modules/paste/notion-blocks-v3';

/**
 * Page-root id used by the real fixture. Top-level blocks point their
 * `parent_id` at this id, which is itself NOT in the pasted set — so they
 * become roots (parentId omitted).
 */
const PAGE = '2c0c2586-eb6d-807c-bafd-c7f973fd5fce';

type NotionValue = Record<string, unknown>;

/** Build one Notion block `value` with sensible record-map defaults. */
function value(id: string, type: string, extra: NotionValue = {}): NotionValue {
  return {
    id,
    version: 1,
    type,
    parent_id: PAGE,
    parent_table: 'block',
    alive: true,
    ...extra,
  };
}

/** Pack one or more `value`s into a single subtree (root = first value). */
function subtreeOf(values: NotionValue[]): unknown {
  const block: Record<string, { value: NotionValue }> = {};

  values.forEach((v) => {
    block[v.id as string] = { value: v };
  });

  return { blockId: values[0].id, blockSubtree: { __version__: 3, block } };
}

/**
 * Build a `text/_notion-blocks-v3-production` payload where each argument is a
 * top-level SIBLING block (its own subtree entry) — the common case.
 */
function v3(...values: NotionValue[]): string {
  return JSON.stringify({
    blocks: values.map((v) => subtreeOf([v])),
    action: 'paste',
    wasContiguousSelection: true,
  });
}

/**
 * Build a payload with a single subtree: `root` followed by its descendants
 * (all packed into one subtree map, as Notion ships nested blocks).
 */
function v3Tree(...values: NotionValue[]): string {
  return JSON.stringify({
    blocks: [subtreeOf(values)],
    action: 'paste',
    wasContiguousSelection: true,
  });
}

/** Convenience: build a `properties.title` rich-text array. */
function title(...segments: unknown[][]): { title: unknown[] } {
  return { title: segments };
}

describe('parseNotionBlocksV3', () => {
  describe('guards', () => {
    it('returns null for non-JSON input', () => {
      expect(parseNotionBlocksV3('<p>not json</p>')).toBeNull();
      expect(parseNotionBlocksV3('')).toBeNull();
    });

    it('returns null for JSON that is not the record-map shape', () => {
      expect(parseNotionBlocksV3(JSON.stringify({ foo: 1 }))).toBeNull();
      // A Blok clipboard array must NOT be claimed by the Notion parser.
      expect(parseNotionBlocksV3(JSON.stringify([{ id: 'a', tool: 'paragraph', data: {} }]))).toBeNull();
    });

    it('exports the correct MIME flavour constant', () => {
      expect(NOTION_BLOCKS_V3_MIME).toBe('text/_notion-blocks-v3-production');
    });
  });

  describe('leaf text blocks', () => {
    it('maps a plain `text` block to a paragraph', () => {
      const out = parseNotionBlocksV3(v3(value('a', 'text', { properties: title(['hello world']) })));

      expect(out).toEqual([{ id: 'a', tool: 'paragraph', data: { text: 'hello world' } }]);
    });

    it('maps an empty `text` block (no properties) to an empty paragraph', () => {
      const out = parseNotionBlocksV3(v3(value('a', 'text')));

      expect(out).toEqual([{ id: 'a', tool: 'paragraph', data: { text: '' } }]);
    });

    it('maps header / sub_header / sub_sub_header to header levels 1/2/3', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('h1', 'header', { properties: title(['Big']) }),
          value('h2', 'sub_header', { properties: title(['Mid']) }),
          value('h3', 'sub_sub_header', { properties: title(['Small']) })
        )
      );

      expect(out).toEqual([
        { id: 'h1', tool: 'header', data: { text: 'Big', level: 1 } },
        { id: 'h2', tool: 'header', data: { text: 'Mid', level: 2 } },
        { id: 'h3', tool: 'header', data: { text: 'Small', level: 3 } },
      ]);
    });

    it('maps a `quote` block', () => {
      const out = parseNotionBlocksV3(v3(value('q', 'quote', { properties: title(['wisdom']) })));

      expect(out).toEqual([{ id: 'q', tool: 'quote', data: { text: 'wisdom' } }]);
    });

    it('maps a `divider` block', () => {
      const out = parseNotionBlocksV3(v3(value('d', 'divider')));

      expect(out).toEqual([{ id: 'd', tool: 'divider', data: {} }]);
    });
  });

  describe('rich-text annotations', () => {
    it('wraps bold / italic / strike / code / underline', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('a', 'text', {
            properties: title(
              ['B', [['b']]],
              ['I', [['i']]],
              ['S', [['s']]],
              ['C', [['c']]],
              ['U', [['_']]]
            ),
          })
        )
      );

      expect(out?.[0].data.text).toBe('<b>B</b><i>I</i><s>S</s><code>C</code><u>U</u>');
    });

    it('renders a link annotation as an anchor', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['site', [['a', 'https://x.test/']]]) }))
      );

      expect(out?.[0].data.text).toBe('<a href="https://x.test/">site</a>');
    });

    it('keeps safe link schemes (mailto, tel, relative, anchor)', () => {
      const hrefs = ['mailto:a@b.test', 'tel:+123', '/page', './rel', '#frag'];

      hrefs.forEach((href) => {
        const out = parseNotionBlocksV3(v3(value('a', 'text', { properties: title(['x', [['a', href]]]) })));

        expect(out?.[0].data.text).toBe(`<a href="${href}">x</a>`);
      });
    });

    it('drops the anchor for dangerous href schemes (XSS guard)', () => {
      const dangerous = [
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        '  javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
      ];

      dangerous.forEach((href) => {
        const out = parseNotionBlocksV3(v3(value('a', 'text', { properties: title(['click', [['a', href]]]) })));

        // No anchor is emitted; the visible text is preserved (and escaped).
        expect(out?.[0].data.text).toBe('click');
      });
    });

    it('escapes HTML-special characters in text', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['a < b & "c"']) }))
      );

      expect(out?.[0].data.text).toBe('a &lt; b &amp; "c"');
    });

    it('joins multiple plain segments', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['foo'], [' '], ['bar']) }))
      );

      expect(out?.[0].data.text).toBe('foo bar');
    });
  });

  describe('code blocks', () => {
    it('maps language display-name to lowercase id and keeps plain text', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('c', 'code', {
            properties: { ...title(['const x = 1;']), language: [['JavaScript']] },
          })
        )
      );

      expect(out).toEqual([
        { id: 'c', tool: 'code', data: { code: 'const x = 1;', language: 'javascript', lineNumbers: false } },
      ]);
    });

    it('falls back to "plain text" for an unknown language', () => {
      const out = parseNotionBlocksV3(
        v3(value('c', 'code', { properties: { ...title(['x']), language: [['Brainfuck']] } }))
      );

      expect((out?.[0].data as { language: string }).language).toBe('plain text');
    });

    it('does not HTML-escape code content (it is plain text, not markup)', () => {
      const out = parseNotionBlocksV3(
        v3(value('c', 'code', { properties: { ...title(['a < b && c']), language: [['Plain Text']] } }))
      );

      expect((out?.[0].data as { code: string }).code).toBe('a < b && c');
    });
  });

  describe('list blocks', () => {
    it('maps a checked to_do to a checklist item', () => {
      const out = parseNotionBlocksV3(
        v3(value('t', 'to_do', { properties: { ...title(['done']), checked: [['Yes']] } }))
      );

      expect(out).toEqual([{ id: 't', tool: 'list', data: { text: 'done', style: 'checklist', checked: true } }]);
    });

    it('maps an unchecked / property-less to_do to an unchecked checklist item', () => {
      const out = parseNotionBlocksV3(v3(value('t', 'to_do')));

      expect(out).toEqual([{ id: 't', tool: 'list', data: { text: '', style: 'checklist', checked: false } }]);
    });

    it('maps bulleted_list to an unordered list item', () => {
      const out = parseNotionBlocksV3(v3(value('b', 'bulleted_list', { properties: title(['item']) })));

      expect(out).toEqual([{ id: 'b', tool: 'list', data: { text: 'item', style: 'unordered' } }]);
    });

    it('maps numbered_list to an ordered list item', () => {
      const out = parseNotionBlocksV3(v3(value('n', 'numbered_list', { properties: title(['item']) })));

      expect(out).toEqual([{ id: 'n', tool: 'list', data: { text: 'item', style: 'ordered' } }]);
    });
  });

  describe('callout (phase 2)', () => {
    it('maps icon + background colour', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('cl', 'callout', {
            properties: title(['note']),
            format: { page_icon: '💡', block_color: 'gray_background' },
          })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'callout', data: { emoji: '💡', text: 'note', textColor: null, backgroundColor: 'gray' } },
      ]);
    });

    it('maps a text colour (no `_background` suffix)', () => {
      const out = parseNotionBlocksV3(
        v3(value('cl', 'callout', { properties: title(['x']), format: { page_icon: '⚠️', block_color: 'blue' } }))
      );

      expect(out?.[0].data).toEqual({ emoji: '⚠️', text: 'x', textColor: 'blue', backgroundColor: null });
    });

    it('defaults the emoji and leaves colours null when format is absent', () => {
      const out = parseNotionBlocksV3(v3(value('cl', 'callout', { properties: title(['x']) })));

      expect(out?.[0].data).toEqual({ emoji: '💡', text: 'x', textColor: null, backgroundColor: null });
    });

    it('treats default_background as no colour', () => {
      const out = parseNotionBlocksV3(
        v3(value('cl', 'callout', { properties: title(['x']), format: { page_icon: '💡', block_color: 'default_background' } }))
      );

      expect(out?.[0].data).toEqual({ emoji: '💡', text: 'x', textColor: null, backgroundColor: null });
    });

    it('nests callout body blocks as children', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('cl', 'callout', { properties: title(['Note']), format: { page_icon: '💡' }, content: ['c1'] }),
          value('c1', 'text', { properties: title(['body']), parent_id: 'cl' })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'callout', data: { emoji: '💡', text: 'Note', textColor: null, backgroundColor: null } },
        { id: 'c1', tool: 'paragraph', data: { text: 'body' }, parentId: 'cl' },
      ]);
    });
  });

  describe('colour rich-text marks (phase 2)', () => {
    it('maps a background-colour mark to a styled <mark>', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['hi', [['h', 'orange_background']]]) }))
      );

      expect(out?.[0].data.text).toBe('<mark style="background-color: var(--blok-color-orange-bg)">hi</mark>');
    });

    it('maps a text-colour mark to a styled <mark>', () => {
      const out = parseNotionBlocksV3(v3(value('a', 'text', { properties: title(['hi', [['h', 'blue']]]) })));

      expect(out?.[0].data.text).toBe('<mark style="color: var(--blok-color-blue-text)">hi</mark>');
    });

    it('collapses text + background colour into a single <mark>', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['hi', [['h', 'orange_background'], ['h', 'orange']]]) }))
      );

      expect(out?.[0].data.text).toBe(
        '<mark style="color: var(--blok-color-orange-text); background-color: var(--blok-color-orange-bg)">hi</mark>'
      );
    });

    it('ignores the "default" and "default_background" colour tokens', () => {
      const plain = parseNotionBlocksV3(v3(value('a', 'text', { properties: title(['hi', [['h', 'default']]]) })));
      const plainBg = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['hi', [['h', 'default_background']]]) }))
      );

      expect(plain?.[0].data.text).toBe('hi');
      expect(plainBg?.[0].data.text).toBe('hi');
    });

    it('wraps colour outside other inline marks', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['hi', [['b'], ['h', 'blue']]]) }))
      );

      expect(out?.[0].data.text).toBe('<mark style="color: var(--blok-color-blue-text)"><b>hi</b></mark>');
    });
  });

  describe('inline equation & page mention (phase 5)', () => {
    it('renders an inline equation as inline code carrying the LaTeX', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['x is '], ['⁍', [['e', 'x^2']]]) }))
      );

      expect(out?.[0].data.text).toBe('x is <code>x^2</code>');
    });

    it('escapes HTML-special characters inside the equation LaTeX', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['⁍', [['e', 'a < b & c']]]) }))
      );

      expect(out?.[0].data.text).toBe('<code>a &lt; b &amp; c</code>');
    });

    it('still applies formatting marks around an inline equation', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['⁍', [['e', 'x^2'], ['b']]]) }))
      );

      expect(out?.[0].data.text).toBe('<b><code>x^2</code></b>');
    });

    it('resolves a page mention to the referenced page title', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('p1', 'text', { properties: title(['see '], ['‣', [['p', 'pg']]]) }),
          value('pg', 'page', { properties: title(['My Page']) })
        )
      );

      expect(out?.[0].data.text).toBe('see My Page');
    });

    it('escapes the resolved page-mention title', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('p1', 'text', { properties: title(['‣', [['p', 'pg']]]) }),
          value('pg', 'page', { properties: title(['A & B <x>']) })
        )
      );

      expect(out?.[0].data.text).toBe('A &amp; B &lt;x&gt;');
    });

    it('falls back to the placeholder text when the mentioned page is not in the payload', () => {
      const out = parseNotionBlocksV3(
        v3(value('p1', 'text', { properties: title(['see '], ['‣', [['p', 'missing']]]) }))
      );

      expect(out?.[0].data.text).toBe('see ‣');
    });
  });

  describe('nesting', () => {
    it('emits descendants in document order with parentId set, root without', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tg', 'toggle', { properties: title(['Parent']), content: ['c1'] }),
          value('c1', 'text', { properties: title(['child']), parent_id: 'tg' })
        )
      );

      expect(out).toEqual([
        { id: 'tg', tool: 'toggle', data: { text: 'Parent', isOpen: true } },
        { id: 'c1', tool: 'paragraph', data: { text: 'child' }, parentId: 'tg' },
      ]);
    });

    it('orders sibling children by the parent content array, not map order', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tg', 'toggle', { properties: title(['P']), content: ['second', 'first'] }),
          value('first', 'text', { properties: title(['1']), parent_id: 'tg' }),
          value('second', 'text', { properties: title(['2']), parent_id: 'tg' })
        )
      );

      expect(out!.map((b) => b.id)).toEqual(['tg', 'second', 'first']);
    });
  });

  describe('columns (phase 3)', () => {
    it('maps column_list + columns with ratios and nested content', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('cl', 'column_list', { content: ['col1', 'col2'] }),
          value('col1', 'column', { format: { column_ratio: 0.7 }, content: ['p1'], parent_id: 'cl' }),
          value('col2', 'column', { format: { column_ratio: 0.3 }, content: ['p2'], parent_id: 'cl' }),
          value('p1', 'text', { properties: title(['left']), parent_id: 'col1' }),
          value('p2', 'text', { properties: title(['right']), parent_id: 'col2' })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'column_list', data: {} },
        { id: 'col1', tool: 'column', data: { widthRatio: 0.7 }, parentId: 'cl' },
        { id: 'p1', tool: 'paragraph', data: { text: 'left' }, parentId: 'col1' },
        { id: 'col2', tool: 'column', data: { widthRatio: 0.3 }, parentId: 'cl' },
        { id: 'p2', tool: 'paragraph', data: { text: 'right' }, parentId: 'col2' },
      ]);
    });

    it('omits widthRatio for an equal / absent ratio', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('cl', 'column_list', { content: ['col'] }),
          value('col', 'column', { content: [], parent_id: 'cl' })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'column_list', data: {} },
        { id: 'col', tool: 'column', data: {}, parentId: 'cl' },
      ]);
    });
  });

  describe('tables (phase 3)', () => {
    it('expands a table into a grid referencing per-cell paragraph blocks', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tb', 'table', {
            content: ['r1', 'r2'],
            format: { table_block_column_order: ['A', 'B'], table_block_row_header: true },
          }),
          value('r1', 'table_row', { properties: { A: [['H1']], B: [['H2']] }, parent_id: 'tb' }),
          value('r2', 'table_row', { properties: { A: [['a']], B: [['b']] }, parent_id: 'tb' })
        )
      );

      expect(out).toEqual([
        {
          id: 'tb',
          tool: 'table',
          data: {
            withHeadings: true,
            withHeadingColumn: false,
            content: [
              [{ blocks: ['r1:A'] }, { blocks: ['r1:B'] }],
              [{ blocks: ['r2:A'] }, { blocks: ['r2:B'] }],
            ],
          },
        },
        { id: 'r1:A', tool: 'paragraph', data: { text: 'H1' }, parentId: 'tb' },
        { id: 'r1:B', tool: 'paragraph', data: { text: 'H2' }, parentId: 'tb' },
        { id: 'r2:A', tool: 'paragraph', data: { text: 'a' }, parentId: 'tb' },
        { id: 'r2:B', tool: 'paragraph', data: { text: 'b' }, parentId: 'tb' },
      ]);
    });

    it('fills missing cells with empty paragraphs and defaults headings off', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tb', 'table', { content: ['r1'], format: { table_block_column_order: ['A', 'B'] } }),
          value('r1', 'table_row', { properties: { A: [['x']] }, parent_id: 'tb' })
        )
      );

      const table = out!.find((b) => b.id === 'tb')!;

      expect((table.data as { withHeadings: boolean }).withHeadings).toBe(false);
      expect((table.data as { content: unknown }).content).toEqual([[{ blocks: ['r1:A'] }, { blocks: ['r1:B'] }]]);
      expect(out!.find((b) => b.id === 'r1:B')!.data).toEqual({ text: '' });
    });

    it('derives column order from row properties when format is absent', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tb', 'table', { content: ['r1'] }),
          value('r1', 'table_row', { properties: { A: [['x']], B: [['y']] }, parent_id: 'tb' })
        )
      );

      expect((out!.find((b) => b.id === 'tb')!.data as { content: unknown }).content).toEqual([
        [{ blocks: ['r1:A'] }, { blocks: ['r1:B'] }],
      ]);
    });

    it('never emits a table_row as its own block', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('tb', 'table', { content: ['r1'], format: { table_block_column_order: ['A'] } }),
          value('r1', 'table_row', { properties: { A: [['x']] }, parent_id: 'tb' })
        )
      );

      expect(out!.some((b) => b.id === 'r1')).toBe(false);
    });
  });

  describe('media & embeds (phase 4)', () => {
    it('maps an equation to a latex code block', () => {
      const out = parseNotionBlocksV3(v3(value('eq', 'equation', { properties: title(['E = mc^2']) })));

      expect(out).toEqual([
        { id: 'eq', tool: 'code', data: { code: 'E = mc^2', language: 'latex', lineNumbers: false } },
      ]);
    });

    it('maps a bookmark with title, description, cover and favicon', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('bm', 'bookmark', {
            properties: { link: [['https://x.test/a']], title: [['Title']], description: [['Desc']] },
            format: { bookmark_icon: 'https://x.test/ico.png', bookmark_cover: 'https://x.test/cov.jpg' },
          })
        )
      );

      expect(out).toEqual([
        {
          id: 'bm',
          tool: 'bookmark',
          data: {
            url: 'https://x.test/a',
            title: 'Title',
            description: 'Desc',
            image: 'https://x.test/cov.jpg',
            favicon: 'https://x.test/ico.png',
          },
        },
      ]);
    });

    it('maps a bookmark with only a link', () => {
      const out = parseNotionBlocksV3(v3(value('bm', 'bookmark', { properties: { link: [['https://x.test/']] } })));

      expect(out).toEqual([{ id: 'bm', tool: 'bookmark', data: { url: 'https://x.test/' } }]);
    });

    it('maps an external (http) image to an image block', () => {
      const out = parseNotionBlocksV3(
        v3(value('im', 'image', { properties: { source: [['https://x.test/i.png']], title: [['i.png']] } }))
      );

      expect(out).toEqual([{ id: 'im', tool: 'image', data: { url: 'https://x.test/i.png' } }]);
    });

    it('falls back to a filename paragraph for an attachment image (no usable URL)', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('im', 'image', {
            properties: { source: [['attachment:uuid:logo.png']], title: [['logo.png']] },
            format: { display_source: 'attachment:uuid:logo.png' },
          })
        )
      );

      expect(out).toEqual([{ id: 'im', tool: 'paragraph', data: { text: 'logo.png' } }]);
    });

    it('maps an external (http) file to a file block with its name', () => {
      const out = parseNotionBlocksV3(
        v3(value('f', 'file', { properties: { source: [['https://x.test/doc.pdf']], title: [['doc.pdf']] } }))
      );

      expect(out).toEqual([{ id: 'f', tool: 'file', data: { url: 'https://x.test/doc.pdf', fileName: 'doc.pdf' } }]);
    });

    it('falls back to a filename paragraph for an attachment file', () => {
      const out = parseNotionBlocksV3(
        v3(value('f', 'file', { properties: { source: [['attachment:uuid:doc.pdf']], title: [['doc.pdf']] } }))
      );

      expect(out).toEqual([{ id: 'f', tool: 'paragraph', data: { text: 'doc.pdf' } }]);
    });

    it('maps a YouTube video to a resolved embed block', () => {
      const out = parseNotionBlocksV3(
        v3(value('v', 'video', { properties: { source: [['https://www.youtube.com/watch?v=ABC123']] } }))
      );

      expect(out?.[0]).toMatchObject({
        id: 'v',
        tool: 'embed',
        data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=ABC123', embed: 'https://www.youtube.com/embed/ABC123' },
      });
    });

    it('maps a direct (non-provider) video URL to a video block', () => {
      const out = parseNotionBlocksV3(
        v3(value('v', 'video', { properties: { source: [['https://cdn.test/clip.mp4']] } }))
      );

      expect(out).toEqual([{ id: 'v', tool: 'video', data: { url: 'https://cdn.test/clip.mp4' } }]);
    });

    it('maps a Google Drive doc to a resolved embed block', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('dr', 'drive', {
            properties: { source: [['https://docs.google.com/document/d/DOC123/preview']] },
            format: { display_source: 'https://docs.google.com/document/d/DOC123/preview' },
          })
        )
      );

      expect(out?.[0]).toMatchObject({ id: 'dr', tool: 'embed', data: { source: expect.stringContaining('DOC123') } });
    });
  });

  describe('against the real captured fixture', () => {
    const fixture = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/notion/demo-page.blocks-v3.json'),
      'utf8'
    );

    it('parses without throwing and returns a non-empty flat array', () => {
      const out = parseNotionBlocksV3(fixture);

      expect(out).not.toBeNull();
      expect(Array.isArray(out)).toBe(true);
      expect(out!.length).toBeGreaterThan(100);
    });

    it('assigns a tool name to every parsed block', () => {
      const out = parseNotionBlocksV3(fixture)!;

      out.forEach((b) => {
        expect(typeof b.tool).toBe('string');
        expect(b.tool.length).toBeGreaterThan(0);
        expect(typeof b.id).toBe('string');
      });
    });
  });
});
