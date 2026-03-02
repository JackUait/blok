import { describe, it, expect, vi } from 'vitest';

// Mock @babel/register (loaded by src/blok.ts) to avoid requiring @babel/core at runtime
vi.mock('@babel/register', () => ({}));

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
