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
