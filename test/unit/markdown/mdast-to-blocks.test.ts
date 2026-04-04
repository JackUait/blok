import { describe, it, expect } from 'vitest';
import { mdastToBlocks } from '../../../src/markdown/mdast-to-blocks';
import type { Root } from 'mdast';

describe('mdastToBlocks', () => {
  describe('paragraph', () => {
    it('converts a paragraph with plain text', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', value: 'Hello world' }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('Hello world');
    });

    it('converts a paragraph with inline formatting', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Hello ' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks[0].data.text).toBe('Hello <strong>bold</strong>');
    });
  });

  describe('heading', () => {
    it('converts heading levels 1-6', () => {
      const tree: Root = {
        type: 'root',
        children: [
          { type: 'heading', depth: 1, children: [{ type: 'text', value: 'H1' }] },
          { type: 'heading', depth: 3, children: [{ type: 'text', value: 'H3' }] },
          { type: 'heading', depth: 6, children: [{ type: 'text', value: 'H6' }] },
        ],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toMatchObject({ type: 'header', data: { text: 'H1', level: 1 } });
      expect(blocks[1]).toMatchObject({ type: 'header', data: { text: 'H3', level: 3 } });
      expect(blocks[2]).toMatchObject({ type: 'header', data: { text: 'H6', level: 6 } });
    });
  });

  describe('thematicBreak', () => {
    it('converts to divider', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'thematicBreak' }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('divider');
      expect(blocks[0].data).toEqual({});
    });
  });

  describe('unordered list', () => {
    it('converts flat unordered list items', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Item 1' }] }] },
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Item 2' }] }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ type: 'list', data: { text: 'Item 1', style: 'unordered', depth: 0 } });
      expect(blocks[1]).toMatchObject({ type: 'list', data: { text: 'Item 2', style: 'unordered', depth: 0 } });
    });

    it('handles nested lists with incrementing depth', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [{
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'Parent' }] },
              {
                type: 'list',
                ordered: false,
                children: [
                  { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Child' }] }] },
                ],
              },
            ],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ type: 'list', data: { text: 'Parent', style: 'unordered', depth: 0 } });
      expect(blocks[1]).toMatchObject({ type: 'list', data: { text: 'Child', style: 'unordered', depth: 1 } });
    });
  });

  describe('ordered list', () => {
    it('converts ordered list with start number', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: true,
          start: 3,
          children: [
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Third' }] }] },
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Fourth' }] }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks[0]).toMatchObject({ type: 'list', data: { text: 'Third', style: 'ordered', start: 3, depth: 0 } });
      expect(blocks[1]).toMatchObject({ type: 'list', data: { text: 'Fourth', style: 'ordered', depth: 0 } });
    });
  });

  describe('checklist', () => {
    it('converts task list items with checked state', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [
            { type: 'listItem', checked: false, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Todo' }] }] },
            { type: 'listItem', checked: true, children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Done' }] }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks[0]).toMatchObject({ type: 'list', data: { text: 'Todo', style: 'checklist', checked: false } });
      expect(blocks[1]).toMatchObject({ type: 'list', data: { text: 'Done', style: 'checklist', checked: true } });
    });
  });

  describe('blockquote', () => {
    it('converts blockquote with single paragraph to quote', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'blockquote',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A wise quote' }] }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: 'quote', data: { text: 'A wise quote', size: 'default' } });
    });

    it('joins multiple blockquote paragraphs with <br>', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Line one' }] },
            { type: 'paragraph', children: [{ type: 'text', value: 'Line two' }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.text).toBe('Line one<br>Line two');
    });
  });

  describe('table', () => {
    it('converts a simple table with headings', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'text', value: 'Name' }] },
                { type: 'tableCell', children: [{ type: 'text', value: 'Age' }] },
              ],
            },
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'text', value: 'Alice' }] },
                { type: 'tableCell', children: [{ type: 'text', value: '30' }] },
              ],
            },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      // Table block + 4 cell paragraph blocks
      const tableBlock = blocks.find(b => b.type === 'table');

      expect(tableBlock).toBeDefined();
      expect(tableBlock!.data.withHeadings).toBe(true);
      expect(tableBlock!.data.content).toHaveLength(2); // 2 rows
      expect(tableBlock!.data.content[0]).toHaveLength(2); // 2 cols
      // Each cell has blocks array with one ID
      expect(tableBlock!.data.content[0][0].blocks).toHaveLength(1);
      // Cell paragraph blocks exist in the output
      const cellBlockIds = tableBlock!.data.content.flat().flatMap((cell: { blocks: string[] }) => cell.blocks);
      const cellBlocks = blocks.filter(b => cellBlockIds.includes(b.id!));

      expect(cellBlocks).toHaveLength(4);
      expect(cellBlocks[0].data.text).toBe('Name');
      expect(cellBlocks[0].parent).toBe(tableBlock!.id);
    });
  });

  describe('code block', () => {
    it('falls back to paragraph for unmapped code blocks', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'const x = 1;', lang: 'typescript' }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('<code>const x = 1;</code>');
    });
  });

  describe('image', () => {
    it('falls back to paragraph for unmapped images', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'image', url: 'https://img.com/pic.png', alt: 'pic' }] }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.text).toContain('<img');
    });
  });

  describe('html block', () => {
    it('falls back to paragraph for raw HTML blocks', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'html', value: '<div>custom</div>' }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('&lt;div&gt;custom&lt;/div&gt;');
    });
  });

  describe('config: toolMap', () => {
    it('uses toolMap entry over built-in handler', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'x = 1', lang: 'python' }],
      };

      const blocks = mdastToBlocks(tree, {
        toolMap: {
          code: {
            tool: 'codeBlock',
            data: (node) => ({
              code: 'value' in node ? node.value : '',
              language: 'lang' in node ? node.lang : 'plain',
            }),
          },
        },
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('codeBlock');
      expect(blocks[0].data).toEqual({ code: 'x = 1', language: 'python' });
    });
  });

  describe('config: onUnknownNode', () => {
    it('calls onUnknownNode for unhandled node types', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'html', value: '<custom-widget />' }],
      };

      const blocks = mdastToBlocks(tree, {
        onUnknownNode: (node) => {
          if (node.type === 'html' && 'value' in node) {
            return [{ type: 'widget', data: { raw: node.value } }];
          }

          return null;
        },
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('widget');
      expect(blocks[0].data.raw).toBe('<custom-widget />');
    });

    it('skips node when onUnknownNode returns null', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'html', value: '<!-- comment -->' }],
      };

      const blocks = mdastToBlocks(tree, {
        onUnknownNode: () => null,
      });

      expect(blocks).toHaveLength(0);
    });
  });

  describe('config: toolMap takes priority over onUnknownNode', () => {
    it('prefers toolMap over onUnknownNode for same node type', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'hello', lang: null }],
      };

      const blocks = mdastToBlocks(tree, {
        toolMap: {
          code: {
            tool: 'myCode',
            data: () => ({ text: 'from toolMap' }),
          },
        },
        onUnknownNode: () => [{ type: 'other', data: { text: 'from hook' } }],
      });

      expect(blocks[0].type).toBe('myCode');
    });
  });

  describe('empty input', () => {
    it('returns empty array for empty root', () => {
      const tree: Root = { type: 'root', children: [] };

      expect(mdastToBlocks(tree)).toEqual([]);
    });
  });

  describe('block IDs', () => {
    it('assigns unique IDs to all blocks', () => {
      const tree: Root = {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'A' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 'B' }] },
        ],
      };

      const blocks = mdastToBlocks(tree);
      const ids = blocks.map(b => b.id);

      expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length); // all unique
    });
  });
});
