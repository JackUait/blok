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

    it('includes table_of_contents entry', () => {
      expect(toolsEntry.defaultBlockTools).toHaveProperty('table_of_contents');
    });
  });

  describe('Columns group export', () => {
    it('exports Columns', () => {
      expect(toolsEntry).toHaveProperty('Columns');
    });
  });

  describe('TableOfContents export', () => {
    it('exports the table of contents tool class', async () => {
      const { TableOfContentsTool } = await import('../../../src/tools/table-of-contents');

      expect(toolsEntry).toHaveProperty('TableOfContents', TableOfContentsTool);
    });
  });

  describe('block tune exports', () => {
    it('does not export Delete (internal-only tune)', () => {
      expect(toolsEntry).not.toHaveProperty('Delete');
    });
  });
});
