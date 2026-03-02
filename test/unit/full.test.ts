import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/full';
import { MarkerInlineTool } from '../../src/components/inline-tools/inline-tool-marker';

describe('full.ts exports', () => {
  describe('allTools', () => {
    it('should include marker inline tool', () => {
      expect(allTools).toHaveProperty('marker');
      expect(allTools.marker.class).toBe(MarkerInlineTool);
    });
  });
});
