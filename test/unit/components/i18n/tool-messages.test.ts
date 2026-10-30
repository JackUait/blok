import { describe, expect, it } from 'vitest';

import { I18n } from '../../../../src/components/modules/i18n';
import type { BlokConfig } from '../../../../types';
import { EventsDispatcher } from '../../../../src/components/utils/events';

/** Keys that are not in en.json, so only the declaration can supply them. */
const DECLARED = {
  'probe.declared': 'Declared text',
  'probe.items_one': '{count} item',
  'probe.items_other': '{count} items',
};

class MessagesTool {
  public static get 'blok.toolMessages'(): Record<string, string> {
    return DECLARED;
  }
}

class Child extends MessagesTool {}

class Parent {
  public static companionTools = { child: Child };
}

const prepared = async (config: Partial<BlokConfig>): Promise<I18n> => {
  const i18n = new I18n({ config: config, eventsDispatcher: new EventsDispatcher() });

  await i18n.prepare();

  return i18n;
};

describe('tool-declared English messages', () => {
  it('resolve in English for a configured tool, its subclasses and its companions', async () => {
    for (const tools of [{ a: MessagesTool }, { a: { class: Child } }, { a: Parent }]) {
      const i18n = await prepared({ i18n: { locale: 'en' }, tools } as unknown as Partial<BlokConfig>);

      expect(i18n.t('probe.declared')).toBe('Declared text');
      expect(i18n.t('probe.items', { count: 2 })).toBe('2 items');
      expect(i18n.has('probe.declared')).toBe(true);
      expect(i18n.getEnglishTranslation('probe.declared')).toBe('Declared text');
    }
  });

  it('lose to host overrides', async () => {
    const i18n = await prepared({
      i18n: { locale: 'en', messages: { 'probe.declared': 'Host text' } },
      tools: { a: MessagesTool },
    } as unknown as Partial<BlokConfig>);

    expect(i18n.t('probe.declared')).toBe('Host text');
  });

  it('are the English fallback in a non-English session', async () => {
    const i18n = await prepared({ i18n: { locale: 'fr' }, tools: { a: MessagesTool } } as unknown as Partial<BlokConfig>);

    expect(i18n.getLocale()).toBe('fr');
    expect(i18n.t('probe.declared')).toBe('Declared text');
    expect(i18n.has('probe.declared')).toBe(true);
  });

  it('stay with the editor whose tools declared them', async () => {
    await prepared({ i18n: { locale: 'en' }, tools: { a: MessagesTool } } as unknown as Partial<BlokConfig>);
    await prepared({ i18n: { locale: 'fr' }, tools: { a: MessagesTool } } as unknown as Partial<BlokConfig>);

    for (const locale of ['en', 'fr']) {
      const other = await prepared({ i18n: { locale }, tools: {} });

      expect(other.t('probe.declared')).toBe('probe.declared');
      expect(other.has('probe.declared')).toBe(false);
      expect(other.getEnglishTranslation('probe.declared')).toBe('');
    }
  });
});
