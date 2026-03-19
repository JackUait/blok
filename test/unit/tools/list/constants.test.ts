import { describe, it, expect } from 'vitest';
import { INDENT_PER_LEVEL, ITEM_STYLES } from '../../../../src/tools/list/constants';

describe('list constants (Notion alignment)', () => {
  it('uses 27px indent per level to match Notion nesting', () => {
    expect(INDENT_PER_LEVEL).toBe(27);
  });

  it('uses unitless leading-[1.5] to match Notion line-height', () => {
    expect(ITEM_STYLES).toContain('leading-[1.5]');
  });
});
