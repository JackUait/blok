import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTION_GROUPS } from '../../../../src/tools/database/database-formula-catalog';
import { FORMULA_FUNCTION_NAMES } from '../../../../src/tools/database/formula';

describe('formula function catalogue', () => {
  it('lists every function the engine runs exactly once, plus not()', () => {
    const listed = FORMULA_FUNCTION_GROUPS.flatMap((group) => group.names);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...FORMULA_FUNCTION_NAMES.filter((name) => name !== 'prop'), 'not'].sort());
  });
});
