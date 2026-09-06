// Applies one mutant from a Stryker JSON report to its source file, so a
// surviving mutant can be checked by hand: apply it, run the tests that import
// the file, and see whether any of them notices.
//
// Usage: node scripts/mutant-apply.mjs <report.json> <source file> <mutant id>
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
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

/**
 * Refuses to patch a file that has changed since the report was built.
 *
 * A mutant is a span, and a span only means something against the exact text it
 * was measured on. Once a file drifts, every span past the first edit lands
 * somewhere else: the patch is silently wrong, the verdict is garbage, and the
 * source is left mangled. One target had already drifted by 48 lines while its
 * report still described the old shape.
 */
export const assertSourceMatchesReport = (source, entry, file) => {
  if (typeof entry?.source !== 'string') {
    throw new Error(`No source recorded for ${file} in the report; cannot prove the spans still fit`);
  }

  if (entry.source === source) {
    return;
  }

  throw new Error(
    `${file} has drifted from the report: ${entry.source.split('\n').length} lines when it was measured, `
    + `${source.split('\n').length} now. Re-measure the file, or remap the spans, before applying a mutant.`,
  );
};

const main = () => {
  const [reportPath, file, id] = process.argv.slice(2);

  if (reportPath === undefined || file === undefined || id === undefined) {
    throw new Error('Usage: node scripts/mutant-apply.mjs <report.json> <source file> <mutant id>');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const entry = report.files[file];
  const mutant = (entry?.mutants ?? []).find((candidate) => candidate.id === id);

  if (mutant === undefined) {
    throw new Error(`No mutant ${id} for ${file} in ${reportPath}`);
  }

  const source = readFileSync(file, 'utf8');

  assertSourceMatchesReport(source, entry, file);
  writeFileSync(file, applyMutant(source, mutant));

  const { line, column } = mutant.location.start;

  process.stdout.write(
    `${mutant.mutatorName} at ${file}:${line}:${column} -> ${JSON.stringify(mutant.replacement)}\n`,
  );
};

/**
 * Whether this module is being run as a CLI rather than imported.
 *
 * Compared by basename, not by full path: sweep drivers run inside throwaway
 * copies of the tree whose `scripts/` is a symlink, so the shell passes the
 * symlinked path while Node reports the realpath. A string comparison there
 * silently skips main() and exits 0 — one sweep scored every mutant as
 * surviving before that was noticed.
 */
export const isEntryPoint = (entryPath, modulePath) => {
  if (typeof entryPath !== 'string') {
    return false;
  }

  return basename(entryPath) === basename(modulePath);
};

if (isEntryPoint(process.argv[1], fileURLToPath(import.meta.url))) {
  main();
}
