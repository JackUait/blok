import { describe, expect, it } from 'vitest';

import { blocksToHtml, blocksToMarkdown, blocksToPlainText, extractTexts, outlineFromOutputData } from '../../../src/view';
import { blocksToMarkdown as serializeBlocks } from '../../../src/markdown/blocks-to-markdown';
import type { OutputData } from '../../../types';

/**
 * A consumer may already register its own tool under the key `page`. Only a
 * block shaped like Blok's page pointer (a string `pageId`) is treated as one;
 * any other `page` block keeps the unknown-block behaviour, children included.
 */
const foreignPage = (): OutputData => ({
  blocks: [
    { id: 'pg', type: 'page', data: { text: 'Own page tool' }, content: ['h'] },
    { id: 'h', type: 'header', parent: 'pg', data: { text: 'Inside heading', level: 2 } },
  ],
});

describe('a foreign block saved as type "page"', () => {
  it('blocksToHtml still renders its children', () => {
    expect(blocksToHtml(foreignPage())).toContain('Inside heading');
  });

  it('blocksToMarkdown still writes its children', () => {
    expect(blocksToMarkdown(foreignPage())).toContain('Inside heading');
  });

  it('blocksToMarkdown keeps foreign page text when pageId is empty', () => {
    const page: OutputData = {
      blocks: [{ type: 'page', data: { pageId: '', text: 'Custom page content' } }],
    };

    expect(blocksToMarkdown(page)).toBe('Custom page content');
  });

  it('blocksToPlainText still reads its children', () => {
    expect(blocksToPlainText(foreignPage())).toContain('Inside heading');
  });

  it('outline still lists headings under it', () => {
    expect(outlineFromOutputData(foreignPage()).map((entry) => entry.text)).toEqual(['Inside heading']);
  });

  it('extractTexts ignores cached titles on foreign and real page blocks', () => {
    const texts = extractTexts({
      blocks: [
        { id: 'pg', type: 'page', data: { cache: { title: 'Not a pointer' } } },
        { id: 'pp', type: 'page', data: { pageId: 'p1', cache: { title: 'Real pointer' } } },
        { id: 'body', type: 'paragraph', data: { text: 'Visible body' } },
      ],
    });

    expect(texts).toEqual(['Visible body']);
  });

  it('the shared markdown core does not write it as "New page"', () => {
    expect(serializeBlocks([{ tool: 'page', data: { text: 'Own page tool' } }])).not.toContain('New page');
  });
});
