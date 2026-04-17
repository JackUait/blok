import Prism from 'prismjs';
import { HIGHLIGHTABLE_LANGUAGES } from './constants';

/** Register a custom Prism grammar for Mermaid diagram syntax.
 *
 * Token types and their semantic meaning:
 *   directive     — %%{init: {...}}%% front-matter directives
 *   comment       — %% single-line comments
 *   diagram-name  — diagram type keyword: graph, flowchart, sequenceDiagram, …  (cyan)
 *   keyword       — direction (TD/LR/…) and structural words (subgraph, end, …)  (normal keyword color)
 *   variable      — node IDs: A, B, myNode  (yellow/amber)
 *   node-bracket  — node shape delimiters: [ ] { } ( )  (cyan, same as diagram-name)
 *   string        — node label content and quoted strings  (white)
 *   edge-label    — text inside |…| edge labels  (green)
 *   edge-delimiter— the | pipes surrounding edge labels  (cyan)
 *   operator      — arrows: -->, -.->, ==>, --o, --x, …  (white/muted)
 *
 * Token ordering follows Prism's greedy-first, specific-before-general rule.
 * The grammar covers flowchart/graph, sequence, class, ER, state, and git diagrams.
 */
function registerMermaidGrammar(): void {
  if (Prism.languages['mermaid']) return;

  Prism.languages['mermaid'] = {
    // %%{init: {...}}%% directives — MUST precede comment (both start with %%)
    'directive': {
      pattern: /%%\{[\s\S]*?\}%%/,
      greedy: true,
    },

    // %% single-line comments
    'comment': {
      pattern: /%%[^\n]*/,
      greedy: true,
    },

    // Edge labels: -->|Yes| or ---|text|
    // Match the full |text| portion; split into delimiter + content via inside
    'edge-label': {
      // Matches |...| that follow an arrow character or stand alone in link context
      pattern: /\|[^|\n]*\|/,
      greedy: true,
      inside: {
        'edge-delimiter': /^\||\|$/,
        'edge-label': /[^|]+/,
      },
    },

    // Node definitions: NodeID[Label text] or NodeID{Label} or NodeID((Label))
    // Capture the bracket + content + closing bracket as a unit; split inside
    'node-definition': {
      // Opening bracket types: [ [[ [( ( (( { (( )) ]] ]) )
      pattern: /(?:\(\[|\[\[|\[\(|\[|\(+|>|\{|\(\()(?:[^\[\]{}()\n])*(?:\]\)|\]\]|\)\]|\]|\)+|\}|\)\))/,
      greedy: true,
      inside: {
        'node-bracket': /^\(?[\[{(>]|[\]})]\)?$/,
        'string': /[^\[\]{}()\n]+/,
      },
    },

    // Diagram type keywords — first token on a line, colored cyan
    'diagram-name': /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|gitGraph|pie(?:\s+title)?|mindmap|timeline|quadrantChart|requirementDiagram|xychart-beta|C4Context|C4Container|C4Component)\b/m,

    // Structural / direction keywords
    'keyword': /\b(?:TD|TB|LR|RL|BT|subgraph|end|direction|participant|actor|as|activate|deactivate|loop|alt|else|opt|par|and|rect|critical|note|over|title|section|classDef|class|linkStyle|style|click|left of|right of)\b/,

    // Arrows and edge connectors (order: longer patterns first)
    // Covers: --> --- -.-> -.- ==> === --o --x <-- o-- x-- ~~~
    'operator': /[xo<]?(?:={2,}|(?:-\.{1,3}|-{2,5}))(?:[xo>]?>{0,2})|~{3}/,

    // Node IDs — word identifier not part of a keyword
    // Uses lookbehind to avoid matching mid-word; must come after keywords
    'variable': /\b(?!(?:TD|TB|LR|RL|BT|end|subgraph|direction|participant|actor|as|activate|deactivate|loop|alt|else|opt|par|and|rect|critical|note|over|title|section|classDef|class|linkStyle|style|click)\b)[-\w]+\b/,
  };
}

// Map Blok language IDs to Prism grammar names and callable importers
// `prereqs` lists grammar keys that must be loaded before this grammar runs.
const LANG_MAP: Record<string, { grammar: string; prereqs?: string[]; importer: () => Promise<unknown> }> = {
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
  // php requires markup and markup-templating to be loaded first
  php:         { grammar: 'php',         prereqs: ['markup', 'markup-templating'], importer: () => import('prismjs/components/prism-php') },
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
  // Mermaid has no official Prism grammar — register a custom one synchronously
  mermaid:     { grammar: 'mermaid',     importer: () => Promise.resolve(registerMermaidGrammar()) },
};

// Prerequisites that aren't user-facing languages but must be loadable by grammar key
const PREREQ_IMPORTERS: Record<string, () => Promise<unknown>> = {
  'markup':              () => import('prismjs/components/prism-markup'),
  'markup-templating':   () => import('prismjs/components/prism-markup-templating'),
};

// Tracks which language grammars have been loaded
const loadedLanguages = new Set<string>();

/** Returns true if this language should be syntax-highlighted */
export function isHighlightable(lang: string): boolean {
  return HIGHLIGHTABLE_LANGUAGES.has(lang);
}

/** Load a prerequisite grammar by key (not a user-facing language ID) */
async function ensurePrereq(grammarKey: string): Promise<void> {
  if (loadedLanguages.has(grammarKey)) return;
  const importer = PREREQ_IMPORTERS[grammarKey];
  if (!importer) return;
  try {
    await importer();
    loadedLanguages.add(grammarKey);
  } catch (e) {
    console.warn(`[blok] Failed to load Prism prerequisite grammar "${grammarKey}":`, e);
  }
}

/** Load the Prism grammar for a language if not yet loaded */
async function ensureLanguage(lang: string): Promise<boolean> {
  const entry = LANG_MAP[lang];
  if (!entry) return false;

  const key = entry.grammar;
  if (loadedLanguages.has(key)) return true;

  // Load prerequisites first, in order
  if (entry.prereqs) {
    for (const prereq of entry.prereqs) {
      await ensurePrereq(prereq);
    }
  }

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

