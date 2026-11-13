import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

// The typed-speed help line. Audio and video share the wording; each reads its own namespace.
const SENTENCES: Record<string, string> = {
  speedEntryRange: '{min} to {max} · Enter to set',
  speedEntryTooHigh: 'Up to {max}',
  speedEntryTooLow: 'At least {min}',
  speedEntryNotNumber: 'Type a number, like {example}',
};
const ENGLISH = Object.fromEntries(
  ['audio', 'video'].flatMap((tool) => Object.entries(SENTENCES).map(([key, text]) => [`tools.${tool}.${key}`, text]))
);
const KEYS = Object.keys(ENGLISH);
const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, string>;

const LOCALES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace('.json', ''));

describe('typed-speed help line strings', () => {
  it('English reads as in the lab', () => {
    const en = load('en');

    expect(Object.fromEntries(KEYS.map((key) => [key, en[key]]))).toEqual(ENGLISH);
  });

  it('every locale has every sentence, in its own words, with the same placeholders', () => {
    const problems = LOCALES.filter((locale) => locale !== 'en').flatMap((locale) => {
      const messages = load(locale);

      return KEYS
        .filter((key) => !messages[key]?.trim()
          || messages[key] === ENGLISH[key]
          || placeholders(messages[key]).join() !== placeholders(ENGLISH[key]).join())
        .map((key) => `${locale}:${key}`);
    });

    expect(problems).toEqual([]);
  });

  it('says the same thing in audio and video', () => {
    const drift = LOCALES.flatMap((locale) => {
      const messages = load(locale);

      return Object.keys(SENTENCES)
        .filter((key) => messages[`tools.audio.${key}`] !== messages[`tools.video.${key}`])
        .map((key) => `${locale}:${key}`);
    });

    expect(drift).toEqual([]);
  });
});
