import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const VIDEO_KEYS = [
  'toolNames.video',
  'tools.video.alignment',
  'tools.video.alignmentLeft',
  'tools.video.alignmentCenter',
  'tools.video.alignmentRight',
  'tools.video.caption',
  'tools.video.toggleCaption',
  'tools.video.autoplay',
  'tools.video.loop',
  'tools.video.replace',
  'tools.video.download',
  'tools.video.copyUrl',
  'tools.video.moreOptions',
  'tools.video.uploading',
  'tools.video.errorUploadFailed',
  'tools.video.errorReplace',
  'tools.video.emptyAddVideo',
  'tools.video.emptyUpload',
  'tools.video.emptyLink',
  'tools.video.emptyInsert',
  'tools.video.emptyChooseFile',
  'tools.video.emptyOrDropHere',
  'tools.video.emptyDropToUpload',
  'tools.video.emptyMaxSize',
  'tools.video.emptyUrlPlaceholder',
  'tools.video.emptyUrlAria',
  'tools.video.emptySourceAria',
] as const;

function getLocaleDirs(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((f) => {
      try {
        return statSync(join(LOCALES_DIR, f)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function loadMessages(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8')) as Record<string, string>;
}

describe('Video tool translations', () => {
  const locales = getLocaleDirs();

  describe('all locales contain Video keys', () => {
    for (const locale of locales) {
      test(`${locale} has all Video translation keys`, () => {
        const messages = loadMessages(locale);
        const missing = VIDEO_KEYS.filter((key) => !(key in messages));
        expect(missing, `${locale}: missing Video keys:\n  ${missing.join('\n  ')}`).toHaveLength(0);
      });
    }
  });

  describe('Video keys have non-empty values and preserve {size}', () => {
    for (const locale of locales) {
      test(`${locale} has non-empty Video values`, () => {
        const messages = loadMessages(locale);
        const empty = VIDEO_KEYS.filter((key) => key in messages && messages[key].trim() === '');
        expect(empty, `${locale}: empty Video values:\n  ${empty.join('\n  ')}`).toHaveLength(0);
        expect(messages['tools.video.emptyMaxSize'], `${locale}: emptyMaxSize must keep {size}`).toContain('{size}');
      });
    }
  });
});
