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
    expect(html).not.toMatch(/<pre[^>]* dir=/);
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
