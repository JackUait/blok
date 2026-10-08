export interface FormulaError {
  message: string;
  start: number;
  end: number;
}

export type TokenType = 'number' | 'string' | 'ident' | 'propRef' | 'op' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: FormulaError };

/** Longest first: the scan takes the first prefix that matches. */
const OPERATORS = ['!==', '===', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '!', '+', '-', '*', '/', '%', '^', '?', ':'];
const ALIASES: Record<string, string> = { '!==': '!=', '===': '==' };
const PUNCT = new Set(['(', ')', '[', ']', ',', '.']);
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' };

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*/u;
const PROP_REF = /^\{\{property:([^}]+)\}\}/;

const fail = (message: string, start: number, end: number): TokenizeResult => ({ ok: false, error: { message, start, end } });

export const tokenize = (source: string): TokenizeResult => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i);

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (rest.startsWith('/*')) {
      const close = source.indexOf('*/', i + 2);

      if (close === -1) return fail('Unterminated comment', i, source.length);
      i = close + 2;
      continue;
    }

    const ref = PROP_REF.exec(rest);

    if (ref !== null) {
      tokens.push({ type: 'propRef', value: ref[1], start: i, end: i + ref[0].length });
      i += ref[0].length;
      continue;
    }

    if (ch === '"') {
      const start = i;
      let value = '';

      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1];

          value += ESCAPES[next] ?? next;
          i += 2;
        } else {
          value += source[i];
          i++;
        }
      }
      if (i >= source.length) return fail('Unterminated string', start, source.length);
      i++;
      tokens.push({ type: 'string', value, start, end: i });
      continue;
    }

    const num = NUMBER.exec(rest);

    if (num !== null) {
      tokens.push({ type: 'number', value: num[0], start: i, end: i + num[0].length });
      i += num[0].length;
      continue;
    }

    const ident = IDENT.exec(rest);

    if (ident !== null) {
      tokens.push({ type: 'ident', value: ident[0], start: i, end: i + ident[0].length });
      i += ident[0].length;
      continue;
    }

    const op = OPERATORS.find((candidate) => rest.startsWith(candidate));

    if (op !== undefined) {
      tokens.push({ type: 'op', value: ALIASES[op] ?? op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }

    if (PUNCT.has(ch)) {
      tokens.push({ type: 'punct', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    return fail(`Unexpected character "${ch}"`, i, i + 1);
  }

  tokens.push({ type: 'eof', value: '', start: source.length, end: source.length });

  return { ok: true, tokens };
};
