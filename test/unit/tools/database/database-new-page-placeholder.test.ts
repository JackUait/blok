/**
 * An untitled row or card reads "New page", as Notion's does (findings-listgallery L06).
 * Each locale reuses its own word for "New page".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../../../../src/components/i18n/locales');
const locales = readdirSync(dir).filter((file) => file.endsWith('.json'));
const read = (file: string): Record<string, string> => JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as Record<string, string>;

describe('untitled row and card placeholder', () => {
  it('reads "New page" in English', () => {
    const en = read('en.json');

    expect(en['tools.database.rowTitlePlaceholder']).toBe('New page');
    expect(en['tools.database.cardTitlePlaceholder']).toBe('New page');
  });

  it.each(locales)('%s uses its own "New page"', (file) => {
    const messages = read(file);

    expect(messages['tools.database.rowTitlePlaceholder']).toBe(messages['tools.database.newPage']);
    expect(messages['tools.database.cardTitlePlaceholder']).toBe(messages['tools.database.newPage']);
  });
});
