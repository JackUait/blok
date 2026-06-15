import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../../src/markdown/markdownToHtml';

describe('markdownToHtml', () => {
  it('renders headings and paragraphs with inline formatting', async () => {
    const html = await markdownToHtml('# Title\n\nHello **bold** and *em*.');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<i>em</i>');
  });

  it('renders unordered and ordered lists', async () => {
    const ul = await markdownToHtml('- a\n- b');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>');
    const ol = await markdownToHtml('1. a\n2. b');
    expect(ol).toContain('<ol>');
  });

  it('renders task list items with disabled checkboxes', async () => {
    const html = await markdownToHtml('- [x] done\n- [ ] todo');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
  });

  it('drops anchors with unsafe URLs but keeps the text', async () => {
    const html = await markdownToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('escapes raw HTML to prevent XSS', async () => {
    const html = await markdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders GFM tables', async () => {
    const html = await markdownToHtml('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('highlights fenced code with a known language', async () => {
    const html = await markdownToHtml('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre class="blok-code lang-javascript">');
    expect(html).toContain('class="token');
  });

  it('falls back to escaped plain text for unknown fence languages', async () => {
    const html = await markdownToHtml('```\nplain <stuff>\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('plain &lt;stuff&gt;');
    expect(html).not.toContain('class="token');
  });

  it('renders blockquotes and horizontal rules', async () => {
    const html = await markdownToHtml('> quote\n\n---');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr>');
  });
});
