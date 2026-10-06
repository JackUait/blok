// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml } from '../../../src/view/blocks-to-html';
import { blocksToMarkdownWithReport } from '../../../src/view/blocks-to-markdown';
import { blocksToPlainText, blocksToPlainTextWithReport } from '../../../src/view/blocks-to-plain-text';
import { extractTexts, injectTexts } from '../../../src/view/document-texts';
import { pageIndex } from '../../../src/view/page-index';
import { invoke } from '../../../src/view/server-runtime';
import type { OutputData } from '../../../types';

const PROTOTYPE_KEYS = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'];
const UNKNOWN = 'x-unknown';

/** A document whose middle block has the given type and a child of its own. */
const documentWith = (type: string): OutputData => ({
  blocks: [
    { id: 'a', type: 'paragraph', data: { text: 'Before' } },
    { id: 'b', type, data: { text: 'Own text' }, content: ['c'] },
    { id: 'c', type: 'paragraph', parent: 'b', data: { text: 'Child' } },
  ],
});

/** Run with the prototype key and with a plain unknown type, naming both the same. */
const both = async <T>(name: string, run: (type: string) => T | Promise<T>): Promise<[string, string]> => {
  const actual = JSON.stringify(await run(name)).split(name).join(UNKNOWN);
  const expected = JSON.stringify(await run(UNKNOWN));

  return [actual, expected];
};

describe('a block typed like an Object.prototype key reads as an unknown block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each(PROTOTYPE_KEYS)('%s', (name) => {
    it('blocksToHtml', async () => {
      const [actual, expected] = await both(name, (type) => blocksToHtml(documentWith(type)));

      expect(actual).toBe(expected);
    });

    it('blocksToHtml with unknown blocks as comments, classes and direction', async () => {
      const [actual, expected] = await both(name, (type) => blocksToHtml(documentWith(type), {
        onUnknownBlock: 'comment',
        classes: true,
        direction: 'rtl',
      }));

      expect(actual).toBe(expected);
    });

    it('blocksToPlainText and its report', async () => {
      const [actual, expected] = await both(name, (type) => [
        blocksToPlainText(documentWith(type)),
        blocksToPlainTextWithReport(documentWith(type)),
      ]);

      expect(actual).toBe(expected);
    });

    it('blocksToMarkdown', async () => {
      const [actual, expected] = await both(name, (type) => blocksToMarkdownWithReport(documentWith(type)));

      expect(actual).toBe(expected);
    });

    it('pageIndex', async () => {
      const [actual, expected] = await both(name, (type) => pageIndex(documentWith(type)));

      expect(actual).toBe(expected);
    });

    it('extractTexts and injectTexts', async () => {
      const [actual, expected] = await both(name, (type) => {
        const texts = extractTexts(documentWith(type));

        return [texts, injectTexts(documentWith(type), texts.map((text) => `${text}!`))];
      });

      expect(actual).toBe(expected);
    });

    it.each([
      'blocksToHtml',
      'blocksToMarkdown',
      'blocksToPlainText',
      'blocksToPlainTextWithReport',
      'inspect',
    ])('server runtime %s', async (operation) => {
      const [actual, expected] = await both(name, (type) => invoke(operation, JSON.stringify(documentWith(type))));

      expect(actual).toBe(expected);
    });

    it.each(['extractTexts', 'pageIndex', 'blocksToHtmlWithPages', 'blocksToMarkdownWithPages'])('server runtime %s', async (operation) => {
      const [actual, expected] = await both(name, (type) => invoke(operation, JSON.stringify({
        document: documentWith(type),
        pages: {},
      })));

      expect(actual).toBe(expected);
    });
  });

  it('still uses a renderer the caller registered under a prototype key', () => {
    const renderers = Object.fromEntries([['constructor', (): string => '<b>mine</b>']]);

    expect(blocksToHtml(documentWith('constructor'), { renderers })).toBe('<p>Before</p><b>mine</b>');
    expect(blocksToPlainText(documentWith('constructor'), { renderers })).toBe('Before\n\nmine\n\nChild');
  });
});
