import type { Highlighter } from '../engine';

/** Blok's own grammar for Mermaid diagram syntax; Prism has none.
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
export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  languages['mermaid'] = {
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
};
