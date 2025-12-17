import { describe, it, expect, vi } from 'vitest';
import Header, { type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

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

const createHeaderOptions = (
  data: Partial<HeaderData> = {},
  config: HeaderConfig = {}
): BlockToolConstructorOptions<HeaderData, HeaderConfig> => ({
  data: { text: '', level: 2, ...data } as HeaderData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

/**
 * Helper to convert MenuConfig to array for easier testing
 */
const toMenuArray = (config: MenuConfig): Array<Record<string, unknown>> => {
  return (Array.isArray(config) ? config : [config]) as Array<Record<string, unknown>>;
};

describe('Header Tool - Custom Configurations', () => {
  describe('placeholder configuration', () => {
    it('uses custom placeholder when provided', () => {
      const options = createHeaderOptions({}, { placeholder: 'Enter heading...' });
      const header = new Header(options);
      const element = header.render();

      expect(element.getAttribute('data-placeholder')).toBe('Enter heading...');
    });

    it('uses empty placeholder when not provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const element = header.render();

      expect(element.getAttribute('data-placeholder')).toBe('');
    });
  });


  describe('levels configuration', () => {
    it('restricts available levels when levels config is provided', () => {
      const options = createHeaderOptions({}, { levels: [1, 2, 3] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(3);
      expect(settings.map(s => s.dataset as Record<string, string> | undefined)).toEqual([
        { 'blok-header-level': '1' },
        { 'blok-header-level': '2' },
        { 'blok-header-level': '3' },
      ]);
    });

    it('shows all levels (1-6) when levels config is not provided', () => {
      const options = createHeaderOptions({}, {});
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(6);
    });

    it('only allows specified levels in settings', () => {
      const options = createHeaderOptions({}, { levels: [2, 4, 6] });
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(3);
    });
  });

  describe('defaultLevel configuration', () => {
    it('uses custom default level when no level is provided in data', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: { defaultLevel: 3 },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H3');
    });

    it('uses H2 as default when defaultLevel is not provided', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: {},
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H2');
    });

    it('falls back to H2 when specified defaultLevel is not in available levels', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: { levels: [1, 2], defaultLevel: 5 },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H2');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('respects level from data even when defaultLevel is configured', () => {
      const options = createHeaderOptions({ text: 'Test', level: 4 }, { defaultLevel: 1 });
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H4');
    });
  });


  describe('levelOverrides configuration', () => {
    it('applies custom tag override', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('DIV');
    });

    it('applies custom name override in settings', () => {
      const options = createHeaderOptions(
        {},
        {
          levelOverrides: {
            1: { name: 'Title' },
            2: { name: 'Subtitle' },
          },
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings[0].title).toBe('Title');
      expect(settings[1].title).toBe('Subtitle');
    });

    it('applies custom font size via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { size: '48px' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.fontSize).toBe('48px');
    });

    it('applies custom margin top via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        { levelOverrides: { 2: { marginTop: '2rem' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.marginTop).toBe('2rem');
    });

    it('applies custom margin bottom via inline styles', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 3 },
        { levelOverrides: { 3: { marginBottom: '1.5rem' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.style.marginBottom).toBe('1.5rem');
    });

    it('applies multiple style overrides together', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        {
          levelOverrides: {
            1: { tag: 'p', size: '3em', marginTop: '20px', marginBottom: '10px' },
          },
        }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('P');
      expect(element.style.fontSize).toBe('3em');
      expect(element.style.marginTop).toBe('20px');
      expect(element.style.marginBottom).toBe('10px');
    });

    it('preserves default values when override is not provided', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 2: { size: '24px' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('H1');
      expect(element.style.fontSize).toBe('');
    });
  });


  describe('combined configurations', () => {
    it('works with levels and levelOverrides together', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 2 },
        {
          levels: [1, 2],
          levelOverrides: {
            1: { name: 'Main Title', size: '3rem' },
            2: { name: 'Section Title', size: '2rem' },
          },
        }
      );
      const header = new Header(options);
      const settings = toMenuArray(header.renderSettings());

      expect(settings).toHaveLength(2);
      expect(settings[0].title).toBe('Main Title');
      expect(settings[1].title).toBe('Section Title');
    });

    it('works with defaultLevel and levelOverrides together', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        data: { text: 'Test' } as HeaderData,
        config: {
          defaultLevel: 3,
          levelOverrides: { 3: { tag: 'div', size: '1.5rem' } },
        },
        api: createMockAPI(),
        readOnly: false,
        block: {} as never,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.tagName).toBe('DIV');
      expect(element.style.fontSize).toBe('1.5rem');
    });
  });

  describe('data handling', () => {
    it('preserves text content with custom configuration', () => {
      const options = createHeaderOptions(
        { text: '<b>Bold</b> text', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.innerHTML).toBe('<b>Bold</b> text');
    });

    it('saves data correctly with custom tag', () => {
      const options = createHeaderOptions(
        { text: 'Test content', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();
      const savedData = header.save(element);

      expect(savedData.text).toBe('Test content');
      expect(savedData.level).toBe(1);
    });
  });

  describe('read-only mode', () => {
    it('respects read-only mode with custom configuration', () => {
      const options: BlockToolConstructorOptions<HeaderData, HeaderConfig> = {
        ...createHeaderOptions({ text: 'Test', level: 1 }, { levelOverrides: { 1: { tag: 'div' } } }),
        readOnly: true,
      };
      const header = new Header(options);
      const element = header.render();

      expect(element.contentEditable).toBe('false');
    });
  });

  describe('data-blok-tool attribute', () => {
    it('sets data-blok-tool attribute regardless of custom tag', () => {
      const options = createHeaderOptions(
        { text: 'Test', level: 1 },
        { levelOverrides: { 1: { tag: 'div' } } }
      );
      const header = new Header(options);
      const element = header.render();

      expect(element.getAttribute('data-blok-tool')).toBe('header');
    });
  });
});
