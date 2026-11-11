import { describe, it, expect } from 'vitest';
import { INLINE_TOOL_ORDER } from '../../../src/components/constants/inline-tool-order';
import { allTools } from '../../../src/full';
import { Annotation, defaultInlineTools } from '../../../src/tools/index';

describe('defaultInlineTools order', () => {
  it('mirrors the canonical toolbar order, minus the internal convertTo and askAi tools', () => {
    // The toolbar sorts by INLINE_TOOL_ORDER, so this list's key order does not
    // drive rendering. Keeping the two in step means the registration list reads
    // the way the toolbar looks.
    // annotation has a place in the order but is opt-in, so the defaults leave it out.
    const expected = INLINE_TOOL_ORDER.filter(name => name !== 'convertTo' && name !== 'askAi' && name !== 'annotation');

    expect(Object.keys(defaultInlineTools)).toEqual(expected);
  });
});

describe('INLINE_TOOL_ORDER', () => {
  // Ask AI is absent: it is the last row, after any third-party tool.
  it('lays the cells out in Notion order: color and emphasis first, then link and technical marks', () => {
    expect(INLINE_TOOL_ORDER).toEqual([
      'convertTo',
      'marker', 'bold', 'italic', 'underline', 'clearFormat',
      'link', 'strikethrough', 'inlineCode', 'equation', 'supSub',
      'annotation',
    ]);
  });
});

describe('annotation tool registration', () => {
  it('is exported for hosts to register', () => {
    expect(Annotation.isInline).toBe(true);
  });

  it('is opt-in: neither the default inline tools nor allTools carry it', () => {
    expect(Object.keys(defaultInlineTools)).not.toContain('annotation');
    expect(Object.keys(allTools)).not.toContain('annotation');
  });
});
