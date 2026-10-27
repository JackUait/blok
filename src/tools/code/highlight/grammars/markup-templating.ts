import { Token, type Highlighter, type TokenizeEnv, type TokenStream } from '../engine';

// Converted from Prism 1.30.0 components/prism-markup-templating.js. Keep regex literals byte-identical.

/**
 * Returns the placeholder for the given language id and index.
 */
const getPlaceholder = (language: string, index: string | number): string =>
  '___' + language.toUpperCase() + index + '___';

/**
 * Prism defines these two as hidden methods on `languages['markup-templating']`.
 * They are plain functions here; php calls them from its hooks.
 */

/**
 * Tokenize all inline templating expressions matching `placeholderPattern`.
 *
 * If `replaceFilter` is provided, only matches of `placeholderPattern` for which `replaceFilter` returns
 * `true` will be replaced.
 *
 * @param env The environment of the `before-tokenize` hook.
 * @param language The language id.
 * @param placeholderPattern The matches of this pattern will be replaced by placeholders.
 */
export const buildPlaceholders = (
  hl: Highlighter,
  env: TokenizeEnv,
  language: string,
  placeholderPattern: RegExp,
  replaceFilter?: (match: string) => boolean
): void => {
  if (env.language !== language) {
    return;
  }

  const tokenStack: string[] = [];

  // eslint-disable-next-line no-param-reassign -- hooks edit env
  env.tokenStack = tokenStack;

  // eslint-disable-next-line no-param-reassign -- hooks edit env
  env.code = env.code.replace(placeholderPattern, (match: string) => {
    if (typeof replaceFilter === 'function' && !replaceFilter(match)) {
      return match;
    }
    // eslint-disable-next-line no-restricted-syntax -- counts up to a free placeholder
    let i = tokenStack.length;

    // Check for existing strings
    while (env.code.indexOf(getPlaceholder(language, i)) !== -1) {
      ++i;
    }

    // Create a sparse array
    tokenStack[i] = match;

    return getPlaceholder(language, i);
  });

  // Switch the grammar to markup
  // eslint-disable-next-line no-param-reassign -- hooks edit env
  env.grammar = hl.languages.markup;
};

/**
 * Replace placeholders with proper tokens after tokenizing.
 *
 * @param env The environment of the `after-tokenize` hook.
 * @param language The language id.
 */
export const tokenizePlaceholders = (hl: Highlighter, env: TokenizeEnv, language: string): void => {
  const tokenStack = env.tokenStack;

  if (env.language !== language || !tokenStack) {
    return;
  }

  // Switch the grammar back
  const grammar = hl.languages[language];

  // eslint-disable-next-line no-param-reassign -- hooks edit env
  env.grammar = grammar;

  // eslint-disable-next-line no-restricted-syntax -- index of the next placeholder to restore
  let j = 0;
  const keys = Object.keys(tokenStack);

  /** Swaps the placeholder in `s` (the text of `tokens[i]`) for its tokens, if it is there. */
  const replaceAt = (tokens: TokenStream, i: number, token: string | Token, s: string): void => {
    const k = keys[j];
    const t = tokenStack[Number(k)];
    const placeholder = getPlaceholder(language, k);

    const index = s.indexOf(placeholder);

    if (index <= -1) {
      return;
    }
    ++j;

    const before = s.substring(0, index);
    const middle = new Token(language, hl.tokenize(t, grammar), 'language-' + language, t);
    const after = s.substring(index + placeholder.length);

    const replacement: TokenStream = [];

    if (before) {
      replacement.push(...walkTokens([before]));
    }
    replacement.push(middle);
    if (after) {
      replacement.push(...walkTokens([after]));
    }

    if (typeof token === 'string') {
      tokens.splice(i, 1, ...replacement);
    } else {
      // eslint-disable-next-line no-param-reassign -- the token keeps its place, only its content changes
      token.content = replacement;
    }
  };

  const walkTokens = (tokens: TokenStream): TokenStream => {
    // eslint-disable-next-line no-restricted-syntax -- loop counter; replaceAt may splice tokens
    for (let i = 0; i < tokens.length; i++) {
      // all placeholders are replaced already
      if (j >= keys.length) {
        break;
      }

      const token = tokens[i];
      const s = typeof token === 'string' ? token : token.content;

      // Prism: `typeof token === 'string' || (token.content && typeof token.content === 'string')`
      if (typeof s === 'string' && (typeof token === 'string' || s !== '')) {
        replaceAt(tokens, i, token, s);
      } else if (typeof s !== 'string') {
        walkTokens(s);
      }
    }

    return tokens;
  };

  walkTokens(env.tokens);
};

export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  languages['markup-templating'] = {};
};
