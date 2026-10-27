import type { Highlighter } from '../engine';

// Converted from Prism 1.30.0 components/prism-r.js. Keep regex literals byte-identical.
export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  languages.r = {
    'comment': /#.*/,
    'string': {
      pattern: /(['"])(?:\\.|(?!\1)[^\\\r\n])*\1/,
      greedy: true
    },
    'percent-operator': {
      // Includes user-defined operators
      // and %%, %*%, %/%, %in%, %o%, %x%
      pattern: /%[^%\s]*%/,
      alias: 'operator'
    },
    'boolean': /\b(?:FALSE|TRUE)\b/,
    'ellipsis': /\.\.(?:\.|\d+)/,
    'number': [
      /\b(?:Inf|NaN)\b/,
      /(?:\b0x[\dA-Fa-f]+(?:\.\d*)?|\b\d+(?:\.\d*)?|\B\.\d+)(?:[EePp][+-]?\d+)?[iL]?/
    ],
    'keyword': /\b(?:NA|NA_character_|NA_complex_|NA_integer_|NA_real_|NULL|break|else|for|function|if|in|next|repeat|while)\b/,
    'operator': /->?>?|<(?:=|<?-)?|[>=!]=?|::?|&&?|\|\|?|[+*\/^$@~]/,
    'punctuation': /[(){}\[\],;]/
  };
};
