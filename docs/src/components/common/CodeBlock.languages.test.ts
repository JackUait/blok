import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from './CodeBlock';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `language="json"`, `language: 'vue'`, `language = "bash"`, `language ?? "typescript"`. */
const LANGUAGE_LITERAL = /\blanguage\s*(?:[:=]|\?\?)\s*(['"])([a-z0-9+#.-]+)\1/g;

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const languagesUsedInDocs = (): Map<string, string[]> => {
  const usage = new Map<string, string[]>();
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(LANGUAGE_LITERAL)) {
      const lang = match[2];
      usage.set(lang, [...(usage.get(lang) ?? []), path.relative(SRC_ROOT, file)]);
    }
  }
  return usage;
};

/**
 * Shiki grammars are registered by hand rather than pulled from the full
 * bundle, so this pair of assertions is what keeps that list honest: a grammar
 * nobody asks for is dead weight in the build, and a grammar somebody asks for
 * but nobody registered renders as unhighlighted plaintext with no error.
 */
describe('CodeBlock supported languages', () => {
  it('registers a grammar for every language the docs actually request', () => {
    const missing = [...languagesUsedInDocs()]
      .filter(([lang]) => !(SUPPORTED_LANGUAGES as readonly string[]).includes(lang))
      .map(([lang, files]) => `${lang} (${files.join(', ')})`);

    expect(missing).toEqual([]);
  });

  it('registers no grammar the docs never request', () => {
    const used = new Set(languagesUsedInDocs().keys());
    const unused = SUPPORTED_LANGUAGES.filter((lang) => !used.has(lang));

    expect(unused).toEqual([]);
  });
});
