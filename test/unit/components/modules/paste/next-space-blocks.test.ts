import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  parseNextSpaceBlocks,
  NEXT_SPACE_MIMES,
} from '../../../../../src/components/modules/paste/next-space-blocks';

/**
 * Page-root id used by buildin.ai's envelope. Top-level roots point their
 * `parentId` at `pageId`, which is itself NOT in the pasted set — so they
 * become roots (parentId omitted).
 */
const PAGE = '00000000-0000-4000-8000-000000000001';

type Node = Record<string, unknown>;

/** Build one buildin node with sensible defaults. */
function node(uuid: string, type: number, extra: Node = {}): Node {
  return {
    uuid,
    parentId: PAGE,
    type,
    title: '',
    backgroundColor: '',
    textColor: '',
    data: { segments: [] },
    subNodes: [],
    ...extra,
  };
}

/** A `data.segments` array carrying one or more plain-text segments. */
function segments(...texts: string[]): { segments: unknown[] } {
  return { segments: texts.map((text) => ({ text, type: 0, enhancer: {} })) };
}

/**
 * Build a buildin envelope where each argument is a top-level SIBLING root
 * (its own `blocks` entry / `subTree`) — the common multi-block case.
 */
function envelope(...nodes: Node[]): string {
  return JSON.stringify({
    blocks: nodes.map((n) => ({ id: n.uuid, subTree: { [`raw-${String(n.uuid)}`]: n } })),
    pageId: PAGE,
    fromType: 'copy',
  });
}

/**
 * Build an envelope with a single `blocks` entry whose `subTree` packs `root`
 * followed by its descendants (as buildin ships nested blocks).
 */
function tree(...nodes: Node[]): string {
  const subTree: Record<string, Node> = {};

  nodes.forEach((n) => {
    subTree[`raw-${String(n.uuid)}`] = n;
  });

  return JSON.stringify({
    blocks: [{ id: nodes[0].uuid, subTree }],
    pageId: PAGE,
    fromType: 'copy',
  });
}

describe('parseNextSpaceBlocks', () => {
  describe('guards', () => {
    it('returns null for non-JSON input', () => {
      expect(parseNextSpaceBlocks('<p>not json</p>')).toBeNull();
      expect(parseNextSpaceBlocks('')).toBeNull();
    });

    it('returns null for JSON that is not the buildin envelope shape', () => {
      expect(parseNextSpaceBlocks(JSON.stringify({ foo: 1 }))).toBeNull();
      expect(parseNextSpaceBlocks(JSON.stringify({ blocks: 'nope' }))).toBeNull();
      // A Blok clipboard array must NOT be claimed by the buildin parser.
      expect(parseNextSpaceBlocks(JSON.stringify([{ id: 'a', tool: 'paragraph', data: {} }]))).toBeNull();
    });

    it('returns null for an empty blocks array', () => {
      expect(parseNextSpaceBlocks(JSON.stringify({ blocks: [], pageId: PAGE }))).toBeNull();
    });

    it('exports both MIME flavour constants', () => {
      expect(NEXT_SPACE_MIMES).toEqual(['text/next-space-blocks', 'text/next-space-content']);
    });
  });

  describe('leaf text blocks', () => {
    it('maps a paragraph (type 1)', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('hello world') })));

      expect(out).toEqual([{ id: 'a', tool: 'paragraph', data: { text: 'hello world' } }]);
    });

    it('maps an empty paragraph (no segments) to empty text', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1)));

      expect(out).toEqual([{ id: 'a', tool: 'paragraph', data: { text: '' } }]);
    });

    it('escapes HTML-special characters in text', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('a < b & "c"') })));

      expect(out?.[0].data.text).toBe('a &lt; b &amp; "c"');
    });

    it('joins multiple plain segments', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('foo', ' ', 'bar') })));

      expect(out?.[0].data.text).toBe('foo bar');
    });

    // buildin stores a Shift+Enter soft line break as a literal newline inside a
    // segment's text. A raw `\n` collapses to a space when set as innerHTML, so
    // it must become a `<br>` to survive — otherwise multi-line text flattens to
    // one line (the "displayed on a single string" migration bug).
    it('converts a soft line break (\\n) inside a segment to <br>', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('first\nsecond') })));

      expect(out?.[0].data.text).toBe('first<br>second');
    });

    it('converts a Windows soft line break (\\r\\n) to a single <br>', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('first\r\nsecond') })));

      expect(out?.[0].data.text).toBe('first<br>second');
    });

    it('converts a newline carried as its own segment to <br>', () => {
      const out = parseNextSpaceBlocks(envelope(node('a', 1, { data: segments('first', '\n', 'second') })));

      expect(out?.[0].data.text).toBe('first<br>second');
    });

    it('maps a quote (type 12)', () => {
      const out = parseNextSpaceBlocks(envelope(node('q', 12, { data: segments('wisdom') })));

      expect(out).toEqual([{ id: 'q', tool: 'quote', data: { text: 'wisdom' } }]);
    });

    it('maps a divider (type 9)', () => {
      const out = parseNextSpaceBlocks(envelope(node('d', 9)));

      expect(out).toEqual([{ id: 'd', tool: 'divider', data: {} }]);
    });

    it('falls back to a paragraph for an unknown type', () => {
      const out = parseNextSpaceBlocks(envelope(node('x', 999, { data: segments('mystery') })));

      expect(out).toEqual([{ id: 'x', tool: 'paragraph', data: { text: 'mystery' } }]);
    });
  });

  describe('headings', () => {
    it('maps headings (type 7) at all four levels from data.level', () => {
      const out = parseNextSpaceBlocks(
        envelope(
          node('h1', 7, { data: { ...segments('One'), level: 1 } }),
          node('h2', 7, { data: { ...segments('Two'), level: 2 } }),
          node('h3', 7, { data: { ...segments('Three'), level: 3 } }),
          node('h4', 7, { data: { ...segments('Four'), level: 4 } })
        )
      );

      expect(out).toEqual([
        { id: 'h1', tool: 'header', data: { text: 'One', level: 1 } },
        { id: 'h2', tool: 'header', data: { text: 'Two', level: 2 } },
        { id: 'h3', tool: 'header', data: { text: 'Three', level: 3 } },
        { id: 'h4', tool: 'header', data: { text: 'Four', level: 4 } },
      ]);
    });

    it('maps a toggle-heading (type 38) as a toggleable header with its children nested', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('h', 38, { data: { ...segments('Toggle H2'), level: 2 }, subNodes: ['c1'] }),
          node('c1', 1, { parentId: 'h', data: segments('body') })
        )
      );

      expect(out).toEqual([
        { id: 'h', tool: 'header', data: { text: 'Toggle H2', level: 2, isToggleable: true, isOpen: true } },
        { id: 'c1', tool: 'paragraph', data: { text: 'body' }, parentId: 'h' },
      ]);
    });
  });

  describe('lists & toggles', () => {
    it('maps an unchecked to-do (type 3) to a checklist item', () => {
      const out = parseNextSpaceBlocks(envelope(node('t', 3, { data: segments('Groceries') })));

      expect(out).toEqual([{ id: 't', tool: 'list', data: { text: 'Groceries', style: 'checklist', checked: false } }]);
    });

    it('maps a checked to-do (data.checked true) to a checked checklist item', () => {
      const out = parseNextSpaceBlocks(envelope(node('t', 3, { data: { ...segments('done'), checked: true } })));

      expect(out).toEqual([{ id: 't', tool: 'list', data: { text: 'done', style: 'checklist', checked: true } }]);
    });

    it('maps a bulleted list (type 4) to an unordered item', () => {
      const out = parseNextSpaceBlocks(envelope(node('b', 4, { data: segments('Bullet') })));

      expect(out).toEqual([{ id: 'b', tool: 'list', data: { text: 'Bullet', style: 'unordered' } }]);
    });

    it('maps a numbered list (type 5) to an ordered item', () => {
      const out = parseNextSpaceBlocks(envelope(node('n', 5, { data: segments('Item') })));

      expect(out).toEqual([{ id: 'n', tool: 'list', data: { text: 'Item', style: 'ordered' } }]);
    });

    it('maps a toggle (type 6) with nested children', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('tg', 6, { data: { ...segments('Open me') }, subNodes: ['c1'] }),
          node('c1', 1, { parentId: 'tg', data: segments('if you dare...') })
        )
      );

      expect(out).toEqual([
        { id: 'tg', tool: 'toggle', data: { text: 'Open me', isOpen: true } },
        { id: 'c1', tool: 'paragraph', data: { text: 'if you dare...' }, parentId: 'tg' },
      ]);
    });
  });

  describe('callout (type 13)', () => {
    // Blok's callout stores its body as CHILD blocks (CalloutData has no `text`
    // field), exactly like a native callout copy carries its body paragraph. So
    // the parser must emit the callout (colours only) PLUS a child paragraph —
    // never an inline `data.text`, which the callout tool silently discards.
    it('maps emoji + colour and emits the body as a child paragraph (no inline text)', () => {
      const out = parseNextSpaceBlocks(
        envelope(
          node('cl', 13, {
            backgroundColor: 'yellow',
            data: { ...segments('call me out!'), icon: { type: 'emoji', value: '⚠️' } },
          })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'callout', data: { emoji: '⚠️', textColor: null, backgroundColor: 'yellow' } },
        { id: 'cl:callout-body', tool: 'paragraph', data: { text: 'call me out!' }, parentId: 'cl' },
      ]);
    });

    it('defaults the emoji and leaves colours null when absent', () => {
      const out = parseNextSpaceBlocks(envelope(node('cl', 13, { data: segments('x') })));

      expect(out?.[0].data).toEqual({ emoji: '💡', textColor: null, backgroundColor: null });
    });

    it('maps a named text colour', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('cl', 13, { textColor: 'blue', data: { ...segments('x'), icon: { type: 'emoji', value: '💡' } } }))
      );

      expect(out?.[0].data).toEqual({ emoji: '💡', textColor: 'blue', backgroundColor: null });
    });

    it('normalizes buildin British "grey" to Blok\'s "gray" preset', () => {
      const out = parseNextSpaceBlocks(envelope(node('cl', 13, { backgroundColor: 'grey', data: segments('x') })));

      expect((out?.[0].data as { backgroundColor: string | null }).backgroundColor).toBe('gray');
    });

    it('drops colour names outside Blok\'s preset palette to null', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('cl', 13, { backgroundColor: 'mauve', textColor: 'chartreuse', data: segments('x') }))
      );

      expect(out?.[0].data).toEqual({ emoji: '💡', textColor: null, backgroundColor: null });
    });

    it('omits the body child paragraph when the callout has no text', () => {
      const out = parseNextSpaceBlocks(envelope(node('cl', 13, { backgroundColor: 'yellow', data: segments() })));

      expect(out).toEqual([
        { id: 'cl', tool: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'yellow' } },
      ]);
    });
  });

  describe('code & equation', () => {
    it('maps a code block (type 25), mapping language name to id and ignoring the caption/description', () => {
      const out = parseNextSpaceBlocks(
        envelope(
          node('c', 25, {
            data: {
              ...segments('foo: bar'),
              format: { language: 'YAML' },
              description: [{ text: 'Name of the code block', type: 0, enhancer: {} }],
            },
          })
        )
      );

      expect(out).toEqual([{ id: 'c', tool: 'code', data: { code: 'foo: bar', language: 'yaml', lineNumbers: false } }]);
    });

    it('falls back to "plain text" for an unknown language and does not escape code', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('c', 25, { data: { ...segments('a < b && c'), format: { language: 'Brainfuck' } } }))
      );

      expect(out).toEqual([{ id: 'c', tool: 'code', data: { code: 'a < b && c', language: 'plain text', lineNumbers: false } }]);
    });

    it('maps an equation (type 23) to a latex code block', () => {
      const out = parseNextSpaceBlocks(envelope(node('eq', 23, { data: segments('E = mc^2') })));

      expect(out).toEqual([{ id: 'eq', tool: 'code', data: { code: 'E = mc^2', language: 'latex', lineNumbers: false } }]);
    });
  });

  describe('columns (types 10 / 11)', () => {
    it('maps column_list + columns with nested content (equal ratio omits widthRatio)', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('cl', 10, { subNodes: ['col1', 'col2'] }),
          node('col1', 11, { parentId: 'cl', data: { segments: [], columnRatio: 1 }, subNodes: ['p1'] }),
          node('p1', 1, { parentId: 'col1', data: segments('two columns') }),
          node('col2', 11, { parentId: 'cl', data: { segments: [], columnRatio: 1 }, subNodes: ['p2'] }),
          node('p2', 1, { parentId: 'col2', data: segments('yeah') })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'column_list', data: {} },
        { id: 'col1', tool: 'column', data: {}, parentId: 'cl' },
        { id: 'p1', tool: 'paragraph', data: { text: 'two columns' }, parentId: 'col1' },
        { id: 'col2', tool: 'column', data: {}, parentId: 'cl' },
        { id: 'p2', tool: 'paragraph', data: { text: 'yeah' }, parentId: 'col2' },
      ]);
    });

    it('preserves a non-1 columnRatio as widthRatio', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('cl', 10, { subNodes: ['col'] }),
          node('col', 11, { parentId: 'cl', data: { segments: [], columnRatio: 0.7 } })
        )
      );

      expect(out).toEqual([
        { id: 'cl', tool: 'column_list', data: {} },
        { id: 'col', tool: 'column', data: { widthRatio: 0.7 }, parentId: 'cl' },
      ]);
    });
  });

  describe('table (type 27)', () => {
    it('expands a table into a grid referencing per-cell paragraph blocks', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('tb', 27, {
            data: {
              segments: [],
              level: 4,
              format: { tableBlockRowHeader: true, tableBlockColumnOrder: ['A', 'B'] },
            },
            subNodes: ['r1', 'r2'],
          }),
          node('r1', 28, {
            parentId: 'tb',
            data: { format: {}, collectionProperties: { A: [{ text: 'H1', type: 0, enhancer: {} }], B: [{ text: 'H2', type: 0, enhancer: {} }] } },
          }),
          node('r2', 28, {
            parentId: 'tb',
            data: { format: {}, collectionProperties: { A: [{ text: 'a', type: 0, enhancer: {} }], B: [{ text: 'b', type: 0, enhancer: {} }] } },
          })
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

    it('never emits a table row (type 28) as its own block', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('tb', 27, { data: { segments: [], format: { tableBlockColumnOrder: ['A'] } }, subNodes: ['r1'] }),
          node('r1', 28, { parentId: 'tb', data: { format: {}, collectionProperties: { A: [{ text: 'x', type: 0, enhancer: {} }] } } })
        )
      );

      expect(out!.some((b) => b.id === 'r1')).toBe(false);
    });
  });

  describe('media (type 14)', () => {
    it('maps an image with RIGHT gravity to an aligned image block', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('im', 14, { title: 'pic.png', data: { ...segments('pic.png'), display: 'image', ossName: 's3/x/pic.png', format: { contentGravity: 'RIGHT' } } }))
      );

      expect(out).toEqual([
        { id: 'im', tool: 'image', data: { url: 'https://cdn2.buildin.ai/s3/x/pic.png', alignment: 'right' } },
      ]);
    });

    it('maps a video to a video block', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('v', 14, { data: { ...segments('clip.mov'), display: 'video', ossName: 's3/x/clip.mov' } }))
      );

      expect(out).toEqual([{ id: 'v', tool: 'video', data: { url: 'https://cdn2.buildin.ai/s3/x/clip.mov' } }]);
    });

    it('maps an audio to an audio block with title + filename', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('au', 14, { data: { ...segments('song.mp4'), display: 'audio', ossName: 's3/x/song.mp4' } }))
      );

      expect(out).toEqual([
        { id: 'au', tool: 'audio', data: { url: 'https://cdn2.buildin.ai/s3/x/song.mp4', title: 'song.mp4', fileName: 'song.mp4' } },
      ]);
    });

    it('maps a file to a file block with its name', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('f', 14, { data: { ...segments('doc.png'), display: 'file', ossName: 's3/x/doc.png' } }))
      );

      expect(out).toEqual([
        { id: 'f', tool: 'file', data: { url: 'https://cdn2.buildin.ai/s3/x/doc.png', fileName: 'doc.png' } },
      ]);
    });

    it('falls back to a paragraph for media with no ossName', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('m', 14, { data: { ...segments('orphan.png'), display: 'image' } }))
      );

      expect(out).toEqual([{ id: 'm', tool: 'paragraph', data: { text: 'orphan.png' } }]);
    });
  });

  describe('embed / bookmark (type 21)', () => {
    it('maps a known service URL to an embed block', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('e', 21, { data: { segments: [], link: 'https://www.youtube.com/watch?v=ABC123' } }))
      );

      expect(out?.[0]).toMatchObject({
        id: 'e',
        tool: 'embed',
        data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=ABC123', embed: 'https://www.youtube.com/embed/ABC123' },
      });
    });

    it('falls back to a bookmark for an unmatched http link', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('e', 21, { data: { segments: [], link: 'https://example.com/x' } }))
      );

      expect(out).toEqual([{ id: 'e', tool: 'bookmark', data: { url: 'https://example.com/x' } }]);
    });

    it('uses non-empty linkInfo plain text as the bookmark title', () => {
      const out = parseNextSpaceBlocks(
        envelope(
          node('e', 21, {
            data: { segments: [], link: 'https://example.com/x', linkInfo: [{ text: 'Example', type: 0, enhancer: {} }] },
          })
        )
      );

      expect(out).toEqual([{ id: 'e', tool: 'bookmark', data: { url: 'https://example.com/x', title: 'Example' } }]);
    });

    it('falls back to a paragraph when there is no http link', () => {
      const out = parseNextSpaceBlocks(
        envelope(node('e', 21, { data: { segments: [{ text: 'no link', type: 0, enhancer: {} }], link: '' } }))
      );

      expect(out).toEqual([{ id: 'e', tool: 'paragraph', data: { text: 'no link' } }]);
    });
  });

  // Copying a SINGLE block in buildin ships the `text/next-space-content`
  // flavour, whose envelope drops the multi-block `blocks: [{ id, subTree }]`
  // wrapper. The parser must still decode it — otherwise a single-toggle copy
  // returns null, falls back to buildin's lossy HTML twin, and the toggle
  // arrives as a bullet list (the reported migration bug).
  describe('single-block content envelope (text/next-space-content)', () => {
    it('decodes a lone toggle (subTree wrapper, no blocks array) as a toggle with its child', () => {
      const payload = JSON.stringify({
        subTree: {
          'raw-tg': node('tg', 6, { data: segments('Open me'), subNodes: ['c1'] }),
          'raw-c1': node('c1', 1, { parentId: 'tg', data: segments('inside') }),
        },
        pageId: PAGE,
        fromType: 'copy',
      });

      const out = parseNextSpaceBlocks(payload);

      expect(out).toEqual([
        { id: 'tg', tool: 'toggle', data: { text: 'Open me', isOpen: true } },
        { id: 'c1', tool: 'paragraph', data: { text: 'inside' }, parentId: 'tg' },
      ]);
    });

    it('decodes a bare single node (no wrapper at all)', () => {
      const out = parseNextSpaceBlocks(JSON.stringify(node('p', 1, { data: segments('lonely') })));

      expect(out).toEqual([{ id: 'p', tool: 'paragraph', data: { text: 'lonely' } }]);
    });

    it('decodes a single-block node map keyed by raw id', () => {
      const out = parseNextSpaceBlocks(JSON.stringify({ 'raw-b': node('b', 4, { data: segments('Bullet') }) }));

      expect(out).toEqual([{ id: 'b', tool: 'list', data: { text: 'Bullet', style: 'unordered' } }]);
    });

    it('still returns null when the object carries no buildin nodes', () => {
      expect(parseNextSpaceBlocks(JSON.stringify({ subTree: { x: { notANode: true } } }))).toBeNull();
      expect(parseNextSpaceBlocks(JSON.stringify({ random: 'object' }))).toBeNull();
    });
  });

  describe('document order & parentId wiring', () => {
    it('emits descendants in document order with parentId set, root without', () => {
      const out = parseNextSpaceBlocks(
        tree(
          node('tg', 6, { data: segments('Parent'), subNodes: ['c1', 'c2'] }),
          node('c1', 1, { parentId: 'tg', data: segments('one') }),
          node('c2', 1, { parentId: 'tg', data: segments('two') })
        )
      );

      expect(out!.map((b) => [b.id, b.parentId])).toEqual([
        ['tg', undefined],
        ['c1', 'tg'],
        ['c2', 'tg'],
      ]);
    });
  });

  describe('against the real captured fixture', () => {
    const fixture = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/buildin-next-space-blocks.json'),
      'utf8'
    );

    it('parses without throwing and assigns a tool + id to every block', () => {
      const out = parseNextSpaceBlocks(fixture);

      expect(out).not.toBeNull();
      expect(Array.isArray(out)).toBe(true);
      out!.forEach((b) => {
        expect(typeof b.tool).toBe('string');
        expect(b.tool.length).toBeGreaterThan(0);
        expect(typeof b.id).toBe('string');
      });
    });

    it('produces the expected top-level tool sequence in document order', () => {
      const out = parseNextSpaceBlocks(fixture)!;
      const roots = out.filter((b) => b.parentId === undefined).map((b) => b.tool);

      expect(roots).toEqual([
        'paragraph', // simple text
        'list', 'list', 'list', // 3 to-dos (Groceries / Frontend / Accessibility)
        'header', 'header', 'header', 'header', // headings 1-4
        'table', // 3x3 table
        'list', 'list', 'list', // 3 bullets
        'list', 'list', 'list', 'list', // 4 numbered
        'toggle', // Open me
        'divider',
        'quote',
        'callout',
        'code', // YAML
        'code', // equation -> latex
        'header', 'header', 'header', 'header', // 4 toggle headings
        'column_list', // 2-column
        'column_list', // 3-column
        'image',
        'bookmark', // youtube link -> empty linkInfo so no title, unmatched bare host -> bookmark
        'video',
        'audio',
        'file',
      ]);
    });

    it('wires table cells, columns and toggle-heading children to their parents', () => {
      const out = parseNextSpaceBlocks(fixture)!;
      const byId = new Map(out.map((b) => [b.id, b]));

      // Table: the type-27 block plus 9 parented cell paragraphs.
      const table = out.find((b) => b.tool === 'table')!;

      expect((table.data as { withHeadings: boolean }).withHeadings).toBe(true);
      const cellRefs = (table.data as { content: { blocks: string[] }[][] }).content
        .flat()
        .flatMap((c) => c.blocks);

      expect(cellRefs).toHaveLength(9);
      cellRefs.forEach((cellId) => {
        expect(byId.get(cellId)!.parentId).toBe(table.id);
        expect(byId.get(cellId)!.tool).toBe('paragraph');
      });

      // Cell TEXT must survive (the column-id join is easy to break): the 3x3
      // grid reads just|a|or / table|nothing|is / special|here|here? in order.
      const cellText = cellRefs.map((cellId) => (byId.get(cellId)!.data as { text: string }).text);

      expect(cellText).toEqual(['just', 'a', 'or', 'table', 'nothing', 'is', 'special', 'here', 'here?']);

      // First column_list has two column children, each with a paragraph child.
      const firstColumnList = out.find((b) => b.tool === 'column_list')!;
      const columns = out.filter((b) => b.tool === 'column' && b.parentId === firstColumnList.id);

      expect(columns.length).toBe(2);
      columns.forEach((col) => {
        expect(out.some((b) => b.parentId === col.id)).toBe(true);
      });

      // Toggle headings each have one nested paragraph child.
      const toggleHeadings = out.filter(
        (b) => b.tool === 'header' && (b.data as { isToggleable?: boolean }).isToggleable === true
      );

      expect(toggleHeadings.length).toBe(4);
      toggleHeadings.forEach((h) => {
        expect(out.some((b) => b.parentId === h.id && b.tool === 'paragraph')).toBe(true);
      });
    });
  });
});
