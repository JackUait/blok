import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import List, { type ListItemConfig, type ListItemData } from '../../../src/tools/list';
import I18n from '../../../src/components/i18n';
import defaultDictionary from '../../../src/components/i18n/locales/en/messages.json';
import type { API, BlockToolConstructorOptions } from '../../../types';
import type { I18nDictionary, TranslationKey } from '../../../types/configs';
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
      t: (key: string) => I18n.t(`tools.list.${key}` as TranslationKey),
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

      expect(dictionary).toHaveProperty('toolNames.bulletedList');
      expect(dictionary).toHaveProperty('toolNames.numberedList');
      expect(dictionary).toHaveProperty('toolNames.todoList');
    });

    it('has tools.list.list key for List placeholder', () => {
      const dictionary = defaultDictionary as I18nDictionary;

      expect(dictionary).toHaveProperty('tools.list.list');
    });
  });

  describe('renderSettings uses i18n', () => {
    it('translates style labels in settings menu', () => {
      const frenchDictionary: I18nDictionary = {
        'toolNames.bulletedList': 'Liste à puces',
        'toolNames.numberedList': 'Liste numérotée',
        'toolNames.todoList': 'Liste de contrôle',
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

      // Falls back to the last segment of the translation key
      expect(settings[0].label).toBe('bulletedList');
      expect(settings[1].label).toBe('numberedList');
      expect(settings[2].label).toBe('todoList');
    });

    it('respects configured styles when translating', () => {
      const germanDictionary: I18nDictionary = {
        'toolNames.bulletedList': 'Aufzählung',
        'toolNames.numberedList': 'Nummerierung',
        'toolNames.todoList': 'Aufgabenliste',
      };

      I18n.setDictionary(germanDictionary);

      const options = createListOptions({}, { styles: ['unordered', 'checklist'] });
      const list = new List(options);
      const settings = toMenuArray(list.renderSettings());

      expect(settings).toHaveLength(2);
      expect(settings[0].label).toBe('Aufzählung');
      expect(settings[1].label).toBe('Aufgabenliste');
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
      expect(toolboxArray[2].title).toBe('To-do list');
    });

    it('toolbox titles have corresponding dictionary entries', () => {
      const toolbox = List.toolbox as Array<{ title: string }>;
      const dictionary = defaultDictionary as I18nDictionary;

      // Map toolbox titles to their dictionary key equivalents
      const titleToDictKey: Record<string, string> = {
        'Bulleted list': 'bulletedList',
        'Numbered list': 'numberedList',
        'To-do list': 'todoList',
      };

      toolbox.forEach((item) => {
        const dictKey = titleToDictKey[item.title];
        expect(dictKey).toBeDefined();
        expect(dictionary).toHaveProperty(`toolNames.${dictKey}`);
      });
    });
  });

  describe('i18n integration with I18n class', () => {
    it('translates list style names via I18n.t()', () => {
      const spanishDictionary: I18nDictionary = {
        'toolNames.bulletedList': 'Lista con viñetas',
        'toolNames.numberedList': 'Lista numerada',
        'toolNames.todoList': 'Lista de verificación',
      };

      I18n.setDictionary(spanishDictionary);

      expect(I18n.t('toolNames.bulletedList')).toBe('Lista con viñetas');
      expect(I18n.t('toolNames.numberedList')).toBe('Lista numerada');
      expect(I18n.t('toolNames.todoList')).toBe('Lista de verificación');
    });

    it('translates toolbox titles via toolNames namespace', () => {
      const japaneseDictionary: I18nDictionary = {
        'toolNames.bulletedList': '箇条書きリスト',
        'toolNames.numberedList': '番号付きリスト',
        'toolNames.todoList': 'ToDoリスト',
      };

      I18n.setDictionary(japaneseDictionary);

      expect(I18n.t('toolNames.bulletedList')).toBe('箇条書きリスト');
      expect(I18n.t('toolNames.numberedList')).toBe('番号付きリスト');
      expect(I18n.t('toolNames.todoList')).toBe('ToDoリスト');
    });
  });
});
