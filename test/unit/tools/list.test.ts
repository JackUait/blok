import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import List, { type ListItemConfig, type ListItemData } from '../../../src/tools/list';
import I18n from '../../../src/components/i18n';
import defaultDictionary from '../../../src/components/i18n/locales/en/messages.json';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { I18nDictionary } from '../../../types/configs';
import type { MenuConfig } from '../../../types/tools/menu-config';

/**
 * Creates a mock API object for testing
 */
const createMockAPI = (): API =>
  ({
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
      t: (key: string) => I18n.t('tools.list', key),
    },
    blocks: {
      getCurrentBlockIndex: () => 0,
      delete: () => {},
      insert: () => {},
    },
  }) as unknown as API;

/**
 * Creates list tool constructor options
 */
const createListOptions = (
  data: Partial<ListItemData> = {},
  config: ListItemConfig = {}
): BlockToolConstructorOptions<ListItemData, ListItemConfig> => ({
  data: { text: '', style: 'unordered', ...data } as ListItemData,
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

describe('List Tool - i18n', () => {
  beforeEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  afterEach(() => {
    I18n.setDictionary(defaultDictionary as I18nDictionary);
  });

  describe('default dictionary contains list translations', () => {
    it('has toolNames entries for list styles', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary.toolNames).toHaveProperty('Bulleted list');
      expect(dictionary.toolNames).toHaveProperty('Numbered list');
      expect(dictionary.toolNames).toHaveProperty('Checklist');
    });

    it('has tools.list namespace for List placeholder', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary.tools).toHaveProperty('list');
      expect(dictionary.tools!.list).toHaveProperty('List');
    });
  });

  describe('renderSettings uses i18n', () => {
    it('translates style labels in settings menu', () => {
      const frenchDictionary: I18nDictionary = {
        toolNames: {
          'Bulleted list': 'Liste à puces',
          'Numbered list': 'Liste numérotée',
          Checklist: 'Liste de contrôle',
        },
      };

      I18n.setDictionary(frenchDictionary);

      const options = createListOptions();
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings).toHaveLength(3);
      expect(settings[0].label).toBe('Liste à puces');
      expect(settings[1].label).toBe('Liste numérotée');
      expect(settings[2].label).toBe('Liste de contrôle');
    });

    it('falls back to original key when translation is missing', () => {
      const emptyDictionary: I18nDictionary = {};

      I18n.setDictionary(emptyDictionary);

      const options = createListOptions();
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings[0].label).toBe('Bulleted list');
      expect(settings[1].label).toBe('Numbered list');
      expect(settings[2].label).toBe('Checklist');
    });

    it('respects configured styles when translating', () => {
      const germanDictionary: I18nDictionary = {
        toolNames: {
          'Bulleted list': 'Aufzählung',
          'Numbered list': 'Nummerierung',
          Checklist: 'Checkliste',
        },
      };

      I18n.setDictionary(germanDictionary);

      const options = createListOptions({}, { styles: ['unordered', 'checklist'] });
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings).toHaveLength(2);
      expect(settings[0].label).toBe('Aufzählung');
      expect(settings[1].label).toBe('Checkliste');
    });
  });

  describe('toolbox configuration', () => {
    it('has translatable titles in toolbox config', () => {
      const toolbox = List.toolbox;

      expect(Array.isArray(toolbox)).toBe(true);

      const toolboxArray = toolbox as Array<{ title: string; name: string }>;

      expect(toolboxArray).toHaveLength(3);
      expect(toolboxArray[0].title).toBe('Bulleted list');
      expect(toolboxArray[1].title).toBe('Numbered list');
      expect(toolboxArray[2].title).toBe('Checklist');
    });

    it('toolbox titles exist in toolNames dictionary', () => {
      const toolbox = List.toolbox as Array<{ title: string }>;
      const dictionary = defaultDictionary as I18nDictionary;

      toolbox.forEach((item) => {
        expect(dictionary.toolNames).toHaveProperty(item.title);
      });
    });
  });

  describe('i18n integration with I18n class', () => {
    it('translates list style names via I18n.t()', () => {
      const spanishDictionary: I18nDictionary = {
        tools: {
          list: {
            'Bulleted list': 'Lista con viñetas',
            'Numbered list': 'Lista numerada',
            Checklist: 'Lista de verificación',
          },
        },
      };

      I18n.setDictionary(spanishDictionary);

      expect(I18n.t('tools.list', 'Bulleted list')).toBe('Lista con viñetas');
      expect(I18n.t('tools.list', 'Numbered list')).toBe('Lista numerada');
      expect(I18n.t('tools.list', 'Checklist')).toBe('Lista de verificación');
    });

    it('translates toolbox titles via toolNames namespace', () => {
      const japaneseDictionary: I18nDictionary = {
        toolNames: {
          'Bulleted list': '箇条書きリスト',
          'Numbered list': '番号付きリスト',
          Checklist: 'チェックリスト',
        },
      };

      I18n.setDictionary(japaneseDictionary);

      expect(I18n.t('toolNames', 'Bulleted list')).toBe('箇条書きリスト');
      expect(I18n.t('toolNames', 'Numbered list')).toBe('番号付きリスト');
      expect(I18n.t('toolNames', 'Checklist')).toBe('チェックリスト');
    });
  });
});
