import { DARK_MODE_SELECTOR } from './constants';

export interface HighlightToken {
  content: string;
  color: string;
  /** Character offset from the start of the LINE (not document) */
  offset: number;
}

export interface ThemeTokens {
  tokens: HighlightToken[][];
  fg: string;
}

export interface DualThemeTokens {
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** Typed subset of Highlight (Set-like, as per the CSS Custom Highlight API spec) */
interface HighlightSet extends Highlight {
  add(range: Range): void;
  delete(range: Range): boolean;
  size: number;
}

/** Typed subset of the CSS Custom Highlight API HighlightRegistry (Map-like) */
interface HighlightMap {
  get(name: string): HighlightSet | undefined;
  set(name: string, highlight: HighlightSet): void;
  delete(name: string): void;
  keys(): IterableIterator<string>;
  size: number;
}

/** CSS global augmented with the highlights registry (feature-detected at runtime) */
interface CSSWithHighlights {
  highlights: HighlightMap;
}

const state = {
  stylesheet: null as CSSStyleSheet | null,
  knownRules: new Set<string>(),
};

export function isHighlightingSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS;
}

function getHighlights(): HighlightMap {
  return (CSS as unknown as CSSWithHighlights).highlights;
}

function ensureStylesheet(): CSSStyleSheet {
  if (!state.stylesheet) {
    state.stylesheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, state.stylesheet];
  }
  return state.stylesheet;
}

function colorToId(hex: string): string {
  const clean = hex.replace('#', '').toLowerCase();
  return clean.length > 6 ? clean.substring(0, 6) : clean;
}

function ensureRule(stylesheet: CSSStyleSheet, name: string, color: string, scope?: string): void {
  const key = `${scope ?? ''}::${name}`;
  if (state.knownRules.has(key)) return;

  const rule = scope
    ? `${scope} ::highlight(${name}) { color: ${color}; }`
    : `::highlight(${name}) { color: ${color}; }`;

  stylesheet.insertRule(rule, stylesheet.cssRules.length);
  state.knownRules.add(key);
}

function findTextNode(
  element: HTMLElement,
  targetOffset: number
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  const find = (node: Node | null, accumulated: number): { node: Node; offset: number } | null => {
    if (!node) {
      if (targetOffset === accumulated && element.lastChild) {
        return { node: element.lastChild, offset: element.lastChild.textContent?.length ?? 0 };
      }
      return null;
    }
    const len = node.textContent?.length ?? 0;
    if (accumulated + len > targetOffset) {
      return { node, offset: targetOffset - accumulated };
    }
    return find(walker.nextNode(), accumulated + len);
  };

  return find(walker.nextNode(), 0);
}

function buildLineOffsets(text: string): number[] {
  return text.split('\n').reduce<{ offsets: number[]; pos: number }>(
    (acc, line) => ({
      offsets: [...acc.offsets, acc.pos],
      pos: acc.pos + line.length + 1,
    }),
    { offsets: [], pos: 0 }
  ).offsets;
}

function applyToken(
  element: HTMLElement,
  text: string,
  lineBase: number,
  token: HighlightToken,
  themeKey: string,
  scope: string | undefined,
  priority: number,
  stylesheet: CSSStyleSheet,
  ownedRanges: Array<[string, Range]>
): void {
  if (!token.content.trim()) return;

  const start = lineBase + token.offset;
  const end = start + token.content.length;
  if (end > text.length) return;

  const startPos = findTextNode(element, start);
  const endPos = findTextNode(element, end);
  if (!startPos || !endPos) return;

  try {
    const range = new Range();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    const colorId = colorToId(token.color);
    const hlName = `blok-${themeKey}-${colorId}`;
    const highlights = getHighlights();

    ensureRule(stylesheet, hlName, token.color, scope);

    const existing = highlights.get(hlName);
    const highlight = existing ?? (new Highlight() as unknown as HighlightSet);
    if (!existing) {
      highlight.priority = priority;
      highlights.set(hlName, highlight);
    }

    highlight.add(range);
    ownedRanges.push([hlName, range]);
  } catch {
    // Skip invalid ranges
  }
}

function applyThemeTokens(
  element: HTMLElement,
  text: string,
  lineOffsets: number[],
  themeData: ThemeTokens,
  themeKey: string,
  scope: string | undefined,
  priority: number,
  stylesheet: CSSStyleSheet,
  ownedRanges: Array<[string, Range]>
): void {
  for (const [lineIdx, lineTokens] of themeData.tokens.entries()) {
    const lineBase = lineOffsets[lineIdx];
    if (lineBase === undefined) continue;

    for (const token of lineTokens) {
      applyToken(element, text, lineBase, token, themeKey, scope, priority, stylesheet, ownedRanges);
    }
  }
}

export function applyHighlights(element: HTMLElement, themes: DualThemeTokens): () => void {
  if (!isHighlightingSupported()) return () => {};

  const stylesheet = ensureStylesheet();
  const ownedRanges: Array<[string, Range]> = [];
  const text = element.textContent ?? '';
  const lineOffsets = buildLineOffsets(text);

  const themeEntries: Array<[string, ThemeTokens, string | undefined, number]> = [
    ['l', themes.light, undefined, 0],
    ['d', themes.dark, DARK_MODE_SELECTOR, 1],
  ];

  for (const [themeKey, themeData, scope, priority] of themeEntries) {
    applyThemeTokens(element, text, lineOffsets, themeData, themeKey, scope, priority, stylesheet, ownedRanges);
  }

  return () => cleanupRanges(ownedRanges, getHighlights());
}

function cleanupRanges(ownedRanges: Array<[string, Range]>, highlights: HighlightMap): void {
  for (const [name, range] of ownedRanges) {
    const hl = highlights.get(name);
    if (!hl) continue;
    hl.delete(range);
    if (hl.size === 0) {
      highlights.delete(name);
    }
  }
}

function removeBlokHighlights(highlights: HighlightMap): void {
  const blokNames = [...highlights.keys()].filter((name) => name.startsWith('blok-'));
  for (const name of blokNames) {
    highlights.delete(name);
  }
}

export function disposeAllHighlights(): void {
  if (isHighlightingSupported()) {
    removeBlokHighlights(getHighlights());
  }

  if (state.stylesheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (s) => s !== state.stylesheet
    );
    state.stylesheet = null;
    state.knownRules.clear();
  }
}
