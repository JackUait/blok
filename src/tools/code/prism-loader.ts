import Prism from 'prismjs';
import { HIGHLIGHTABLE_LANGUAGES } from './constants';

// Map Blok language IDs to Prism grammar names and callable importers
const LANG_MAP: Record<string, { grammar: string; importer: () => Promise<unknown> }> = {
  javascript:  { grammar: 'javascript',  importer: () => import('prismjs/components/prism-javascript') },
  typescript:  { grammar: 'typescript',  importer: () => import('prismjs/components/prism-typescript') },
  python:      { grammar: 'python',      importer: () => import('prismjs/components/prism-python') },
  java:        { grammar: 'java',        importer: () => import('prismjs/components/prism-java') },
  c:           { grammar: 'c',           importer: () => import('prismjs/components/prism-c') },
  cpp:         { grammar: 'cpp',         importer: () => import('prismjs/components/prism-cpp') },
  csharp:      { grammar: 'csharp',      importer: () => import('prismjs/components/prism-csharp') },
  go:          { grammar: 'go',          importer: () => import('prismjs/components/prism-go') },
  rust:        { grammar: 'rust',        importer: () => import('prismjs/components/prism-rust') },
  ruby:        { grammar: 'ruby',        importer: () => import('prismjs/components/prism-ruby') },
  php:         { grammar: 'php',         importer: () => import('prismjs/components/prism-php') },
  swift:       { grammar: 'swift',       importer: () => import('prismjs/components/prism-swift') },
  kotlin:      { grammar: 'kotlin',      importer: () => import('prismjs/components/prism-kotlin') },
  sql:         { grammar: 'sql',         importer: () => import('prismjs/components/prism-sql') },
  html:        { grammar: 'markup',      importer: () => import('prismjs/components/prism-markup') },
  css:         { grammar: 'css',         importer: () => import('prismjs/components/prism-css') },
  json:        { grammar: 'json',        importer: () => import('prismjs/components/prism-json') },
  yaml:        { grammar: 'yaml',        importer: () => import('prismjs/components/prism-yaml') },
  markdown:    { grammar: 'markdown',    importer: () => import('prismjs/components/prism-markdown') },
  bash:        { grammar: 'bash',        importer: () => import('prismjs/components/prism-bash') },
  // shell shares the bash grammar intentionally
  shell:       { grammar: 'bash',        importer: () => import('prismjs/components/prism-bash') },
  dockerfile:  { grammar: 'docker',      importer: () => import('prismjs/components/prism-docker') },
  // xml shares the markup grammar intentionally
  xml:         { grammar: 'markup',      importer: () => import('prismjs/components/prism-markup') },
  graphql:     { grammar: 'graphql',     importer: () => import('prismjs/components/prism-graphql') },
  r:           { grammar: 'r',           importer: () => import('prismjs/components/prism-r') },
  scala:       { grammar: 'scala',       importer: () => import('prismjs/components/prism-scala') },
  dart:        { grammar: 'dart',        importer: () => import('prismjs/components/prism-dart') },
  lua:         { grammar: 'lua',         importer: () => import('prismjs/components/prism-lua') },
  latex:       { grammar: 'latex',       importer: () => import('prismjs/components/prism-latex') },
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

  const key = entry.grammar;
  if (loadedLanguages.has(key)) return true;

  try {
    await entry.importer();
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

/**
 * Compatibility shim: matches the tokenizeCode signature previously exported
 * by shiki-loader. Returns null since Prism uses innerHTML-based highlighting
 * (see tokenizePrism) rather than the CSS Custom Highlight API token format.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function tokenizeCode(_code: string, _lang: string): Promise<null> {
  return null;
}
