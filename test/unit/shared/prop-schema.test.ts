import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { describeFromPropSchema, fillDefaults, type PropSchema } from '../../../src/shared/prop-schema';
import { validateAgainst } from '../../../src/shared/schema/validate';

interface CounterData {
  count: number;
  label: string;
}

const schema: PropSchema = { count: { default: 0 }, label: { default: 'n' } };

describe('fillDefaults', () => {
  it('keeps provided values and fills missing keys with their default', () => {
    const result = fillDefaults<CounterData>(schema, { count: 5 });

    expect(result).toEqual({ count: 5, label: 'n' });
  });

  it('returns ONLY schema keys, dropping unknown incoming keys', () => {
    const result = fillDefaults<CounterData>(schema, { count: 1, extra: 'x' });

    expect(Object.keys(result).sort()).toEqual(['count', 'label']);
  });

  it('refills a cleared (undefined) key with its default, never dropping it', () => {
    const result = fillDefaults<CounterData>(schema, { count: undefined, label: 'hi' });

    expect(result).toEqual({ count: 0, label: 'hi' });
  });

  it('returns a frozen object', () => {
    const result = fillDefaults<CounterData>(schema, { count: 1 });

    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('describeFromPropSchema', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const description = describeFromPropSchema({
    type: 'counter',
    title: 'Counter',
    propSchema: {
      count: { default: 0 },
      label: { default: 'n' },
      on: { default: false },
      mode: { default: 'a', values: ['a', 'b'] },
      tags: { default: [] },
      body: { default: [] },
    },
    richTextFields: ['body'],
  });

  it('types keys from their defaults and closes the object', () => {
    expect(validateAgainst(description.data, { count: 1, label: 'x', on: true, mode: 'b', tags: ['t'], body: [{ text: 'hi' }] })).toEqual([]);
    expect(validateAgainst(description.data, { count: 'one' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { on: 'yes' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { mode: 'c' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { extra: 1 }).length).toBeGreaterThan(0);
  });

  it('checks a rich-text field as rich text', () => {
    expect(validateAgainst(description.data, { body: 5 }).length).toBeGreaterThan(0);
  });

  it('leaves arrays, objects and null untyped', () => {
    const loose = describeFromPropSchema({ type: 'x', propSchema: { list: { default: [] }, map: { default: {} }, none: { default: null } } });

    expect(validateAgainst(loose.data, { list: 'a', map: 3, none: 'b' })).toEqual([]);
  });

  it('gives a summary and the defaults', () => {
    expect(description.summary).toBe('Counter block');
    expect(description.defaultData).toEqual({ count: 0, label: 'n', on: false, mode: 'a', tags: [], body: [] });
    expect(describeFromPropSchema({ type: 'x', propSchema: {} }).summary).toBe('x block');
  });
});
