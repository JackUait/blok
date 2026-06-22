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

    // Real Notion clipboard mentions are 3-element `[p, pageId, spaceId]` and
    // reference a page that is NOT included in a single-page copy — so the
    // realistic path is "extra args ignored, placeholder preserved".
    it('reads the page id from a real 3-element mention and keeps the placeholder when absent', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('a', 'text', {
            properties: title(
              ['‣', [['p', 'b0f73136-810b-4d02-8d9d-feebc2fa5eb2', '6ca10a2a-d599-486f-8f8f-560b1615b563']]],
              [' ']
            ),
          })
        )
      );

      expect(out?.[0].data.text).toBe('‣ ');
    });

    it('resolves a 3-element mention when the referenced page IS in the payload', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('p1', 'text', { properties: title(['‣', [['p', 'pg', 'space-id']]]) }),
          value('pg', 'page', { properties: title(['Linked']) })
        )
      );

      expect(out?.[0].data.text).toBe('Linked');
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

  describe('standalone service embeds (phase 6)', () => {
    it('maps a tweet embed block to a resolved embed', () => {
      const out = parseNotionBlocksV3(
        v3(value('e1', 'tweet', { properties: { source: [['https://twitter.com/jack/status/20']] } }))
      );

      expect(out?.[0]).toMatchObject({
        id: 'e1',
        tool: 'embed',
        data: { service: 'twitter', source: 'https://twitter.com/jack/status/20', kind: 'script' },
      });
    });

    it('maps a figma embed via format.display_source', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('e2', 'figma', {
            properties: {},
            format: { display_source: 'https://www.figma.com/file/abc/Design' },
          })
        )
      );

      expect(out?.[0]).toMatchObject({ id: 'e2', tool: 'embed', data: { service: 'figma' } });
    });

    it('falls back to a bookmark for an unmatched generic embed url', () => {
      const out = parseNotionBlocksV3(
        v3(value('e3', 'embed', { properties: { source: [['https://example.com/x']] } }))
      );

      expect(out).toEqual([{ id: 'e3', tool: 'bookmark', data: { url: 'https://example.com/x' } }]);
    });

    it('falls back to an empty paragraph for an embed with no http source', () => {
      const out = parseNotionBlocksV3(v3(value('e4', 'codepen')));

      expect(out).toEqual([{ id: 'e4', tool: 'paragraph', data: { text: '' } }]);
    });
  });

  describe('audio blocks (phase 6)', () => {
    it('maps an external (http) audio block to an audio tool with its filename', () => {
      const out = parseNotionBlocksV3(
        v3(value('au', 'audio', { properties: { source: [['https://cdn.test/song.mp3']], title: [['song.mp3']] } }))
      );

      expect(out).toEqual([{ id: 'au', tool: 'audio', data: { url: 'https://cdn.test/song.mp3', fileName: 'song.mp3' } }]);
    });

    it('falls back to a filename paragraph for an attachment audio (no usable URL)', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('au', 'audio', {
            properties: { source: [['attachment:uuid:track.mp3']], title: [['track.mp3']] },
            format: { display_source: 'attachment:uuid:track.mp3' },
          })
        )
      );

      expect(out).toEqual([{ id: 'au', tool: 'paragraph', data: { text: 'track.mp3' } }]);
    });
  });

  describe('pdf blocks (phase 6)', () => {
    it('maps an external pdf to a file block', () => {
      const out = parseNotionBlocksV3(
        v3(value('pd', 'pdf', { properties: { source: [['https://x.test/spec.pdf']], title: [['spec.pdf']] } }))
      );

      expect(out).toEqual([{ id: 'pd', tool: 'file', data: { url: 'https://x.test/spec.pdf', fileName: 'spec.pdf' } }]);
    });

    it('falls back to a filename paragraph for an attachment pdf', () => {
      const out = parseNotionBlocksV3(
        v3(value('pd', 'pdf', { properties: { source: [['attachment:uuid:spec.pdf']], title: [['spec.pdf']] } }))
      );

      expect(out).toEqual([{ id: 'pd', tool: 'paragraph', data: { text: 'spec.pdf' } }]);
    });
  });

  describe('inline date & user mention (phase 6)', () => {
    it('renders an inline date mention as plain text without leaking the placeholder glyph', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['due '], ['‣', [['d', { type: 'date', start_date: '2026-06-22' }]]]) }))
      );

      expect(out?.[0].data.text).toBe('due 2026-06-22');
    });

    it('renders a date range with start/end and times', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('a', 'text', {
            properties: title([
              '‣',
              [['d', { type: 'daterange', start_date: '2026-06-22', start_time: '09:00', end_date: '2026-06-23', end_time: '17:00' }]],
            ]),
          })
        )
      );

      expect(out?.[0].data.text).toBe('2026-06-22 09:00 → 2026-06-23 17:00');
    });

    it('still applies formatting marks around an inline date', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['‣', [['d', { type: 'date', start_date: '2026-06-22' }], ['b']]]) }))
      );

      expect(out?.[0].data.text).toBe('<b>2026-06-22</b>');
    });

    it('drops an unresolvable user mention without leaking the placeholder glyph', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['hi '], ['‣', [['u', 'user-uuid']]]) }))
      );

      expect(out?.[0].data.text).toBe('hi ');
    });

    it('preserves the underlying text of a comment mark (no glyph, keeps content)', () => {
      const out = parseNotionBlocksV3(
        v3(value('a', 'text', { properties: title(['commented', [['m', 'discussion-uuid']]]) }))
      );

      expect(out?.[0].data.text).toBe('commented');
    });
  });

  describe('heading toggleable state (phase 6)', () => {
    it('marks a toggleable heading as a collapsible container with its children nested', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('h', 'sub_sub_header', { properties: title(['Toggle H3']), format: { toggleable: true }, content: ['c1'] }),
          value('c1', 'text', { properties: title(['body']), parent_id: 'h' })
        )
      );

      expect(out).toEqual([
        { id: 'h', tool: 'header', data: { text: 'Toggle H3', level: 3, isToggleable: true, isOpen: true } },
        { id: 'c1', tool: 'paragraph', data: { text: 'body' }, parentId: 'h' },
      ]);
    });

    it('leaves a non-toggleable heading as a plain header', () => {
      const out = parseNotionBlocksV3(v3(value('h', 'header', { properties: title(['Plain']) })));

      expect(out).toEqual([{ id: 'h', tool: 'header', data: { text: 'Plain', level: 1 } }]);
    });
  });

  describe('quote size (phase 6)', () => {
    it('maps a large quote to size:large', () => {
      const out = parseNotionBlocksV3(
        v3(value('q', 'quote', { properties: title(['big']), format: { quote_size: 'large' } }))
      );

      expect(out).toEqual([{ id: 'q', tool: 'quote', data: { text: 'big', size: 'large' } }]);
    });

    it('omits size for a default quote', () => {
      const out = parseNotionBlocksV3(v3(value('q', 'quote', { properties: title(['normal']) })));

      expect(out).toEqual([{ id: 'q', tool: 'quote', data: { text: 'normal' } }]);
    });
  });

  describe('media alignment / caption / crop (phase 6)', () => {
    it('preserves left/right image alignment but omits the center default', () => {
      const left = parseNotionBlocksV3(
        v3(value('im', 'image', { properties: { source: [['https://x.test/i.png']] }, format: { block_alignment: 'left' } }))
      );
      const center = parseNotionBlocksV3(
        v3(value('im', 'image', { properties: { source: [['https://x.test/i.png']] }, format: { block_alignment: 'center' } }))
      );

      expect(left).toEqual([{ id: 'im', tool: 'image', data: { url: 'https://x.test/i.png', alignment: 'left' } }]);
      expect(center).toEqual([{ id: 'im', tool: 'image', data: { url: 'https://x.test/i.png' } }]);
    });

    it('preserves image caption (visible) and alt text', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('im', 'image', {
            properties: { source: [['https://x.test/i.png']], caption: [['a caption']], alt_text: [['alt words']] },
          })
        )
      );

      expect(out).toEqual([
        {
          id: 'im',
          tool: 'image',
          data: { url: 'https://x.test/i.png', caption: 'a caption', captionVisible: true, alt: 'alt words' },
        },
      ]);
    });

    it('converts a percent crop region, renaming width/height to w/h', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('im', 'image', {
            properties: { source: [['https://x.test/i.png']] },
            format: { image_edit_metadata: { crop: { x: 16.5, y: 0, unit: '%', width: 77.5, height: 100 }, mask: 'None' } },
          })
        )
      );

      expect(out).toEqual([
        { id: 'im', tool: 'image', data: { url: 'https://x.test/i.png', crop: { x: 16.5, y: 0, w: 77.5, h: 100 } } },
      ]);
    });

    it('maps a circle crop mask to a crop shape', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('im', 'image', {
            properties: { source: [['https://x.test/i.png']] },
            format: { image_edit_metadata: { crop: { x: 10, y: 10, unit: '%', width: 80, height: 80 }, mask: 'circle' } },
          })
        )
      );

      expect((out?.[0].data as { crop: unknown }).crop).toEqual({ x: 10, y: 10, w: 80, h: 80, shape: 'circle' });
    });

    it('ignores a full-frame (no-op) crop', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('im', 'image', {
            properties: { source: [['https://x.test/i.png']] },
            format: { image_edit_metadata: { crop: { x: 0, y: 0, unit: '%', width: 100, height: 100 }, mask: 'None' } },
          })
        )
      );

      expect(out).toEqual([{ id: 'im', tool: 'image', data: { url: 'https://x.test/i.png' } }]);
    });

    it('preserves caption + alignment on a direct video block', () => {
      const out = parseNotionBlocksV3(
        v3(
          value('v', 'video', {
            properties: { source: [['https://cdn.test/clip.mp4']], caption: [['clip cap']] },
            format: { block_alignment: 'right' },
          })
        )
      );

      expect(out).toEqual([
        { id: 'v', tool: 'video', data: { url: 'https://cdn.test/clip.mp4', alignment: 'right', caption: 'clip cap', captionVisible: true } },
      ]);
    });

    it('preserves caption on a file block', () => {
      const out = parseNotionBlocksV3(
        v3(value('f', 'file', { properties: { source: [['https://x.test/doc.pdf']], title: [['doc.pdf']], caption: [['the doc']] } }))
      );

      expect(out).toEqual([
        { id: 'f', tool: 'file', data: { url: 'https://x.test/doc.pdf', fileName: 'doc.pdf', caption: 'the doc', captionVisible: true } },
      ]);
    });
  });

  describe('synced blocks & structure-only drops (phase 6)', () => {
    it('flattens a synced container, promoting its children to the same level', () => {
      const out = parseNotionBlocksV3(
        v3Tree(
          value('sc', 'transclusion_container', { content: ['c1', 'c2'] }),
          value('c1', 'text', { properties: title(['one']), parent_id: 'sc' }),
          value('c2', 'text', { properties: title(['two']), parent_id: 'sc' })
        )
      );

      expect(out).toEqual([
        { id: 'c1', tool: 'paragraph', data: { text: 'one' } },
        { id: 'c2', tool: 'paragraph', data: { text: 'two' } },
      ]);
    });

    it('drops a synced reference (pointer-only) without emitting a block', () => {
      const out = parseNotionBlocksV3(v3(value('sr', 'transclusion_reference')));

      expect(out).toEqual([]);
    });

    it.each(['table_of_contents', 'breadcrumb', 'copy_indicator', 'link_to_page', 'alias'])(
      'drops the structure-only block type "%s" instead of leaving a stray paragraph',
      (type) => {
        const out = parseNotionBlocksV3(v3(value('x', type, { properties: title(['ignored']) })));

        expect(out).toEqual([]);
      }
    );
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
