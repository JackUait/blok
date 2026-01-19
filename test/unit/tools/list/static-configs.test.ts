import { describe, it, expect } from 'vitest';
import {
  getListSanitizeConfig,
  getListPasteConfig,
  getListConversionConfig,
} from '../../../../src/tools/list/static-configs';

describe('static-configs', () => {
  describe('getListSanitizeConfig', () => {
    it('returns sanitize config with text property', () => {
      const config = getListSanitizeConfig();

      expect(config).toHaveProperty('text');
      expect(typeof config.text).toBe('object');
    });

    it('allows br tags', () => {
      const config = getListSanitizeConfig();

      expect(config.text.br).toBe(true);
    });

    it('allows anchor tags with href, target, and rel', () => {
      const config = getListSanitizeConfig();

      expect(config.text.a).toEqual({
        href: true,
        target: '_blank',
        rel: 'nofollow',
      });
    });

    it('allows b tags for bold text', () => {
      const config = getListSanitizeConfig();

      expect(config.text.b).toBe(true);
    });

    it('allows i tags for italic text', () => {
      const config = getListSanitizeConfig();

      expect(config.text.i).toBe(true);
    });

    it('allows mark tags for highlights', () => {
      const config = getListSanitizeConfig();

      expect(config.text.mark).toBe(true);
    });

    it('has consistent structure for all allowed tags', () => {
      const config = getListSanitizeConfig();
      const allowedTags = ['br', 'b', 'i', 'mark'];

      allowedTags.forEach(tag => {
        expect(config.text).toHaveProperty(tag);
        expect(config.text[tag]).toBe(true);
      });
    });
  });

  describe('getListPasteConfig', () => {
    it('returns paste config with tags property', () => {
      const config = getListPasteConfig();

      expect(config).toHaveProperty('tags');
      expect(Array.isArray(config.tags)).toBe(true);
    });

    it('allows LI tags for paste', () => {
      const config = getListPasteConfig();

      expect(config.tags).toContain('LI');
    });

    it('only allows LI tags', () => {
      const config = getListPasteConfig();

      expect(config.tags).toHaveLength(1);
      expect(config.tags[0]).toBe('LI');
    });
  });

  describe('getListConversionConfig', () => {
    it('returns conversion config with export and import functions', () => {
      const config = getListConversionConfig();

      expect(config).toHaveProperty('export');
      expect(config).toHaveProperty('import');
      expect(typeof config.export).toBe('function');
      expect(typeof config.import).toBe('function');
    });

    it('export function extracts text from data', () => {
      const config = getListConversionConfig();
      const data = { text: 'Exported text', style: 'unordered', checked: false };

      const result = config.export(data);

      expect(result).toBe('Exported text');
    });

    it('export handles empty text', () => {
      const config = getListConversionConfig();
      const data = { text: '', style: 'ordered', checked: false };

      const result = config.export(data);

      expect(result).toBe('');
    });

    it('export handles text with HTML', () => {
      const config = getListConversionConfig();
      const data = { text: '<strong>Bold</strong> text', style: 'unordered', checked: false };

      const result = config.export(data);

      expect(result).toContain('<strong>');
    });

    it('import function creates list item data from string', () => {
      const config = getListConversionConfig();
      const content = 'Imported text';

      const result = config.import(content);

      expect(result).toEqual({
        text: 'Imported text',
        style: 'unordered',
        checked: false,
      });
    });

    it('import handles empty string', () => {
      const config = getListConversionConfig();

      const result = config.import('');

      expect(result).toEqual({
        text: '',
        style: 'unordered',
        checked: false,
      });
    });

    it('import handles string with HTML', () => {
      const config = getListConversionConfig();
      const content = '<b>Bold</b> text';

      const result = config.import(content);

      expect(result.text).toBe('<b>Bold</b> text');
    });

    it('import always sets style to unordered', () => {
      const config = getListConversionConfig();

      const result = config.import('Any text');

      expect(result.style).toBe('unordered');
    });

    it('import always sets checked to false', () => {
      const config = getListConversionConfig();

      const result = config.import('Any text');

      expect(result.checked).toBe(false);
    });
  });
});
