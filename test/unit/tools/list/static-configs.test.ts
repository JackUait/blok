import { describe, it, expect } from 'vitest';
import type { SanitizerConfig, SanitizerRule } from '../../../../types';
import type { ListItemData, ListItemStyle } from '../../../../src/tools/list/types';
import {
  getListSanitizeConfig,
  getListPasteConfig,
  getListConversionConfig,
} from '../../../../src/tools/list/static-configs';
import { MarkerInlineTool } from '../../../../src/components/inline-tools/inline-tool-marker';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';

/**
 * Type guard to check if a value is a SanitizerConfig (object)
 */
const isSanitizerConfig = (value: unknown): value is SanitizerConfig => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Type guard to check if export is a function
 */
const isExportFunction = (value: unknown): value is (data: ListItemData) => string => {
  return typeof value === 'function';
};

/**
 * Type guard to check if import is a function
 */
const isImportFunction = (
  value: unknown,
): value is (data: string, config: Record<string, unknown>) => ListItemData => {
  return typeof value === 'function';
};

/**
 * Create a ListItemData object with proper typing
 */
const createListItemData = (overrides: Partial<ListItemData> = {}): ListItemData => {
  return {
    text: '',
    style: 'unordered' satisfies ListItemStyle,
    checked: false,
    ...overrides,
  };
};

describe('static-configs', () => {
  describe('getListSanitizeConfig', () => {
    it('returns sanitize config with text property', () => {
      const config = getListSanitizeConfig();

      expect(config).toHaveProperty('text');
      expect(typeof config.text).toBe('object');
    });

    it('allows br tags', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        expect(config.text.br).toBe(true);
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });

    it('allows anchor tags with href, target, and rel', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        expect(config.text.a).toEqual({
          href: true,
          target: '_blank',
          rel: 'nofollow',
        });
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });

    it('allows b tags for bold text', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        expect(config.text.b).toBe(true);
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });

    it('allows i tags for italic text', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        expect(config.text.i).toBe(true);
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });

    it('does not include mark entry so marker inline tool sanitizer is not overridden', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        expect(config.text.mark).toBeUndefined();
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });

    it('has consistent structure for all allowed tags', () => {
      const config = getListSanitizeConfig();

      if (isSanitizerConfig(config.text)) {
        // Access each property directly to avoid union type indexing issues
        expect(config.text.br).toBe(true);
        expect(config.text.b).toBe(true);
        expect(config.text.i).toBe(true);
      } else {
        throw new Error('Expected text to be a SanitizerConfig');
      }
    });
  });

  describe('getListPasteConfig', () => {
    it('returns paste config with tags property', () => {
      const config = getListPasteConfig();

      // PasteConfig can be false, but getListPasteConfig always returns a valid config
      expect(config).not.toBe(false);
      if (config !== false && config.tags) {
        expect(Array.isArray(config.tags)).toBe(true);
      }
    });

    it('allows LI tags for paste', () => {
      const config = getListPasteConfig();

      if (config !== false && config.tags) {
        expect(Array.isArray(config.tags)).toBe(true);
      }
    });

    it('allows LI tags with style attribute', () => {
      const config = getListPasteConfig();

      if (config !== false && config.tags) {
        // tags is now an array of SanitizerConfig objects
        expect(config.tags).toHaveLength(1);
        const firstTag = config.tags[0];
        if (isSanitizerConfig(firstTag)) {
          expect(firstTag).toHaveProperty('li');
          expect(firstTag.li).toHaveProperty('style', true);
        } else {
          throw new Error('Expected first tag to be a SanitizerConfig object');
        }
      }
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
      const data = createListItemData({ text: 'Exported text', style: 'unordered' });

      if (isExportFunction(config.export)) {
        const result = config.export(data);
        expect(result).toBe('Exported text');
      } else {
        throw new Error('Expected export to be a function');
      }
    });

    it('export handles empty text', () => {
      const config = getListConversionConfig();
      const data = createListItemData({ text: '', style: 'ordered' });

      if (isExportFunction(config.export)) {
        const result = config.export(data);
        expect(result).toBe('');
      } else {
        throw new Error('Expected export to be a function');
      }
    });

    it('export handles text with HTML', () => {
      const config = getListConversionConfig();
      const data = createListItemData({
        text: '<strong>Bold</strong> text',
        style: 'unordered',
      });

      if (isExportFunction(config.export)) {
        const result = config.export(data);
        expect(result).toContain('<strong>');
      } else {
        throw new Error('Expected export to be a function');
      }
    });

    it('import function creates list item data from string', () => {
      const config = getListConversionConfig();
      const content = 'Imported text';

      if (isImportFunction(config.import)) {
        const result = config.import(content, {});
        expect(result).toEqual({
          text: 'Imported text',
          style: 'unordered',
          checked: false,
        });
      } else {
        throw new Error('Expected import to be a function');
      }
    });

    it('import handles empty string', () => {
      const config = getListConversionConfig();

      if (isImportFunction(config.import)) {
        const result = config.import('', {});
        expect(result).toEqual({
          text: '',
          style: 'unordered',
          checked: false,
        });
      } else {
        throw new Error('Expected import to be a function');
      }
    });

    it('import handles string with HTML', () => {
      const config = getListConversionConfig();
      const content = '<b>Bold</b> text';

      if (isImportFunction(config.import)) {
        const result = config.import(content, {});
        expect(result.text).toBe('<b>Bold</b> text');
      } else {
        throw new Error('Expected import to be a function');
      }
    });

    it('import always sets style to unordered', () => {
      const config = getListConversionConfig();

      if (isImportFunction(config.import)) {
        const result = config.import('Any text', {});
        expect(result.style).toBe('unordered');
      } else {
        throw new Error('Expected import to be a function');
      }
    });

    it('import always sets checked to false', () => {
      const config = getListConversionConfig();

      if (isImportFunction(config.import)) {
        const result = config.import('Any text', {});
        expect(result.checked).toBe(false);
      } else {
        throw new Error('Expected import to be a function');
      }
    });
  });

  describe('getListSanitizeConfig — mark style preservation after merge', () => {
    it('should not override marker inline tool function-based sanitizer during Object.assign merge', () => {
      const listConfig = getListSanitizeConfig();
      const markerConfig = MarkerInlineTool.sanitize;

      /**
       * Simulate what BlockToolAdapter.sanitizeConfig does:
       *   Object.assign({}, baseConfig, rule)
       *
       * baseConfig = inline tools' sanitize configs (includes marker's function-based mark rule)
       * rule = the list tool's text field config (includes mark: true if bug exists)
       *
       * If the list config has `mark: true`, it overwrites the marker's function,
       * and sanitizeBlocks' internal cloneTagConfig(true) converts it to
       * preserveExistingAttributesRule which strips `style`.
       */
      const baseConfig: SanitizerConfig = { ...markerConfig };
      const listTextRule = listConfig.text as SanitizerConfig;
      const mergedSanitizeConfig: SanitizerConfig = {
        text: Object.assign({}, baseConfig, listTextRule) as unknown as SanitizerRule,
      };

      const blocksData = [
        {
          tool: 'list',
          data: {
            text: '<mark style="color: red; background-color: transparent">colored text</mark>',
          },
        },
      ];

      const result = sanitizeBlocks(blocksData, mergedSanitizeConfig, {});

      /**
       * The style attribute must survive sanitization.
       * Before the fix, mark: true overwrites the function sanitizer,
       * and the style attribute is stripped by preserveExistingAttributesRule.
       */
      const sanitizedText = result[0].data.text as string;

      expect(sanitizedText).toContain('style=');
      expect(sanitizedText).toContain('color');
      expect(sanitizedText).toContain('colored text');
    });
  });
});
