import { describe, it, expect } from 'vitest';
import { generateBlockId, generateId } from '../../../../src/components/utils/id-generator';

describe('id-generator', () => {
  describe('generateBlockId', () => {
    it('should generate a string', () => {
      const id = generateBlockId();

      expect(typeof id).toBe('string');
    });

    it('should generate unique IDs', () => {
      const id1 = generateBlockId();
      const id2 = generateBlockId();

      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with expected length', () => {
      const id = generateBlockId();

      expect(id.length).toBe(10);
    });

    it('should generate IDs that are URL-safe', () => {
      const id = generateBlockId();

      // nanoid generates URL-safe strings using A-Za-z0-9_--
      expect(id).toMatch(/^[\w-]+$/);
    });

    it('should generate different IDs across multiple calls', () => {
      const ids = new Set();

      for (let i = 0; i < 1000; i++) {
        ids.add(generateBlockId());
      }

      expect(ids.size).toBe(1000);
    });
  });

  describe('generateId', () => {
    it('should generate a string without prefix', () => {
      const id = generateId();

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate a string with prefix', () => {
      const id = generateId('prefix-');

      expect(id).toMatch(/^prefix-/);
    });

    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with hexadecimal suffix', () => {
      const id = generateId();

      // The suffix should be a hexadecimal number (without the prefix)
      const parts = id.match(/^([a-zA-Z0-9-_]*)?([a-f0-9]+)$/);
      expect(parts).toBeTruthy();
    });

    it('should handle empty string prefix', () => {
      const id = generateId('');

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should handle special characters in prefix', () => {
      const id = generateId('test_');

      expect(id).toMatch(/^test_/);
    });
  });
});
