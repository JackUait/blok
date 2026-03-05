// docs/src/components/tools/tools-data.test.ts
import { describe, it, expect } from 'vitest';
import { defaultBlockTools, defaultInlineTools } from '../../../../src/tools/index';
import {
  DOCUMENTED_BLOCK_TOOL_KEYS,
  DOCUMENTED_INLINE_TOOL_KEYS,
  TOOL_SECTIONS,
} from './tools-data';

describe('tools documentation coverage', () => {
  it('documents every key in defaultBlockTools', () => {
    for (const key of Object.keys(defaultBlockTools)) {
      expect(
        DOCUMENTED_BLOCK_TOOL_KEYS.has(key),
        `Block tool "${key}" is exported in defaultBlockTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('documents every key in defaultInlineTools', () => {
    for (const key of Object.keys(defaultInlineTools)) {
      expect(
        DOCUMENTED_INLINE_TOOL_KEYS.has(key),
        `Inline tool "${key}" is exported in defaultInlineTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty id, title, and description', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.id.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty exportName', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.exportName.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty usageExample', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.usageExample.length).toBeGreaterThan(0);
    }
  });
});
