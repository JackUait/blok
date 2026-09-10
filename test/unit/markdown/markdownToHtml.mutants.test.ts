import { describe, it, expect } from 'vitest';

import { markdownToHtml } from '../../../src/markdown/markdownToHtml';

const render = (md: string, opts = {}): Promise<string> => markdownToHtml(md, opts);

describe('markdownToHtml mutants', () => {
  describe('escaping', () => {
    it('escapes every character that could reopen a tag', async () => {
      const html = await render('`a & b < c > d "e"`');

      expect(html).toContain('<code>a &amp; b &lt; c &gt; d &quot;e&quot;</code>');
    });

    it('escapes raw inline html rather than rendering it', async () => {
      const html = await render('text <img src=x onerror=alert(1)> more');

      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });

  describe('heading slugs', () => {
    it('slugs a heading down to words and dashes', async () => {
      const html = await render('# Hello, World! (v2)');

      expect(html).toContain('id="hello-world-v2"');
    });

    it('disambiguates repeated headings with a counter', async () => {
      const html = await render('# Same\n\n# Same\n\n# Same');

      expect(html).toContain('id="same"');
      expect(html).toContain('id="same-1"');
      expect(html).toContain('id="same-2"');
    });

    it('falls back to "section" when nothing survives slugging', async () => {
      const html = await render('# !!!');

      expect(html).toContain('id="section"');
    });

    it('slugs the flattened text of a formatted heading', async () => {
      const html = await render('# **Bold** and `code`');

      expect(html).toContain('id="bold-and-code"');
    });

    it('collapses runs of spaces and underscores into one dash', async () => {
      const html = await render('# a   b___c');

      expect(html).toContain('id="a-b-c"');
    });
  });

  describe('GitHub alerts', () => {
    it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])('recognises [!%s]', async (kind) => {
      const html = await render(`> [!${kind}]\n> body text`);

      expect(html).toContain(kind.toLowerCase());
      expect(html).toContain('body text');
      expect(html).not.toContain(`[!${kind}]`);
    });

    it('leaves an unknown marker as an ordinary quote', async () => {
      const html = await render('> [!SHOUT]\n> body text');

      expect(html).toContain('<blockquote>');
      expect(html).toContain('[!SHOUT]');
    });

    it('leaves a quote whose first block is not a paragraph alone', async () => {
      const html = await render('> # [!NOTE]\n> body');

      expect(html).toContain('<blockquote>');
      expect(html).toContain('[!NOTE]');
    });

    it('keeps the rest of the line when the marker is followed by text', async () => {
      const html = await render('> [!NOTE] inline body');

      expect(html).toContain('inline body');
      expect(html).not.toContain('[!NOTE]');
    });

    it('keeps the following lines when the marker sits alone', async () => {
      const html = await render('> [!WARNING]\n> first\n>\n> second');

      expect(html).toContain('first');
      expect(html).toContain('second');
      expect(html).not.toContain('[!WARNING]');
    });
  });

  describe('links', () => {
    it('opens an external link in a new tab, with the safe rel', async () => {
      const html = await render('[text](https://example.test/page)');

      expect(html).toContain('href="https://example.test/page"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer nofollow"');
    });

    it('keeps a same-page link in the same tab', async () => {
      const html = await render('[text](#section-two)');

      expect(html).toContain('target="_self"');
    });

    it('drops a dangerous url but keeps its text', async () => {
      const html = await render('[click me](javascript:alert(1))');

      expect(html).not.toContain('javascript:');
      expect(html).toContain('click me');
      expect(html).not.toContain('<a ');
    });
  });

  describe('images', () => {
    it('renders an image with an escaped alt', async () => {
      const html = await render('![a "quoted" & <alt>](https://example.test/i.png)');

      expect(html).toContain('src="https://example.test/i.png"');
      expect(html).toContain('alt="a &quot;quoted&quot; &amp; &lt;alt&gt;"');
    });

    it('renders nothing for a dangerous image source', async () => {
      const html = await render('![alt](javascript:alert(1))');

      expect(html).not.toContain('<img');
      expect(html).not.toContain('javascript:');
    });
  });

  describe('references', () => {
    it('resolves a link reference against its definition', async () => {
      const html = await render('[text][ref]\n\n[ref]: https://example.test/x');

      expect(html).toContain('href="https://example.test/x"');
      expect(html).toContain('text');
    });

    it('renders an unresolved link reference as its literal source', async () => {
      const html = await render('[text][missing]');

      expect(html).toContain('[text][missing]');
      expect(html).not.toContain('<a ');
    });

    it('resolves an image reference against its definition', async () => {
      const html = await render('![alt][ref]\n\n[ref]: https://example.test/i.png');

      expect(html).toContain('<img src="https://example.test/i.png" alt="alt">');
    });

    it('renders an unresolved image reference as its literal source, marked as an image', async () => {
      const html = await render('![alt][missing]');

      expect(html).toContain('![alt][missing]');
      expect(html).not.toContain('<img');
    });
  });

  describe('footnotes', () => {
    it('numbers references in the order they appear, not definition order', async () => {
      const html = await render('a[^second] b[^first]\n\n[^first]: one\n\n[^second]: two');
      const firstMarker = html.indexOf('id="fnref-second"');
      const secondMarker = html.indexOf('id="fnref-first"');

      expect(firstMarker).toBeGreaterThan(-1);
      expect(secondMarker).toBeGreaterThan(firstMarker);
      expect(html).toContain('href="#fn-second"');
      expect(html).toContain('<li id="fn-second">');
    });

    it('reuses one number for a repeated reference', async () => {
      const html = await render('a[^x] b[^x]\n\n[^x]: only');

      expect(html.match(/<li id="fn-x">/g)).toHaveLength(1);
    });

    it('renders no trailer when nothing references a footnote', async () => {
      const html = await render('plain paragraph');

      expect(html).not.toContain('blok-md-footnotes');
    });

    it('labels the backlink, and takes the label from the caller', async () => {
      const html = await render('a[^x]\n\n[^x]: note', { backToContentLabel: 'Вернуться' });

      expect(html).toContain('aria-label="Вернуться"');
    });

    it('labels the backlink in English by default', async () => {
      const html = await render('a[^x]\n\n[^x]: note');

      expect(html).toContain('aria-label="Back to content"');
    });
  });

  describe('inline marks', () => {
    it('renders each inline mark with its own tag', async () => {
      const html = await render('**b** *i* ~~s~~ `c`\nnext');

      expect(html).toContain('<strong>b</strong>');
      expect(html).toContain('<i>i</i>');
      expect(html).toContain('<s>s</s>');
      expect(html).toContain('<code>c</code>');
    });

    it('renders a hard break as a br', async () => {
      const html = await render('one  \ntwo');

      expect(html).toContain('<br>');
    });
  });

  // The whole output is one string built by joining parts with ''. Only an
  // exact-output assertion sees a changed separator or a stray default value.
  describe('exact output', () => {
    it('puts nothing between two block siblings', async () => {
      expect(await render('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
    });

    it('renders nothing for a document that is only a link definition', async () => {
      expect(await render('[r]: https://e.test/x')).toBe('');
    });

    it('renders nothing after the body when no footnote is referenced', async () => {
      expect(await render('plain paragraph')).toBe('<p>plain paragraph</p>');
    });

    it('puts nothing between two inline siblings', async () => {
      expect(await render('**a**b')).toBe('<p><strong>a</strong>b</p>');
    });

    it('puts nothing between two list items', async () => {
      expect(await render('- a\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    });

    it('puts nothing between two table cells or two table rows', async () => {
      expect(await render('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |'))
        .toBe('<table><thead><tr><th>a</th><th>b</th></tr></thead>'
          + '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>');
    });

    it('puts nothing between two footnote items', async () => {
      expect(await render('a[^x] b[^y]\n\n[^x]: one\n\n[^y]: two'))
        .toBe('<p>a<sup class="blok-md-fnref" id="fnref-x"><a href="#fn-x">1</a></sup>'
          + ' b<sup class="blok-md-fnref" id="fnref-y"><a href="#fn-y">2</a></sup></p>'
          + '<section class="blok-md-footnotes"><hr><ol>'
          + '<li id="fn-x"><p>one</p><a class="blok-md-fnback" href="#fnref-x" '
          + 'aria-label="Back to content">↩</a></li>'
          + '<li id="fn-y"><p>two</p><a class="blok-md-fnback" href="#fnref-y" '
          + 'aria-label="Back to content">↩</a></li>'
          + '</ol></section>');
    });

    it('renders an ordered list with its start attribute', async () => {
      expect(await render('3. a\n4. b')).toBe('<ol start="3"><li><p>a</p></li><li><p>b</p></li></ol>');
    });

    it('renders an unchecked task item without the checked attribute', async () => {
      expect(await render('- [ ] a'))
        .toBe('<ul><li class="blok-md-task"><input type="checkbox" disabled><p>a</p></li></ul>');
    });

    it('renders a checked task item with the checked attribute', async () => {
      expect(await render('- [x] a'))
        .toBe('<ul><li class="blok-md-task"><input type="checkbox" disabled checked><p>a</p></li></ul>');
    });
  });

  describe('heading slug edge cases', () => {
    it('collapses dashes that came from separated words but not one inside a word', async () => {
      expect(await render('# a - b')).toBe('<h1 id="a-b">a - b</h1>');
    });

    it('strips the dashes a trailing separator produced', async () => {
      expect(await render('# a --')).toBe('<h1 id="a">a --</h1>');
    });

    it('takes the slug from the source of an inline equation', async () => {
      const html = await render('# $a+b$');

      expect(html).toContain('<h1 id="ab">');
    });

    it('falls back to "section" for a heading whose only content is an image', async () => {
      const html = await render('# ![a](https://e.test/i.png)');

      expect(html).toContain('<h1 id="section">');
    });
  });

  describe('blockquotes and alerts', () => {
    it('renders an empty blockquote', async () => {
      expect(await render('>')).toBe('<blockquote></blockquote>');
    });

    it('leaves a quote whose first block is not a paragraph alone', async () => {
      expect(await render('> ---')).toBe('<blockquote><hr></blockquote>');
    });

    it('renders the alert title in title case', async () => {
      expect(await render('> [!NOTE]\n> body'))
        .toBe('<div class="blok-md-alert blok-md-alert-note">'
          + '<p class="blok-md-alert-title">Note</p><p>body</p></div>');
    });

    it('drops the marker paragraph when the marker sits alone', async () => {
      expect(await render('> [!NOTE]'))
        .toBe('<div class="blok-md-alert blok-md-alert-note">'
          + '<p class="blok-md-alert-title">Note</p></div>');
    });

    it('drops the hard break left behind by a marker on its own line', async () => {
      expect(await render('> [!NOTE]  \n> body'))
        .toBe('<div class="blok-md-alert blok-md-alert-note">'
          + '<p class="blok-md-alert-title">Note</p><p>body</p></div>');
    });

    it('only reads the marker out of a leading text node', async () => {
      expect(await render('> `[!NOTE]` body'))
        .toBe('<blockquote><p><code>[!NOTE]</code> body</p></blockquote>');
    });
  });

  describe('references defined outside the top level', () => {
    it('renders an unresolved link reference as its literal source', async () => {
      expect(await render('> [ref]: https://e.test/x\n\n[text][ref]'))
        .toBe('<blockquote></blockquote><p>[text][ref]</p>');
    });

    it('renders an unresolved image reference as its literal source, marked as an image', async () => {
      expect(await render('> [ref]: https://e.test/i.png\n\n![alt][ref]'))
        .toBe('<blockquote></blockquote><p>![alt][ref]</p>');
    });

    it('leaves a footnote reference whose definition is out of scope empty', async () => {
      expect(await render('> [^x]: note\n\na[^x]'))
        .toBe('<blockquote></blockquote>'
          + '<p>a<sup class="blok-md-fnref" id="fnref-x"><a href="#fn-x">1</a></sup></p>'
          + '<section class="blok-md-footnotes"><hr><ol>'
          + '<li id="fn-x"><a class="blok-md-fnback" href="#fnref-x" '
          + 'aria-label="Back to content">↩</a></li></ol></section>');
    });

    // The fallback prints the LABEL as written, not the lowercased identifier.
    // A reference only becomes a node when a definition matches it, so the
    // case difference has to live in the label, not the identifier.
    it('falls back to the label as written for a link reference', async () => {
      expect(await render('> [ref]: https://e.test/x\n\n[text][Ref]'))
        .toBe('<blockquote></blockquote><p>[text][Ref]</p>');
    });

    it('falls back to the label as written for an image reference', async () => {
      expect(await render('> [pic]: https://e.test/i.png\n\n![alt][Pic]'))
        .toBe('<blockquote></blockquote><p>![alt][Pic]</p>');
    });
  });

  describe('math', () => {
    it('renders a flow equation in display mode', async () => {
      const html = await render('$$\nx\n$$');

      expect(html.startsWith('<span class="katex-display">')).toBe(true);
      expect(html).toContain('<annotation encoding="application/x-tex">x</annotation>');
    });

    it('renders an inline equation without display mode', async () => {
      const html = await render('a $x$ b');

      expect(html.startsWith('<p>a <span class="katex">')).toBe(true);
      expect(html).not.toContain('katex-display');
    });

    it('leaves dollars alone when they are not a complete equation', async () => {
      expect(await render('$5 and $10')).toBe('<p>$5 and $10</p>');
    });
  });

  describe('images with an unusable source', () => {
    it('renders nothing, not even the alt text', async () => {
      expect(await render('![a](javascript:alert(1))')).toBe('<p></p>');
    });
  });
});
