import { describe, it, expect } from 'vitest';
import { convertGdocs } from '../../../../../src/cli/commands/convert-gdocs/index';

const gdocs = (html: string): string =>
  `<b id="docs-internal-guid-test">${html}</b>`;

describe('convertGdocs', () => {
  it('unwraps Google Docs wrapper and converts content', () => {
    const json = convertGdocs(gdocs('<p><span>Hello world</span></p>'));
    const result = JSON.parse(json);

    expect(result.version).toBe('2.31.0');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('paragraph');
    expect(result.blocks[0].data.text).toBe('Hello world');
  });

  it('converts bold style spans to <b> tags', () => {
    const html = gdocs('<p><span style="font-weight:700">bold text</span></p>');
    const result = JSON.parse(convertGdocs(html));

    expect(result.blocks[0].data.text).toContain('<b>');
    expect(result.blocks[0].data.text).toContain('bold text');
  });

  it('converts italic style spans to <i> tags', () => {
    const html = gdocs('<p><span style="font-style:italic">italic text</span></p>');
    const result = JSON.parse(convertGdocs(html));

    expect(result.blocks[0].data.text).toContain('<i>');
    expect(result.blocks[0].data.text).toContain('italic text');
  });

  it('converts color styles to <mark> tags', () => {
    const html = gdocs('<p><span style="color:rgb(255, 0, 0)">red text</span></p>');
    const result = JSON.parse(convertGdocs(html));

    expect(result.blocks[0].data.text).toContain('<mark');
    expect(result.blocks[0].data.text).toContain('red text');
  });

  it('converts combined bold + italic + color to nested semantic tags', () => {
    const html = gdocs(
      '<p><span style="font-weight:700;font-style:italic;color:#ff0000">styled</span></p>'
    );
    const result = JSON.parse(convertGdocs(html));
    const text = result.blocks[0].data.text;

    expect(text).toContain('<b>');
    expect(text).toContain('<i>');
    expect(text).toContain('<mark');
    expect(text).toContain('styled');
  });

  it('filters default black text color (no mark created)', () => {
    const html = gdocs('<p><span style="color:rgb(0, 0, 0)">plain text</span></p>');
    const result = JSON.parse(convertGdocs(html));

    expect(result.blocks[0].data.text).not.toContain('<mark');
    expect(result.blocks[0].data.text).toBe('plain text');
  });

  it('converts table cell paragraphs to br-separated content', () => {
    const html = gdocs(
      '<table><tbody><tr><td><p><span>Line A</span></p><p><span>Line B</span></p></td></tr></tbody></table>'
    );
    const result = JSON.parse(convertGdocs(html));
    const tableBlock = result.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // Table child paragraphs should contain the br-separated content
    const cellBlocks = result.blocks.filter(
      (b: { type: string; parent: string }) => b.parent === tableBlock.id
    );

    expect(cellBlocks.length).toBeGreaterThan(0);
    expect(cellBlocks[0].data.text).toContain('Line A');
    expect(cellBlocks[0].data.text).toContain('Line B');
  });

  it('preserves link color via mark wrapping', () => {
    const html = gdocs(
      '<p><a href="https://example.com" style="background-color:rgb(252, 229, 205)"><span style="color:#1155cc">link</span></a></p>'
    );
    const result = JSON.parse(convertGdocs(html));
    const text = result.blocks[0].data.text;

    expect(text).toContain('<a');
    expect(text).toContain('<mark');
    expect(text).toContain('link');
  });

  it('handles lists with aria-level for depth', () => {
    const html = gdocs(`
      <ul>
        <li aria-level="1"><span>Root item</span></li>
        <li aria-level="2"><span>Nested item</span></li>
      </ul>
    `);
    const result = JSON.parse(convertGdocs(html));
    const lists = result.blocks.filter((b: { type: string }) => b.type === 'list');

    expect(lists).toHaveLength(2);
    expect(lists[0].data.depth).toBeNull();
    expect(lists[1].data.depth).toBe(1);
  });

  it('returns empty blocks for empty input', () => {
    const result = JSON.parse(convertGdocs(''));

    expect(result.version).toBe('2.31.0');
    expect(result.blocks).toEqual([]);
  });

  it('handles non-Google Docs HTML (no wrapper)', () => {
    const html = '<h1>Title</h1><p>Content</p>';
    const result = JSON.parse(convertGdocs(html));

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe('header');
    expect(result.blocks[1].type).toBe('paragraph');
  });

  it('converts realistic multi-block Google Docs document', () => {
    const html = gdocs(`
      <h1><span style="font-weight:700">Title</span></h1>
      <p><span>A paragraph with </span><span style="font-weight:700">bold</span></p>
      <ul>
        <li aria-level="1"><span>Item one</span></li>
        <li aria-level="1"><span>Item two</span></li>
      </ul>
    `);
    const result = JSON.parse(convertGdocs(html));
    const types = result.blocks.map((b: { type: string }) => b.type);

    expect(types).toContain('header');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
  });

  it('does not produce double <br> from table cell double-preprocessing', () => {
    const html = gdocs(
      '<table><tbody><tr><td><p><span>Line 1</span></p><p><span>Line 2</span></p></td></tr></tbody></table>'
    );
    const result = JSON.parse(convertGdocs(html));
    const cellBlocks = result.blocks.filter(
      (b: { parent: string }) => b.parent !== undefined
    );

    expect(cellBlocks.length).toBeGreaterThan(0);
    // Should have exactly one <br> between lines, not double
    const brCount = (cellBlocks[0].data.text.match(/<br\s*\/?>/gi) || []).length;

    expect(brCount).toBeLessThanOrEqual(1);
  });

  it('all blocks have unique IDs', () => {
    const html = gdocs('<p><span>a</span></p><p><span>b</span></p><h1><span>c</span></h1>');
    const result = JSON.parse(convertGdocs(html)) as { blocks: Array<{ id: string }> };
    const ids = result.blocks.map((b) => b.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
