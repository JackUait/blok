// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToMarkdownWithReport,
  blocksToPlainText,
} from '../../../src/view';

import type { OutputData } from '../../../types';
import type { PageInfo } from '../../../types/tools/page';

const legacyDocument: OutputData = {
  blocks: [{
    id: 'pg',
    type: 'page',
    data: {
      pageId: 'p1',
      cache: { title: 'Private plan', icon: { type: 'emoji', value: '🔐' } },
    },
  }],
};

describe('static page metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['no lookup', {}],
    ['unresolved lookup', { pageInfo: () => undefined }],
  ])('keeps legacy metadata hidden with %s', (_name, metadataOptions) => {
    const pageHref = vi.fn(() => '/p/p1');
    const options = { ...metadataOptions, pageHref };
    const html = blocksToHtml(legacyDocument, options);
    const plainText = blocksToPlainText(legacyDocument, options);
    const markdown = blocksToMarkdown(legacyDocument, options);

    expect(html).not.toContain('Private plan');
    expect(html).not.toContain('🔐');
    expect(plainText).not.toContain('Private plan');
    expect(markdown).not.toContain('Private plan');
    expect(plainText).not.toContain('🔐');
    expect(markdown).not.toContain('🔐');
    expect(html).toContain('>Page</span>');
    expect(plainText).toBe('Page');
    expect(markdown).toBe('Page');
    expect(html).not.toContain('<a');
    expect(pageHref).not.toHaveBeenCalled();
  });

  it('uses only authorized host title and emoji, escaping HTML and Markdown', () => {
    const info: PageInfo = {
      title: 'Roadmap <Q4>',
      icon: { type: 'emoji', value: '🗺<b>' },
    };
    const options = { pageInfo: () => info };
    const html = blocksToHtml(legacyDocument, options);

    expect(html).not.toContain('Private plan');
    expect(html).not.toContain('🔐');
    expect(html).toContain('Roadmap &lt;Q4&gt;');
    expect(html).toContain('🗺&lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(blocksToPlainText(legacyDocument, options)).toBe('Roadmap <Q4>');
    expect(blocksToMarkdown(legacyDocument, options)).toBe('Roadmap \\<Q4>');
    expect(blocksToMarkdownWithReport(legacyDocument, options).markdown).toBe('Roadmap \\<Q4>');
  });

  it('shows denied access without leaking even metadata returned with the denial', () => {
    const pageHref = vi.fn(() => '/p/Private%20plan');
    const info: PageInfo = {
      access: 'none',
      title: 'Private plan',
      icon: { type: 'emoji', value: '🔐' },
    };
    const options = { pageInfo: () => info, pageHref };
    const html = blocksToHtml(legacyDocument, options);

    expect(html).toContain('No access');
    expect(html).toMatch(/<svg\b/);
    expect(html).not.toContain('Private plan');
    expect(html).not.toContain('🔐');
    expect(html).not.toContain('<a');
    expect(pageHref).not.toHaveBeenCalled();
    expect(blocksToPlainText(legacyDocument, options)).toBe('No access');
    expect(blocksToMarkdown(legacyDocument, options)).toBe('No access');
  });

  it('keeps a missing page distinct and unlinked', () => {
    const pageHref = vi.fn(() => '/p/p1');
    const options = { pageInfo: () => null, pageHref };
    const html = blocksToHtml(legacyDocument, options);

    expect(html).toContain('Page not found');
    expect(html).not.toContain('Private plan');
    expect(html).not.toContain('🔐');
    expect(html).not.toContain('<a');
    expect(pageHref).not.toHaveBeenCalled();
    expect(blocksToPlainText(legacyDocument, options)).toBe('Page not found');
    expect(blocksToMarkdown(legacyDocument, options)).toBe('Page not found');
  });

  it('transforms and escapes authorized page and icon URLs', () => {
    const html = blocksToHtml(legacyDocument, {
      pageInfo: () => ({
        title: 'Roadmap',
        icon: { type: 'image', url: '/icon.svg?x=1&y=2' },
      }),
      pageHref: (pageId) => `/p/${pageId}?x=1&y=2`,
      transformUrl: (url, { attr }) => `${attr === 'href' ? 'https://app.test' : 'https://cdn.test'}${url}`,
    });

    expect(html).toContain('href="https://app.test/p/p1?x=1&amp;y=2"');
    expect(html).toContain('src="https://cdn.test/icon.svg?x=1&amp;y=2"');
    expect(html).not.toContain('Private plan');
    expect(html).not.toContain('🔐');
  });

  it('drops unsafe page links and image icons after URL handling', () => {
    const html = blocksToHtml(legacyDocument, {
      pageInfo: () => ({
        title: 'Roadmap',
        icon: { type: 'image', url: 'javascript:alert(1)' },
      }),
      pageHref: () => '/p/p1',
      transformUrl: (url, { attr }) => attr === 'href' ? 'javascript:alert(1)' : url,
    });

    expect(html).toContain('Roadmap');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
  });

  it('imports the view entry without DOM globals in Node', async () => {
    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();

    const view = await import('../../../src/view');

    expect(typeof view.blocksToHtml).toBe('function');
    expect(typeof view.blocksToMarkdown).toBe('function');
    expect(Reflect.get(globalThis, 'window')).toBeUndefined();
    expect(Reflect.get(globalThis, 'document')).toBeUndefined();
  });
});
