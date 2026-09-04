// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { applyMutant } from '../../../scripts/mutant-apply.mjs';

const SOURCE = [
  'const a = 1;',
  'const flag = x === 2 && y;',
  'const b = 3;',
].join('\n');

describe('applyMutant', () => {
  // Stryker reports a mutant as a span, not a line. Replacing a whole line, or
  // guessing the text from the mutator name, silently mutates the wrong thing:
  // a line holding two literals has two different mutants at two columns, and
  // patching by text hits whichever comes first.
  it('replaces exactly the reported span', () => {
    const mutated = applyMutant(SOURCE, {
      location: { start: { line: 2, column: 14 }, end: { line: 2, column: 21 } },
      replacement: 'true',
    });

    expect(mutated.split('\n')[1]).toBe('const flag = true && y;');
  });

  it('leaves every other line byte-identical', () => {
    const mutated = applyMutant(SOURCE, {
      location: { start: { line: 2, column: 14 }, end: { line: 2, column: 21 } },
      replacement: 'true',
    });

    expect(mutated.split('\n')[0]).toBe('const a = 1;');
    expect(mutated.split('\n')[2]).toBe('const b = 3;');
  });

  it('replaces a span covering several lines', () => {
    const mutated = applyMutant('a(\n  1,\n  2\n);', {
      location: { start: { line: 1, column: 1 }, end: { line: 4, column: 2 } },
      replacement: 'b()',
    });

    expect(mutated).toBe('b();');
  });

  it('replaces a span on the first line without losing it', () => {
    const mutated = applyMutant(SOURCE, {
      location: { start: { line: 1, column: 11 }, end: { line: 1, column: 12 } },
      replacement: '9',
    });

    expect(mutated.split('\n')[0]).toBe('const a = 9;');
  });
});
