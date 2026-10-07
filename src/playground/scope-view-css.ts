/**
 * Scopes a stylesheet under one selector, for the playground's copies of
 * view.css (the Blok View panel and the history preview). The live editor
 * stamps the same attributes view.css styles, so an unscoped copy would
 * restyle the editor too.
 */

/** At-rules whose body is more rules; everything inside gets scoped. */
const GROUPING_AT_RULES = new Set(['layer', 'media', 'supports', 'container']);

/** `:root`, `:host` or `html` as the start of a selector, ending its first compound. */
const ROOT_START = /^(?::root|:host|html)(?![\w-])/;

/**
 * Walks `text` from `from`, skipping backslash escapes and quoted strings, and
 * hands every other character to `visit`. Stops at the first
 * index `visit` returns true for; -1 when it never does.
 */
const scan = (text: string, from: number, visit: (char: string) => boolean): number => {
  const cursor = { index: from, quote: '' };

  while (cursor.index < text.length) {
    const char = text[cursor.index];

    if (char === '\\') {
      cursor.index += 2;
      continue;
    }

    if (cursor.quote !== '') {
      cursor.quote = char === cursor.quote ? '' : cursor.quote;
    } else if (char === '"' || char === "'") {
      cursor.quote = char;
    } else if (visit(char)) {
      return cursor.index;
    }

    cursor.index++;
  }

  return -1;
};

/** Index of the first `stop` character outside parentheses and brackets. -1 when there is none. */
const findTopLevel = (text: string, from: number, stop: (char: string) => boolean): number => {
  const nesting = { depth: 0 };

  return scan(text, from, (char) => {
    if (char === '(' || char === '[') {
      nesting.depth++;
    } else if (char === ')' || char === ']') {
      nesting.depth--;
    } else {
      return nesting.depth === 0 && stop(char);
    }

    return false;
  });
};

/** Index of the `}` that closes the block opened just before `from`. */
const blockEnd = (text: string, from: number): number => {
  const nesting = { depth: 1 };
  const end = scan(text, from, (char) => {
    if (char === '{') {
      nesting.depth++;
    }

    return char === '}' && --nesting.depth === 0;
  });

  return end === -1 ? text.length : end;
};

const splitSelectors = (prelude: string): string[] => {
  const parts: string[] = [];
  const cursor = { start: 0, comma: findTopLevel(prelude, 0, (char) => char === ',') };

  while (cursor.comma !== -1) {
    parts.push(prelude.slice(cursor.start, cursor.comma));
    cursor.start = cursor.comma + 1;
    cursor.comma = findTopLevel(prelude, cursor.start, (char) => char === ',');
  }

  parts.push(prelude.slice(cursor.start));

  return parts.map((part) => part.trim()).filter((part) => part !== '');
};

const scopeSelector = (selector: string, scope: string): string => {
  if (!ROOT_START.test(selector)) {
    return `${scope} ${selector}`;
  }

  const end = findTopLevel(selector, 0, (char) => /[\s>+~]/.test(char));

  if (end === -1) {
    return scope;
  }

  return `${selector.slice(0, end)} ${scope} ${selector.slice(end).trim()}`;
};

const scopeRules = (css: string, scope: string): string => {
  const out: string[] = [];
  const state = { at: 0 };

  while (state.at < css.length) {
    const end = findTopLevel(css, state.at, (char) => char === '{' || char === ';' || char === '}');

    if (end === -1 || css[end] === '}') {
      out.push(css.slice(state.at));
      break;
    }

    const prelude = css.slice(state.at, end);
    const lead = prelude.match(/^\s*/)?.[0] ?? '';
    const head = prelude.trim();

    if (css[end] === ';') {
      out.push(css.slice(state.at, end + 1));
      state.at = end + 1;
      continue;
    }

    const close = blockEnd(css, end + 1);
    const body = css.slice(end + 1, close);
    const atRule = /^@([\w-]+)/.exec(head)?.[1];

    if (atRule === undefined) {
      out.push(`${lead}${splitSelectors(head).map((selector) => scopeSelector(selector, scope)).join(', ')} {${body}}`);
    } else if (GROUPING_AT_RULES.has(atRule)) {
      out.push(`${lead}${head} {${scopeRules(body, scope)}}`);
    } else {
      // @keyframes, @property, @font-face: their insides are not selectors.
      out.push(`${lead}${head} {${body}}`);
    }

    state.at = close + 1;
  }

  return out.join('');
};

/**
 * @param css - the stylesheet
 * @param scope - the selector every rule must sit under
 */
export const scopeStylesheet = (css: string, scope: string): string =>
  scopeRules(css.replace(/\/\*[\s\S]*?\*\//g, ''), scope);
