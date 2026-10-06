import { describe, expect, it } from 'vitest';

import { blocksToHtml } from '../../../src/view';
import type { OutputData } from '../../../types';

const doc = (blocks: OutputData['blocks']): OutputData => ({ blocks });

describe('blocksToHtml direction', () => {
  const data = doc([
    { id: 'ar', type: 'paragraph', data: { text: 'مرحبا <b>بالعالم</b>!' } },
    { id: 'en', type: 'paragraph', data: { text: '<b>Hello</b> world' } },
    { id: 'num', type: 'paragraph', data: { text: '123' } },
    { id: 'h', type: 'header', data: { text: 'عنوان', level: 2 } },
    { id: 'l1', type: 'list', data: { text: 'واحد', style: 'unordered' } },
    { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered' } },
    { id: 'code', type: 'code', data: { code: 'const a = 1;', language: 'js' } },
    { id: 'eq', type: 'paragraph', data: { text: 'مرحبا <span data-latex="a-b=c">a-b=c</span>' } },
  ]);

  it('leaves the output byte-identical without the option', () => {
    expect(blocksToHtml(data)).not.toContain('dir=');
    expect(blocksToHtml(data, { root: true, classes: true })).not.toContain('dir=');
  });

  it('stamps the root wrapper with the document direction', () => {
    expect(blocksToHtml(doc([]), { root: true, direction: 'rtl' })).toBe('<div data-blok-interface="view" dir="rtl"></div>');
  });

  it('stamps each block from the first strong letter of its own text', () => {
    const html = blocksToHtml(data, { direction: 'ltr' });

    expect(html).toContain('<p dir="rtl">مرحبا');
    expect(html).toContain('<p dir="ltr"><b>Hello</b>');
    // No strong letter: no dir, the block follows the document.
    expect(html).toContain('<p>123</p>');
    expect(html).toMatch(/<h2[^>]* dir="rtl"[^>]*>عنوان<\/h2>/);
    // Each list item is a block: dir goes on the <li>, not the <ul>.
    expect(html).toContain('<ul><li dir="rtl">واحد</li><li dir="ltr">two</li></ul>');
    // Code is not prose: its source never sets a direction.
    expect(html).toContain('<pre dir="ltr"><code class="language-js">');
  });

  it('stamps a tab from its title', () => {
    const html = blocksToHtml(doc([
      { id: 'tabs', type: 'tabs', data: {} },
      { id: 't1', type: 'tab', parent: 'tabs', data: { title: 'نظرة' } },
    ]), { direction: 'ltr' });

    expect(html).toContain('<section dir="rtl" data-blok-tab><h4 data-blok-tab-title>نظرة</h4></section>');
  });

  describe('code and math read left-to-right in any direction', () => {
    const code = (data: Record<string, unknown>): OutputData => doc([{ id: 'c', type: 'code', data: { code: '\\frac{a}{b} = c - d', language: 'latex', ...data } }]);

    it('pins every <pre> shape LTR', () => {
      expect(blocksToHtml(code({}), { direction: 'rtl' })).toMatch(/^<pre dir="ltr"/);
      expect(blocksToHtml(code({ filename: 'f.tex' }), { direction: 'rtl' })).toContain('<pre dir="ltr">');
      expect(blocksToHtml(code({}), { direction: 'rtl', classes: true })).toMatch(/<pre class="[^"]*" dir="ltr">/);
    });

    it('pins an inline equation LTR, kept as stored', () => {
      const html = blocksToHtml(doc([{ type: 'paragraph', data: { text: 'مرحبا <span data-latex="a-b=c">a-b=c</span>' } }]), { direction: 'rtl' });

      expect(html).toBe('<p dir="rtl">مرحبا <span data-latex="a-b=c" dir="ltr">a-b=c</span></p>');
    });

    it('pins an inline equation LTR when a renderer replaces it', () => {
      const html = blocksToHtml(doc([{ type: 'paragraph', data: { text: 'مرحبا <span data-latex="a-b=c">a-b=c</span>' } }]), {
        direction: 'rtl',
        inlineRenderers: { span: ({ attrs }) => attrs['data-latex'] === undefined ? undefined : '<span class="katex">math</span>' },
      });

      expect(html).toBe('<p dir="rtl">مرحبا <span dir="ltr"><span class="katex">math</span></span></p>');
    });

    it('does not let a leading equation turn a right-to-left paragraph left-to-right', () => {
      const html = blocksToHtml(doc([{ type: 'paragraph', data: { text: '<span data-latex="a-b=c">a-b=c</span> مرحبا' } }]), { direction: 'ltr' });

      expect(html).toMatch(/^<p dir="rtl">/);
    });
  });

  it('stamps the content element under editor parity, as the editor does', () => {
    const html = blocksToHtml(doc([{ id: 'ar', type: 'paragraph', data: { text: 'مرحبا' } }]), {
      classes: true,
      direction: 'ltr',
    });

    expect(html).toMatch(/^<div data-blok-element class="[^"]*"><div class="[^"]*" dir="rtl"><p/);
  });

  it('ignores a direction value that is not ltr or rtl', () => {
    const options = { root: true, direction: '"><script>' } as unknown as Parameters<typeof blocksToHtml>[1];

    expect(blocksToHtml(data, options)).not.toContain('dir=');
  });
});
