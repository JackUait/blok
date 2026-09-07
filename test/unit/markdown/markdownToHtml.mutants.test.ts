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
});
