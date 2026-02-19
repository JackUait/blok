import { describe, it, expect } from 'vitest';
import { Paragraph, type ParagraphConfig, type ParagraphData } from '../../../src/tools/paragraph';
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
      expect(Paragraph.toolbox).toHaveProperty('title', 'Text');
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

    it('has correct sanitize config', () => {
      expect(Paragraph.sanitize).toEqual({
        text: {
          br: true,
          img: {
            src: true,
            style: true,
          },
          p: true,
          ul: true,
          li: true,
          span: {
            style: true,
          },
        },
      });
    });
  });
});
