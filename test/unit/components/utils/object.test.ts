import { describe, it, expect } from 'vitest';
import { deepMerge, equals } from '../../../../src/components/utils/object';

describe('object', () => {
  describe('deepMerge', () => {
    it('should return target unchanged if no sources provided', () => {
      const target = { a: 1 };
      const result = deepMerge(target);

      expect(result).toBe(target);
      expect(result).toEqual({ a: 1 });
    });

    it('should merge two simple objects', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should merge nested objects', () => {
      const target = { a: { x: 1, y: 2 } as Record<string, unknown>, b: 3 };
      const source = { a: { y: 3, z: 4 } as Partial<Record<string, unknown>>, c: 5 };

      const result = deepMerge(target, source);

      expect(result).toEqual({
        a: { x: 1, y: 3, z: 4 },
        b: 3,
        c: 5,
      });
    });

    it('should overwrite arrays in target with arrays from source', () => {
      const target = { arr: [1, 2, 3] };
      const source = { arr: [4, 5] };

      const result = deepMerge(target, source);

      expect(result).toEqual({ arr: [4, 5] });
    });

    it('should skip undefined values in source', () => {
      const target = { a: 1, b: 2, c: 3 };
      const source = { b: undefined, c: 4 };

      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 2, c: 4 });
    });

    it('should merge multiple sources', () => {
      const target = { a: 1 };
      const source1 = { b: 2 } as Partial<typeof target>;
      const source2 = { c: 3 } as Partial<typeof target>;
      const source3 = { d: 4 } as Partial<typeof target>;

      const result = deepMerge(target, source1, source2, source3);

      expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    it('should handle null target', () => {
      const target = null as unknown as Record<string, unknown>;
      const source = { a: 1 };

      const result = deepMerge(target, source);

      expect(result).toBe(target);
    });

    it('should handle non-object source', () => {
      const target = { a: 1 };
      const source = 'not an object' as unknown as Partial<typeof target>;

      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1 });
    });

    it('should mutate and return the target object', () => {
      const target = { a: 1 };
      const source = { b: 2 } as Partial<typeof target>;

      const result = deepMerge(target, source);

      expect(result).toBe(target);
      expect(target).toEqual({ a: 1, b: 2 });
    });

    it('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: { value: 'original' } as Record<string, unknown>,
          } as Record<string, unknown>,
        } as Record<string, unknown>,
      };
      const source = {
        level1: {
          level2: {
            level3: { value: 'updated' } as Record<string, unknown>,
            newValue: 'added',
          } as Record<string, unknown>,
        } as Record<string, unknown>,
      } as Record<string, unknown>;

      const result = deepMerge(target, source);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: { value: 'updated' },
            newValue: 'added',
          },
        },
      });
    });

    it('should add new keys from source', () => {
      const target = { existing: 'value' };
      const source = { newKey: 'newValue' } as Partial<typeof target>;

      const result = deepMerge(target, source);

      expect(result).toEqual({
        existing: 'value',
        newKey: 'newValue',
      });
    });
  });

  describe('equals', () => {
    it('should return true for identical primitives', () => {
      expect(equals(1, 1)).toBe(true);
      expect(equals('test', 'test')).toBe(true);
      expect(equals(true, true)).toBe(true);
      expect(equals(null, null)).toBe(true);
    });

    it('should return false for different primitives', () => {
      expect(equals(1, 2)).toBe(false);
      expect(equals('test', 'other')).toBe(false);
      expect(equals(true, false)).toBe(false);
    });

    it('should return true for same object reference', () => {
      const obj = { a: 1 };
      expect(equals(obj, obj)).toBe(true);
    });

    it('should compare shallow objects', () => {
      expect(equals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(equals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(equals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('should compare nested objects', () => {
      const obj1 = { a: { b: { c: 1 } }, d: 2 };
      const obj2 = { a: { b: { c: 1 } }, d: 2 };
      const obj3 = { a: { b: { c: 2 } }, d: 2 };

      expect(equals(obj1, obj2)).toBe(true);
      expect(equals(obj1, obj3)).toBe(false);
    });

    it('should compare arrays', () => {
      expect(equals([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(equals([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(equals([1, 2], [1, 2, 3])).toBe(false);
    });

    it('should compare nested arrays', () => {
      expect(equals([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
      expect(equals([[1, 2], [3, 4]], [[1, 2], [3, 5]])).toBe(false);
    });

    it('should compare mixed objects and arrays', () => {
      const obj1 = { arr: [1, { x: 2 }], obj: { y: [3, 4] } };
      const obj2 = { arr: [1, { x: 2 }], obj: { y: [3, 4] } };
      const obj3 = { arr: [1, { x: 2 }], obj: { y: [3, 5] } };

      expect(equals(obj1, obj2)).toBe(true);
      expect(equals(obj1, obj3)).toBe(false);
    });

    it('should return false when one is null and other is not', () => {
      expect(equals(null, { a: 1 })).toBe(false);
      expect(equals({ a: 1 }, null)).toBe(false);
    });

    it('should return false when comparing array to object', () => {
      expect(equals([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(false);
    });

    it('should handle empty objects and arrays', () => {
      expect(equals({}, {})).toBe(true);
      expect(equals([], [])).toBe(true);
      expect(equals({}, [])).toBe(false);
    });

    it('should handle objects with different key orders', () => {
      expect(equals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });
  });
});
