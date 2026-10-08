import { FUNCTIONS, paramMismatch } from './functions';
import type { FunctionDef } from './functions';
import type { FormulaNode } from './parser';
import { propertyFormulaType } from './properties';
import { T, elementOf, listOf, typeName, unify } from './types';
import type { FormulaType } from './types';
import type { PropertyDefinition } from '../types';

export class FormulaCheckError extends Error {
  constructor(message: string, readonly start: number, readonly end: number) {
    super(message);
  }
}

const fail = (message: string, node: { start: number; end: number }): never => {
  throw new FormulaCheckError(message, node.start, node.end);
};

export interface Scope<V> {
  vars: ReadonlyMap<string, V>;
  lambda?: { current: V; index: V };
}

/** List functions whose argument 2 runs once per item with `current` and `index`. */
export const LAMBDA_FUNCTIONS = ['find', 'findIndex', 'filter', 'some', 'every', 'map'] as const;
export type LambdaFunction = typeof LAMBDA_FUNCTIONS[number];

/** Calls the checker and evaluator handle themselves: lazy arguments, bindings or lambdas. */
export const SPECIAL_FORMS = ['prop', 'if', 'ifs', 'and', 'or', 'let', 'lets', ...LAMBDA_FUNCTIONS] as const;

export const isLambda = (name: string): name is LambdaFunction => (LAMBDA_FUNCTIONS as readonly string[]).includes(name);

/** Argument indexes of the names in let/lets and the conditions in ifs: 0, 2, 4... before the last argument. */
export const bindingIndexes = (count: number): number[] => Array.from({ length: Math.floor((count - 1) / 2) }, (_, k) => k * 2);

export interface PropSpan {
  start: number;
  end: number;
  id: string;
}

/** Rewrites `prop("Name")` to the property id and records where each reference sits in the source. */
export const resolveProps = (node: FormulaNode, schema: PropertyDefinition[], spans: PropSpan[]): FormulaNode => {
  const walk = (n: FormulaNode): FormulaNode => {
    switch (n.type) {
      case 'prop': {
        const ref = n.ref;
        const property = ref.by === 'name' ? schema.find((p) => p.name === ref.name) : schema.find((p) => p.id === ref.id);

        if (property === undefined) {
          return fail(ref.by === 'name' ? `Unknown property "${ref.name}"` : `Unknown property id "${ref.id}"`, n);
        }
        spans.push({ start: n.start, end: n.end, id: property.id });

        return { ...n, ref: { by: 'id', id: property.id } };
      }
      case 'list': return { ...n, items: n.items.map(walk) };
      case 'unary': return { ...n, operand: walk(n.operand) };
      case 'binary': return { ...n, left: walk(n.left), right: walk(n.right) };
      case 'ternary': return { ...n, test: walk(n.test), then: walk(n.then), otherwise: walk(n.otherwise) };
      case 'call': return { ...n, args: n.args.map(walk) };
      case 'number':
      case 'string':
      case 'boolean':
      case 'empty':
      case 'ident':
        return n;
    }
  };

  return walk(node);
};

const isLoose = (type: FormulaType): boolean => type.kind === 'any' || type.kind === 'empty';

const arityText = (name: string, def: FunctionDef, got: number): string => {
  const min = def.params.length;
  const max = def.rest !== undefined ? Infinity : min + (def.optional?.length ?? 0);
  const plural = (count: number): string => `${count} argument${count === 1 ? '' : 's'}`;
  const range = min === max ? plural(min) : `${min} to ${plural(max)}`;
  const expected = max === Infinity ? `at least ${plural(min)}` : range;

  return `${name}() takes ${expected}, got ${got}`;
};

export class Checker {
  constructor(private readonly properties: ReadonlyMap<string, PropertyDefinition>) {}

  check(node: FormulaNode, scope: Scope<FormulaType>): FormulaType {
    switch (node.type) {
      case 'number': return T.number;
      case 'string': return T.text;
      case 'boolean': return T.boolean;
      case 'empty': return T.empty;
      case 'list': {
        const types = node.items.map((item) => this.check(item, scope));

        return listOf(types.reduce<FormulaType>((acc, type) => unify(acc, type) ?? T.any, T.empty));
      }
      case 'ident': return this.checkIdent(node, scope);
      case 'prop': return this.checkProp(node);
      case 'unary': {
        const operand = this.check(node.operand, scope);

        if (node.op === 'not') return T.boolean;
        if (!isLoose(operand) && operand.kind !== 'number') fail(`Operator "-" expects Number, got ${typeName(operand)}`, node.operand);

        return T.number;
      }
      case 'binary': return this.checkBinary(node, scope);
      case 'ternary': {
        this.check(node.test, scope);

        return this.branches([this.check(node.then, scope), this.check(node.otherwise, scope)], node);
      }
      case 'call': return this.checkCall(node, scope);
    }
  }

  private checkIdent(node: Extract<FormulaNode, { type: 'ident' }>, scope: Scope<FormulaType>): FormulaType {
    const bound = scope.vars.get(node.name);

    if (bound !== undefined) return bound;
    if (node.name === 'current' || node.name === 'index') {
      if (scope.lambda === undefined) fail(`"${node.name}" can only be used inside a list function`, node);

      return node.name === 'current' ? scope.lambda?.current ?? T.any : T.number;
    }

    return fail(`Unknown variable "${node.name}"`, node);
  }

  private checkProp(node: Extract<FormulaNode, { type: 'prop' }>): FormulaType {
    const id = node.ref.by === 'id' ? node.ref.id : '';
    const property = this.properties.get(id);
    const type = property === undefined ? undefined : propertyFormulaType(property);

    if (property === undefined) return fail(`Unknown property id "${id}"`, node);
    if (type === undefined) return fail(`Property "${property.name}" cannot be used in a formula`, node);

    return type;
  }

  private branches(types: FormulaType[], node: FormulaNode): FormulaType {
    return types.reduce((acc, type) => unify(acc, type) ?? fail(`if() branches return different types: ${typeName(acc)} and ${typeName(type)}`, node));
  }

  private checkBinary(node: Extract<FormulaNode, { type: 'binary' }>, scope: Scope<FormulaType>): FormulaType {
    const left = this.check(node.left, scope);
    const right = this.check(node.right, scope);

    switch (node.op) {
      case 'and':
      case 'or':
      case '==':
      case '!=':
        return T.boolean;
      case '>':
      case '>=':
      case '<':
      case '<=': {
        const common = unify(left, right);

        if (common === undefined || !['number', 'text', 'date', 'any', 'empty'].includes(common.kind)) {
          fail(`Cannot compare ${typeName(left)} with ${typeName(right)}`, node);
        }

        return T.boolean;
      }
      case '+': {
        if (left.kind === 'text' || right.kind === 'text') return T.text;
        const common = unify(left, right);

        if (common !== undefined && ['number', 'any', 'empty'].includes(common.kind)) return common.kind === 'empty' ? T.any : common;

        return fail(`Operator "+" cannot combine ${typeName(left)} and ${typeName(right)}`, node);
      }
      case '-':
      case '*':
      case '/':
      case '%':
      case '^': {
        const bad = [left, right].findIndex((type) => !isLoose(type) && type.kind !== 'number');

        if (bad !== -1) fail(`Operator "${node.op}" expects Number, got ${typeName([left, right][bad])}`, bad === 0 ? node.left : node.right);

        return T.number;
      }
    }
  }

  private checkCall(node: Extract<FormulaNode, { type: 'call' }>, scope: Scope<FormulaType>): FormulaType {
    const { name, args } = node;
    const count = (ok: boolean, message: string): void => {
      if (!ok) fail(message, node);
    };

    switch (name) {
      case 'prop': return fail('prop() on a related page is not supported yet', node);
      case 'if':
        count(args.length === 3, `if() takes 3 arguments, got ${args.length}`);
        this.check(args[0], scope);

        return this.branches([this.check(args[1], scope), this.check(args[2], scope)], node);
      case 'ifs': {
        count(args.length >= 3 && args.length % 2 === 1, 'ifs() takes conditions and values in pairs, then a fallback value');
        const values = args.filter((arg, i) => {
          const isValue = i % 2 === 1 || i === args.length - 1;

          if (!isValue) this.check(arg, scope);

          return isValue;
        });

        return this.branches(values.map((arg) => this.check(arg, scope)), node);
      }
      case 'and':
      case 'or':
        count(args.length >= 2, `${name}() takes at least 2 arguments, got ${args.length}`);
        args.forEach((arg) => this.check(arg, scope));

        return T.boolean;
      case 'let':
      case 'lets':
        return this.checkLet(node, scope);
      default:
        break;
    }

    if (isLambda(name)) return this.checkLambda(name, node, scope);
    const def = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;

    if (def === undefined) return fail(`Unknown function "${name}"`, { start: node.nameStart, end: node.nameEnd });
    const min = def.params.length;
    const max = def.rest !== undefined ? Infinity : min + (def.optional?.length ?? 0);

    count(args.length >= min && args.length <= max, arityText(name, def, args.length));
    const types = args.map((arg) => this.check(arg, scope));

    types.forEach((type, i) => {
      const spec = def.params[i] ?? def.optional?.[i - min] ?? def.rest ?? 'any';
      const expected = paramMismatch(spec, type, types[0]);

      if (expected !== undefined) fail(`Argument ${i + 1} of ${name}() expects ${expected}, got ${typeName(type)}`, args[i]);
    });
    const result = typeof def.returns === 'function' ? def.returns(types) : def.returns;

    return 'error' in result ? fail(result.error, node) : result;
  }

  private checkLet(node: Extract<FormulaNode, { type: 'call' }>, scope: Scope<FormulaType>): FormulaType {
    const { name, args } = node;

    if (name === 'let' && args.length !== 3) fail(`let() takes 3 arguments, got ${args.length}`, node);
    if (name === 'lets' && (args.length < 3 || args.length % 2 === 0)) fail('lets() takes names and values in pairs, then an expression', node);
    const vars = new Map(scope.vars);

    bindingIndexes(args.length).forEach((i) => {
      const binding = args[i];

      if (binding.type !== 'ident') fail(`${name}() needs a variable name as argument ${i + 1}`, binding);
      vars.set(binding.type === 'ident' ? binding.name : '', this.check(args[i + 1], { ...scope, vars }));
    });

    return this.check(args[args.length - 1], { ...scope, vars });
  }

  private checkLambda(name: LambdaFunction, node: Extract<FormulaNode, { type: 'call' }>, scope: Scope<FormulaType>): FormulaType {
    const { args } = node;

    if (args.length !== 2) fail(`${name}() takes 2 arguments, got ${args.length}`, node);
    const listType = this.check(args[0], scope);

    if (!isLoose(listType) && listType.kind !== 'list') fail(`Argument 1 of ${name}() expects a list, got ${typeName(listType)}`, args[0]);
    const element = elementOf(listType);
    const body = this.check(args[1], { ...scope, lambda: { current: element, index: T.number } });

    if (name === 'map') return listOf(body);
    if (!isLoose(body) && body.kind !== 'boolean') fail(`${name}() needs a condition that returns Boolean, got ${typeName(body)}`, args[1]);

    switch (name) {
      case 'find': return element;
      case 'findIndex': return T.number;
      case 'filter': return listOf(element);
      case 'some':
      case 'every':
        return T.boolean;
    }
  }
}
