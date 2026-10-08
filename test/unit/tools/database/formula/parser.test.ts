import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse } from '../../../../../src/tools/database/formula/parser';
import type { FormulaNode } from '../../../../../src/tools/database/formula/parser';

const show = (node: FormulaNode): string => {
  switch (node.type) {
    case 'number': return String(node.value);
    case 'string': return JSON.stringify(node.value);
    case 'boolean': return String(node.value);
    case 'empty': return 'EMPTY';
    case 'ident': return node.name;
    case 'prop': return node.ref.by === 'name' ? `prop<${node.ref.name}>` : `prop#${node.ref.id}`;
    case 'list': return `[${node.items.map(show).join(' ')}]`;
    case 'unary': return `(${node.op} ${show(node.operand)})`;
    case 'binary': return `(${node.op} ${show(node.left)} ${show(node.right)})`;
    case 'ternary': return `(? ${show(node.test)} ${show(node.then)} ${show(node.otherwise)})`;
    case 'call': return `(${node.method ? '.' : ''}${node.name}${node.args.map((a) => ` ${show(a)}`).join('')})`;
  }
};

const tree = (source: string): string => {
  const result = parse(source);

  if (!result.ok) throw new Error(`${result.error.message} @${result.error.start}`);

  return show(result.node);
};

describe('formula parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('precedence', () => {
    it('multiplies before adding', () => {
      expect(tree('1 + 2 * 3')).toBe('(+ 1 (* 2 3))');
    });

    it('applies left associativity to subtraction and division', () => {
      expect(tree('8 - 4 - 2')).toBe('(- (- 8 4) 2)');
      expect(tree('8 / 4 / 2')).toBe('(/ (/ 8 4) 2)');
    });

    it('raises powers right-associatively and above unary minus', () => {
      expect(tree('2 ^ 3 ^ 2')).toBe('(^ 2 (^ 3 2))');
      expect(tree('-2 ^ 2')).toBe('(- (^ 2 2))');
      expect(tree('2 ^ -1')).toBe('(^ 2 (- 1))');
    });

    it('binds pi() * r ^ 2 as in the docs example', () => {
      expect(tree('pi() * prop("Radius") ^ 2')).toBe('(* (pi) (^ prop<Radius> 2))');
    });

    it('compares after arithmetic and tests equality after comparison', () => {
      expect(tree('1 + 1 > 1 == true')).toBe('(== (> (+ 1 1) 1) true)');
    });

    it('ranks and above or, and both below comparison', () => {
      expect(tree('a or b and c')).toBe('(or a (and b c))');
      expect(tree('1 < 2 && 3 > 2 || false')).toBe('(or (and (< 1 2) (> 3 2)) false)');
    });

    it('treats not and ! as prefix operators', () => {
      expect(tree('not prop("Checkbox")')).toBe('(not prop<Checkbox>)');
      expect(tree('!true')).toBe('(not true)');
      expect(tree('not true and false')).toBe('(and (not true) false)');
    });

    it('puts the ternary lowest and nests it to the right', () => {
      expect(tree('a ? 1 : b ? 2 : 3')).toBe('(? a 1 (? b 2 3))');
      expect(tree('prop("Checked") == true ? "Complete" : "Incomplete"'))
        .toBe('(? (== prop<Checked> true) "Complete" "Incomplete")');
    });

    it('groups with parentheses', () => {
      expect(tree('(1 + 2) * 3')).toBe('(* (+ 1 2) 3)');
    });
  });

  describe('calls and dot notation', () => {
    it('parses a function call with arguments', () => {
      expect(tree('if(true, 1, 2)')).toBe('(if true 1 2)');
    });

    it('turns a dot call into a call with the receiver first', () => {
      expect(tree('prop("Task ID").split("-").first()')).toBe('(.first (.split prop<Task ID> "-"))');
    });

    it('accepts a dot call with no parentheses', () => {
      expect(tree('current.length > 2')).toBe('(> (.length current) 2)');
    });

    it('accepts the function forms of and/or', () => {
      expect(tree('and(true, false)')).toBe('(and true false)');
      expect(tree('or(true, false)')).toBe('(or true false)');
    });

    it('keeps prop() on a receiver as a method call', () => {
      expect(tree('current.prop("Status")')).toBe('(.prop current "Status")');
    });

    it('reads a stored id reference', () => {
      expect(tree('{{property:p1}} * 2')).toBe('(* prop#p1 2)');
    });
  });

  describe('literals', () => {
    it('reads lists, booleans and nested lists', () => {
      expect(tree('[1, "a", [true, false]]')).toBe('[1 "a" [true false]]');
      expect(tree('[]')).toBe('[]');
    });

    it('treats an empty or comment-only formula as empty', () => {
      expect(tree('')).toBe('EMPTY');
      expect(tree('  /* nothing */ ')).toBe('EMPTY');
    });

    it('records source spans on nodes', () => {
      const result = parse('1 + foo(2)');

      expect(result.ok && result.node.type === 'binary' && [result.node.right.start, result.node.right.end]).toEqual([4, 10]);
    });
  });

  describe('errors', () => {
    it('reports a missing closing parenthesis', () => {
      expect(parse('(1 + 2')).toEqual({ ok: false, error: { message: 'Expected ")"', start: 6, end: 6 } });
    });

    it('reports a trailing token', () => {
      expect(parse('1 2')).toEqual({ ok: false, error: { message: 'Unexpected "2"', start: 2, end: 3 } });
    });

    it('reports a missing operand', () => {
      expect(parse('1 +')).toEqual({ ok: false, error: { message: 'Unexpected end of formula', start: 3, end: 3 } });
    });

    it('reports a ternary without a colon', () => {
      expect(parse('true ? 1')).toMatchObject({ ok: false, error: { message: 'Expected ":"' } });
    });

    it('passes tokenizer errors through', () => {
      expect(parse('"abc')).toMatchObject({ ok: false, error: { message: 'Unterminated string' } });
    });

    it('reports a prop() call without a text literal', () => {
      expect(parse('prop(1)')).toMatchObject({ ok: false, error: { message: 'prop() takes a property name in quotes' } });
    });
  });
});
