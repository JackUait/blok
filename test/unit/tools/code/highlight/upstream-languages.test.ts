/**
 * Runs Prism 1.30.0's own language test cases against Blok's highlighter.
 * The harness copies Prism's `tests/helper/test-case.js`:
 * - the code is normalized to CRLF before tokenizing;
 * - token streams are simplified, dropping whitespace-only strings;
 * - `.html.test` files compare highlighted HTML after the same whitespace
 *   normalization.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHighlighter, type TokenStream } from '../../../../../src/tools/code/highlight/engine';
import { createGrammarLoader, GRAMMARS } from '../../../../../src/tools/code/highlight/grammar-loader';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/prism-upstream/languages');

type Simple = string | [string, string | Simple[]];

const simplify = (stream: TokenStream): Simple[] => stream
  .map((item): Simple => {
    if (typeof item === 'string') {
      return item;
    }

    return [item.type, typeof item.content === 'string' ? item.content : simplify(item.content)];
  })
  .filter((item) => !(typeof item === 'string' && item.trim() === ''));

const parseCase = (content: string): { code: string; expected: string } => {
  const parts = content.replace(/\r\n?|\n/g, '\r\n').split(/^-{10,}[ \t]*$/m, 3);

  return { code: (parts[0] ?? '').trim(), expected: (parts[1] ?? '').trim() };
};

/** `a!+b` → main `a`; `a+b` → main `b`. */
const parseLanguages = (directory: string): { languages: string[]; main: string } => {
  const languages = directory.split('+').map((name) => name.replace('!', ''));
  const marked = directory.split('+').find((name) => name.endsWith('!'));

  return { languages, main: marked ? marked.replace('!', '') : languages[languages.length - 1] };
};

const normalizeHtml = (html: string): string => html
  .replace(/</g, '\n<')
  .replace(/>/g, '>\n')
  .replace(/[ \t]*[\r\n]\s*/g, '\n')
  .trim();

const tableOrder = Object.keys(GRAMMARS);

const highlighterFor = async (languages: string[]): Promise<ReturnType<typeof createHighlighter>> => {
  const hl = createHighlighter();
  const load = createGrammarLoader(hl, { base: [], optional: false });
  const ordered = [...languages].sort((a, b) => tableOrder.indexOf(a) - tableOrder.indexOf(b));

  for (const language of ordered) {
    await load(language);
  }

  return hl;
};

const directories = readdirSync(ROOT).sort();

describe('Prism upstream language tests', () => {
  it('finds the copied test cases', () => {
    expect(directories.length).toBeGreaterThan(30);
  });

  describe.each(directories)('%s', (directory) => {
    const { languages, main } = parseLanguages(directory);
    const files = readdirSync(resolve(ROOT, directory)).filter((file) => file.endsWith('.test')).sort();

    it.each(files)('%s', async (file) => {
      const { code, expected } = parseCase(readFileSync(resolve(ROOT, directory, file), 'utf8'));
      const hl = await highlighterFor(languages);
      const grammar = hl.languages[main];

      expect(grammar, `grammar ${main}`).toBeDefined();

      if (file.endsWith('.html.test')) {
        expect(normalizeHtml(hl.highlight(code, grammar, main))).toBe(normalizeHtml(expected));

        return;
      }

      const actual = simplify(hl.tokenizeWithHooks(code, grammar, main));

      expect(JSON.stringify(actual)).toBe(JSON.stringify(JSON.parse(expected)));
    });
  });
});
