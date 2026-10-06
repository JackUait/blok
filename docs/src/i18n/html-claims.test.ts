import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

// Saved text fields hold inline HTML (paragraph save() returns innerHTML), so
// copy may say the document is typed JSON, never that it holds no HTML at all.
const ABSOLUTE_NO_HTML = {
  en: /never HTML|no HTML|nothing here is HTML/i,
  ru: /не HTML|нет HTML|ни HTML|никакого HTML|без разбора HTML/i,
};

const strings = (node: unknown, path = ''): [string, string][] => {
  if (typeof node === 'string') {
    return [[path, node]];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => strings(value, path ? `${path}.${key}` : key));
  }

  return [];
};

describe('no absolute "no HTML" claims in the catalog', () => {
  for (const [locale, catalog] of [['en', en], ['ru', ru]] as const) {
    it(`${locale}.json never says the content holds no HTML`, () => {
      const hits = strings(catalog)
        .filter(([, value]) => ABSOLUTE_NO_HTML[locale].test(value))
        .map(([path, value]) => `${path}: ${value}`);

      expect(hits).toEqual([]);
    });
  }
});

describe('web app manifest description', () => {
  it('does not say the content holds no HTML', () => {
    const manifest: { description: string } = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/site.webmanifest'), 'utf8')
    );

    expect(manifest.description).not.toMatch(ABSOLUTE_NO_HTML.en);
  });
});
