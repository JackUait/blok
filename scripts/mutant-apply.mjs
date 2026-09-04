// Applies one mutant from a Stryker JSON report to its source file, so a
// surviving mutant can be checked by hand: apply it, run the tests that import
// the file, and see whether any of them notices.
//
// Usage: node scripts/mutant-apply.mjs <report.json> <source file> <mutant id>
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Replaces the exact span a Stryker mutant reports.
 *
 * The span, never the line: a line holding two literals carries two different
 * mutants at two columns, and patching by matching text hits whichever comes
 * first. That mistake reads as "the test does not catch this mutant" while a
 * different mutant is the one being run.
 */
export const applyMutant = (source, mutant) => {
  const lines = source.split('\n');
  const { start, end } = mutant.location;
  const head = lines.slice(0, start.line - 1);
  const tail = lines.slice(end.line);
  const patched = lines[start.line - 1].slice(0, start.column - 1)
    + mutant.replacement
    + lines[end.line - 1].slice(end.column - 1);

  return [...head, patched, ...tail].join('\n');
};

const main = () => {
  const [reportPath, file, id] = process.argv.slice(2);

  if (reportPath === undefined || file === undefined || id === undefined) {
    throw new Error('Usage: node scripts/mutant-apply.mjs <report.json> <source file> <mutant id>');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const mutant = (report.files[file]?.mutants ?? []).find((candidate) => candidate.id === id);

  if (mutant === undefined) {
    throw new Error(`No mutant ${id} for ${file} in ${reportPath}`);
  }

  writeFileSync(file, applyMutant(readFileSync(file, 'utf8'), mutant));

  const { line, column } = mutant.location.start;

  process.stdout.write(
    `${mutant.mutatorName} at ${file}:${line}:${column} -> ${JSON.stringify(mutant.replacement)}\n`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
