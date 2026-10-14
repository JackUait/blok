import { describe, it, expect } from 'vitest';
import { INLINE_TOOL_ORDER } from '../../../src/components/constants/inline-tool-order';
import { defaultInlineTools } from '../../../src/tools/index';

describe('defaultInlineTools order', () => {
  it('mirrors the canonical toolbar order, minus the internal convertTo and askAi tools', () => {
    // The toolbar sorts by INLINE_TOOL_ORDER, so this list's key order does not
    // drive rendering. Keeping the two in step means the registration list reads
    // the way the toolbar looks.
    const expected = INLINE_TOOL_ORDER.filter(name => name !== 'convertTo' && name !== 'askAi');

    expect(Object.keys(defaultInlineTools)).toEqual(expected);
  });
});

describe('INLINE_TOOL_ORDER', () => {
  it('lays the cells out in Notion order: Ask AI, color and emphasis first, then link and technical marks', () => {
    expect(INLINE_TOOL_ORDER).toEqual([
      'convertTo',
      'askAi',
      'marker', 'bold', 'italic', 'underline', 'clearFormat',
      'link', 'strikethrough', 'inlineCode', 'equation', 'supSub',
    ]);
  });
});
