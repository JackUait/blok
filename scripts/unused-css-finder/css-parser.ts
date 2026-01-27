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
 * Remove CSS comments from content
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Remove @import directives from CSS
 */
function stripImports(css: string): string {
  return css.replace(/@import\s+[^;]+;/g, '');
}

/**
 * Preprocess CSS: remove comments and imports
 */
function preprocessCSS(css: string): string {
  let processed = css;
  processed = stripComments(processed);
  processed = stripImports(processed);
  return processed;
}

/**
 * Extract all class names from CSS content
 */
export function extractClassNames(css: string): string[] {
  const processed = preprocessCSS(css);
  const classNames = new Set<string>();

  // Find all occurrences of .className
  // We use a simple regex to find . followed by class chars
  // Then validate the context
  let index = 0;
  const classRegex = /\.([a-zA-Z0-9_-]+)/g;

  while (index < processed.length) {
    const match = classRegex.exec(processed);
    if (!match) break;

    const fullMatch = match[0];
    const className = match[1];
    const matchStart = match.index;
    const matchEnd = match.index + fullMatch.length;

    // Check if this is really a class selector (not in a string, comment, etc.)
    // It should be preceded by: start, whitespace, combinator ([>+~]), or element name
    // It should be followed by: end, whitespace, combinator ([>+~]), pseudo-class (:), comma, or brace ({)
    const charBefore = matchStart > 0 ? processed[matchStart - 1] : '';
    const charAfter = matchEnd < processed.length ? processed[matchEnd] : '';

    const validBefore = charBefore === '' ||
                       /\s/.test(charBefore) ||
                       '[>+~:,{'.includes(charBefore) ||
                       /[a-zA-Z]/.test(charBefore); // element selector before class

    const validAfter = charAfter === '' ||
                      /\s/.test(charAfter) ||
                      '[>+~:,{.'.includes(charAfter) ||
                      charAfter === '['; // another class or attribute after

    if (validBefore && validAfter) {
      classNames.add(className);
    }

    // Continue searching from after the dot to catch chained classes like .a.b
    index = matchStart + 1;
    classRegex.lastIndex = index;
  }

  return Array.from(classNames);
}

/**
 * Extract attribute selectors (e.g., [data-blok-selected="true"])
 * Only extracts custom data-* attributes, not standard HTML attributes like role or contenteditable
 * Standard HTML attributes are always valid and don't need usage checking
 * Also excludes Tailwind arbitrary values like [18px]
 */
function extractAttributeSelectors(css: string): Selector[] {
  const processed = preprocessCSS(css);
  const selectors: Selector[] = [];

  // Match only [data-*] attribute selectors
  // Exclude standard HTML attributes (role, contenteditable, etc.) and Tailwind arbitrary values
  const attrRegex = /\[(data-[a-zA-Z0-9_-]+)(?:[~|^$*]?=["'][^"']*["'])?\]/g;
  let match;

  while ((match = attrRegex.exec(processed)) !== null) {
    selectors.push({
      type: 'attribute',
      value: match[1],
      raw: match[0],
    });
  }

  return selectors;
}

/**
 * Extract element selectors (e.g., div, span, button)
 */
function extractElementSelectors(css: string): Selector[] {
  const processed = preprocessCSS(css);
  const selectors: Selector[] = [];
  const elements = new Set<string>();

  // Match element names that are not part of other selectors
  // This looks for words at the start of a selector or after combinators
  // that are not classes or IDs
  const lines = processed.split('{')[0].split('}').join('').split(',');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip if starts with ., @, [, or :
    if (/^[\.@\[:]/.test(trimmed)) {
      continue;
    }

    // Extract potential element names
    // Remove pseudo-classes and pseudo-elements
    const withoutPseudo = trimmed.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
    // Remove attribute selectors
    const withoutAttrs = withoutPseudo.replace(/\[[^\]]+\]/g, '');
    // Remove class and ID selectors
    const withoutClasses = withoutAttrs.replace(/[.#][a-zA-Z0-9_-]+/g, '');
    // Remove combinators and keep the element name
    const parts = withoutClasses.split(/[>+~\s]+/).filter(p => p.length > 0);

    for (const part of parts) {
      const elementName = part.trim();
      // Check if it's a valid HTML element name (starts with letter, contains letters, numbers, hyphen)
      if (/^[a-z][a-z0-9-]*$/i.test(elementName)) {
        elements.add(elementName);
      }
    }
  }

  for (const element of elements) {
    selectors.push({ type: 'element', value: element, raw: element });
  }

  return selectors;
}

/**
 * Extract all selectors from CSS content
 */
export function extractSelectors(css: string): Selector[] {
  const selectors: Selector[] = [];

  // Extract class selectors
  const classNames = extractClassNames(css);
  for (const className of classNames) {
    selectors.push({ type: 'class', value: className, raw: `.${className}` });
  }

  // Add attribute selectors
  selectors.push(...extractAttributeSelectors(css));

  // Add element selectors
  selectors.push(...extractElementSelectors(css));

  return selectors;
}

/**
 * Parse CSS content and return structured data
 */
export function parseCSS(css: string, filePath: string): ParsedCSS {
  const selectors = extractSelectors(css);

  return {
    filePath,
    classes: selectors.filter(s => s.type === 'class').map(s => s.value),
    attributes: selectors.filter(s => s.type === 'attribute').map(s => s.value),
    elements: selectors.filter(s => s.type === 'element').map(s => s.value),
  };
}
