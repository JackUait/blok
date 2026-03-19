import { describe, it, expect } from 'vitest';
import { INDENT_PER_LEVEL, ORDERED_INDENT_PER_LEVEL, ITEM_STYLES } from '../../../../src/tools/list/constants';

describe('list constants (Notion alignment)', () => {
  it('uses 27px indent per level to match Notion bullet indent (1.7em × 16px = 27.2px)', () => {
    expect(INDENT_PER_LEVEL).toBe(27);
  });

  it('uses 26px ordered indent per level to match Notion number indent (1.6em × 16px = 25.6px)', () => {
    expect(ORDERED_INDENT_PER_LEVEL).toBe(26);
  });

  it('uses unitless leading-[1.5] to match Notion line-height', () => {
    expect(ITEM_STYLES).toContain('leading-[1.5]');
  });
});
