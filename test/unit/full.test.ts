import { describe, it, expect, vi } from 'vitest';

// Mock @babel/register (loaded by src/blok.ts) to avoid requiring @babel/core at runtime
vi.mock('@babel/register', () => ({}));

import { allTools } from '../../src/full';
import { MarkerInlineTool } from '../../src/components/inline-tools/inline-tool-marker';
import { Quote } from '../../src/tools/quote';
import { CalloutTool } from '../../src/tools/callout';
import { CodeTool } from '../../src/tools/code';
import { ToggleItem } from '../../src/tools/toggle';

describe('full.ts exports', () => {
  describe('allTools', () => {
    it('should include marker inline tool', () => {
      expect(allTools).toHaveProperty('marker');
      expect(allTools.marker.class).toBe(MarkerInlineTool);
    });

    // Quote, Callout, Code and Toggle declare a `conversionConfig` (so they are
    // valid "turn into" targets), but the default turn-into menu only lists tools
    // that are actually registered in the shipped bundle. If they fall out of
    // `allTools`, the default build silently drops them as conversion targets.
    it.each([
      ['quote', Quote],
      ['callout', CalloutTool],
      ['code', CodeTool],
      ['toggle', ToggleItem],
    ])('registers %s as a turn-into target in allTools', (name, toolClass) => {
      expect(allTools).toHaveProperty(name);
      expect(allTools[name as keyof typeof allTools].class).toBe(toolClass);
      // Guard the precondition that makes it a valid conversion target.
      expect(toolClass.conversionConfig.import).toBeDefined();
    });
  });
});
