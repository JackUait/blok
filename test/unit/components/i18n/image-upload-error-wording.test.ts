import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, string>;

describe('image upload error wording', () => {
  it('says the server upload failed, not just "upload failed"', () => {
    expect(load('en')['tools.image.errorUploadFailed']).toBe('Couldn’t upload to the server');
    expect(load('ru')['tools.image.errorUploadFailed']).toBe('Не удалось загрузить на сервер');
  });
});
