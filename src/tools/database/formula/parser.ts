import { tokenize } from './tokenizer';
import type { FormulaError, Token } from './tokenizer';

interface Span {
  start: number;
  end: number;
}

export type PropRef = { by: 'name'; name: string } | { by: 'id'; id: string };

export type FormulaNode = Span & (
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'empty' }
  | { type: 'ident'; name: string }
  | { type: 'prop'; ref: PropRef }
  | { type: 'list'; items: FormulaNode[] }
  | { type: 'unary'; op: '-' | 'not'; operand: FormulaNode }
  | { type: 'binary'; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { type: 'ternary'; test: FormulaNode; then: FormulaNode; otherwise: FormulaNode }
  | { type: 'call'; name: string; args: FormulaNode[]; method: boolean; nameStart: number; nameEnd: number }
);

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '>' | '>=' | '<' | '<=' | 'and' | 'or';

export type ParseResult = { ok: true; node: FormulaNode } | { ok: false; error: FormulaError };

class ParseError extends Error {
  constructor(message: string, readonly start: number, readonly end: number) {
    super(message);
  }
}

/** Lowest to highest; the ternary sits below all of these. */
const BINARY_LEVELS: Array<Partial<Record<string, BinaryOp>>> = [
  { 'or': 'or', '||': 'or' },
  { 'and': 'and', '&&': 'and' },
  { '==': '==', '!=': '!=' },
  { '>': '>', '>=': '>=', '<': '<', '<=': '<=' },
  { '+': '+', '-': '-' },
  { '*': '*', '/': '/', '%': '%' },
];

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseFormula(): FormulaNode {
    if (this.peek().type === 'eof') return { type: 'empty', start: 0, end: 0 };
    const node = this.parseTernary();
    const next = this.peek();

    if (next.type !== 'eof') throw new ParseError(`Unexpected "${next.value}"`, next.start, next.end);

    return node;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];

    if (token.type !== 'eof') this.pos++;

    return token;
  }

  private isPunct(value: string): boolean {
    const token = this.peek();

    return token.type === 'punct' && token.value === value;
  }

  private expectPunct(value: string): Token {
    const token = this.peek();

    if (token.type !== 'punct' || token.value !== value) throw new ParseError(`Expected "${value}"`, token.start, token.start);

    return this.advance();
  }

  private parseTernary(): FormulaNode {
    const test = this.parseBinary(0);
    const token = this.peek();

    if (token.type !== 'op' || token.value !== '?') return test;
    this.advance();
    const then = this.parseTernary();
    const colon = this.peek();

    if (colon.type !== 'op' || colon.value !== ':') throw new ParseError('Expected ":"', colon.start, colon.start);
    this.advance();
    const otherwise = this.parseTernary();

    return { type: 'ternary', test, then, otherwise, start: test.start, end: otherwise.end };
  }

  private binaryOpAt(level: number): BinaryOp | undefined {
    const token = this.peek();

    if (token.type !== 'op' && token.type !== 'ident') return undefined;

    return BINARY_LEVELS[level][token.value];
  }

  private parseBinary(level: number): FormulaNode {
    if (level >= BINARY_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);

    for (let op = this.binaryOpAt(level); op !== undefined; op = this.binaryOpAt(level)) {
      this.advance();
      const right = this.parseBinary(level + 1);

      left = { type: 'binary', op, left, right, start: left.start, end: right.end };
    }

    return left;
  }

  private parseUnary(): FormulaNode {
    const token = this.peek();
    const isNot = (token.type === 'op' && token.value === '!') || (token.type === 'ident' && token.value === 'not');

    if (isNot || (token.type === 'op' && token.value === '-')) {
      this.advance();
      const operand = this.parseUnary();

      return { type: 'unary', op: isNot ? 'not' : '-', operand, start: token.start, end: operand.end };
    }

    return this.parsePower();
  }

  private parsePower(): FormulaNode {
    const base = this.parsePostfix();
    const token = this.peek();

    if (token.type !== 'op' || token.value !== '^') return base;
    this.advance();
    const exponent = this.parseUnary();

    return { type: 'binary', op: '^', left: base, right: exponent, start: base.start, end: exponent.end };
  }

  private parsePostfix(): FormulaNode {
    let node = this.parsePrimary();

    while (this.isPunct('.')) {
      this.advance();
      const name = this.peek();

      if (name.type !== 'ident') throw new ParseError('Expected a function name after "."', name.start, name.end);
      this.advance();
      const args = this.isPunct('(') ? this.parseArgs() : { items: [], end: name.end };

      node = {
        type: 'call', name: name.value, args: [node, ...args.items], method: true,
        nameStart: name.start, nameEnd: name.end, start: node.start, end: args.end,
      };
    }

    return node;
  }

  private parseArgs(): { items: FormulaNode[]; end: number } {
    this.expectPunct('(');
    const items: FormulaNode[] = [];

    if (!this.isPunct(')')) {
      items.push(this.parseTernary());
      while (this.isPunct(',')) {
        this.advance();
        items.push(this.parseTernary());
      }
    }

    return { items, end: this.expectPunct(')').end };
  }

  private parsePrimary(): FormulaNode {
    const token = this.peek();

    switch (token.type) {
      case 'number':
        this.advance();

        return { type: 'number', value: Number(token.value), start: token.start, end: token.end };
      case 'string':
        this.advance();

        return { type: 'string', value: token.value, start: token.start, end: token.end };
      case 'propRef':
        this.advance();

        return { type: 'prop', ref: { by: 'id', id: token.value }, start: token.start, end: token.end };
      case 'ident':
        return this.parseIdent(token);
      case 'punct':
        if (token.value === '(') {
          this.advance();
          const inner = this.parseTernary();

          this.expectPunct(')');

          return inner;
        }
        if (token.value === '[') return this.parseList(token);
        break;
      case 'eof':
        throw new ParseError('Unexpected end of formula', token.start, token.end);
      case 'op':
        break;
    }

    throw new ParseError(`Unexpected "${token.value}"`, token.start, token.end);
  }

  private parseIdent(token: Token): FormulaNode {
    this.advance();
    if (token.value === 'true' || token.value === 'false') {
      return { type: 'boolean', value: token.value === 'true', start: token.start, end: token.end };
    }
    if (!this.isPunct('(')) return { type: 'ident', name: token.value, start: token.start, end: token.end };
    const args = this.parseArgs();

    if (token.value === 'prop') {
      const [name] = args.items;

      if (args.items.length !== 1 || name.type !== 'string') {
        throw new ParseError('prop() takes a property name in quotes', token.start, args.end);
      }

      return { type: 'prop', ref: { by: 'name', name: name.value }, start: token.start, end: args.end };
    }

    return {
      type: 'call', name: token.value, args: args.items, method: false,
      nameStart: token.start, nameEnd: token.end, start: token.start, end: args.end,
    };
  }

  private parseList(open: Token): FormulaNode {
    this.advance();
    const items: FormulaNode[] = [];

    if (!this.isPunct(']')) {
      items.push(this.parseTernary());
      while (this.isPunct(',')) {
        this.advance();
        items.push(this.parseTernary());
      }
    }

    return { type: 'list', items, start: open.start, end: this.expectPunct(']').end };
  }
}

export const parse = (source: string): ParseResult => {
  const tokens = tokenize(source);

  if (!tokens.ok) return tokens;

  try {
    return { ok: true, node: new Parser(tokens.tokens).parseFormula() };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: { message: error.message, start: error.start, end: error.end } };
    throw error;
  }
};
