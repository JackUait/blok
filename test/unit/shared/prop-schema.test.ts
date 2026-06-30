import { describe, it, expect } from 'vitest';
import { fillDefaults, type PropSchema } from '../../../src/shared/prop-schema';

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
    const result = fillDefaults<CounterData>(schema, { count: 1, extra: 'x' } as Record<string, unknown>);

    expect(Object.keys(result).sort()).toEqual(['count', 'label']);
  });

  it('refills a cleared (undefined) key with its default, never dropping it', () => {
    const result = fillDefaults<CounterData>(schema, { count: undefined, label: 'hi' } as Record<string, unknown>);

    expect(result).toEqual({ count: 0, label: 'hi' });
  });

  it('returns a frozen object', () => {
    const result = fillDefaults<CounterData>(schema, { count: 1 });

    expect(Object.isFrozen(result)).toBe(true);
  });
});
