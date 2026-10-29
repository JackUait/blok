import { FUNCTIONS } from './functions';
import type { RunContext } from './functions';
import type { FormulaNode } from './parser';
import { bindingIndexes, isLambda } from './checker';
import type { LambdaFunction, Scope } from './checker';
import { propertyFormulaValue } from './properties';
import { readPropertyValue } from '../value-helpers';
import { checkValue, valueSize } from './limits';
import { isRef } from './types';
import type { FormulaText, FormulaValue } from './types';
import { compareValues, concatText, formulaValueToText, isText, num, truthy, valuesEqual } from './values';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from '../types';

export interface EvalEnv extends RunContext {
  row: DatabaseRow;
  properties: ReadonlyMap<string, PropertyDefinition>;
  /** A formula or rollup of this row, as the formula sees it. `undefined` reads the stored value. */
  propValue?: (property: PropertyDefinition) => FormulaValue | undefined;
  related?: (databaseId: string) => PropertyDefinition[] | undefined;
  /** A property value of a row of a related database. */
  relatedValue?: (databaseId: string, rowId: string, property: PropertyDefinition) => PropertyValue | undefined;
}

const ordered = (a: FormulaValue, b: FormulaValue): boolean => a !== null && b !== null;

const arithmetic = (op: string, a: number, b: number): number => {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
    default: return a ** b;
  }
};

/** Throws `FormulaLimitExceeded` past a cap of `limits.ts`. */
export const evaluate = (node: FormulaNode, env: EvalEnv, scope: Scope<FormulaValue>): FormulaValue => {
  const ev = (child: FormulaNode, inner: Scope<FormulaValue> = scope): FormulaValue => evaluate(child, env, inner);

  env.budget.spend(1);
  switch (node.type) {
    case 'number': return node.value;
    case 'string': return node.value;
    case 'boolean': return node.value;
    case 'empty': return null;
    case 'list': return checked(env, node.items.map((item) => ev(item)));
    case 'ident': {
      const bound = scope.vars.get(node.name);

      if (bound !== undefined) return bound;

      return node.name === 'index' ? scope.lambda?.index ?? null : scope.lambda?.current ?? null;
    }
    case 'prop': {
      const id = node.ref.by === 'id' ? node.ref.id : '';
      const property = env.properties.get(id);

      if (property === undefined) return null;

      return env.propValue?.(property) ?? propertyFormulaValue(property, readPropertyValue(env.row, property), env.timeZone);
    }
    case 'unary': {
      const operand = ev(node.operand);

      if (node.op === 'not') return !truthy(operand);

      return typeof operand === 'number' ? num(-operand) : null;
    }
    case 'ternary': return truthy(ev(node.test)) ? ev(node.then) : ev(node.otherwise);
    case 'binary': return checked(env, evaluateBinary(node, env, ev));
    case 'call': return checked(env, evaluateCall(node, env, scope, ev));
  }
};

/** Caps a made value and pays for its size. */
const checked = (env: EvalEnv, value: FormulaValue): FormulaValue => {
  env.budget.spend(checkValue(value));

  return value;
};

/** Builtins that read one item, not the whole list. */
const LOOKUPS: ReadonlySet<string> = new Set(['at', 'first', 'last', 'empty']);

/** What a builtin pays besides its result: its arguments, and the pairs `unique` compares. */
const argumentCost = (name: string, values: FormulaValue[]): number => {
  if (LOOKUPS.has(name)) return 1;
  const read = values.reduce<number>((total, value) => total + valueSize(value), 0);
  const items = Array.isArray(values[0]) ? values[0].length : 0;

  if (name === 'unique') return read + items * items;
  if (name === 'sort') return read + items * Math.ceil(Math.log2(items + 1));

  return read;
};

const zeroForEmpty = (op: '+' | '-' | '*' | '/', a: FormulaValue, b: FormulaValue): FormulaValue => {
  const x = a ?? 0;
  const y = b ?? 0;

  return typeof x === 'number' && typeof y === 'number' ? num(arithmetic(op, x, y)) : null;
};

const evaluateBinary = (
  node: Extract<FormulaNode, { type: 'binary' }>,
  env: EvalEnv,
  ev: (child: FormulaNode) => FormulaValue
): FormulaValue => {
  if (node.op === 'and') return truthy(ev(node.left)) && truthy(ev(node.right));
  if (node.op === 'or') return truthy(ev(node.left)) || truthy(ev(node.right));
  const a = ev(node.left);
  const b = ev(node.right);

  switch (node.op) {
    case '==': return valuesEqual(a, b);
    case '!=': return !valuesEqual(a, b);
    case '>': return ordered(a, b) && compareValues(a, b) > 0;
    case '>=': return ordered(a, b) && compareValues(a, b) >= 0;
    case '<': return ordered(a, b) && compareValues(a, b) < 0;
    case '<=': return ordered(a, b) && compareValues(a, b) <= 0;
    case '+':
      if (isText(a) || isText(b)) {
        const asText = (v: FormulaValue): FormulaText => (isText(v) ? v : formulaValueToText(v, env));

        return concatText(asText(a), asText(b));
      }

      return zeroForEmpty(node.op, a, b);
    // notion-spec-2 §18.1, §22.5: an empty side of + - * / counts as 0. `%` and `^` are unmeasured, so they keep empty.
    case '-':
    case '*':
    case '/':
      return zeroForEmpty(node.op, a, b);
    case '%':
    case '^':
      return typeof a === 'number' && typeof b === 'number' ? num(arithmetic(node.op, a, b)) : null;
  }
};

const evaluateCall = (
  node: Extract<FormulaNode, { type: 'call' }>,
  env: EvalEnv,
  scope: Scope<FormulaValue>,
  ev: (child: FormulaNode, inner?: Scope<FormulaValue>) => FormulaValue
): FormulaValue => {
  const { name, args } = node;

  switch (name) {
    case 'prop': return relatedProp(node, env, ev);
    case 'if': return truthy(ev(args[0])) ? ev(args[1]) : ev(args[2]);
    case 'ifs': {
      const hit = bindingIndexes(args.length).find((i) => truthy(ev(args[i])));

      return ev(args[hit === undefined ? args.length - 1 : hit + 1]);
    }
    case 'and': return args.every((arg) => truthy(ev(arg)));
    case 'or': return args.some((arg) => truthy(ev(arg)));
    case 'let':
    case 'lets': {
      const vars = new Map(scope.vars);

      bindingIndexes(args.length).forEach((i) => {
        const binding = args[i];

        if (binding.type === 'ident') vars.set(binding.name, ev(args[i + 1], { ...scope, vars }));
      });

      return ev(args[args.length - 1], { ...scope, vars });
    }
    default:
      break;
  }

  if (isLambda(name)) return evaluateLambda(name, ev(args[0]), (current, index) => ev(args[1], { ...scope, lambda: { current, index } }));
  const def = FUNCTIONS[name];
  const values = args.map((arg) => ev(arg));

  if (!def.keepEmpty && values.some((value) => value === null)) return null;
  env.budget.spend(argumentCost(name, values));

  return def.run(values, env);
};

const relatedProp = (
  node: Extract<FormulaNode, { type: 'call' }>,
  env: EvalEnv,
  ev: (child: FormulaNode) => FormulaValue
): FormulaValue => {
  const page = ev(node.args[0]);
  const ref = node.args[1];

  if (!isRef(page) || page.kind !== 'page' || page.databaseId === undefined || ref === undefined) return null;
  const schema = env.related?.(page.databaseId) ?? [];
  const property = ref.type === 'string'
    ? schema.find((p) => p.name === ref.value)
    : schema.find((p) => ref.type === 'prop' && ref.ref.by === 'id' && p.id === ref.ref.id);

  if (property === undefined) return null;

  return propertyFormulaValue(property, env.relatedValue?.(page.databaseId, page.id, property), env.timeZone);
};

const evaluateLambda = (
  name: LambdaFunction,
  listValue: FormulaValue,
  body: (current: FormulaValue, index: number) => FormulaValue
): FormulaValue => {
  const items = Array.isArray(listValue) ? listValue : [];
  const test = (item: FormulaValue, i: number): boolean => truthy(body(item, i));

  switch (name) {
    case 'map': return items.map((item, i) => body(item, i));
    case 'filter': return items.filter(test);
    case 'find': return items.find(test) ?? null;
    case 'findIndex': return items.findIndex(test);
    case 'some': return items.some(test);
    case 'every': return items.every(test);
  }
};
