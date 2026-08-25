import { describe, it, expect } from 'vitest';
import { mdastToBlocks } from '../../../src/markdown/mdast-to-blocks';
import { markdownToBlocks } from '../../../src/markdown/index';
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
      const tableData = tableBlock!.data as { withHeadings: boolean; content: { blocks: string[] }[][] };

      expect(tableData.withHeadings).toBe(true);
      expect(tableData.content).toHaveLength(2); // 2 rows
      expect(tableData.content[0]).toHaveLength(2); // 2 cols
      // Each cell has blocks array with one ID
      expect(tableData.content[0][0].blocks).toHaveLength(1);
      // Cell paragraph blocks exist in the output
      const cellBlockIds = tableData.content.flat().flatMap((cell: { blocks: string[] }) => cell.blocks);
      const cellBlocks = blocks.filter(b => cellBlockIds.includes(b.id!));

      expect(cellBlocks).toHaveLength(4);
      expect((cellBlocks[0].data as { text: string }).text).toBe('Name');
      expect(cellBlocks[0].parent).toBe(tableBlock!.id);
    });
  });

  describe('code block', () => {
    it('converts fenced code blocks to code tool blocks', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'const x = 1;', lang: 'typescript' }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('code');
      expect(blocks[0].data).toEqual({ code: 'const x = 1;', language: 'typescript' });
    });

    it('normalizes common model-emitted fence aliases to Prism language ids', () => {
      const aliases: Array<[string, string]> = [
        ['js', 'javascript'],
        ['jsx', 'javascript'],
        ['ts', 'typescript'],
        ['tsx', 'typescript'],
        ['py', 'python'],
        ['sh', 'bash'],
        ['zsh', 'bash'],
        ['console', 'bash'],
        ['yml', 'yaml'],
        ['c++', 'cpp'],
        ['golang', 'go'],
        ['c#', 'csharp'],
        ['docker', 'dockerfile'],
        ['tex', 'latex'],
      ];

      const tree: Root = {
        type: 'root',
        children: aliases.map(([lang]) => ({ type: 'code' as const, value: 'x', lang })),
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => (b.data as { language: string }).language)).toEqual(aliases.map(([, id]) => id));
    });

    it('keeps an already-canonical language untouched', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'x', lang: 'bash' }],
      };

      expect((mdastToBlocks(tree)[0].data as { language: string }).language).toBe('bash');
    });

    it('keeps an unknown language label rather than erasing it', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'x', lang: 'elixir' }],
      };

      expect((mdastToBlocks(tree)[0].data as { language: string }).language).toBe('elixir');
    });

    it('defaults language to "plain text" when lang is null', () => {
      const tree: Root = {
        type: 'root',
        children: [{ type: 'code', value: 'hello world', lang: null }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('code');
      expect(blocks[0].data).toEqual({ code: 'hello world', language: 'plain text' });
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

  describe('list item with nested block content', () => {
    it('emits a fenced code block nested in a list item as a sibling code block', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: true,
          children: [{
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'Install it:' }] },
              { type: 'code', lang: 'bash', value: 'npm i thing' },
            ],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => b.type)).toEqual(['list', 'code']);
      expect(blocks[1].data).toMatchObject({ code: 'npm i thing', language: 'bash' });
    });

    it('emits a second paragraph in a list item as a sibling paragraph', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [{
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'First' }] },
              { type: 'paragraph', children: [{ type: 'text', value: 'Second' }] },
            ],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => b.type)).toEqual(['list', 'paragraph']);
      expect(blocks[0].data.text).toBe('First');
      expect(blocks[1].data.text).toBe('Second');
    });

    it('emits a blockquote nested in a list item as a sibling quote block', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [{
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'Note' }] },
              {
                type: 'blockquote',
                children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Careful' }] }],
              },
            ],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => b.type)).toEqual(['list', 'quote']);
      expect(blocks[1].data.text).toBe('Careful');
    });

    it('still emits a list block when the item starts with non-paragraph content', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [{
            type: 'listItem',
            children: [{ type: 'code', lang: null, value: 'x' }],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => b.type)).toEqual(['list', 'code']);
      expect(blocks[0].data.text).toBe('');
    });

    it('keeps nested list content after the item own nested blocks in document order', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: false,
          children: [{
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'Parent' }] },
              { type: 'code', lang: null, value: 'code' },
              {
                type: 'list',
                ordered: false,
                children: [{
                  type: 'listItem',
                  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Child' }] }],
                }],
              },
            ],
          }],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks.map(b => b.type)).toEqual(['list', 'code', 'list']);
      expect(blocks[2].data).toMatchObject({ text: 'Child', depth: 1 });
    });

    it('restarts ordered numbering after interposed content by stamping start', async () => {
      const md = [
        '1. Install it:',
        '',
        '   ```bash',
        '   npm i thing',
        '   ```',
        '',
        '2. Then run it.',
      ].join('\n');

      const blocks = await markdownToBlocks(md);

      expect(blocks.map(b => b.type)).toEqual(['list', 'code', 'list']);
      expect(blocks[0].data).toMatchObject({ text: 'Install it:', style: 'ordered' });
      expect(blocks[1].data).toMatchObject({ code: 'npm i thing', language: 'bash' });
      expect(blocks[2].data).toMatchObject({ text: 'Then run it.', style: 'ordered', start: 2 });
    });

    it('does not stamp start on an uninterrupted ordered list', () => {
      const tree: Root = {
        type: 'root',
        children: [{
          type: 'list',
          ordered: true,
          children: [
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'One' }] }] },
            { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Two' }] }] },
          ],
        }],
      };

      const blocks = mdastToBlocks(tree);

      expect(blocks[1].data.start).toBeUndefined();
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
