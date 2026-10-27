/**
 * Blok's `tokenizePrism` must give the HTML Prism 1.30.0 gives when its
 * grammars are loaded in Blok's order: markup, css, clike, javascript first,
 * then what the language requires and loads optionally.
 *
 * Cases from Prism's own tests are pinned by a SHA-256 of the HTML (their token
 * streams are pinned in full by upstream-languages.test.ts). Blok's snippets
 * and the repo samples keep the full HTML.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

interface GoldenCase {
  lang: string;
  source: string;
  code?: string;
  html?: string;
  sha256?: string;
}

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/prism-upstream');
const cases = JSON.parse(readFileSync(resolve(FIXTURES, 'golden-html.json'), 'utf8')) as GoldenCase[];

const codeOf = (item: GoldenCase): string => {
  if (item.code !== undefined) {
    return item.code;
  }

  const file = item.source.replace(/^upstream:/, '');

  return readFileSync(resolve(FIXTURES, 'languages', file), 'utf8')
    .replace(/\r\n?/g, '\n')
    .split(/^-{10,}[ \t]*$/m, 3)[0]
    .trim();
};

describe('golden HTML from Prism 1.30.0', () => {
  it('has cases for every highlightable language', () => {
    expect(new Set(cases.map((item) => item.lang)).size).toBeGreaterThanOrEqual(28);
  });

  it.each(cases.map((item) => [`${item.lang} ← ${item.source}`, item] as const))('%s', async (_name, item) => {
    vi.resetModules();
    const { tokenizePrism } = await import('../../../../../src/tools/code/prism-loader');

    const html = await tokenizePrism(codeOf(item), item.lang);

    if (item.html !== undefined) {
      expect(html).toBe(item.html);
    } else {
      expect(createHash('sha256').update(html ?? '').digest('hex')).toBe(item.sha256);
    }
  });
});
