import { createHighlighter } from './highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from './highlight/grammar-loader';
import { HIGHLIGHTABLE_LANGUAGES } from './constants';

/** Blok language id → grammar name. Several Blok ids share one grammar on purpose. */
const LANG_MAP: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  sql: 'sql',
  html: 'markup',
  // Prism's own `xml` is a copy of markup taken before css/js patch it; Blok has always used markup.
  xml: 'markup',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  markdown: 'markdown',
  bash: 'bash',
  shell: 'bash',
  dockerfile: 'docker',
  graphql: 'graphql',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  latex: 'latex',
  mermaid: 'mermaid',
};

const createState = (): { hl: ReturnType<typeof createHighlighter>; load: (id: string) => Promise<void> } => {
  const hl = createHighlighter();

  return { hl, load: createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: true }) };
};

// eslint-disable-next-line no-restricted-syntax -- module singleton, replaced by resetPrismState
let state = createState();

/** Returns true if this language should be syntax-highlighted */
export function isHighlightable(lang: string): boolean {
  return HIGHLIGHTABLE_LANGUAGES.has(lang);
}

/**
 * Tokenize code for the given language.
 * Returns an HTML string with <span class="token ..."> elements, or null
 * if the language is not highlightable or grammar loading fails.
 */
export async function tokenizePrism(code: string, lang: string): Promise<string | null> {
  if (!isHighlightable(lang)) return null;

  const grammarName = Object.prototype.hasOwnProperty.call(LANG_MAP, lang) ? LANG_MAP[lang] : undefined;

  if (!grammarName) return null;

  const { hl, load } = state;

  try {
    await load(grammarName);
  } catch (e) {
    console.warn(`[blok] Failed to load Prism grammar for "${lang}":`, e);

    return null;
  }

  const grammar = hl.languages[grammarName];

  if (!grammar) return null;

  try {
    return hl.highlight(code, grammar, grammarName);
  } catch (e) {
    console.warn(`[blok] Prism highlight error for "${lang}":`, e);

    return null;
  }
}

/** For testing: start over with no grammars loaded */
export function resetPrismState(): void {
  state = createState();
}
