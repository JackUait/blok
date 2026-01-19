import { describe, it, expect } from 'vitest';
import { cacheable } from '../../../../src/components/utils/decorators';

describe('decorators', () => {
  describe('cacheable (legacy decorator)', () => {
    it('should cache method results', () => {
      let callCount = 0;

      class TestClass {
        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        expensiveComputation(): number {
          callCount++;
          return 42;
        }
      }

      const instance = new TestClass();

      expect(instance.expensiveComputation()).toBe(42);
      expect(callCount).toBe(1);

      expect(instance.expensiveComputation()).toBe(42);
      expect(callCount).toBe(1); // Should not increase
    });

    it('should cache getter results', () => {
      class TestClass {
        protected valueState = 0;
        protected getterCallCount = 0;

        get value(): number {
          this.getterCallCount++;
          return this.valueState;
        }

        set value(v: number) {
          this.valueState = v;
        }

        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        get cachedValue(): number {
          return this.value * 2;
        }

        get callCount(): number {
          return this.getterCallCount;
        }
      }

      const instance = new TestClass();
      instance.value = 5;

      expect(instance.cachedValue).toBe(10);
      expect(instance.callCount).toBe(1);

      expect(instance.cachedValue).toBe(10);
      expect(instance.callCount).toBe(1); // Should not increase
    });

    it('should clear cache when setter is called', () => {
      class TestClass {
        protected valueState = 0;
        protected getterCallCount = 0;

        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        get value(): number {
          this.getterCallCount++;
          return this.valueState;
        }

        set value(v: number) {
          this.valueState = v;
        }

        get callCount(): number {
          return this.getterCallCount;
        }
      }

      const instance = new TestClass();

      expect(instance.value).toBe(0);
      expect(instance.callCount).toBe(1);

      instance.value = 5;

      expect(instance.value).toBe(5);
      expect(instance.callCount).toBe(2); // Cache cleared, recomputed
    });

    it('should work with multiple instances', () => {
      let callCount = 0;

      class TestClass {
        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        getValue(): number {
          callCount++;
          return Math.random();
        }
      }

      const instance1 = new TestClass();
      const instance2 = new TestClass();

      const val1 = instance1.getValue();
      const val2 = instance2.getValue();

      expect(callCount).toBe(2);

      // Each instance should have its own cache
      expect(instance1.getValue()).toBe(val1);
      expect(instance2.getValue()).toBe(val2);
      expect(callCount).toBe(2); // No new calls
    });
  });

  describe('cacheable behavior with complex objects', () => {
    it('should cache array results', () => {
      let callCount = 0;

      class TestClass {
        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        getArray(): number[] {
          callCount++;
          return [1, 2, 3].map(x => x * 2);
        }
      }

      const instance = new TestClass();

      const arr1 = instance.getArray();
      const arr2 = instance.getArray();

      expect(callCount).toBe(1);
      expect(arr1).toEqual([2, 4, 6]);
      expect(arr2).toEqual([2, 4, 6]);
      // Same reference due to caching
      expect(arr1).toBe(arr2);
    });

    it('should cache object results', () => {
      let callCount = 0;

      class TestClass {
        // @ts-expect-error - TypeScript decorator signature limitation with class types
        @cacheable
        getObject(): Record<string, number> {
          callCount++;
          return { a: 1, b: 2 };
        }
      }

      const instance = new TestClass();

      const obj1 = instance.getObject();
      const obj2 = instance.getObject();

      expect(callCount).toBe(1);
      expect(obj1).toEqual({ a: 1, b: 2 });
      expect(obj2).toEqual({ a: 1, b: 2 });
      // Same reference due to caching
      expect(obj1).toBe(obj2);
    });
  });
});
