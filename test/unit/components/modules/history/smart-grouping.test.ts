import { describe, it, expect, beforeEach } from 'vitest';
import { SmartGrouping } from '../../../../../src/components/modules/history/smart-grouping';

describe('SmartGrouping', () => {
  let grouping: SmartGrouping;

  beforeEach(() => {
    grouping = new SmartGrouping();
  });

  describe('shouldCreateCheckpoint', () => {
    it('should return false when no current context exists (first action)', () => {
      const result = grouping.shouldCreateCheckpoint({ actionType: 'insert' }, 'block-1');

      expect(result).toBe(false);
    });

    it('should return true when block changes', () => {
      grouping.updateContext('insert', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'insert' }, 'block-2');

      expect(result).toBe(true);
    });

    it('should return true when action type changes from insert to delete-back', () => {
      grouping.updateContext('insert', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');

      expect(result).toBe(true);
    });

    it('should return true when action type changes from delete-back to insert', () => {
      grouping.updateContext('delete-back', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'insert' }, 'block-1');

      expect(result).toBe(true);
    });

    it('should return true when action type changes from delete-back to delete-fwd', () => {
      grouping.updateContext('delete-back', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'delete-fwd' }, 'block-1');

      expect(result).toBe(true);
    });

    it('should return false for same action type and same block', () => {
      grouping.updateContext('insert', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'insert' }, 'block-1');

      expect(result).toBe(false);
    });

    it('should return false for continued deletion in same block', () => {
      grouping.updateContext('delete-back', 'block-1');
      const result = grouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');

      expect(result).toBe(false);
    });

    it('should default to insert when no actionType provided', () => {
      grouping.updateContext('insert', 'block-1');
      const result = grouping.shouldCreateCheckpoint({}, 'block-1');

      expect(result).toBe(false);
    });

    it('should create checkpoint when switching from insert to delete with default', () => {
      grouping.updateContext('delete-back', 'block-1');
      // No actionType defaults to 'insert'
      const result = grouping.shouldCreateCheckpoint({}, 'block-1');

      expect(result).toBe(true);
    });
  });

  describe('isImmediateCheckpoint', () => {
    it('should return true for format action', () => {
      expect(grouping.isImmediateCheckpoint('format')).toBe(true);
    });

    it('should return true for structural action', () => {
      expect(grouping.isImmediateCheckpoint('structural')).toBe(true);
    });

    it('should return true for paste action', () => {
      expect(grouping.isImmediateCheckpoint('paste')).toBe(true);
    });

    it('should return true for cut action', () => {
      expect(grouping.isImmediateCheckpoint('cut')).toBe(true);
    });

    it('should return false for insert action', () => {
      expect(grouping.isImmediateCheckpoint('insert')).toBe(false);
    });

    it('should return false for delete-back action', () => {
      expect(grouping.isImmediateCheckpoint('delete-back')).toBe(false);
    });

    it('should return false for delete-fwd action', () => {
      expect(grouping.isImmediateCheckpoint('delete-fwd')).toBe(false);
    });
  });

  describe('updateContext', () => {
    it('should update context with action type and block id', () => {
      grouping.updateContext('insert', 'block-1');
      const context = grouping.getCurrentContext();

      expect(context).toBeDefined();
      expect(context?.type).toBe('insert');
      expect(context?.blockId).toBe('block-1');
      expect(context?.timestamp).toBeGreaterThan(0);
    });

    it('should overwrite previous context', () => {
      grouping.updateContext('insert', 'block-1');
      grouping.updateContext('delete-back', 'block-2');
      const context = grouping.getCurrentContext();

      expect(context?.type).toBe('delete-back');
      expect(context?.blockId).toBe('block-2');
    });
  });

  describe('getCurrentContext', () => {
    it('should return undefined when no context is set', () => {
      expect(grouping.getCurrentContext()).toBeUndefined();
    });

    it('should return current context after update', () => {
      grouping.updateContext('insert', 'block-1');

      expect(grouping.getCurrentContext()).toBeDefined();
    });
  });

  describe('clearContext', () => {
    it('should clear current context', () => {
      grouping.updateContext('insert', 'block-1');
      grouping.clearContext();

      expect(grouping.getCurrentContext()).toBeUndefined();
    });

    it('should be safe to call when no context exists', () => {
      expect(() => grouping.clearContext()).not.toThrow();
    });
  });
});
