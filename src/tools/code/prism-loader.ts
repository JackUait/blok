import Prism from 'prismjs';
import { HIGHLIGHTABLE_LANGUAGES } from './constants';

// Map Blok language IDs to Prism grammar names and dynamic import paths
const LANG_MAP: Record<string, { grammar: string; importPath: string }> = {
  javascript:  { grammar: 'javascript',  importPath: 'prismjs/components/prism-javascript' },
  typescript:  { grammar: 'typescript',  importPath: 'prismjs/components/prism-typescript' },
  python:      { grammar: 'python',      importPath: 'prismjs/components/prism-python' },
  java:        { grammar: 'java',        importPath: 'prismjs/components/prism-java' },
  c:           { grammar: 'c',           importPath: 'prismjs/components/prism-c' },
  cpp:         { grammar: 'cpp',         importPath: 'prismjs/components/prism-cpp' },
  csharp:      { grammar: 'csharp',      importPath: 'prismjs/components/prism-csharp' },
  go:          { grammar: 'go',          importPath: 'prismjs/components/prism-go' },
  rust:        { grammar: 'rust',        importPath: 'prismjs/components/prism-rust' },
  ruby:        { grammar: 'ruby',        importPath: 'prismjs/components/prism-ruby' },
  php:         { grammar: 'php',         importPath: 'prismjs/components/prism-php' },
  swift:       { grammar: 'swift',       importPath: 'prismjs/components/prism-swift' },
  kotlin:      { grammar: 'kotlin',      importPath: 'prismjs/components/prism-kotlin' },
  sql:         { grammar: 'sql',         importPath: 'prismjs/components/prism-sql' },
  html:        { grammar: 'markup',      importPath: 'prismjs/components/prism-markup' },
  css:         { grammar: 'css',         importPath: 'prismjs/components/prism-css' },
  json:        { grammar: 'json',        importPath: 'prismjs/components/prism-json' },
  yaml:        { grammar: 'yaml',        importPath: 'prismjs/components/prism-yaml' },
  markdown:    { grammar: 'markdown',    importPath: 'prismjs/components/prism-markdown' },
  bash:        { grammar: 'bash',        importPath: 'prismjs/components/prism-bash' },
  shell:       { grammar: 'bash',        importPath: 'prismjs/components/prism-bash' },
  dockerfile:  { grammar: 'docker',      importPath: 'prismjs/components/prism-docker' },
  xml:         { grammar: 'markup',      importPath: 'prismjs/components/prism-markup' },
  graphql:     { grammar: 'graphql',     importPath: 'prismjs/components/prism-graphql' },
  r:           { grammar: 'r',           importPath: 'prismjs/components/prism-r' },
  scala:       { grammar: 'scala',       importPath: 'prismjs/components/prism-scala' },
  dart:        { grammar: 'dart',        importPath: 'prismjs/components/prism-dart' },
  lua:         { grammar: 'lua',         importPath: 'prismjs/components/prism-lua' },
  latex:       { grammar: 'latex',       importPath: 'prismjs/components/prism-latex' },
};

// Tracks which language grammars have been loaded
const loadedLanguages = new Set<string>();

/** Returns true if this language should be syntax-highlighted */
export function isHighlightable(lang: string): boolean {
  return HIGHLIGHTABLE_LANGUAGES.has(lang);
}

/** Load the Prism grammar for a language if not yet loaded */
async function ensureLanguage(lang: string): Promise<boolean> {
  const entry = LANG_MAP[lang];
  if (!entry) return false;

  const key = entry.importPath;
  if (loadedLanguages.has(key)) return true;

  try {
    await import(/* @vite-ignore */ entry.importPath);
    loadedLanguages.add(key);
    return true;
  } catch (e) {
    console.warn(`[blok] Failed to load Prism grammar for "${lang}":`, e);
    return false;
  }
}

/**
 * Tokenize code with Prism for the given language.
 * Returns an HTML string with <span class="token ..."> elements, or null
 * if the language is not highlightable or grammar loading fails.
 */
export async function tokenizePrism(code: string, lang: string): Promise<string | null> {
  if (!isHighlightable(lang)) return null;

  const entry = LANG_MAP[lang];
  if (!entry) return null;

  const loaded = await ensureLanguage(lang);
  if (!loaded) return null;

  const grammar = Prism.languages[entry.grammar];
  if (!grammar) return null;

  try {
    return Prism.highlight(code, grammar, entry.grammar);
  } catch (e) {
    console.warn(`[blok] Prism highlight error for "${lang}":`, e);
    return null;
  }
}

/** For testing: reset loaded language cache */
export function resetPrismState(): void {
  loadedLanguages.clear();
}
