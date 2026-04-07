import { describe, it, expect } from 'vitest';
import { convertHtml } from '../../../../../src/cli/commands/convert-html/index';

describe('convertHtml', () => {
  it('converts simple HTML to OutputData JSON', () => {
    const json = convertHtml('<h1>Title</h1><p>Hello <b>world</b></p>');
    const result = JSON.parse(json);

    expect(result.version).toBe('2.31.0');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe('header');
    expect(result.blocks[0].data.text).toBe('Title');
    expect(result.blocks[0].data.level).toBe(1);
    expect(result.blocks[1].type).toBe('paragraph');
    expect(result.blocks[1].data.text).toBe('Hello <b>world</b>');
  });

  it('returns empty blocks for empty input', () => {
    const result = JSON.parse(convertHtml(''));

    expect(result.version).toBe('2.31.0');
    expect(result.blocks).toEqual([]);
  });

  it('preprocesses legacy HTML before building blocks', () => {
    const json = convertHtml('<p><del>removed</del> text</p>');
    const result = JSON.parse(json);

    expect(result.blocks[0].data.text).toContain('<s>removed</s>');
    expect(result.blocks[0].data.text).not.toContain('<del>');
  });

  it('sanitizes disallowed tags', () => {
    const json = convertHtml('<p><font color="red"><span class="x">clean</span></font></p>');
    const result = JSON.parse(json);

    expect(result.blocks[0].data.text).toBe('clean');
  });

  it('handles full legacy article with mixed content', () => {
    const html = `
      <h2>Section</h2>
      <p>Intro paragraph with <b>bold</b></p>
      <ul><li>item one</li><li>item two</li></ul>
      <table><tr><th>Header</th></tr><tr><td>Data</td></tr></table>
      <hr>
      <aside style="background-color: rgb(251, 236, 221);"><p>Note</p></aside>
    `;
    const result = JSON.parse(convertHtml(html));

    expect(result.version).toBe('2.31.0');
    const types = result.blocks.map((b: { type: string }) => b.type);

    expect(types).toContain('header');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('table');
    expect(types).toContain('divider');
    expect(types).toContain('callout');
  });

  it('handles bullet paragraph preprocessing + list building', () => {
    const html = '<p>\u2022 first</p><p>\u2022 second</p>';
    const result = JSON.parse(convertHtml(html));

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe('list');
    expect(result.blocks[0].data.style).toBe('unordered');
    expect(result.blocks[0].data.text).toBe('first');
    expect(result.blocks[1].data.text).toBe('second');
  });

  it('all blocks have unique IDs', () => {
    const html = '<p>a</p><p>b</p><h1>c</h1><ul><li>d</li></ul>';
    const result = JSON.parse(convertHtml(html));
    const ids: string[] = result.blocks.map((b: { id: string }) => b.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
