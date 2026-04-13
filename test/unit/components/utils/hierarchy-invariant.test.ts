import { describe, it, expect } from 'vitest';

import { assertHierarchy, validateHierarchy } from '../../../../src/components/utils/hierarchy-invariant';
import type { OutputBlockData } from '../../../../types';

describe('hierarchy-invariant', () => {
  describe('validateHierarchy', () => {
    it('returns no violations for a consistent tree', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['h1', 'p1'] },
        { id: 'h1', type: 'header', data: {}, parent: 'c1' },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });

    it('flags a child whose parent is missing from the input', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {}, parent: 'ghost' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe('child-parent-missing');
      expect(violations[0].blockId).toBe('p1');
      expect(violations[0].parentId).toBe('ghost');
    });

    it('flags a child not listed in its parent\'s content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe('child-not-in-parent-content');
      expect(violations[0].blockId).toBe('p1');
      expect(violations[0].parentId).toBe('c1');
    });

    it('flags a dangling id inside content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['ghost'] },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations.some(v => v.kind === 'content-id-dangling')).toBe(true);
    });

    it('flags a child listed in the wrong parent\'s content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['p1'] },
        { id: 'c2', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c2' },
      ];
      const violations = validateHierarchy(blocks);

      // c1 lists p1 but p1.parent === c2 → content-parent-mismatch AND
      // c2 has p1 as child but c2.content[] is empty → child-not-in-parent-content
      expect(violations.some(v => v.kind === 'content-parent-mismatch' && v.blockId === 'c1')).toBe(true);
      expect(violations.some(v => v.kind === 'child-not-in-parent-content' && v.blockId === 'p1')).toBe(true);
    });

    it('flags duplicate ids inside content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['p1', 'p1'] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations.some(v => v.kind === 'content-duplicate')).toBe(true);
    });

    it('treats a root block with no parent and no content as valid', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {} },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });

    it('handles two-level nesting (callout > toggle > paragraph)', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['t1'] },
        { id: 't1', type: 'toggle', data: {}, parent: 'c1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 't1' },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });
  });

  describe('assertHierarchy', () => {
    it('is a noop for a valid tree', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {} },
      ];

      expect(() => assertHierarchy(blocks, 'test')).not.toThrow();
    });

    it('throws with a readable message when drift is present', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];

      expect(() => assertHierarchy(blocks, 'after save')).toThrow(/Hierarchy invariant violated at after save/);
      expect(() => assertHierarchy(blocks, 'after save')).toThrow(/p1.*parent=c1/);
    });
  });
});
