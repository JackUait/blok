import { describe, it, expect } from 'vitest';
import { phrasingToHtml } from '../../../src/markdown/phrasing-to-html';
import type { PhrasingContent } from 'mdast';

describe('phrasingToHtml', () => {
  it('serializes plain text', () => {
    const nodes: PhrasingContent[] = [{ type: 'text', value: 'Hello world' }];

    expect(phrasingToHtml(nodes)).toBe('Hello world');
  });

  it('escapes HTML entities in text', () => {
    const nodes: PhrasingContent[] = [{ type: 'text', value: '<script>alert("xss")</script>' }];

    expect(phrasingToHtml(nodes)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('serializes strong to <strong>', () => {
    const nodes: PhrasingContent[] = [{
      type: 'strong',
      children: [{ type: 'text', value: 'bold' }],
    }];

    expect(phrasingToHtml(nodes)).toBe('<strong>bold</strong>');
  });

  it('serializes emphasis to <i>', () => {
    const nodes: PhrasingContent[] = [{
      type: 'emphasis',
      children: [{ type: 'text', value: 'italic' }],
    }];

    expect(phrasingToHtml(nodes)).toBe('<i>italic</i>');
  });

  it('serializes delete (strikethrough) to <s>', () => {
    const nodes: PhrasingContent[] = [{
      type: 'delete',
      children: [{ type: 'text', value: 'struck' }],
    }];

    expect(phrasingToHtml(nodes)).toBe('<s>struck</s>');
  });

  it('serializes inlineCode to <code>', () => {
    const nodes: PhrasingContent[] = [{ type: 'inlineCode', value: 'const x = 1' }];

    expect(phrasingToHtml(nodes)).toBe('<code>const x = 1</code>');
  });

  it('escapes HTML inside inlineCode', () => {
    const nodes: PhrasingContent[] = [{ type: 'inlineCode', value: '<div>' }];

    expect(phrasingToHtml(nodes)).toBe('<code>&lt;div&gt;</code>');
  });

  it('serializes link to <a> with target and rel', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'https://example.com',
      children: [{ type: 'text', value: 'click here' }],
    }];

    expect(phrasingToHtml(nodes)).toBe(
      '<a href="https://example.com" target="_blank" rel="nofollow">click here</a>'
    );
  });

  it('escapes quotes in link URLs', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'https://example.com/?a="b"',
      children: [{ type: 'text', value: 'link' }],
    }];

    expect(phrasingToHtml(nodes)).toBe(
      '<a href="https://example.com/?a=&quot;b&quot;" target="_blank" rel="nofollow">link</a>'
    );
  });

  it('serializes break to <br>', () => {
    const nodes: PhrasingContent[] = [
      { type: 'text', value: 'line one' },
      { type: 'break' },
      { type: 'text', value: 'line two' },
    ];

    expect(phrasingToHtml(nodes)).toBe('line one<br>line two');
  });

  it('serializes inline image to <img>', () => {
    const nodes: PhrasingContent[] = [{
      type: 'image',
      url: 'https://img.com/pic.png',
      alt: 'a picture',
    }];

    expect(phrasingToHtml(nodes)).toBe('<img src="https://img.com/pic.png" alt="a picture">');
  });

  it('passes through inline HTML as-is', () => {
    const nodes: PhrasingContent[] = [{ type: 'html', value: '<sub>subscript</sub>' }];

    expect(phrasingToHtml(nodes)).toBe('<sub>subscript</sub>');
  });

  it('handles nested formatting', () => {
    const nodes: PhrasingContent[] = [{
      type: 'strong',
      children: [
        { type: 'text', value: 'bold ' },
        { type: 'emphasis', children: [{ type: 'text', value: 'and italic' }] },
      ],
    }];

    expect(phrasingToHtml(nodes)).toBe('<strong>bold <i>and italic</i></strong>');
  });

  it('handles mixed inline content', () => {
    const nodes: PhrasingContent[] = [
      { type: 'text', value: 'Hello ' },
      { type: 'strong', children: [{ type: 'text', value: 'world' }] },
      { type: 'text', value: ' and ' },
      { type: 'inlineCode', value: 'code' },
    ];

    expect(phrasingToHtml(nodes)).toBe('Hello <strong>world</strong> and <code>code</code>');
  });

  it('returns empty string for empty array', () => {
    expect(phrasingToHtml([])).toBe('');
  });
});
