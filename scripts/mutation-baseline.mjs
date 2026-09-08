// Keeps the Stryker baseline report honest across source changes.
//
// A scoped Stryker run reports only the files it mutated, so re-measuring part
// of the repository leaves two reports and no baseline. These two steps close
// that: `drift` says which of the baseline's entries no longer describe the
// source on disk, and `merge` folds a scoped run's fresh entries back into the
// baseline.
//
// Usage:
//   node scripts/mutation-baseline.mjs drift <report.json> [--mutate]
//   node scripts/mutation-baseline.mjs merge <baseline.json> <fresh.json> <out.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './mutant-apply.mjs';

const LIVE = new Set(['Survived', 'NoCoverage']);

/**
 * The slice of a Stryker JSON report these two steps read and write.
 * @typedef {object} MutationReport
 * @property {Record<string, { source: string, mutants: Array<{ status: string }> }>} files
 * @property {object} [thresholds]
 * @property {object} [config]
 */

const liveIn = (entry) => entry.mutants.filter((m) => LIVE.has(m.status)).length;

/**
 * Splits a baseline report by whether each entry still describes its file.
 *
 * The report embeds the exact source it measured, which is the only reliable
 * test: every mutant is a span into that text, so once a file moves by one line
 * the whole entry is unusable and applying one of its mutants patches something
 * nobody generated.
 * @param {object} args - report to inspect and how to read the working tree
 * @param {MutationReport} args.report - a parsed Stryker JSON report
 * @param {(path: string) => string | undefined} args.readSource - current file
 *   contents, or undefined when the file is gone
 * @returns {{ current: string[], drifted: string[], deleted: string[],
 *   liveInCurrent: number, liveInDrifted: number, liveInDeleted: number }}
 */
export const findDrift = ({ report, readSource }) => {
  const buckets = { current: [], drifted: [], deleted: [] };
  const live = { current: 0, drifted: 0, deleted: 0 };

  for (const [path, entry] of Object.entries(report.files)) {
    const source = readSource(path);
    const bucket = source === undefined ? 'deleted' : source === entry.source ? 'current' : 'drifted';

    buckets[bucket].push(path);
    live[bucket] += liveIn(entry);
  }

  return {
    ...buckets,
    liveInCurrent: live.current,
    liveInDrifted: live.drifted,
    liveInDeleted: live.deleted,
  };
};

/**
 * Folds a scoped run's results into the baseline.
 *
 * The fresh run's envelope is discarded on purpose: its `config.mutate` and
 * `thresholds` describe the slice, and adopting them would make the merged
 * report claim the whole baseline was measured under the slice's settings.
 * @param {object} args - the two reports and the files proven gone
 * @param {MutationReport} args.baseline - the report being updated
 * @param {MutationReport} args.fresh - a scoped run's report
 * @param {string[]} [args.deleted] - paths to drop from the baseline
 * @returns {{ report: MutationReport, summary: { replaced: number,
 *   added: number, dropped: number, carried: number } }} the merged report and
 *   how it was assembled, kept apart so the report stays a Stryker report
 */
export const mergeReports = ({ baseline, fresh, deleted = [] }) => {
  const dropped = new Set(deleted);
  const files = {};
  const summary = { replaced: 0, added: 0, dropped: 0, carried: 0 };

  for (const [path, entry] of Object.entries(baseline.files)) {
    if (dropped.has(path)) {
      summary.dropped += 1;
      continue;
    }

    if (path in fresh.files) {
      files[path] = fresh.files[path];
      summary.replaced += 1;
    } else {
      files[path] = entry;
      summary.carried += 1;
    }
  }

  for (const [path, entry] of Object.entries(fresh.files)) {
    if (path in files || dropped.has(path)) {
      continue;
    }

    files[path] = entry;
    summary.added += 1;
  }

  return { report: { ...baseline, files }, summary };
};

const readReport = (path) => JSON.parse(readFileSync(path, 'utf8'));

const main = () => {
  const [command, ...rest] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const wantsMutateList = process.argv.includes('--mutate');

  if (command === 'drift') {
    const drift = findDrift({
      report: readReport(rest[0]),
      readSource: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    });

    if (wantsMutateList) {
      process.stdout.write(`${JSON.stringify(drift.drifted.sort(), null, 2)}\n`);

      return;
    }

    process.stdout.write(
      `current  ${drift.current.length} file(s), ${drift.liveInCurrent} live\n` +
        `drifted  ${drift.drifted.length} file(s), ${drift.liveInDrifted} live\n` +
        `deleted  ${drift.deleted.length} file(s), ${drift.liveInDeleted} live\n`
    );

    return;
  }

  if (command === 'merge') {
    const [baselinePath, freshPath, outPath] = rest;
    const baseline = readReport(baselinePath);
    const fresh = readReport(freshPath);
    const { deleted } = findDrift({
      report: baseline,
      readSource: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    });
    const { report, summary } = mergeReports({ baseline, fresh, deleted });

    writeFileSync(outPath, JSON.stringify(report));
    process.stdout.write(`${JSON.stringify(summary)}\n`);

    return;
  }

  throw new Error(
    'Usage: node scripts/mutation-baseline.mjs drift <report.json> [--mutate]\n' +
      '       node scripts/mutation-baseline.mjs merge <baseline.json> <fresh.json> <out.json>'
  );
};

if (isEntryPoint(process.argv[1], fileURLToPath(import.meta.url))) {
  main();
}
