import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { linkToBlock, linkToHtml, rememberCut, takeCut } from '../../../../src/components/utils/copy-as-link';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';

const paragraphTool = (): BlockToolAdapter =>
  ({
    name: 'paragraph',
    conversionConfig: { import: 'text', export: 'text' },
    settings: {},
  }) as unknown as BlockToolAdapter;

describe('copy-as-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('linkToHtml', () => {
    it('escapes the url and the text', () => {
      const html = linkToHtml({ url: 'https://x.test/?a=1&b="2"', text: '<b>Plans & more</b>' });
      const holder = document.createElement('div');

      holder.innerHTML = html;

      const anchor = holder.querySelector('a');

      expect(holder.children).toHaveLength(1);
      expect(anchor?.getAttribute('href')).toBe('https://x.test/?a=1&b="2"');
      expect(anchor?.textContent).toBe('<b>Plans & more</b>');
      expect(anchor?.children).toHaveLength(0);
    });

    it('shows the url when the text is empty', () => {
      expect(linkToHtml({ url: 'https://x.test/p1', text: '' })).toBe('<a href="https://x.test/p1">https://x.test/p1</a>');
    });
  });

  describe('linkToBlock', () => {
    it('makes a default-block entry through the default tool import', () => {
      expect(linkToBlock({ url: 'https://x.test/p1', text: 'Plans' }, paragraphTool())).toEqual({
        tool: 'paragraph',
        data: { text: '<a href="https://x.test/p1">Plans</a>' },
      });
    });

    it('uses an import function when the default tool declares one', () => {
      const tool = {
        name: 'custom',
        conversionConfig: { import: (html: string) => ({ body: html }) },
        settings: {},
      } as unknown as BlockToolAdapter;

      expect(linkToBlock({ url: 'https://x.test/p1', text: 'P' }, tool).data).toEqual({
        body: '<a href="https://x.test/p1">P</a>',
      });
    });
  });

  describe('cut registry', () => {
    it('lets a cut be taken once', () => {
      const token = rememberCut();

      expect(takeCut(token)).toBe(true);
      expect(takeCut(token)).toBe(false);
    });

    it('never takes a token it did not mint', () => {
      expect(takeCut('made-up')).toBe(false);
      expect(takeCut(undefined)).toBe(false);
    });

    it('mints a new token for every cut', () => {
      expect(rememberCut()).not.toBe(rememberCut());
    });
  });
});
