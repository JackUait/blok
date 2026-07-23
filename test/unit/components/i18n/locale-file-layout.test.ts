import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'fs';
import { extname, resolve } from 'path';

import { ALL_LOCALE_CODES } from '../../../../src/components/i18n/locales';

const REPO_ROOT = resolve(__dirname, '../../../..');
const LOCALES_DIR = resolve(REPO_ROOT, 'src/components/i18n/locales');

describe('locale file layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names each flat locale file after its locale code', () => {
    const localeFiles = readdirSync(LOCALES_DIR)
      .filter(name => extname(name) === '.json')
      .sort();
    const expectedFiles = ALL_LOCALE_CODES.map(code => `${code}.json`).sort();

    expect(localeFiles).toEqual(expectedFiles);

    const localeDirectories = readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    expect(localeDirectories).toEqual([]);
  });
});
