import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { I18n } from '../../../../src/components/modules/i18n';
import { EventsDispatcher } from '../../../../src/components/utils/events';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');
const read = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf-8')) as Record<string, string>;
const english = read('en');
const localeCodes = readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));

/** A plural group is the base of every English key ending in `_other`. */
const pluralBases = Object.keys(english).filter((key) => key.endsWith('_other')).map((key) => key.slice(0, -'_other'.length));

const createI18n = (): I18n => new I18n({ config: {}, eventsDispatcher: new EventsDispatcher() });

describe('plural forms', () => {
  it('picks the English singular for 1 and the plural otherwise', async () => {
    const i18n = createI18n();

    await i18n.prepare();

    expect(i18n.t('tools.database.templateRepeatEveryWeek', { count: 1 })).toBe('Every 1 week');
    expect(i18n.t('tools.database.templateRepeatEveryWeek', { count: 2 })).toBe('Every 2 weeks');
    expect(i18n.t('tools.database.templateRepeatEveryDay', { count: 3 })).toBe('Every 3 days');
  });

  it('picks the plural form a host override gives', async () => {
    const i18n = createI18n();

    await i18n.prepare();
    i18n.setDictionary({ 'custom.apples_one': '{count} apple', 'custom.apples_other': '{count} apples' });

    expect(i18n.t('custom.apples', { count: 1 })).toBe('1 apple');
    expect(i18n.t('custom.apples', { count: 7 })).toBe('7 apples');
  });

  it('picks the Russian few and many forms', async () => {
    const i18n = createI18n();

    await i18n.prepare();
    await i18n.setLocale('ru');

    const forms = [1, 2, 5, 21].map((count) => i18n.t('tools.database.templateRepeatEveryWeek', { count }));

    expect(new Set(forms).size).toBeGreaterThanOrEqual(3);
    forms.forEach((form, index) => expect(form).toContain(String([1, 2, 5, 21][index])));
  });

  it('has at least one plural group', () => {
    expect(pluralBases.length).toBeGreaterThan(0);
    pluralBases.forEach((base) => expect(english[`${base}_one`], base).toBeDefined());
  });

  /*
   * i18next falls back to ENGLISH when a locale lacks the form its plural
   * rules pick, so a missing "few" shows English text in Russian.
   */
  it.each(localeCodes)('%s has every plural form its language uses', (code) => {
    const messages = read(code);
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

    for (const base of pluralBases) {
      for (const category of categories) {
        expect(messages[`${base}_${category}`], `${code} ${base}_${category}`).toBeDefined();
      }
    }
  });

  /*
   * The UI puts a number field where {count} sits. It finds that spot as the
   * first run of the number's digits, so no other digit may appear.
   */
  it.each(localeCodes)('%s plural forms hold {count} once and no other digit', (code) => {
    const messages = read(code);

    for (const [key, value] of Object.entries(messages)) {
      if (!pluralBases.some((base) => key.startsWith(`${base}_`))) continue;

      expect(value.split('{count}').length - 1, `${code} ${key}`).toBe(1);
      expect(/\d/.test(value.replace('{count}', '')), `${code} ${key}`).toBe(false);
    }
  });
});
