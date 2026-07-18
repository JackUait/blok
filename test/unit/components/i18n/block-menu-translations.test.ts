import { describe, expect, it } from 'vitest';

import { I18n } from '../../../../src/components/modules/i18n';
import { translateToolTitle } from '../../../../src/components/utils/tools';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokConfig, ToolboxConfigEntry } from '../../../../types';

/**
 * Regression tests for block menu showing untranslated or raw tool-name
 * strings. Reproduces two user-reported screenshots:
 *   1. Popover item labelled "image" (lowercase, internal tool name)
 *   2. Popover item labelled "Heading 1" in English while the search
 *      placeholder is rendered in Russian.
 *
 * Both rely on `translateToolTitle` resolving the entry's `titleKey` via
 * the live `I18n` module. If either fails to resolve, the menu falls back
 * to the raw tool name / English title even though the locale is Russian.
 */

const createI18nModule = (config: Partial<BlokConfig> = {}): I18n => {
  return new I18n({
    config: config as BlokConfig,
    eventsDispatcher: new EventsDispatcher(),
  });
};

describe('Block menu tool titles on non-English locale', () => {
  it('resolves toolNames.image for Russian locale (image entry)', async () => {
    const i18n = createI18nModule();

    await i18n.prepare();
    await i18n.setLocale('ru');

    // Directly: the key must be resolvable on the active locale.
    expect(i18n.has('toolNames.image')).toBe(true);
    expect(i18n.t('toolNames.image')).toBe('Изображение');

    // Through translateToolTitle using the exact shape image tool produces.
    const imageEntry: ToolboxConfigEntry = {
      icon: '<svg/>',
      titleKey: 'image',
    };

    // Fallback 'image' mimics blockSettings.ts path (raw tool.name).
    expect(translateToolTitle(i18n, imageEntry, 'image')).toBe('Изображение');
  });

  it('resolves tools.header.heading1 for Russian locale (header entry)', async () => {
    const i18n = createI18nModule();

    await i18n.prepare();
    await i18n.setLocale('ru');

    expect(i18n.has('tools.header.heading1')).toBe(true);
    expect(i18n.t('tools.header.heading1')).toBe('Заголовок 1');

    const headerEntry: ToolboxConfigEntry = {
      icon: '<svg/>',
      title: 'Heading 1',
      titleKey: 'tools.header.heading1',
    };

    expect(translateToolTitle(i18n, headerEntry, 'header')).toBe('Заголовок 1');
  });

  it('localizes a custom tool title via toolNames.<toolName> when the tool has no titleKey', async () => {
    // A consumer registers a custom tool (e.g. `fileLink`) whose toolbox entry
    // only sets a raw English title. Localization must be possible by the tool
    // name — `toolNames.fileLink` — instead of the brittle raw-title key
    // ('toolNames.File Link', where spaces/casing must match exactly).
    const i18n = createI18nModule({
      i18n: {
        messages: {
          'toolNames.fileLink': 'Ссылка на файл',
        },
      },
    });

    await i18n.prepare();

    const customEntry: ToolboxConfigEntry = {
      icon: '<svg/>',
      title: 'File Link',
    };

    // Fallback mimics toolbox.ts path: raw tool.name from the Blok config.
    expect(translateToolTitle(i18n, customEntry, 'fileLink')).toBe('Ссылка на файл');
  });

  it('keeps returning the raw title when neither raw-title key nor tool-name key is translated', async () => {
    const i18n = createI18nModule();

    await i18n.prepare();

    const customEntry: ToolboxConfigEntry = {
      icon: '<svg/>',
      title: 'File Link',
    };

    expect(translateToolTitle(i18n, customEntry, 'fileLink')).toBe('File Link');
  });

  it('capitalizes the raw tool name when no translation and no title exist (toolbox display fallback)', async () => {
    // The toolbox previously passed capitalize(tool.name) as the fallback,
    // which broke toolNames.<toolName> lookups (key became 'toolNames.FileLink').
    // Call sites now pass the raw tool name; translateToolTitle capitalizes
    // only when the name is displayed verbatim.
    const i18n = createI18nModule();

    await i18n.prepare();

    const entryWithoutTitle: ToolboxConfigEntry = { icon: '<svg/>' };

    expect(translateToolTitle(i18n, entryWithoutTitle, 'fileLink')).toBe('FileLink');
  });

  it('resolves toolNames.<CapitalizedToolName> when the raw-name key is missing (pre-1.2.3 contract)', async () => {
    // Before the raw-name lookup landed, consumers localized custom tools via
    // the capitalized tool name (toolNames.TestTool). That published contract
    // must keep resolving alongside the raw-name key.
    const i18n = createI18nModule({
      i18n: {
        messages: {
          'toolNames.TestTool': 'ТестТул',
        },
      },
    });

    await i18n.prepare();

    const entryWithEmptyTitle: ToolboxConfigEntry = { icon: '<svg/>', title: '' };

    expect(translateToolTitle(i18n, entryWithEmptyTitle, 'testTool')).toBe('ТестТул');
  });

  it('falls back to the capitalized tool name when the title is an empty string', async () => {
    const i18n = createI18nModule();

    await i18n.prepare();

    const entryWithEmptyTitle: ToolboxConfigEntry = { icon: '<svg/>', title: '' };

    expect(translateToolTitle(i18n, entryWithEmptyTitle, 'testTool')).toBe('TestTool');
  });

  it('resolves translations when user provides partial messages override on English locale', async () => {
    // User stays on English locale but supplies partial custom messages,
    // e.g. only the search placeholder is Russified. Base English dict still
    // provides the tool-name translations, so menu entries must render in
    // English (not the raw tool name).
    const i18n = createI18nModule({
      i18n: {
        messages: {
          'popover.search': 'Поиск',
        },
      },
    });

    await i18n.prepare();

    expect(i18n.t('popover.search')).toBe('Поиск');

    const imageEntry: ToolboxConfigEntry = {
      icon: '<svg/>',
      titleKey: 'image',
    };

    expect(translateToolTitle(i18n, imageEntry, 'image')).toBe('Image');
  });
});
