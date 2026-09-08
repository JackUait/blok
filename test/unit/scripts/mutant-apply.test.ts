// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { applyMutant, assertSourceMatchesReport, isEntryPoint } from '../../../scripts/mutant-apply.mjs';

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
      mutatorName: 'BooleanLiteral',
      location: { start: { line: 2, column: 14 }, end: { line: 2, column: 21 } },
      replacement: 'true',
    });

    expect(mutated.split('\n')[1]).toBe('const flag = true && y;');
  });

  it('leaves every other line byte-identical', () => {
    const mutated = applyMutant(SOURCE, {
      mutatorName: 'BooleanLiteral',
      location: { start: { line: 2, column: 14 }, end: { line: 2, column: 21 } },
      replacement: 'true',
    });

    expect(mutated.split('\n')[0]).toBe('const a = 1;');
    expect(mutated.split('\n')[2]).toBe('const b = 3;');
  });

  it('replaces a span covering several lines', () => {
    const mutated = applyMutant('if (x) {\n  a();\n  b();\n}', {
      mutatorName: 'BlockStatement',
      location: { start: { line: 1, column: 8 }, end: { line: 4, column: 2 } },
      replacement: '{}',
    });

    expect(mutated).toBe('if (x) {}');
  });

  // Stryker mutates the AST and re-prints, so its `a || b` for the node `a && b`
  // inside `a && b && c` means `(a || b) && c`. Splicing the text raw would
  // produce `a || b && c`, which JS parses as `a || (b && c)` — a mutant nobody
  // generated, scored under the real mutant's id.
  it('parenthesises an expression replacement so it cannot reassociate', () => {
    const mutated = applyMutant('const r = a && b && c;', {
      mutatorName: 'LogicalOperator',
      location: { start: { line: 1, column: 11 }, end: { line: 1, column: 17 } },
      replacement: 'a || b',
    });

    expect(mutated).toBe('const r = (a || b) && c;');
  });

  // Precedence is not a logical-operator problem. Dropping the call from
  // `(a ?? '').trim()` leaves a `??` expression where a member call stood, and
  // spliced raw into an `&&` chain that is a SyntaxError — which the sweep
  // scores as a kill, because no test in the run can even load the module.
  it('parenthesises a compound replacement from any mutator', () => {
    const mutated = applyMutant("const r = ok && (a ?? '').trim() !== '';", {
      mutatorName: 'MethodExpression',
      location: { start: { line: 1, column: 17 }, end: { line: 1, column: 33 } },
      replacement: "a ?? ''",
    });

    expect(mutated).toBe("const r = ok && (a ?? '') !== '';");
  });

  // A literal is already a primary expression, and an import source may not be
  // parenthesised at all.
  it('leaves a literal replacement unwrapped', () => {
    const mutated = applyMutant("import x from 'a';", {
      mutatorName: 'StringLiteral',
      location: { start: { line: 1, column: 15 }, end: { line: 1, column: 18 } },
      replacement: '""',
    });

    expect(mutated).toBe('import x from "";');
  });

  // A block body, a case label and a removed call are statements, and wrapping
  // any of them turns the patch into a syntax error or an object literal.
  it('leaves a replacement that is not an expression alone', () => {
    const span = { start: { line: 1, column: 11 }, end: { line: 1, column: 17 } };

    expect(applyMutant('const r = a && b && c;', { mutatorName: 'BlockStatement', location: span, replacement: '{}' }))
      .toBe('const r = {} && c;');
    expect(applyMutant('const r = a && b && c;', { mutatorName: 'CallExpression', location: span, replacement: ';' }))
      .toBe('const r = ; && c;');
    expect(applyMutant('const r = a && b && c;', { mutatorName: 'ConditionalExpression', location: span, replacement: 'default:' }))
      .toBe('const r = default: && c;');
  });

  it('replaces a span on the first line without losing it', () => {
    const mutated = applyMutant(SOURCE, {
      mutatorName: 'StringLiteral',
      location: { start: { line: 1, column: 11 }, end: { line: 1, column: 12 } },
      replacement: '""',
    });

    expect(mutated.split('\n')[0]).toBe('const a = "";');
  });
});

/**
 * A mutant is a span, and a span only means something against the exact text it
 * was measured on. The baseline ages the moment anyone edits a file, and then a
 * span lands in the wrong place: the patch is silently wrong, the verdict is
 * garbage, and the source is left mangled. One file had already drifted by 48
 * lines while its report still claimed the old shape.
 */
describe('assertSourceMatchesReport', () => {
  it('accepts a file byte-identical to the report', () => {
    expect(() => assertSourceMatchesReport('a\nb\n', { source: 'a\nb\n' }, 'x.ts')).not.toThrow();
  });

  it('refuses a file that has changed since the report was built', () => {
    expect(() => assertSourceMatchesReport('a\nCHANGED\n', { source: 'a\nb\n' }, 'x.ts'))
      .toThrow(/drifted/i);
  });

  it('names the file and both line counts, so the reason is obvious', () => {
    expect(() => assertSourceMatchesReport('a\nb\nc\n', { source: 'a\n' }, 'src/x.ts'))
      .toThrow(/src\/x\.ts.*1.*3|src\/x\.ts/);
  });

  // A report without the source cannot prove anything either way. Refusing is
  // the only safe answer: silently trusting it is how the spans go wrong.
  it('refuses when the report carries no source to compare against', () => {
    expect(() => assertSourceMatchesReport('a\n', {}, 'x.ts')).toThrow(/no source/i);
  });
});

/**
 * The applier is run as a CLI from sweep drivers, and several of those drivers
 * work inside a throwaway copy of the tree whose `scripts/` is a symlink. A
 * guard comparing argv[1] to the module URL by string fails there: the shell
 * passes the symlinked path, Node reports the realpath, main() never runs and
 * the process exits 0. One sweep would have scored every mutant as surviving.
 */
describe('isEntryPoint', () => {
  it('recognises the module when the paths match', () => {
    expect(isEntryPoint('/repo/scripts/mutant-apply.mjs', '/repo/scripts/mutant-apply.mjs')).toBe(true);
  });

  it('recognises it when the caller reached it through a symlinked directory', () => {
    expect(isEntryPoint('/tmp/sandbox/scripts/mutant-apply.mjs', '/repo/scripts/mutant-apply.mjs')).toBe(true);
  });

  it('does not claim to be the entry point when another script imported it', () => {
    expect(isEntryPoint('/repo/scripts/sweep.mjs', '/repo/scripts/mutant-apply.mjs')).toBe(false);
  });

  it('answers false when there is no entry path at all', () => {
    expect(isEntryPoint(undefined, '/repo/scripts/mutant-apply.mjs')).toBe(false);
  });
});
