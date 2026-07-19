import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Paragraph, type ParagraphConfig, type ParagraphData } from '../../../src/tools/paragraph';
import type { API, BlockToolConstructorOptions, PasteEvent } from '../../../types';
import { PLACEHOLDER_FOCUS_ONLY_CLASSES } from '../../../src/components/utils/placeholder';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';

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

const createParagraphOptions = (
  data: Partial<ParagraphData> = {},
  config: ParagraphConfig = {}
): BlockToolConstructorOptions<ParagraphData, ParagraphConfig> => ({
  data: { text: '', ...data } as ParagraphData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

describe('Paragraph Tool - Custom Configurations', () => {
  describe('placeholder configuration', () => {
    it('uses custom placeholder when provided', () => {
      const options = createParagraphOptions({}, { placeholder: 'Start typing...' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element).toHaveAttribute('data-blok-placeholder-active', 'Start typing...');
    });

    it('uses default placeholder translation key when not provided', () => {
      const options = createParagraphOptions({}, {});
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      // The mock API returns the key as-is, so we expect the translation key
      expect(element).toHaveAttribute('data-blok-placeholder-active', 'tools.paragraph.placeholder');
    });

    it('uses DEFAULT_PLACEHOLDER static value when config is undefined', () => {
      expect(Paragraph.DEFAULT_PLACEHOLDER).toBe('tools.paragraph.placeholder');
    });

    // FIX D11: Notion shows NOTHING on an unfocused empty paragraph — the
    // placeholder appears only on focus. The paragraph must therefore NOT carry
    // the empty-editor placeholder classes (which show the hint whenever the
    // editor root is [data-blok-empty=true], even without focus).
    it('does NOT include the unfocused empty-editor placeholder classes (Notion: no placeholder until focus)', () => {
      const options = createParagraphOptions({}, {});
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      const className = element.getAttribute('class') ?? '';

      // The (now-removed) empty-editor variant was the only source of a
      // `data-blok-empty` hook on the paragraph; none may remain.
      expect(className).not.toContain('data-blok-empty');
    });

    it('still includes the focus-gated placeholder classes so the hint shows on focus', () => {
      const options = createParagraphOptions({}, {});
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      const className = element.getAttribute('class') ?? '';

      PLACEHOLDER_FOCUS_ONLY_CLASSES.forEach((cls) => {
        expect(className).toContain(cls);
      });
    });
  });

  describe('setPlaceholder (reactive)', () => {
    it('updates the live placeholder attribute on an editable block', () => {
      const options = createParagraphOptions({}, { placeholder: 'Old' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      expect(element).toHaveAttribute('data-blok-placeholder-active', 'Old');

      paragraph.setPlaceholder('New placeholder');
      expect(element).toHaveAttribute('data-blok-placeholder-active', 'New placeholder');
    });

    it('clears the placeholder attribute when set to false', () => {
      const options = createParagraphOptions({}, { placeholder: 'Old' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      paragraph.setPlaceholder(false);
      expect(element).toHaveAttribute('data-blok-placeholder-active', '');
    });

    it('is a no-op on a read-only block (no DOM write) but updates internal state', () => {
      const options = { ...createParagraphOptions({}, { placeholder: 'Old' }), readOnly: true };
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      // read-only render does not set the active placeholder attribute
      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);

      paragraph.setPlaceholder('New');
      // still no attribute while read-only
      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);

      // toggling back to edit shows the updated placeholder
      paragraph.setReadOnly(false);
      expect(element).toHaveAttribute('data-blok-placeholder-active', 'New');
    });
  });

  describe('preserveBlank configuration', () => {
    it('validates empty paragraph as invalid when preserveBlank is false', () => {
      const options = createParagraphOptions({}, { preserveBlank: false });
      const paragraph = new Paragraph(options);
      const isValid = paragraph.validate({ text: '   ' });

      expect(isValid).toBe(false);
    });

    it('validates empty paragraph as valid when preserveBlank is true', () => {
      const options = createParagraphOptions({}, { preserveBlank: true });
      const paragraph = new Paragraph(options);
      const isValid = paragraph.validate({ text: '   ' });

      expect(isValid).toBe(true);
    });

    it('defaults to false for preserveBlank', () => {
      const options = createParagraphOptions({}, {});
      const paragraph = new Paragraph(options);
      const isValid = paragraph.validate({ text: '' });

      expect(isValid).toBe(false);
    });

    it('validates non-empty paragraph as valid regardless of preserveBlank', () => {
      const optionsWithPreserve = createParagraphOptions({}, { preserveBlank: true });
      const optionsWithoutPreserve = createParagraphOptions({}, { preserveBlank: false });

      const paragraphWithPreserve = new Paragraph(optionsWithPreserve);
      const paragraphWithoutPreserve = new Paragraph(optionsWithoutPreserve);

      expect(paragraphWithPreserve.validate({ text: 'Some content' })).toBe(true);
      expect(paragraphWithoutPreserve.validate({ text: 'Some content' })).toBe(true);
    });
  });

  describe('styles configuration', () => {
    it('applies custom font size via inline styles', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { size: '18px' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.fontSize).toBe('18px');
    });

    it('applies custom line height via inline styles', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { lineHeight: '1.8' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.lineHeight).toBe('1.8');
    });

    it('applies custom margin top via inline styles', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { marginTop: '1rem' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.marginTop).toBe('1rem');
    });

    it('applies custom margin bottom via inline styles', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { marginBottom: '0.5rem' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.marginBottom).toBe('0.5rem');
    });

    it('applies multiple style overrides together', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        {
          styles: {
            size: '16px',
            lineHeight: '1.75',
            marginTop: '12px',
            marginBottom: '8px',
          },
        }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.fontSize).toBe('16px');
      expect(element.style.lineHeight).toBe('1.75');
      expect(element.style.marginTop).toBe('12px');
      expect(element.style.marginBottom).toBe('8px');
    });

    it('does not apply inline styles when styles config is empty', () => {
      const options = createParagraphOptions({ text: 'Test' }, { styles: {} });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.fontSize).toBe('');
      expect(element.style.lineHeight).toBe('');
      expect(element.style.marginTop).toBe('');
      expect(element.style.marginBottom).toBe('');
    });

    it('does not apply inline styles when styles config is not provided', () => {
      const options = createParagraphOptions({ text: 'Test' }, {});
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.fontSize).toBe('');
      expect(element.style.lineHeight).toBe('');
    });
  });

  describe('combined configurations', () => {
    it('works with placeholder and styles together', () => {
      const options = createParagraphOptions(
        {},
        {
          placeholder: 'Enter text here...',
          styles: { size: '14px', lineHeight: '1.5' },
        }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element).toHaveAttribute('data-blok-placeholder-active', 'Enter text here...');
      expect(element.style.fontSize).toBe('14px');
      expect(element.style.lineHeight).toBe('1.5');
    });

    it('works with preserveBlank and styles together', () => {
      const options = createParagraphOptions(
        { text: '' },
        {
          preserveBlank: true,
          styles: { marginTop: '10px' },
        }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const isValid = paragraph.validate({ text: '' });

      expect(isValid).toBe(true);
      expect(element.style.marginTop).toBe('10px');
    });

    it('works with all configurations together', () => {
      const options = createParagraphOptions(
        { text: 'Content' },
        {
          placeholder: 'Type something...',
          preserveBlank: true,
          styles: {
            size: '15px',
            lineHeight: '1.6',
            marginTop: '8px',
            marginBottom: '8px',
          },
        }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element).toHaveAttribute('data-blok-placeholder-active', 'Type something...');
      expect(element.style.fontSize).toBe('15px');
      expect(element.style.lineHeight).toBe('1.6');
      expect(element.style.marginTop).toBe('8px');
      expect(element.style.marginBottom).toBe('8px');
      expect(paragraph.validate({ text: '' })).toBe(true);
    });
  });

  describe('data handling', () => {
    it('preserves text content with custom configuration', () => {
      const options = createParagraphOptions(
        { text: '<b>Bold</b> and <i>italic</i>' },
        { styles: { size: '16px' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.innerHTML).toBe('<b>Bold</b> and <i>italic</i>');
    });

    it('saves data correctly with custom styles', () => {
      const options = createParagraphOptions(
        { text: 'Test content' },
        { styles: { size: '18px' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      expect(savedData.text).toBe('Test content');
    });

    it('merges content correctly', () => {
      const options = createParagraphOptions(
        { text: 'First part' },
        { styles: { size: '16px' } }
      );
      const paragraph = new Paragraph(options);
      paragraph.render();
      paragraph.merge({ text: ' second part' });

      const element = paragraph.render();

      expect(element.innerHTML).toContain('First part');
      expect(element.innerHTML).toContain('second part');
    });
  });

  describe('read-only mode', () => {
    it('respects read-only mode with custom configuration', () => {
      const options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig> = {
        ...createParagraphOptions({ text: 'Test' }, { styles: { size: '16px' } }),
        readOnly: true,
      };
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.contentEditable).toBe('false');
    });

    it('does not show placeholder in read-only mode', () => {
      const options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig> = {
        ...createParagraphOptions({}, {}),
        readOnly: true,
      };
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);
    });

    it('preserves empty paragraphs with a line break in read-only mode', () => {
      const options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig> = {
        ...createParagraphOptions({ text: '' }, {}),
        readOnly: true,
      };
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.innerHTML).toBe('<br>');
    });

    it('does not add extra line break to non-empty paragraphs in read-only mode', () => {
      const options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig> = {
        ...createParagraphOptions({ text: 'Hello' }, {}),
        readOnly: true,
      };
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.innerHTML).toBe('Hello');
    });

    it('is editable when not in read-only mode', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { size: '16px' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.contentEditable).toBe('true');
    });
  });

  describe('setReadOnly', () => {
    it('sets contentEditable to false when entering readonly', () => {
      const options = createParagraphOptions({ text: 'Hello' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.contentEditable).toBe('true');

      paragraph.setReadOnly(true);

      expect(element.contentEditable).toBe('false');
    });

    it('sets contentEditable to true when exiting readonly', () => {
      const options = createParagraphOptions({ text: 'Hello' });

      (options as { readOnly: boolean }).readOnly = true;

      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.contentEditable).toBe('false');

      paragraph.setReadOnly(false);

      expect(element.contentEditable).toBe('true');
    });

    it('removes placeholder attribute when entering readonly', () => {
      const options = createParagraphOptions({ text: '' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(true);

      paragraph.setReadOnly(true);

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);
    });

    it('restores placeholder attribute when exiting readonly', () => {
      const options = createParagraphOptions({ text: '' });

      (options as { readOnly: boolean }).readOnly = true;

      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(false);

      paragraph.setReadOnly(false);

      expect(element.hasAttribute('data-blok-placeholder-active')).toBe(true);
    });

    it('inserts br when entering readonly with empty content', () => {
      const options = createParagraphOptions({ text: '' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      paragraph.setReadOnly(true);

      expect(element.innerHTML).toBe('<br>');
    });

    it('removes br when exiting readonly with empty content', () => {
      const options = createParagraphOptions({ text: '' });

      (options as { readOnly: boolean }).readOnly = true;

      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.innerHTML).toBe('<br>');

      paragraph.setReadOnly(false);

      expect(element.innerHTML).toBe('');
    });

    it('preserves DOM element reference across toggle', () => {
      const options = createParagraphOptions({ text: 'Hello' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      paragraph.setReadOnly(true);
      paragraph.setReadOnly(false);

      expect(paragraph.render()).toBe(element);
    });
  });

  describe('line-height (Notion alignment)', () => {
    it('renders with unitless leading-[1.5] to match Notion body text line-height', () => {
      const options = createParagraphOptions({ text: 'Test' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.className).toContain('leading-[1.5]');
    });
  });

  describe('spacing (Notion alignment)', () => {
    it('uses 1px top margin (mt-px) to match Notion .notion-text margin: 1px 0', () => {
      const options = createParagraphOptions({ text: 'Test' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const classes = element.className.split(/\s+/);

      expect(classes).toContain('mt-px');
      expect(classes).not.toContain('mt-[2px]');
    });
  });

  describe('data-blok-tool attribute', () => {
    it('sets data-blok-tool attribute with custom styles', () => {
      const options = createParagraphOptions(
        { text: 'Test' },
        { styles: { size: '16px' } }
      );
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element).toHaveAttribute('data-blok-tool', 'paragraph');
    });
  });

  describe('static properties', () => {
    it('has correct toolbox configuration', () => {
      expect(Paragraph.toolbox).toHaveProperty('icon');
      expect(Paragraph.toolbox).toHaveProperty('titleKey', 'text');
    });

    it('has correct conversion config', () => {
      expect(Paragraph.conversionConfig).toEqual({
        export: 'text',
        import: 'text',
      });
    });

    it('supports read-only mode', () => {
      expect(Paragraph.isReadOnlySupported).toBe(true);
    });

    it('has correct paste config', () => {
      expect(Paragraph.pasteConfig).toEqual({ tags: ['P'] });
    });

    it('keeps the existing block-level and image whitelist in the text sanitize config', () => {
      const text = Paragraph.sanitize.text as Record<string, unknown>;

      expect(text.br).toBe(true);
      expect(text.img).toEqual({ src: true, style: true });
      expect(text.p).toBe(true);
      expect(text.ul).toBe(true);
      expect(text.li).toBe(true);
    });
  });

  describe('onPaste', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('updates element innerHTML synchronously on paste', () => {
      const options = createParagraphOptions({ text: 'original' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      const pastedElement = document.createElement('div');
      pastedElement.innerHTML = '<b>hello</b>';

      const pasteEvent = {
        detail: {
          data: pastedElement,
        },
      } as unknown as PasteEvent;

      paragraph.onPaste(pasteEvent);

      // innerHTML must be updated synchronously so refreshToolRootElement() reads current DOM
      expect(element.innerHTML).toBe('<b>hello</b>');
      expect(paragraph.save(element).text).toBe('<b>hello</b>');
    });
  });

  describe('save and sanitize preserves rich HTML in paragraph text', () => {
    it('preserves img tags through render → save → sanitize pipeline', () => {
      const imgHtml = '<img src="https://example.com/photo.jpg" style="width: 100%;"><br>';
      const options = createParagraphOptions({ text: imgHtml });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: savedData }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<img');
      expect(text).toContain('src="https://example.com/photo.jpg"');
      expect(text).toContain('style="width: 100%;"');
    });

    it('preserves block-level HTML (p, ul, li) and strips decorative span styles through render → save → sanitize pipeline', () => {
      const richHtml = '<p>Utiliza:</p><ul><li>separadores <span style="font-size: 1rem;">gastronorm</span></li><li>recipientes</li></ul>';
      const options = createParagraphOptions({ text: richHtml });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: savedData }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<p>');
      expect(text).toContain('<ul>');
      expect(text).toContain('<li>');
      // The shared inline whitelist keeps a bare <span> (to support equation spans),
      // but strips the decorative style attribute — no style-based injection survives.
      expect(text).not.toContain('font-size');
      expect(text).not.toContain('style=');
      expect(text).toContain('gastronorm');
    });

    it('strips disallowed tags (script, div, iframe) through render → save → sanitize pipeline', () => {
      const unsafeHtml = '<p>Safe</p><script>alert(1)</script><div>Text</div><iframe src="x"></iframe>';
      const options = createParagraphOptions({ text: unsafeHtml });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: savedData }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<p>');
      expect(text).not.toContain('<script');
      expect(text).not.toContain('<div');
      expect(text).not.toContain('<iframe');
    });

    // FIX D3 + D8: inline formatting (and pasted color) must survive in paragraphs,
    // matching Notion. Previously the text whitelist omitted strong/em/u/s/a/code/mark,
    // so converting a formatted header to a paragraph stripped the marks, and pasted
    // colored <mark> was dropped while it survived in headers.
    it('preserves inline formatting (strong, em, a, code) through render → save → sanitize pipeline', () => {
      const richHtml =
        '<strong>bold</strong> <em>italic</em> <a href="https://x.test">link</a> <code>code</code>';
      const options = createParagraphOptions({ text: richHtml });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: savedData }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<strong>bold</strong>');
      expect(text).toContain('<em>italic</em>');
      expect(text).toContain('href="https://x.test"');
      expect(text).toContain('<code>code</code>');
    });

    it('preserves a colored <mark> (with only its color styles) through the sanitize pipeline', () => {
      const colored = '<mark style="color: red; position: fixed;">red</mark>';
      const options = createParagraphOptions({ text: colored });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const savedData = paragraph.save(element);

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: savedData }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<mark');
      expect(text).toContain('color: red');
      expect(text).not.toContain('position');
    });

    // FIX D3: "Turn into" re-sanitizes the source HTML with the TARGET tool's text
    // config. Simulate the conversion-strip scenario at the tool level: sanitizing
    // formatted text with the paragraph's whitelist must keep the marks.
    it('keeps inline marks when sanitizing formatted text with the paragraph whitelist (conversion-strip scenario)', () => {
      const formatted = '<strong>Heading text</strong> with <em>emphasis</em>';

      const sanitized = sanitizeBlocks(
        [{ tool: 'paragraph', data: { text: formatted } }],
        Paragraph.sanitize,
        {}
      );

      const text = sanitized[0].data.text as string;

      expect(text).toContain('<strong>Heading text</strong>');
      expect(text).toContain('<em>emphasis</em>');
    });
  });

  // FIX D1: Notion-style block-level text/background color stored on the block's
  // data and applied to the rendered element via the shared CSS-var palette.
  describe('block color (Notion D1)', () => {
    interface MutableBlockStub {
      id: string;
      dispatchChange: ReturnType<typeof vi.fn>;
    }

    const createOptionsWithBlock = (
      data: Partial<ParagraphData> = {}
    ): {
      options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig>;
      block: MutableBlockStub;
    } => {
      const block: MutableBlockStub = { id: 'block-1', dispatchChange: vi.fn() };
      const options: BlockToolConstructorOptions<ParagraphData, ParagraphConfig> = {
        ...createParagraphOptions(data, {}),
        block: block as unknown as BlockToolConstructorOptions<ParagraphData, ParagraphConfig>['block'],
      };

      return { options, block };
    };

    it('applies background color as a shared CSS var on render', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi', backgroundColor: 'blue' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
    });

    it('applies text color as a shared CSS var on render', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi', textColor: 'red' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.color).toBe('var(--blok-color-red-text)');
    });

    it('does not apply any color style when no color fields are set', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      expect(element.style.color).toBe('');
      expect(element.style.backgroundColor).toBe('');
    });

    it('persists the color fields in save()', () => {
      const { options } = createOptionsWithBlock({
        text: 'Hi',
        textColor: 'red',
        backgroundColor: 'blue',
      });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const saved = paragraph.save(element);

      expect(saved.text).toBe('Hi');
      expect(saved.textColor).toBe('red');
      expect(saved.backgroundColor).toBe('blue');
    });

    it('omits color fields from save() when unset', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();
      const saved = paragraph.save(element);

      expect(saved.textColor).toBeUndefined();
      expect(saved.backgroundColor).toBeUndefined();
    });

    it('declares the color fields in the sanitize config so they survive saving', () => {
      const text = Paragraph.sanitize as Record<string, unknown>;

      expect(text.textColor).toBe(false);
      expect(text.backgroundColor).toBe(false);
    });

    it('exposes a single Color submenu via renderSettings', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi' });
      const paragraph = new Paragraph(options);
      const settings = paragraph.renderSettings() as Array<{ name?: string; title?: string }>;

      const names = settings.map((s) => s.name);

      expect(names).toContain('block-color');
      expect(names).not.toContain('block-text-color');
      expect(names).not.toContain('block-background-color');
    });

    it('reuses the marker "Color" i18n key for the submenu label', () => {
      const { options } = createOptionsWithBlock({ text: 'Hi' });
      const paragraph = new Paragraph(options);
      const settings = paragraph.renderSettings() as Array<{ name?: string; title?: string }>;

      const colorTune = settings.find((s) => s.name === 'block-color');

      // mock i18n returns the key as-is
      expect(colorTune?.title).toBe('toolNames.marker');
    });

    it('persists and re-applies a picked color (mutates data, re-renders, dispatches change)', () => {
      const { options, block } = createOptionsWithBlock({ text: 'Hi' });
      const paragraph = new Paragraph(options);
      const element = paragraph.render();

      const settings = paragraph.renderSettings() as Array<{
        name?: string;
        children?: { items: Array<{ element: HTMLElement }> };
      }>;
      const colorTune = settings.find((s) => s.name === 'block-color');
      const picker = colorTune?.children?.items[0].element as HTMLElement;

      (picker.querySelector('[data-blok-testid="block-color-swatch-backgroundColor-blue"]') as HTMLElement).click();

      expect(element.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
      expect(paragraph.save(element).backgroundColor).toBe('blue');
      expect(block.dispatchChange).toHaveBeenCalled();
    });
  });
});
