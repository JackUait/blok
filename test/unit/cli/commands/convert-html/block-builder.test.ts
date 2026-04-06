import { describe, it, expect } from 'vitest';
import { buildBlocks } from '../../../../../src/cli/commands/convert-html/block-builder';
import type { OutputBlockData } from '../../../../../src/cli/commands/convert-html/types';

function run(html: string): OutputBlockData[] {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  return buildBlocks(dom.body);
}

describe('buildBlocks', () => {
  // --- Simple blocks ---
  describe('paragraph', () => {
    it('converts <p> to paragraph block', () => {
      const blocks = run('<p>Hello world</p>');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('Hello world');
      expect(blocks[0].id).toMatch(/^paragraph-\d+$/);
    });

    it('preserves inline HTML in paragraph', () => {
      const blocks = run('<p>Hello <b>bold</b> and <i>italic</i></p>');
      expect(blocks[0].data.text).toBe('Hello <b>bold</b> and <i>italic</i>');
    });

    it('preserves links in paragraph', () => {
      const blocks = run('<p><a href="https://example.com">link</a></p>');
      expect(blocks[0].data.text).toContain('href="https://example.com"');
    });
  });

  describe('header', () => {
    it('converts <h1> to header block with level 1', () => {
      const blocks = run('<h1>Title</h1>');
      expect(blocks[0].type).toBe('header');
      expect(blocks[0].data.text).toBe('Title');
      expect(blocks[0].data.level).toBe(1);
    });

    it('converts <h3> to header block with level 3', () => {
      const blocks = run('<h3>Subtitle</h3>');
      expect(blocks[0].data.level).toBe(3);
    });

    it('converts all heading levels', () => {
      const blocks = run('<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>');
      expect(blocks.map((b) => b.data.level)).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('quote', () => {
    it('converts <blockquote> to quote block', () => {
      const blocks = run('<blockquote>A wise quote</blockquote>');
      expect(blocks[0].type).toBe('quote');
      expect(blocks[0].data.text).toBe('A wise quote');
      expect(blocks[0].data.size).toBe('default');
    });
  });

  describe('code', () => {
    it('converts <pre> to code block using textContent', () => {
      const blocks = run('<pre><code>const x = 1;\nconst y = 2;</code></pre>');
      expect(blocks[0].type).toBe('code');
      expect(blocks[0].data.code).toBe('const x = 1;\nconst y = 2;');
      expect(blocks[0].data.language).toBe('plain-text');
    });

    it('does not interpret HTML inside code', () => {
      const blocks = run('<pre>&lt;div&gt;hello&lt;/div&gt;</pre>');
      expect(blocks[0].data.code).toBe('<div>hello</div>');
    });
  });

  describe('divider', () => {
    it('converts <hr> to divider block', () => {
      const blocks = run('<hr>');
      expect(blocks[0].type).toBe('divider');
      expect(blocks[0].data).toEqual({});
    });
  });

  describe('image', () => {
    it('converts <img> to image block', () => {
      const blocks = run('<img src="https://example.com/photo.jpg">');
      expect(blocks[0].type).toBe('image');
      expect(blocks[0].data).toEqual({ url: 'https://example.com/photo.jpg' });
    });
  });

  describe('toggle', () => {
    it('converts <details> with <summary> to toggle block', () => {
      const blocks = run('<details><summary>Click me</summary><p>Hidden</p></details>');
      expect(blocks[0].type).toBe('toggle');
      expect(blocks[0].data.text).toBe('Click me');
    });

    it('uses innerHTML as fallback when no <summary>', () => {
      const blocks = run('<details>Just content</details>');
      expect(blocks[0].type).toBe('toggle');
      expect(blocks[0].data.text).toBe('Just content');
    });
  });

  // --- List blocks ---
  describe('list', () => {
    it('converts <ul> to unordered list blocks', () => {
      const blocks = run('<ul><li>alpha</li><li>beta</li></ul>');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('list');
      expect(blocks[0].data.text).toBe('alpha');
      expect(blocks[0].data.style).toBe('unordered');
      expect(blocks[0].data.depth).toBeNull();
      expect(blocks[0].data.checked).toBeNull();
      expect(blocks[0].data.start).toBeNull();
    });

    it('converts <ol> to ordered list blocks', () => {
      const blocks = run('<ol><li>first</li><li>second</li></ol>');
      expect(blocks[0].data.style).toBe('ordered');
    });

    it('sets start on first item from <ol start="3">', () => {
      const blocks = run('<ol start="3"><li>three</li><li>four</li></ol>');
      expect(blocks[0].data.start).toBe(3);
      expect(blocks[1].data.start).toBeNull();
    });

    it('handles nested lists with depth', () => {
      const blocks = run('<ul><li>parent<ul><li>child</li></ul></li></ul>');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].data.text).toBe('parent');
      expect(blocks[0].data.depth).toBeNull();
      expect(blocks[1].data.text).toBe('child');
      expect(blocks[1].data.depth).toBe(1);
    });

    it('preserves inline HTML in list items', () => {
      const blocks = run('<ul><li><b>bold</b> item</li></ul>');
      expect(blocks[0].data.text).toBe('<b>bold</b> item');
    });
  });

  // --- Table blocks ---
  describe('table', () => {
    it('converts <table> to table block with cell blocks', () => {
      const blocks = run('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
      const tableBlock = blocks.find((b) => b.type === 'table');
      const cellBlocks = blocks.filter((b) => b.parent === tableBlock?.id);
      expect(tableBlock).toBeDefined();
      expect(cellBlocks).toHaveLength(4);
      expect((tableBlock!.data.content as unknown[][]).length).toBe(2);
    });

    it('detects headings from <th> tags', () => {
      const blocks = run('<table><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></table>');
      const tableBlock = blocks.find((b) => b.type === 'table')!;
      expect(tableBlock.data.withHeadings).toBe(true);
    });

    it('cell blocks have parent reference', () => {
      const blocks = run('<table><tr><td>cell</td></tr></table>');
      const tableBlock = blocks.find((b) => b.type === 'table')!;
      const cellBlock = blocks.find((b) => b.parent === tableBlock.id)!;
      expect(cellBlock.parent).toBe(tableBlock.id);
      expect(cellBlock.type).toBe('paragraph');
      expect(cellBlock.data.text).toBe('cell');
    });

    it('handles empty cells', () => {
      const blocks = run('<table><tr><td></td></tr></table>');
      const tableBlock = blocks.find((b) => b.type === 'table')!;
      const row = (tableBlock.data.content as Record<string, unknown>[][])[0];
      expect((row[0].blocks as string[]).length).toBe(0);
    });
  });

  // --- Callout blocks ---
  describe('callout', () => {
    it('converts <aside> to callout block with children', () => {
      const blocks = run('<aside style="background-color: rgb(251, 236, 221);"><p>Note content</p></aside>');
      const calloutBlock = blocks.find((b) => b.type === 'callout')!;
      expect(calloutBlock).toBeDefined();
      expect(calloutBlock.data.emoji).toBe('\u{1F4A1}');
      expect(calloutBlock.data.backgroundColor).toBe('orange');
      expect(calloutBlock.content).toHaveLength(1);
    });

    it('child blocks have parent reference', () => {
      const blocks = run('<aside style="background-color: rgb(200,200,200);"><p>text</p></aside>');
      const calloutBlock = blocks.find((b) => b.type === 'callout')!;
      const childBlock = blocks.find((b) => b.parent === calloutBlock.id)!;
      expect(childBlock.parent).toBe(calloutBlock.id);
      expect(childBlock.data.text).toBe('text');
    });

    it('maps background color to nearest preset', () => {
      const blocks = run('<aside style="background-color: rgb(231, 243, 248);"><p>blue note</p></aside>');
      const calloutBlock = blocks.find((b) => b.type === 'callout')!;
      expect(calloutBlock.data.backgroundColor).toBe('blue');
    });
  });

  // --- Edge cases ---
  describe('multiple blocks', () => {
    it('converts mixed content into multiple blocks', () => {
      const blocks = run('<h1>Title</h1><p>Body</p><hr><p>More</p>');
      expect(blocks).toHaveLength(4);
      expect(blocks.map((b) => b.type)).toEqual(['header', 'paragraph', 'divider', 'paragraph']);
    });

    it('generates unique IDs', () => {
      const blocks = run('<p>a</p><p>b</p><p>c</p>');
      const ids = blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('inline-only content', () => {
    it('wraps bare text as paragraph', () => {
      const blocks = run('bare text');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].data.text).toBe('bare text');
    });
  });

  describe('empty input', () => {
    it('returns empty blocks array', () => {
      expect(run('')).toEqual([]);
    });
  });
});
