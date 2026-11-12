import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const ENGLISH: Record<string, string> = {
  'tools.image.emptyHint': 'Drag a picture here, choose one from your device, or paste a link.',
  'tools.video.emptyHint': 'Drag a video here, choose one from your device, or paste a link.',
  'tools.audio.emptyHint': 'Drag an audio file here, choose one from your device, or paste a link.',
  'tools.file.emptyHint': 'Drag any file here, choose one from your device, or paste a link.',
  'tools.image.emptyHintUpload': 'Drag a picture here or choose one from your device.',
  'tools.video.emptyHintUpload': 'Drag a video here or choose one from your device.',
  'tools.audio.emptyHintUpload': 'Drag an audio file here or choose one from your device.',
  'tools.file.emptyHintUpload': 'Drag any file here or choose one from your device.',
  'tools.image.emptyHintLink': 'Paste a link to it below.',
  'tools.image.emptyDropAnywhere': 'Let go anywhere in this block.',
  'tools.audio.coverHint': 'Drag an image here, choose one, or paste a link.',
};
const KEYS = Object.keys(ENGLISH);

const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, string>;

const LOCALES = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace('.json', ''));

describe('one-surface media empty state strings', () => {
  it('English reads as written in the design', () => {
    const en = load('en');

    expect(Object.fromEntries(KEYS.map((key) => [key, en[key]]))).toEqual(ENGLISH);
  });

  it('every locale has every sentence, in its own words', () => {
    const problems = LOCALES.filter((locale) => locale !== 'en').flatMap((locale) => {
      const messages = load(locale);

      return KEYS
        .filter((key) => !messages[key]?.trim() || messages[key] === ENGLISH[key])
        .map((key) => `${locale}:${key}`);
    });

    expect(problems).toEqual([]);
  });

  it('gives each block its own sentence', () => {
    const clashes = LOCALES.flatMap((locale) => {
      const messages = load(locale);
      const hints = ['image', 'video', 'audio', 'file'].map((tool) => messages[`tools.${tool}.emptyHint`]);

      return new Set(hints).size === hints.length ? [] : [locale];
    });

    expect(clashes).toEqual([]);
  });
});
