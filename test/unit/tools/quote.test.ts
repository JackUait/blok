import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Quote, type QuoteData } from '../../../src/tools/quote';
import type { API, BlockToolConstructorOptions } from '../../../types';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: {
    t: (key: string) => key,
  },
} as unknown as API);

const createQuoteOptions = (
  data: Partial<QuoteData> = {},
  readOnly = false
): BlockToolConstructorOptions<QuoteData> => ({
  data: { text: '', size: 'default', ...data } as QuoteData,
  api: createMockAPI(),
  readOnly,
  block: {} as never,
});

describe('Quote Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setReadOnly', () => {
    it('sets contentEditable to false when entering readonly', () => {
      const options = createQuoteOptions({ text: 'Hello' });
      const quote = new Quote(options);
      const element = quote.render();

      expect(element.contentEditable).toBe('true');

      quote.setReadOnly(true);

      expect(element.contentEditable).toBe('false');
    });

    it('sets contentEditable to true when exiting readonly', () => {
      const options = createQuoteOptions({ text: 'Hello' }, true);
      const quote = new Quote(options);
      const element = quote.render();

      expect(element.contentEditable).toBe('false');

      quote.setReadOnly(false);

      expect(element.contentEditable).toBe('true');
    });

    it('removes placeholder attribute when entering readonly', () => {
      const options = createQuoteOptions({ text: '' });
      const quote = new Quote(options);
      const element = quote.render();

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(true);

      quote.setReadOnly(true);

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);
    });

    it('restores placeholder attribute when exiting readonly', () => {
      const options = createQuoteOptions({ text: '' }, true);
      const quote = new Quote(options);
      const element = quote.render();

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);

      quote.setReadOnly(false);

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(true);
    });

    it('inserts br when entering readonly with empty content', () => {
      const options = createQuoteOptions({ text: '' });
      const quote = new Quote(options);
      const element = quote.render();

      quote.setReadOnly(true);

      expect(element.innerHTML).toBe('<br>');
    });

    it('removes br when exiting readonly with empty content', () => {
      const options = createQuoteOptions({ text: '' }, true);
      const quote = new Quote(options);
      const element = quote.render();

      expect(element.innerHTML).toBe('<br>');

      quote.setReadOnly(false);

      expect(element.innerHTML).toBe('');
    });

    it('preserves DOM element reference across toggle', () => {
      const options = createQuoteOptions({ text: 'Hello' });
      const quote = new Quote(options);
      const element = quote.render();

      quote.setReadOnly(true);
      quote.setReadOnly(false);

      expect(quote.render()).toBe(element);
    });
  });
});
