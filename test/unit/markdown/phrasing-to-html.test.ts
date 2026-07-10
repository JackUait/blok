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
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">click here</a>'
    );
  });

  it('opens anchor-only links in the same window (target="_self")', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: '#results',
      children: [{ type: 'text', value: 'jump' }],
    }];

    expect(phrasingToHtml(nodes)).toBe(
      '<a href="#results" target="_self" rel="noopener noreferrer nofollow">jump</a>'
    );
  });

  it('escapes quotes in link URLs', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'https://example.com/?a="b"',
      children: [{ type: 'text', value: 'link' }],
    }];

    expect(phrasingToHtml(nodes)).toBe(
      '<a href="https://example.com/?a=&quot;b&quot;" target="_blank" rel="noopener noreferrer nofollow">link</a>'
    );
  });

  it('drops javascript: scheme in link URLs (XSS)', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'javascript:alert(1)',
      children: [{ type: 'text', value: 'click here' }],
    }];

    const html = phrasingToHtml(nodes);

    expect(html).not.toContain('javascript');
    expect(html).not.toContain('href');
    expect(html).toContain('click here');
  });

  it('drops javascript: scheme regardless of case/whitespace', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: '  JaVaScRiPt:alert(1)',
      children: [{ type: 'text', value: 'x' }],
    }];

    expect(phrasingToHtml(nodes).toLowerCase()).not.toContain('javascript');
  });

  it('drops scheme smuggled with a newline inside the keyword (XSS)', () => {
    // mdast decodes &NewLine; to a literal "\n" before serialization; the
    // browser strips it from the href, reconstituting javascript:.
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'java\nscript:alert(1)',
      children: [{ type: 'text', value: 'click here' }],
    }];

    const html = phrasingToHtml(nodes);

    expect(html).not.toContain('href');
    expect(html).toContain('click here');
  });

  it('drops a data: scheme in a link href (XSS)', () => {
    const nodes: PhrasingContent[] = [{
      type: 'link',
      url: 'data:text/html,<script>alert(1)</script>',
      children: [{ type: 'text', value: 'x' }],
    }];

    expect(phrasingToHtml(nodes)).not.toContain('href');
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

  it('drops image with javascript: scheme (XSS)', () => {
    const nodes: PhrasingContent[] = [{
      type: 'image',
      url: 'javascript:alert(1)',
      alt: 'x',
    }];

    expect(phrasingToHtml(nodes)).not.toContain('javascript');
  });

  it('drops a data:image/svg+xml image (SVG can execute script)', () => {
    const nodes: PhrasingContent[] = [{
      type: 'image',
      url: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
      alt: 'x',
    }];

    expect(phrasingToHtml(nodes)).not.toContain('<img');
  });

  it('keeps a raster data:image (no script risk)', () => {
    const nodes: PhrasingContent[] = [{
      type: 'image',
      url: 'data:image/png;base64,iVBORw0KGgo=',
      alt: 'pic',
    }];

    expect(phrasingToHtml(nodes)).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" alt="pic">');
  });

  it('escapes inline raw HTML instead of passing it through (XSS)', () => {
    const nodes: PhrasingContent[] = [{ type: 'html', value: '<img src=x onerror="alert(1)">' }];

    const html = phrasingToHtml(nodes);

    // Raw HTML must be neutralised — escaped to inert text, no live <img> tag.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes inline <script> raw HTML (XSS)', () => {
    const nodes: PhrasingContent[] = [{ type: 'html', value: '<script>alert(1)</script>' }];

    const html = phrasingToHtml(nodes);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
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
