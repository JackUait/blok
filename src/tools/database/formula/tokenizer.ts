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

const PATTERNS: Array<{ type: TokenType; re: RegExp }> = [
  { type: 'propRef', re: /^\{\{property:([^}]+)\}\}/ },
  { type: 'number', re: /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/ },
  { type: 'ident', re: /^[\p{L}_$][\p{L}\p{N}_$]*/u },
];

class TokenizeError extends Error {
  constructor(message: string, readonly start: number, readonly end: number) {
    super(message);
  }
}

class Scanner {
  private pos = 0;
  readonly tokens: Token[] = [];

  constructor(private readonly source: string) {}

  run(): Token[] {
    while (this.pos < this.source.length) {
      this.step();
    }
    this.tokens.push({ type: 'eof', value: '', start: this.source.length, end: this.source.length });

    return this.tokens;
  }

  private push(type: TokenType, value: string, length: number): void {
    this.tokens.push({ type, value, start: this.pos, end: this.pos + length });
    this.pos += length;
  }

  private step(): void {
    const rest = this.source.slice(this.pos);

    if (/^\s/.test(rest)) {
      this.pos++;

      return;
    }
    if (rest.startsWith('/*')) return this.skipComment();
    if (rest.startsWith('"')) return this.readString();

    for (const { type, re } of PATTERNS) {
      const match = re.exec(rest);

      if (match !== null) return this.push(type, match[1] ?? match[0], match[0].length);
    }

    const op = OPERATORS.find((candidate) => rest.startsWith(candidate));

    if (op !== undefined) return this.push('op', ALIASES[op] ?? op, op.length);
    if (PUNCT.has(rest[0])) return this.push('punct', rest[0], 1);

    throw new TokenizeError(`Unexpected character "${rest[0]}"`, this.pos, this.pos + 1);
  }

  private skipComment(): void {
    const close = this.source.indexOf('*/', this.pos + 2);

    if (close === -1) throw new TokenizeError('Unterminated comment', this.pos, this.source.length);
    this.pos = close + 2;
  }

  private readString(): void {
    const start = this.pos;
    const parts: string[] = [];

    this.pos++;
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      parts.push(this.readChar());
    }
    if (this.pos >= this.source.length) throw new TokenizeError('Unterminated string', start, this.source.length);
    this.pos++;
    this.tokens.push({ type: 'string', value: parts.join(''), start, end: this.pos });
  }

  private readChar(): string {
    const ch = this.source[this.pos];

    if (ch !== '\\' || this.pos + 1 >= this.source.length) {
      this.pos++;

      return ch;
    }
    const next = this.source[this.pos + 1];

    this.pos += 2;

    return ESCAPES[next] ?? next;
  }
}

export const tokenize = (source: string): TokenizeResult => {
  try {
    return { ok: true, tokens: new Scanner(source).run() };
  } catch (error) {
    if (error instanceof TokenizeError) return { ok: false, error: { message: error.message, start: error.start, end: error.end } };
    throw error;
  }
};
