import { parseUntrustedDocument } from '../../utils/inert-html';

/**
 * Excel puts cell formatting in `<style>` class rules (`.xl65 {font-weight:700;}`)
 * and only a `class` on the cell or `<font>` run. The sanitizer drops both the
 * style block and the class, so the formatting is lost. This pass copies the
 * rules onto the elements before that happens.
 *
 * Must run on the raw clipboard string: parsing into a `<div>` drops `<head>`,
 * where Excel puts the `<style>`.
 */

const STYLE_PROPS = new Set(['color', 'background', 'background-color', 'text-align', 'vertical-align']);
const MARK_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line']);

// No url() (would load), no expression(), no quotes or escapes.
const UNSAFE_VALUE = /url\s*\(|expression|javascript|[\\<>"'{}]/i;
// Office color keywords meaning "default text": not a real color.
const DEFAULT_COLOR = /^(windowtext|auto|inherit)$/i;

// Inline runs between these are wrapped one by one. Table parts are never
// wrapped: a <b> around a row is hoisted out of the table when re-parsed.
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'CAPTION', 'COLGROUP', 'COL', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
]);

type Declarations = Map<string, string>;

const parseDeclarations = (body: string): Declarations => {
  const result: Declarations = new Map();

  for (const part of body.split(';')) {
    const colon = part.indexOf(':');

    if (colon === -1) {
      continue;
    }

    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!important/i, '').trim();
    const known = STYLE_PROPS.has(prop) || MARK_PROPS.has(prop);
    const isDefaultColor = prop === 'color' && DEFAULT_COLOR.test(value);

    if (known && value !== '' && !UNSAFE_VALUE.test(value) && !isDefaultColor) {
      result.set(prop, value);
    }
  }

  return result;
};

// Hand scans, not regexes: a regex for these goes quadratic on a long
// <style> with no closing brace or comment end, and freezes the tab.

/** Drops CSS comments. An unclosed one, and everything after it, stays. */
const stripComments = (text: string): string => {
  const parts: string[] = [];
  const cursor = { at: 0, done: false };

  while (!cursor.done) {
    const open = text.indexOf('/*', cursor.at);
    const close = open === -1 ? -1 : text.indexOf('*/', open + 2);

    if (close === -1) {
      parts.push(text.slice(cursor.at));
      cursor.done = true;
    } else {
      parts.push(text.slice(cursor.at, open), ' ');
      cursor.at = close + 2;
    }
  }

  return parts.join('');
};

/**
 * Every `selector { body }` with no brace inside. A selector starts after the
 * last brace of either kind, so in `@media x { .a { … } }` the rule is `.a`.
 */
const splitRules = (text: string): Array<[string, string]> => {
  const rules: Array<[string, string]> = [];
  const state = { selectorStart: 0, open: -1 };

  for (const { index, 0: brace } of text.matchAll(/[{}]/g)) {
    if (brace === '}' && state.open !== -1) {
      rules.push([text.slice(state.selectorStart, state.open), text.slice(state.open + 1, index)]);
    }

    if (brace === '{') {
      state.selectorStart = state.open === -1 ? state.selectorStart : state.open + 1;
      state.open = index;
    } else {
      state.selectorStart = index + 1;
      state.open = -1;
    }
  }

  return rules;
};

/** Rules whose whole selector is one class, e.g. `.xl65`. Everything else is skipped. */
const readClassRules = (styleText: string): Map<string, Declarations> => {
  const rules = new Map<string, Declarations>();
  const text = stripComments(styleText.replace(/<!--|-->/g, ' '));

  for (const [selector, body] of splitRules(text)) {
    const className = /^\s*\.([A-Za-z_][\w-]*)\s*$/.exec(selector)?.[1];

    if (className === undefined) {
      continue;
    }

    const declarations = parseDeclarations(body);

    if (declarations.size > 0) {
      rules.set(className, new Map([...(rules.get(className) ?? []), ...declarations]));
    }
  }

  return rules;
};

const wrapRun = (nodes: Node[], tags: string[]): void => {
  const first = nodes[0];
  const isBlank = nodes.every(node => node.nodeType !== Node.ELEMENT_NODE && (node.textContent ?? '').trim() === '');

  if (first === undefined || isBlank || first.parentNode === null) {
    return;
  }

  const doc = first.ownerDocument ?? document;
  const outer = doc.createElement(tags[0]);
  const inner = tags.slice(1).reduce((parent, tag) => parent.appendChild(doc.createElement(tag)), outer);

  first.parentNode.insertBefore(outer, first);
  nodes.forEach(node => inner.appendChild(node));
};

const wrapInlineRuns = (element: Element, tags: string[]): void => {
  const runs: Node[][] = [[]];

  for (const node of Array.from(element.childNodes)) {
    const isElement = node instanceof Element;

    if (isElement && BLOCK_TAGS.has(node.tagName)) {
      runs.push([]);
      wrapInlineRuns(node, tags);
    } else if (isElement && node.tagName === 'BR') {
      runs.push([]);
    } else {
      runs[runs.length - 1].push(node);
    }
  }

  runs.forEach(run => wrapRun(run, tags));
};

/**
 * Wrap an element's text in `<b>`/`<i>`/`<u>`/`<s>` for the bold, italic,
 * underline and strike in `declarations`. Cell-level marks never reach cell
 * content otherwise: the cell parsers only read marks inside the cell.
 * Each line and each block child is wrapped on its own, because cell content
 * is later split on `<br>` and `<p>`.
 */
export function wrapCellTextMarks(element: Element, declarations: string): void {
  // Per declaration, not one regex over the string: `[^;]*underline` over a
  // raw style attribute goes quadratic.
  const values = (props: string[]): string[] => declarations.split(';').flatMap(part => {
    const colon = part.indexOf(':');

    return colon !== -1 && props.includes(part.slice(0, colon).trim().toLowerCase())
      ? [part.slice(colon + 1).trim().toLowerCase()]
      : [];
  });
  const decorations = values(['text-decoration', 'text-decoration-line']);
  const tags = [
    values(['font-weight']).some(value => /^(bold|bolder|[6-9]00)\b/.test(value)) ? 'b' : '',
    values(['font-style']).some(value => /^(italic|oblique)\b/.test(value)) ? 'i' : '',
    decorations.some(value => value.includes('underline')) ? 'u' : '',
    decorations.some(value => value.includes('line-through')) ? 's' : '',
  ].filter(Boolean);

  if (tags.length > 0) {
    wrapInlineRuns(element, tags);
  }
}

const hasInline = (element: HTMLElement, prop: string): boolean => {
  if (prop === 'background' || prop === 'background-color') {
    return /(?<![a-z-])background(?:-color)?\s*:/i.test(element.getAttribute('style') ?? '');
  }

  const group = prop.startsWith('text-decoration') ? 'text-decoration' : prop;

  return new RegExp(`(?<![a-z-])${group}(?:-line)?\\s*:`, 'i').test(element.getAttribute('style') ?? '');
};

/**
 * Copy simple `.class {…}` rules from the clipboard's `<style>` onto the
 * elements that use them. Colors, fill and alignment go into the inline
 * style (an existing inline value wins); bold, italic, underline and strike
 * become tags around the text. The `<style>` block is removed.
 * @param html - raw clipboard HTML string
 * @returns the rewritten HTML, or the input when no rule applies
 */
export function preprocessExcelClassStyles(html: string): string {
  if (!/<style[\s>]/i.test(html) || !/class\s*=/i.test(html)) {
    return html;
  }

  const doc = parseUntrustedDocument(html);
  const styles = Array.from(doc.querySelectorAll('style'));
  const rules = readClassRules(styles.map(style => style.textContent ?? '').join('\n'));

  if (rules.size === 0) {
    return html;
  }

  const changed = Array.from(doc.body.querySelectorAll<HTMLElement>('[class]')).filter(element => {
    const merged: Declarations = new Map(Array.from(element.classList).flatMap(name => [...(rules.get(name) ?? [])]));
    const own = [...merged].filter(([prop]) => !hasInline(element, prop));
    const marks = own.filter(([prop]) => MARK_PROPS.has(prop)).map(([prop, value]) => `${prop}:${value}`).join(';');

    own.filter(([prop]) => STYLE_PROPS.has(prop)).forEach(([prop, value]) => element.style.setProperty(prop, value));
    wrapCellTextMarks(element, marks);

    return own.length > 0;
  });

  if (changed.length === 0) {
    return html;
  }

  styles.forEach(style => style.remove());

  return doc.documentElement.outerHTML;
}
