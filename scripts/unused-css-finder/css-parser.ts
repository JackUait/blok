/**
 * CSS Parser - Extracts selectors and class names from CSS content
 */

export interface Selector {
  type: 'class' | 'attribute' | 'element';
  value: string;
  raw: string;
}

export interface ParsedCSS {
  filePath: string;
  classes: string[];
  attributes: string[];
  elements: string[];
}

/**
 * Collect all matches from a regex against a string
 */
const allMatches = (regex: RegExp, text: string): RegExpExecArray[] => {
  const results: RegExpExecArray[] = [];
  for (;;) {
    const m = regex.exec(text);
    if (!m) break;
    results.push(m);
  }
  return results;
};

/**
 * Remove CSS comments from content
 */
const stripComments = (css: string): string => {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
};

/**
 * Remove @import directives from CSS
 */
const stripImports = (css: string): string => {
  return css.replace(/@import\s+[^;]+;/g, '');
};

/**
 * Preprocess CSS: remove comments and imports
 */
const preprocessCSS = (css: string): string => {
  return stripImports(stripComments(css));
};

/**
 * Check if a class match has valid surrounding characters
 */
const isValidClassContext = (processed: string, matchStart: number, matchEnd: number): boolean => {
  const charBefore = matchStart > 0 ? processed[matchStart - 1] : '';
  const charAfter = matchEnd < processed.length ? processed[matchEnd] : '';

  const validBefore = charBefore === '' ||
                     /\s/.test(charBefore) ||
                     '[>+~:,{'.includes(charBefore) ||
                     /[a-zA-Z]/.test(charBefore);

  const validAfter = charAfter === '' ||
                    /\s/.test(charAfter) ||
                    '[>+~:,{.'.includes(charAfter) ||
                    charAfter === '[';

  return validBefore && validAfter;
};

/**
 * Extract all class names from CSS content
 */
export const extractClassNames = (css: string): string[] => {
  const processed = preprocessCSS(css);
  const classNames = new Set<string>();

  const classRegex = /\.([a-zA-Z0-9_-]+)/g;
  const matches = allMatches(classRegex, processed);

  for (const match of matches) {
    const className = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    if (isValidClassContext(processed, matchStart, matchEnd)) {
      classNames.add(className);
    }
  }

  return Array.from(classNames);
};

/**
 * Extract attribute selectors (e.g., [data-blok-selected="true"])
 * Only extracts custom data-* attributes, not standard HTML attributes like role or contenteditable
 * Standard HTML attributes are always valid and don't need usage checking
 * Also excludes Tailwind arbitrary values like [18px]
 */
const extractAttributeSelectors = (css: string): Selector[] => {
  const processed = preprocessCSS(css);

  const attrRegex = /\[(data-[a-zA-Z0-9_-]+)(?:[~|^$*]?=["'][^"']*["'])?\]/g;
  return allMatches(attrRegex, processed).map(match => ({
    type: 'attribute' as const,
    value: match[1],
    raw: match[0],
  }));
};

/**
 * Extract element name from a cleaned selector part
 */
const extractElementFromPart = (part: string, elements: Set<string>): void => {
  const elementName = part.trim();
  if (/^[a-z][a-z0-9-]*$/i.test(elementName)) {
    elements.add(elementName);
  }
};

/**
 * Extract element selectors (e.g., div, span, button)
 */
const extractElementSelectors = (css: string): Selector[] => {
  const processed = preprocessCSS(css);
  const elements = new Set<string>();

  const lines = processed.split('{')[0].split('}').join('').split(',');

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[.@[\]:]/.test(trimmed)) {
      continue;
    }

    const withoutPseudo = trimmed.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
    const withoutAttrs = withoutPseudo.replace(/\[[^\]]+\]/g, '');
    const withoutClasses = withoutAttrs.replace(/[.#][a-zA-Z0-9_-]+/g, '');
    const parts = withoutClasses.split(/[>+~\s]+/).filter(p => p.length > 0);

    for (const part of parts) {
      extractElementFromPart(part, elements);
    }
  }

  return Array.from(elements).map(element => ({ type: 'element' as const, value: element, raw: element }));
};

/**
 * Extract all selectors from CSS content
 */
export const extractSelectors = (css: string): Selector[] => {
  const selectors: Selector[] = [];

  const classNames = extractClassNames(css);
  for (const className of classNames) {
    selectors.push({ type: 'class', value: className, raw: `.${className}` });
  }

  selectors.push(...extractAttributeSelectors(css));
  selectors.push(...extractElementSelectors(css));

  return selectors;
};

/**
 * Parse CSS content and return structured data
 */
export const parseCSS = (css: string, filePath: string): ParsedCSS => {
  const selectors = extractSelectors(css);

  return {
    filePath,
    classes: selectors.filter(s => s.type === 'class').map(s => s.value),
    attributes: selectors.filter(s => s.type === 'attribute').map(s => s.value),
    elements: selectors.filter(s => s.type === 'element').map(s => s.value),
  };
};
