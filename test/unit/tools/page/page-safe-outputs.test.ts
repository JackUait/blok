import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageTool } from '../../../../src/tools/page';
import type { PageData } from '../../../../src/tools/page/types';
import { convertBlockDataToString } from '../../../../src/components/utils/blocks';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import { blocksToMarkdown, blocksToPlainText, extractTexts } from '../../../../src/view';
import type { OutputData } from '../../../../types';

const legacyPageData: PageData = {
  pageId: 'p1',
  cache: { title: 'Private plan', icon: { type: 'emoji', value: '🔐' } },
};

const legacyDocument: OutputData = {
  blocks: [{ id: 'pg', type: 'page', data: legacyPageData }],
};

describe('page safe outputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not expose legacy cached metadata through plain text or Markdown', () => {
    expect(blocksToPlainText(legacyDocument)).toBe('Page');
    expect(blocksToMarkdown(legacyDocument)).toBe('Page');
  });

  it('does not offer a cached title for translation', () => {
    expect(extractTexts(legacyDocument)).toEqual([]);
  });

  it('copies a page with a URL as a neutral link', () => {
    expect(PageTool.copyAsLink(legacyPageData, {
      href: () => '/pages/p1',
    })).toEqual({ url: new URL('/pages/p1', document.baseURI).href, text: 'Page' });
  });

  it('uses neutral text when converting a page without a URL', () => {
    expect(convertBlockDataToString(legacyPageData, PageTool.conversionConfig)).toBe('Page');
  });

  it('declares the ID and block color, never page metadata, in the saved page schema', () => {
    if (typeof blokDocumentSchema.$defs.page.properties !== 'object' || blokDocumentSchema.$defs.page.properties === null) {
      throw new Error('Page schema must expose properties.');
    }

    expect(Object.keys(blokDocumentSchema.$defs.page.properties)).toEqual(['pageId', 'textColor', 'backgroundColor']);
  });
});
