import type { Highlighter, Token, TokenStream } from '../engine';

// Converted from Prism 1.30.0 components/prism-graphql.js. Keep regex literals byte-identical.
export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  languages.graphql = {
    'comment': /#.*/,
    'description': {
      pattern: /(?:"""(?:[^"]|(?!""")")*"""|"(?:\\.|[^\\"\r\n])*")(?=\s*[a-z_])/i,
      greedy: true,
      alias: 'string',
      inside: {
        'language-markdown': {
          pattern: /(^"(?:"")?)(?!\1)[\s\S]+(?=\1$)/,
          lookbehind: true,
          inside: languages.markdown
        }
      }
    },
    'string': {
      pattern: /"""(?:[^"]|(?!""")")*"""|"(?:\\.|[^\\"\r\n])*"/,
      greedy: true
    },
    'number': /(?:\B-|\b)\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
    'boolean': /\b(?:false|true)\b/,
    'variable': /\$[a-z_]\w*/i,
    'directive': {
      pattern: /@[a-z_]\w*/i,
      alias: 'function'
    },
    'attr-name': {
      pattern: /\b[a-z_]\w*(?=\s*(?:\((?:[^()"]|"(?:\\.|[^\\"\r\n])*")*\))?:)/i,
      greedy: true
    },
    'atom-input': {
      pattern: /\b[A-Z]\w*Input\b/,
      alias: 'class-name'
    },
    'scalar': /\b(?:Boolean|Float|ID|Int|String)\b/,
    'constant': /\b[A-Z][A-Z_\d]*\b/,
    'class-name': {
      pattern: /(\b(?:enum|implements|interface|on|scalar|type|union)\s+|&\s*|:\s*|\[)[A-Z_]\w*/,
      lookbehind: true
    },
    'fragment': {
      pattern: /(\bfragment\s+|\.{3}\s*(?!on\b))[a-zA-Z_]\w*/,
      lookbehind: true,
      alias: 'function'
    },
    'definition-mutation': {
      pattern: /(\bmutation\s+)[a-zA-Z_]\w*/,
      lookbehind: true,
      alias: 'function'
    },
    'definition-query': {
      pattern: /(\bquery\s+)[a-zA-Z_]\w*/,
      lookbehind: true,
      alias: 'function'
    },
    'keyword': /\b(?:directive|enum|extend|fragment|implements|input|interface|mutation|on|query|repeatable|scalar|schema|subscription|type|union)\b/,
    'operator': /[!=|&]|\.{3}/,
    'property-query': /\w+(?=\s*\()/,
    'object': /\w+(?=\s*\{)/,
    'punctuation': /[!(){}\[\]:=,]/,
    'property': /\w+/
  };
  
  hl.hooks.add('after-tokenize', function afterTokenizeGraphql(env) {
    if (env.language !== 'graphql') {
      return;
    }
  
    /**
     * get the graphql token stream that we want to customize
     */
    const validTokens = env.tokens.filter(function (token): token is Token {
      return typeof token !== 'string' && token.type !== 'comment' && token.type !== 'scalar';
    });
  
    // eslint-disable-next-line no-restricted-syntax -- the walk's cursor, moved by the helpers below
    let currentIndex = 0;
  
    /**
     * Returns whether the token relative to the current index has the given type.
     */
    const getToken = (offset: number): Token | undefined => validTokens[currentIndex + offset];
  
    /**
     * Returns whether the token relative to the current index has the given type.
     */
    const isTokenType = (types: readonly string[], offset = 0): boolean => {
      // eslint-disable-next-line no-restricted-syntax -- loop counter
      for (let i = 0; i < types.length; i++) {
        const token = getToken(i + offset);

        if (!token || token.type !== types[i]) {
          return false;
        }
      }

      return true;
    };
  
    /**
     * Returns the index of the closing bracket to an opening bracket.
     *
     * It is assumed that `token[currentIndex - 1]` is an opening bracket.
     *
     * If no closing bracket could be found, `-1` will be returned.
     */
    const findClosingBracket = (open: RegExp, close: RegExp): number => {
      // eslint-disable-next-line no-restricted-syntax -- bracket depth
      let stackHeight = 1;
  
      // eslint-disable-next-line no-restricted-syntax -- loop counter
      for (let i = currentIndex; i < validTokens.length; i++) {
        const token = validTokens[i];
        const content = token.content;
  
        if (token.type !== 'punctuation' || typeof content !== 'string') {
          continue;
        }

        if (open.test(content)) {
          stackHeight++;
          continue;
        }

        if (!close.test(content)) {
          continue;
        }

        stackHeight--;

        if (stackHeight === 0) {
          return i;
        }
      }
  
      return -1;
    };
  
    /**
     * Adds an alias to the given token.
     */
    const addAlias = (token: Token, alias: string): void => {
      if (Array.isArray(token.alias)) {
        token.alias.push(alias);

        return;
      }

      // eslint-disable-next-line no-param-reassign -- Prism adds aliases to the token in place
      token.alias = token.alias ? [token.alias, alias] : [alias];
    };

    /** Aliases the input variables before `definitionEnd` and records their names. */
    const collectInputVariables = (definitionEnd: number, inputVariables: Array<string | TokenStream>): void => {
      for (; currentIndex < definitionEnd; currentIndex++) {
        const t = getToken(0);

        if (t?.type === 'variable') {
          addAlias(t, 'variable-input');
          inputVariables.push(t.content);
        }
      }
    };

    /** Gives references to input variables a special alias. */
    const markInputReferences = (inputVariables: Array<string | TokenStream>): void => {
      const mutationEnd = findClosingBracket(/^\{$/, /^\}$/);

      if (mutationEnd === -1) {
        return;
      }

      // eslint-disable-next-line no-restricted-syntax -- loop counter
      for (let i = currentIndex; i < mutationEnd; i++) {
        const varToken = validTokens[i];

        if (varToken.type === 'variable' && inputVariables.indexOf(varToken.content) >= 0) {
          addAlias(varToken, 'variable-input');
        }
      }
    };

    /** Prism's loop body for a `mutation` keyword; each `return` is Prism's `continue`. */
    const markMutation = (): void => {
      // any array of the names of all input variables (if any)
      const inputVariables: Array<string | TokenStream> = [];

      if (isTokenType(['definition-mutation', 'punctuation']) && getToken(1)?.content === '(') {
        // definition

        currentIndex += 2; // skip 'definition-mutation' and 'punctuation'

        const definitionEnd = findClosingBracket(/^\($/, /^\)$/);

        if (definitionEnd === -1) {
          return;
        }

        // find all input variables
        collectInputVariables(definitionEnd, inputVariables);

        currentIndex = definitionEnd + 1;
      }

      if (isTokenType(['punctuation', 'property-query']) && getToken(0)?.content === '{') {
        currentIndex++; // skip opening bracket

        addAlias(validTokens[currentIndex], 'property-mutation');

        if (inputVariables.length > 0) {
          markInputReferences(inputVariables);
        }
      }
    };
  
    for (; currentIndex < validTokens.length;) {
      const startToken = validTokens[currentIndex++];
  
      // add special aliases for mutation tokens
      if (startToken.type === 'keyword' && startToken.content === 'mutation') {
        markMutation();
      }
    }
  });
};
