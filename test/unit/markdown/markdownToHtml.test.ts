import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../../src/markdown/markdownToHtml';

describe('markdownToHtml', () => {
  it('renders headings and paragraphs with inline formatting', async () => {
    const html = await markdownToHtml('# Title\n\nHello **bold** and *em*.');
    expect(html).toContain('<h1 id="title">Title</h1>');
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

  it('renders inline math with KaTeX', async () => {
    const html = await markdownToHtml('Euler: $e^{i\\pi}+1=0$ done.');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('$e^');
  });

  it('renders block math with KaTeX in display mode', async () => {
    const html = await markdownToHtml('$$\n\\int_0^1 x\\,dx\n$$');
    expect(html).toContain('class="katex');
    expect(html).toContain('katex-display');
  });

  it('resolves link references against their definitions', async () => {
    const html = await markdownToHtml('See [the site][site].\n\n[site]: https://example.com');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('the site</a>');
  });

  it('drops link references with unsafe definition URLs but keeps the text', async () => {
    const html = await markdownToHtml('[x][bad]\n\n[bad]: javascript:alert(1)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('x');
  });

  it('renders a missing link reference as literal bracket text', async () => {
    const html = await markdownToHtml('See [the site][nope].');
    expect(html).toContain('[the site][nope]');
    expect(html).not.toContain('<a ');
  });

  it('resolves image references against their definitions', async () => {
    const html = await markdownToHtml('![logo][img]\n\n[img]: https://example.com/a.png');
    expect(html).toContain('<img src="https://example.com/a.png"');
    expect(html).toContain('alt="logo"');
  });

  it('renders footnotes as superscript refs plus a footnotes section', async () => {
    const html = await markdownToHtml('Text with a note.[^1]\n\n[^1]: The note body.');
    expect(html).toContain('<sup');
    expect(html).toContain('href="#');
    expect(html).toContain('class="blok-md-footnotes"');
    expect(html).toContain('The note body.');
  });

  it('renders GitHub alerts from labelled blockquotes', async () => {
    const html = await markdownToHtml('> [!WARNING]\n> Be careful here.');
    expect(html).toContain('blok-md-alert');
    expect(html).toContain('blok-md-alert-warning');
    expect(html).toContain('Be careful here.');
    expect(html).not.toContain('[!WARNING]');
  });

  it('keeps a plain blockquote when there is no alert marker', async () => {
    const html = await markdownToHtml('> just a quote');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('blok-md-alert');
  });

  it('adds slug ids to headings', async () => {
    const html = await markdownToHtml('# Hello World');
    expect(html).toContain('<h1 id="hello-world"');
    expect(html).toContain('>Hello World</h1>');
  });

  it('disambiguates duplicate heading slugs', async () => {
    const html = await markdownToHtml('# Dup\n\n## Dup');
    expect(html).toContain('id="dup"');
    expect(html).toContain('id="dup-1"');
  });
});
