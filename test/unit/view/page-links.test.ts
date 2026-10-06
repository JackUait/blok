// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blocksToHtml,
  blocksToMarkdownWithReport,
  blocksToPlainText,
  pageIndex,
} from '../../../src/view';
import type { OutputData } from '../../../types';

const document: OutputData = {
  blocks: [{
    id: 'r1',
    type: 'page-link',
    data: {
      pageId: 'p1',
      title: 'Saved secret',
      href: '/pages/saved-secret',
      cache: { title: 'Cached secret' },
    },
  }],
};

describe('page-link static output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an allowed reference from host metadata without making an owner', () => {
    const options = {
      pageInfo: () => ({ title: 'Roadmap', icon: { type: 'emoji' as const, value: 'R' } }),
      pageHref: () => '/pages/p1',
    };
    const html = blocksToHtml(document, options);

    expect(html).toContain('Roadmap');
    expect(html).toContain('href="/pages/p1"');
    expect(html).toContain('R');
    expect(html).not.toContain('Saved secret');
    expect(html).not.toContain('Cached secret');
    expect(pageIndex(document).owners).toEqual([]);
    expect(blocksToPlainText(document, options)).toBe('Roadmap');
  });

  it('uses the page row classes in the static parity view', () => {
    const html = blocksToHtml(document, {
      classes: true,
      pageInfo: () => ({ title: 'Roadmap' }),
    });

    expect(html).toContain('class="my-px"');
  });

  it('routes a derived URL through the page-link transform policy', () => {
    const transformUrl = vi.fn((url: string) => url);

    blocksToHtml(document, {
      pageInfo: () => ({ title: 'Roadmap' }),
      pageHref: () => '/pages/p1',
      transformUrl,
    });

    expect(transformUrl).toHaveBeenCalledWith('/pages/p1', { attr: 'href', blockType: 'page-link' });
  });

  it('never exposes denied metadata or asks for a denied destination', () => {
    const pageHref = vi.fn(() => '/pages/secret-title');
    const options = {
      pageInfo: () => ({
        access: 'none' as const,
        title: 'Secret',
        icon: { type: 'emoji' as const, value: 'X' },
      }),
      pageHref,
    };
    const html = blocksToHtml(document, options);
    const markdown = blocksToMarkdownWithReport(document, options);

    expect(html).toContain('No access');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('Secret');
    expect(html).not.toContain('X');
    expect(html).not.toContain('href=');
    expect(pageHref).not.toHaveBeenCalled();
    expect(blocksToPlainText(document, options)).toBe('No access');
    expect(markdown.markdown).toBe('No access');
    expect(markdown.warnings).toContainEqual(expect.objectContaining({
      construct: 'page-link',
      action: 'degraded',
    }));
  });

  it.each([
    ['unresolved', undefined, 'Page'],
    ['missing', null, 'Page not found'],
  ])('keeps %s metadata neutral and unlinked', (_state, pageInfo, label) => {
    const pageHref = vi.fn(() => '/pages/secret-title');
    const options = { pageInfo: () => pageInfo, pageHref };
    const html = blocksToHtml(document, options);

    expect(html).toContain(label);
    expect(html).not.toContain('Saved secret');
    expect(html).not.toContain('Cached secret');
    expect(html).not.toContain('<a');
    expect(pageHref).not.toHaveBeenCalled();
    expect(blocksToPlainText(document, options)).toBe(label);
    expect(blocksToMarkdownWithReport(document, options).markdown).toBe(label);
  });

  it('drops an unsafe derived destination but keeps the allowed title', () => {
    const html = blocksToHtml(document, {
      pageInfo: () => ({ title: 'Roadmap' }),
      pageHref: () => 'javascript:alert(1)',
    });

    expect(html).toContain('Roadmap');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
  });

  it('does not expose malformed children under a non-container link', () => {
    const malformed: OutputData = {
      blocks: [
        { id: 'r1', type: 'page-link', data: { pageId: 'p1' }, content: ['child'] },
        { id: 'child', type: 'paragraph', parent: 'r1', data: { text: 'Nested secret' } },
      ],
    };
    const options = { pageInfo: () => ({ title: 'Roadmap' }) };

    expect(blocksToPlainText(malformed, options)).not.toContain('Nested secret');
    expect(blocksToMarkdownWithReport(malformed, options).markdown).not.toContain('Nested secret');
    expect(blocksToHtml(malformed, options)).not.toContain('Nested secret');
    expect(blocksToPlainText(malformed, options)).toBe('Roadmap');
    expect(blocksToMarkdownWithReport(malformed, options).markdown).toBe('Roadmap');
  });

  it('degrades an allowed reference to visible text and reports lost identity in Markdown', () => {
    const result = blocksToMarkdownWithReport(document, {
      pageInfo: () => ({ title: 'Roadmap <Q4>' }),
    });

    expect(result.markdown).toBe('Roadmap \\<Q4>');
    expect(result.warnings).toContainEqual(expect.objectContaining({
      construct: 'page-link',
      action: 'degraded',
    }));
  });
});
