import { describe, it, expect } from 'vitest';
import * as toolsEntry from '../../../src/tools/index';

describe('tools entry exports', () => {
  describe('defaultBlockTools', () => {
    it('includes database entry', () => {
      expect(toolsEntry.defaultBlockTools).toHaveProperty('database');
    });

    it('includes database-row entry', () => {
      expect(toolsEntry.defaultBlockTools).toHaveProperty('database-row');
    });
  });

  describe('Columns group export', () => {
    it('exports Columns', () => {
      expect(toolsEntry).toHaveProperty('Columns');
    });
  });

  describe('block tune exports', () => {
    it('does not export Delete (internal-only tune)', () => {
      expect(toolsEntry).not.toHaveProperty('Delete');
    });
  });
});
