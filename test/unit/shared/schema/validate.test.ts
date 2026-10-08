// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_PROFILE_KEYWORDS, unknownKeywords, validateAgainst } from '../../../../src/shared/schema/validate';
import { blokDocumentSchema } from '../../../../src/view/document-schema';

type Schema = Readonly<Record<string, unknown>>;

const ok = (schema: Schema, value: unknown): void => {
  expect(validateAgainst(schema, value)).toEqual([]);
};

const bad = (schema: Schema, value: unknown, path = ''): void => {
  const problems = validateAgainst(schema, value);

  expect(problems[0]?.path).toBe(path);
  expect(problems[0]?.message).toEqual(expect.any(String));
  expect(problems[0]?.message.length).toBeGreaterThan(0);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateAgainst', () => {
  it('accepts named types, unions and integers as numbers', () => {
    ok({ type: 'string' }, 'a');
    bad({ type: 'string' }, 1);
    ok({ type: ['string', 'null'] }, null);
    bad({ type: ['string', 'null'] }, 1);
    ok({ type: 'number' }, 3);
    ok({ type: 'integer' }, 3);
    bad({ type: 'integer' }, 3.5);
    ok({ type: 'boolean' }, false);
    bad({ type: 'boolean' }, 'false');
    ok({ type: 'null' }, null);
    bad({ type: 'null' }, {});
    ok({ type: 'array' }, []);
    bad({ type: 'array' }, {});
    ok({ type: 'object' }, {});
    bad({ type: 'object' }, []);
    bad({ type: 'object' }, null);
  });

  it('checks enum and const without coercion', () => {
    ok({ enum: [0, 90] }, 90);
    bad({ enum: [0, 90] }, 45);
    bad({ enum: [0, 90] }, '90');
    ok({ const: true }, true);
    bad({ const: true }, false);
  });

  it('compares enum objects structurally, ignoring key order at every depth', () => {
    const choice = { a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } };

    ok({ enum: [choice] }, { b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 });
    bad({ enum: [choice] }, { a: 1, b: { c: 2, d: [3, { e: 4, f: 6 }] } });
    bad({ enum: [choice] }, { ...choice, extra: true });
  });

  it('compares const structurally while preserving array order and object keys', () => {
    ok({ const: { a: 1, b: 2 } }, { b: 2, a: 1 });
    ok({ const: [1, { a: 2, b: 3 }] }, [1, { b: 3, a: 2 }]);
    bad({ const: [1, 2] }, [2, 1]);
    bad({ const: [1] }, [1, 2]);
    bad({ const: { a: null } }, { b: null });
    bad({ const: {} }, []);
  });

  it('distinguishes inclusive and exclusive numeric boundaries', () => {
    ok({ minimum: 38 }, 38);
    bad({ minimum: 38 }, 37.9);
    ok({ maximum: 600 }, 600);
    bad({ maximum: 600 }, 600.1);
    bad({ exclusiveMinimum: 0 }, 0);
    ok({ exclusiveMinimum: 0 }, 0.001);
    ok({ minimum: 38 }, 'not a number');
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite numbers: %s', value => {
    bad({ type: 'number' }, value);
    bad({ type: 'integer' }, value);
    bad({}, value);
    bad({ items: { type: 'number' } }, [value], '/0');
    bad({ properties: { count: { type: 'number' } } }, { count: value }, '/count');
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite numbers in unconstrained children: %s', value => {
    bad({}, { count: value }, '/count');
    bad({}, [value], '/0');
    bad({ additionalProperties: true }, { nested: [value] }, '/nested/0');
  });

  it('counts string lengths in Unicode code points', () => {
    ok({ minLength: 1 }, 'x');
    bad({ minLength: 1 }, '');
    ok({ maxLength: 2 }, 'ab');
    bad({ maxLength: 2 }, 'abc');
    ok({ minLength: 2, maxLength: 2 }, '😀😀');
    bad({ minLength: 2 }, '😀');
    bad({ maxLength: 1 }, '😀😀');
    ok({ minLength: 1 }, 0);
  });

  it('matches string patterns without requiring a full-string match', () => {
    ok({ pattern: '^#[0-9a-f]{6}$' }, '#ff3b30');
    bad({ pattern: '^#[0-9a-f]{6}$' }, 'red');
    ok({ pattern: 'tag' }, 'a tag here');
    ok({ pattern: '^.$' }, '😀');
  });

  it('checks item schemas and inclusive array-length boundaries', () => {
    ok({ items: { type: 'number' }, minItems: 2, maxItems: 2 }, [1, 2]);
    bad({ items: { type: 'number' } }, [1, 'x'], '/1');
    bad({ minItems: 2 }, [1]);
    bad({ maxItems: 1 }, [1, 2]);
    ok({ minItems: 0, maxItems: 0 }, []);
    ok({ items: { type: 'number' } }, 'not an array');
  });

  it('checks properties, required fields and additional properties', () => {
    const schema = {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      patternProperties: { '^tag:': { type: 'object' } },
    };

    ok(schema, { text: 'a', 'tag:x': {} });
    bad(schema, {});
    bad(schema, { text: 'a', extra: 1 }, '/extra');
    bad(schema, { text: 1 }, '/text');
    bad(schema, { text: 'a', 'tag:x': 'no' }, '/tag:x');
    ok({ additionalProperties: { type: 'string' } }, { a: 'b' });
    bad({ additionalProperties: { type: 'string' } }, { a: 1 }, '/a');
    ok({ additionalProperties: true }, { a: 1 });
    ok({ properties: { a: {} }, additionalProperties: false }, { a: 1 });
    ok({ required: ['text'] }, 'not an object');
  });

  it('requires own properties rather than inherited properties', () => {
    bad({ required: ['toString'] }, {});
    bad({ properties: {}, additionalProperties: false }, { toString: 'x' }, '/toString');
    ok({ properties: { toString: { type: 'string' } }, additionalProperties: false }, { toString: 'x' });
  });

  it('applies both declared and every matching pattern schema', () => {
    const schema = {
      properties: { text: { type: 'string' } },
      patternProperties: { '^t': { minLength: 2 }, 't$': { pattern: '^a' } },
      additionalProperties: false,
    };

    ok(schema, { text: 'ab' });
    bad(schema, { text: 'a' }, '/text');
    bad(schema, { text: 'bb' }, '/text');
  });

  it('requires exactly one matching oneOf branch', () => {
    const schema = { oneOf: [{ type: 'string' }, { type: 'array' }] };

    ok(schema, 'a');
    bad(schema, 1);
    bad({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1);
    ok({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1.5);
  });

  it('requires at least one matching anyOf branch', () => {
    ok({ anyOf: [{ type: 'number' }, { type: 'integer' }] }, 1);
    bad({ anyOf: [{ type: 'string' }] }, 1);
  });

  it('requires every allOf branch and preserves nested value paths', () => {
    ok({ allOf: [{ type: 'number' }, { minimum: 5 }] }, 5);
    bad({ allOf: [{ type: 'number' }, { minimum: 5 }] }, 4);
    bad({ allOf: [{ properties: { count: { type: 'integer' } } }] }, { count: 1.5 }, '/count');
  });

  it('applies then only when if matches', () => {
    const schema = {
      if: { required: ['type'], properties: { type: { const: 'p' } } },
      then: { required: ['text'] },
    };

    ok(schema, { type: 'q' });
    bad(schema, { type: 'p' });
    ok(schema, { type: 'p', text: 'x' });
    ok({ if: { type: 'string' } }, 1);
    ok({ then: { type: 'string' } }, 1);
  });

  it('does not constrain values through annotations or insert defaults', () => {
    const schema = { description: 'x', deprecated: true, default: 1, examples: [1] };
    const value = Object.freeze({});

    ok(schema, 'anything');
    ok(schema, value);
    expect(value).toEqual({});
  });

  it('escapes slash and tilde in nested value pointers', () => {
    bad(
      { properties: { 'a/b~c': { items: { properties: { '~x/y': { type: 'string' } } } } } },
      { 'a/b~c': [{ '~x/y': 1 }] },
      '/a~1b~0c/0/~0x~1y'
    );
  });

  it('does not mutate a schema or its value', () => {
    const schema = Object.freeze({
      properties: Object.freeze({ text: Object.freeze({ type: 'string' }) }),
      required: Object.freeze(['text']),
    });
    const value = Object.freeze({ text: 'hello' });

    ok(schema, value);
    expect(schema).toEqual({ properties: { text: { type: 'string' } }, required: ['text'] });
    expect(value).toEqual({ text: 'hello' });
  });
});

describe('unsupported keyword policy', () => {
  it.each([
    { $ref: '#/x' },
    { format: 'uri' },
    { exclusiveMaximum: 10 },
    { properties: { absent: { format: 'uri' } } },
    { anyOf: [{}, { format: 'uri' }] },
    { if: { const: false }, then: { format: 'uri' } },
  ])('ignores unsupported keywords even in unused branches: %j', schema => {
    ok(schema, {});
    expect(unknownKeywords(schema).length).toBeGreaterThan(0);
  });

  it('ignores unsupported format beside a supported type', () => {
    const schema = { type: 'string', format: 'uri' };

    ok(schema, 'not a URI');
    expect(unknownKeywords(schema)).toEqual(['/format']);
  });

  it('ignores unsupported keywords in unused property schemas', () => {
    const schema = {
      type: 'object',
      properties: { unused: { format: 'uri' }, text: { type: 'string' } },
    };

    ok(schema, { text: 'hello' });
    expect(unknownKeywords(schema)).toEqual(['/properties/unused/format']);
  });

  it('preserves supported field diagnostics beside an unused unsupported keyword', () => {
    const schema = {
      properties: { unused: { format: 'uri' }, text: { type: 'string' } },
    };

    bad(schema, { text: 1 }, '/text');
    expect(unknownKeywords(schema)).toEqual(['/properties/unused/format']);
  });
});

describe('malformed schemas', () => {
  it.each([
    { type: 'date' },
    { type: [] },
    { type: ['string', 1] },
    { type: ['string', 'string'] },
    { enum: 'x' },
    { required: 'text' },
    { required: [1] },
    { required: ['text', 'text'] },
    { properties: [] },
    { properties: null },
    { properties: { unused: false } },
    { properties: { unused: new Date(0) } },
    { patternProperties: [] },
    { patternProperties: { '^x': 1 } },
    { items: [] },
    { items: true },
    { items: null },
    { additionalProperties: 'no' },
    { oneOf: {} },
    { oneOf: [] },
    { oneOf: [{}, false] },
    { anyOf: [{}, null] },
    { allOf: [] },
    { allOf: [1] },
    { if: false },
    { then: true },
    { description: 1 },
    { deprecated: 'yes' },
    { examples: 'x' },
    { enum: [Infinity] },
    { const: NaN },
    { const: undefined },
    { default: Infinity },
    { examples: [undefined] },
  ])('fails closed on malformed keyword values: %j', schema => {
    bad(schema, {});
  });

  it.each([
    { keyword: 'type', items: ['number', 'string'], value: 'x' },
    { keyword: 'required', items: ['a'], value: {} },
    { keyword: 'enum', items: [1, 2], value: 2 },
    { keyword: 'const', items: [1], value: [2] },
    { keyword: 'examples', items: [1], value: {} },
  ])('rejects sparse arrays in $keyword', ({ keyword, items, value }) => {
    const sparse: unknown[] = [...items];

    delete sparse[0];
    bad({ [keyword]: sparse }, value);
  });

  it.each(['minimum', 'maximum', 'exclusiveMinimum'])('requires finite numeric %s bounds', keyword => {
    for (const bound of ['0', NaN, Infinity, -Infinity]) {
      bad({ [keyword]: bound }, 1);
    }
  });

  it.each(['minLength', 'maxLength', 'minItems', 'maxItems'])('requires nonnegative integer %s limits', keyword => {
    for (const limit of [-1, 0.5, '1', NaN, Infinity]) {
      bad({ [keyword]: limit }, 'x');
    }
  });

  it.each([
    { pattern: '[' },
    { pattern: 1 },
    { patternProperties: { '[': {} } },
    { properties: { absent: { pattern: '[' } } },
    { if: { const: false }, then: { pattern: '[' } },
  ])('reports malformed regexes rather than throwing: %j', schema => {
    bad(schema, 1);
  });

  it.each([null, true, [], new Date(0)])('rejects non-object schema roots: %j', schema => {
    bad(schema as unknown as Schema, {});
  });
});

describe('unknownKeywords', () => {
  it('lists unsupported keywords with their schema paths', () => {
    expect(unknownKeywords({
      type: 'object',
      properties: { a: { $ref: '#/x' }, format: { type: 'string', format: 'uri' } },
    })).toEqual(['/properties/a/$ref', '/properties/format/format']);
  });

  it('walks every profile subschema location and escapes pointer segments', () => {
    expect(unknownKeywords({
      properties: { 'a/b~c': { format: 'uri' } },
      patternProperties: { '^a/': { $ref: '#/x' } },
      items: { title: 'x' },
      additionalProperties: { not: {} },
      oneOf: [{ multipleOf: 2 }],
      anyOf: [{ contains: {} }],
      allOf: [{ exclusiveMaximum: 1 }],
      if: { else: {} },
      then: { $defs: {} },
    })).toEqual([
      '/properties/a~1b~0c/format',
      '/patternProperties/^a~1/$ref',
      '/items/title',
      '/additionalProperties/not',
      '/oneOf/0/multipleOf',
      '/anyOf/0/contains',
      '/allOf/0/exclusiveMaximum',
      '/if/else',
      '/then/$defs',
    ]);
  });

  it('does not treat property names or annotation and literal data as keywords', () => {
    expect(unknownKeywords({
      properties: { format: { type: 'string' } },
      const: { format: 'uri' },
      enum: [{ $ref: 'literal' }],
      default: { title: 'x' },
      examples: [{ not: {} }],
    })).toEqual([]);
  });

  it('ignores non-schema input when collecting keyword names', () => {
    expect(unknownKeywords(null)).toEqual([]);
    expect(unknownKeywords([])).toEqual([]);
    expect(unknownKeywords(false)).toEqual([]);
  });

  it('exposes exactly the canonical 25 keywords', () => {
    expect([...SCHEMA_PROFILE_KEYWORDS].sort()).toEqual([
      'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'patternProperties',
      'items', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'minimum', 'maximum', 'exclusiveMinimum',
      'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'deprecated', 'description',
      'default', 'examples',
    ].sort());
  });
});

describe('validateAgainst on the shipped schema', () => {
  const defs = blokDocumentSchema.$defs;

  it('accepts a callout with a null colour and rejects a numeric one', () => {
    ok(defs.callout, { emoji: '💡', textColor: null });
    bad(defs.callout, { emoji: '💡', textColor: 3 }, '/textColor');
  });

  it('rejects image markup colours outside the pattern', () => {
    const markup = [{ id: 'm', type: 'pen', color: 'red', points: [0, 0, 1], size: 0.1 }];

    bad(defs.image, { url: 'u', markup }, '/markup/0');
    ok(defs.image, { url: 'u', markup: [{ ...markup[0], color: '#ff3b30' }] });
  });

  it('every definition uses only profile keywords', () => {
    for (const [name, def] of Object.entries(defs)) {
      expect(unknownKeywords(def), name).toEqual([]);
    }
  });
});
