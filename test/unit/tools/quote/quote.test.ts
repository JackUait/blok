import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolConstructorOptions, PasteEvent } from '../../../../types';
import type { QuoteData } from '../../../../src/tools/quote';

const createMockAPI = (): API =>
  ({
    styles: {
      block: 'blok-block',
      inlineToolbar: '',
      inlineToolButton: '',
      inlineToolButtonActive: '',
      input: '',
      loader: '',
      button: '',
      settingsButton: '',
      settingsButtonActive: '',
    },
    i18n: { t: (k: string) => k },
  }) as unknown as API;

const createQuoteOptions = (
  data: Partial<QuoteData> = {},
  overrides: { readOnly?: boolean } = {}
): BlockToolConstructorOptions<QuoteData> => ({
  data: { text: '', size: 'default', ...data } as QuoteData,
  config: {},
  api: createMockAPI(),
  readOnly: overrides.readOnly ?? false,
  block: { id: 'quote-block-id' } as never,
});

describe('Quote Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('render()', () => {
    it('returns a blockquote element', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.tagName).toBe('BLOCKQUOTE');
    });

    it('is contentEditable when not read-only', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.contentEditable).toBe('true');
    });

    it('is not contentEditable in read-only mode', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({}, { readOnly: true }));
      const el = tool.render();

      expect(el.contentEditable).toBe('false');
    });

    it('renders saved text content', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: 'Hello world' }));
      const el = tool.render();

      expect(el.innerHTML).toBe('Hello world');
    });

    it('renders HTML content with inline formatting', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: '<b>Bold</b> and <i>italic</i>' }));
      const el = tool.render();

      expect(el.innerHTML).toBe('<b>Bold</b> and <i>italic</i>');
    });

    it('has a 3px left border via Tailwind class', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.className).toContain('border-l-[3px]');
    });

    it('uses currentcolor for the left border', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.className).toContain('border-current');
    });

    it('has horizontal padding', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.className).toContain('pl-[0.9em]');
    });

    it('has vertical margin of 0.3em for spacing between blocks', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.className).toContain('mt-[0.3em]');
      expect(el.className).toContain('mb-[0.3em]');
    });

    it('does not apply large font size by default', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'default' }));
      const el = tool.render();

      expect(el.className).not.toContain('text-[1.2em]');
    });

    it('applies large font size when size is large', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'large' }));
      const el = tool.render();

      expect(el.className).toContain('text-[1.2em]');
    });

    it('sets data-blok-tool attribute to quote', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el).toHaveAttribute('data-blok-tool', 'quote');
    });

    it('sets up placeholder in editable mode', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      expect(el.hasAttribute('data-blok-placeholder-active')).toBe(true);
    });

    it('does not set placeholder in read-only mode', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({}, { readOnly: true }));
      const el = tool.render();

      expect(el.hasAttribute('data-blok-placeholder-active')).toBe(false);
    });

    it('renders <br> for empty text in read-only mode', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: '' }, { readOnly: true }));
      const el = tool.render();

      expect(el.innerHTML).toBe('<br>');
    });
  });

  describe('save()', () => {
    it('returns text and size from the rendered element', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: 'Saved text', size: 'large' }));
      const el = tool.render();
      const data = tool.save(el);

      expect(data.text).toBe('Saved text');
      expect(data.size).toBe('large');
    });

    it('saves current innerHTML as text', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: '' }));
      const el = tool.render();

      el.innerHTML = 'Modified content';
      const data = tool.save(el);

      expect(data.text).toBe('Modified content');
    });

    it('defaults size to default', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();
      const data = tool.save(el);

      expect(data.size).toBe('default');
    });
  });

  describe('validate()', () => {
    it('returns true for non-empty text', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());

      expect(tool.validate({ text: 'Something', size: 'default' })).toBe(true);
    });

    it('returns false for empty text', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());

      expect(tool.validate({ text: '', size: 'default' })).toBe(false);
    });

    it('returns false for whitespace-only text', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());

      expect(tool.validate({ text: '   ', size: 'default' })).toBe(false);
    });
  });

  describe('merge()', () => {
    it('appends merged data text to existing content', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ text: 'First' }));
      const el = tool.render();

      tool.merge({ text: ' second', size: 'default' });

      expect(el.innerHTML).toContain('First');
      expect(el.innerHTML).toContain('second');
    });
  });

  describe('renderSettings()', () => {
    it('returns a single parent item with children containing size options', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());

      tool.render();
      const settings = tool.renderSettings() as Array<{ children: { items: unknown[] } }>;

      expect(Array.isArray(settings)).toBe(true);
      expect(settings.length).toBe(1);
      expect(settings[0].children).toBeDefined();
      expect(settings[0].children.items.length).toBe(2);
    });

    it('parent item has quote size title and icon', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());

      tool.render();
      const settings = tool.renderSettings() as Array<{ title: string; icon: string }>;

      expect(settings[0].title).toBe('tools.quote.size');
      expect(settings[0].icon).toBeTruthy();
    });

    it('marks default size as active when size is default', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'default' }));

      tool.render();
      const settings = tool.renderSettings() as Array<{ children: { items: Array<{ isActive: boolean }> } }>;
      const children = settings[0].children.items;

      expect(children[0].isActive).toBe(true);
      expect(children[1].isActive).toBe(false);
    });

    it('marks large size as active when size is large', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'large' }));

      tool.render();
      const settings = tool.renderSettings() as Array<{ children: { items: Array<{ isActive: boolean }> } }>;
      const children = settings[0].children.items;

      expect(children[0].isActive).toBe(false);
      expect(children[1].isActive).toBe(true);
    });

    it('toggles to large size when large option is activated', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'default' }));
      const el = tool.render();

      const settings = tool.renderSettings() as Array<{ children: { items: Array<{ onActivate: () => void }> } }>;

      settings[0].children.items[1].onActivate(); // Activate "Large"

      expect(el.className).toContain('text-[1.2em]');
      expect(tool.save(el).size).toBe('large');
    });

    it('toggles to default size when default option is activated', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions({ size: 'large' }));
      const el = tool.render();

      const settings = tool.renderSettings() as Array<{ children: { items: Array<{ onActivate: () => void }> } }>;

      settings[0].children.items[0].onActivate(); // Activate "Default"

      expect(el.className).not.toContain('text-[1.2em]');
      expect(tool.save(el).size).toBe('default');
    });
  });

  describe('onPaste()', () => {
    it('updates element with pasted blockquote content', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const tool = new Quote(createQuoteOptions());
      const el = tool.render();

      const pastedElement = document.createElement('blockquote');

      pastedElement.innerHTML = 'Pasted quote text';

      const pasteEvent = {
        detail: { data: pastedElement },
      } as unknown as PasteEvent;

      tool.onPaste(pasteEvent);

      expect(el.innerHTML).toBe('Pasted quote text');
    });
  });

  describe('static properties', () => {
    it('has toolbox with icon and titleKey', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const toolbox = Quote.toolbox;

      expect(toolbox).toBeDefined();
      expect(!Array.isArray(toolbox) && toolbox.icon).toBeTruthy();
      expect(!Array.isArray(toolbox) && toolbox.titleKey).toBe('quote');
    });

    it('has titleKey for i18n', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const toolbox = Quote.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.titleKey).toBe('quote');
    });

    it('has " shortcut for toolbox trigger', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const toolbox = Quote.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.shortcut).toBe('"');
    });

    it('has searchTermKeys for multilingual search', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const toolbox = Quote.toolbox;

      expect(!Array.isArray(toolbox) && toolbox.searchTermKeys).toEqual(
        expect.arrayContaining(['quote', 'blockquote', 'citation'])
      );
    });

    it('has conversion config with text export/import', async () => {
      const { Quote } = await import('../../../../src/tools/quote');

      expect(Quote.conversionConfig).toEqual({
        export: 'text',
        import: 'text',
      });
    });

    it('supports read-only mode', async () => {
      const { Quote } = await import('../../../../src/tools/quote');

      expect(Quote.isReadOnlySupported).toBe(true);
    });

    it('has paste config for BLOCKQUOTE tags', async () => {
      const { Quote } = await import('../../../../src/tools/quote');

      expect(Quote.pasteConfig).toEqual({ tags: ['BLOCKQUOTE'] });
    });

    it('has sanitize config allowing inline formatting', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const sanitize = Quote.sanitize;

      expect(sanitize).toHaveProperty('text');
      expect((sanitize as Record<string, Record<string, unknown>>).text.br).toBe(true);
    });

    it('sanitize config preserves style attribute on mark elements', async () => {
      const { Quote } = await import('../../../../src/tools/quote');
      const sanitize = Quote.sanitize;
      const markRule = (sanitize as Record<string, Record<string, unknown>>).text.mark;

      expect(markRule).toEqual(expect.objectContaining({ style: true }));
    });
  });
});
