// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildScope,
  buildStrykerArgs,
  checkRatchet,
  collectSurvivors,
  isPartialRun,
  nextTotal,
  resolveDiffBase,
  splitByBudget,
  updateSurvivorAges,
} from '../../../scripts/mutation-scope.mjs';

const SOURCES = [
  'src/components/utils/child-tools.ts',
  'src/components/utils/sanitize-url.ts',
  'src/components/utils/logger.ts',
  'src/shared/url-policy.ts',
];

const TESTS = [
  'test/unit/components/utils/child-tools.test.ts',
  'test/unit/components/utils/sanitize-url.test.ts',
  'test/unit/utils/sanitize-url.test.ts',
  'test/unit/shared/url-policy.test.ts',
];

const mutant = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  mutatorName: 'ConditionalExpression',
  status: 'Survived',
  replacement: 'true',
  location: { start: { line: 12, column: 3 } },
  ...overrides,
});

describe('mutation-scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveDiffBase', () => {
    it('diffs from the recorded commit when it is still reachable', () => {
      expect(resolveDiffBase({ lastCheckedSha: 'abc123' }, () => true)).toEqual({
        from: 'abc123',
        mode: 'incremental',
      });
    });

    it('falls back to a full sweep when no commit was ever recorded', () => {
      expect(resolveDiffBase({}, () => true)).toEqual({
        from: null,
        mode: 'full',
      });
    });

    // A force-push leaves lastCheckedSha pointing at a commit that no longer
    // exists. Diffing from it fails, so the range has to be abandoned.
    it('falls back to a full sweep when the recorded commit is gone', () => {
      expect(resolveDiffBase({ lastCheckedSha: 'dead77' }, () => false)).toEqual({
        from: null,
        mode: 'full',
      });
    });
  });

  describe('buildScope', () => {
    it('pairs a changed source with its own test file', () => {
      const scope = buildScope({
        changedPaths: ['src/components/utils/child-tools.ts'],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual(['src/components/utils/child-tools.ts']);
      expect(scope.testFiles).toEqual([
        'test/unit/components/utils/child-tools.test.ts',
      ]);
      expect(scope.skipped).toEqual([]);
    });

    // Without this, someone can delete assertions from a test, leave the source
    // untouched, and the run reports nothing.
    it('mutates a source whose test changed even when the source did not', () => {
      const scope = buildScope({
        changedPaths: ['test/unit/shared/url-policy.test.ts'],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual(['src/shared/url-policy.ts']);
      expect(scope.testFiles).toEqual(['test/unit/shared/url-policy.test.ts']);
    });

    it('skips a source that has no test file of its own', () => {
      const scope = buildScope({
        changedPaths: ['src/components/utils/logger.ts'],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual([]);
      expect(scope.skipped).toEqual([
        { file: 'src/components/utils/logger.ts', reason: 'no-test' },
      ]);
    });

    // Two files are called sanitize-url.test.ts. The one whose directory mirrors
    // the source wins, which is how the repo is actually laid out.
    it('prefers the test whose path mirrors the source over a same-named one', () => {
      const scope = buildScope({
        changedPaths: ['src/components/utils/sanitize-url.ts'],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual(['src/components/utils/sanitize-url.ts']);
      expect(scope.testFiles).toEqual([
        'test/unit/components/utils/sanitize-url.test.ts',
      ]);
      expect(scope.skipped).toEqual([]);
    });

    // Guessing between same-named tests in unrelated directories is how a run
    // silently measures the wrong module.
    it('skips a source with several same-named tests and no mirrored one', () => {
      const scope = buildScope({
        changedPaths: ['src/components/modules/ui.ts'],
        sourceFiles: ['src/components/modules/ui.ts'],
        testFiles: [
          'test/unit/components/ui.test.ts',
          'test/unit/tools/ui.test.ts',
        ],
      });

      expect(scope.mutate).toEqual([]);
      expect(scope.skipped).toEqual([
        { file: 'src/components/modules/ui.ts', reason: 'ambiguous-test' },
      ]);
    });

    it('ignores paths outside src and deleted files', () => {
      const scope = buildScope({
        changedPaths: [
          'docs/plans/whatever.md',
          'src/components/utils/removed.ts',
          'src/shared/url-policy.ts',
        ],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual(['src/shared/url-policy.ts']);
      expect(scope.skipped).toEqual([]);
    });

    // Blok has three files called sanitizer.ts, so the mirrored path is the only
    // thing that says which one a changed test belongs to.
    it('picks the mirrored source for a changed test', () => {
      const scope = buildScope({
        changedPaths: ['test/unit/components/utils/sanitizer.test.ts'],
        sourceFiles: [
          'src/components/utils/sanitizer.ts',
          'src/view/sanitizer.ts',
        ],
        testFiles: ['test/unit/components/utils/sanitizer.test.ts'],
      });

      expect(scope.mutate).toEqual(['src/components/utils/sanitizer.ts']);
    });

    it('skips a changed test that mirrors nothing and matches several sources', () => {
      const scope = buildScope({
        changedPaths: ['test/unit/tools/sanitizer.test.ts'],
        sourceFiles: [
          'src/components/utils/sanitizer.ts',
          'src/view/sanitizer.ts',
        ],
        testFiles: ['test/unit/tools/sanitizer.test.ts'],
      });

      expect(scope.mutate).toEqual([]);
      expect(scope.skipped).toEqual([
        { file: 'test/unit/tools/sanitizer.test.ts', reason: 'ambiguous-source' },
      ]);
    });

    it('lists each source and test once when both sides changed', () => {
      const scope = buildScope({
        changedPaths: [
          'src/shared/url-policy.ts',
          'test/unit/shared/url-policy.test.ts',
        ],
        sourceFiles: SOURCES,
        testFiles: TESTS,
      });

      expect(scope.mutate).toEqual(['src/shared/url-policy.ts']);
      expect(scope.testFiles).toEqual(['test/unit/shared/url-policy.test.ts']);
    });
  });

  describe('buildStrykerArgs', () => {
    it('narrows the run to the changed files and their tests', () => {
      expect(buildStrykerArgs({
        mode: 'incremental',
        mutate: ['src/a.ts', 'src/b.ts'],
        testFiles: ['test/unit/a.test.ts'],
      })).toEqual([
        'run',
        '--mutate',
        'src/a.ts,src/b.ts',
        '--testFiles',
        'test/unit/a.test.ts',
      ]);
    });

    // The baseline sweep leans on the config file's own defaults instead of
    // passing every path in the repo on one command line.
    it('passes no file selection for a full sweep', () => {
      expect(buildStrykerArgs({
        mode: 'full',
        mutate: [],
        testFiles: [],
        allowFull: true,
      })).toEqual(['run']);
    });

    // A CI job that loses its baseline artifact would otherwise silently start a
    // sixteen-hour sweep of all 104k mutants and sit on a runner slot until it
    // times out. Full sweeps have to be asked for.
    it('refuses a full sweep that was not asked for', () => {
      expect(() => buildStrykerArgs({ mode: 'full', mutate: [], testFiles: [] }))
        .toThrow('No mutation baseline');
    });

    it('asks for no run at all when nothing changed', () => {
      expect(buildStrykerArgs({ mode: 'incremental', mutate: [], testFiles: [] })).toBeNull();
    });
  });

  describe('collectSurvivors', () => {
    it('counts survived and uncovered mutants, and nothing else', () => {
      const survivors = collectSurvivors({
        files: {
          'src/shared/url-policy.ts': {
            mutants: [
              mutant({ status: 'Survived' }),
              mutant({ status: 'NoCoverage', location: { start: { line: 30, column: 1 } } }),
              mutant({ status: 'Killed', location: { start: { line: 40, column: 1 } } }),
              mutant({ status: 'Timeout', location: { start: { line: 41, column: 1 } } }),
              mutant({ status: 'CompileError', location: { start: { line: 42, column: 1 } } }),
              mutant({ status: 'Ignored', location: { start: { line: 43, column: 1 } } }),
            ],
          },
        },
      });

      expect(survivors.map(({ file, mutator, line, status }) => ({ file, mutator, line, status })))
        .toEqual([
          {
            file: 'src/shared/url-policy.ts',
            mutator: 'ConditionalExpression',
            line: 12,
            status: 'Survived',
          },
          {
            file: 'src/shared/url-policy.ts',
            mutator: 'ConditionalExpression',
            line: 30,
            status: 'NoCoverage',
          },
        ]);
    });

    // A ternary yields a `true` and a `false` mutant at the very same position.
    // Keying on position alone folded them into one and lost 70 of 652 survivors
    // on the first real run.
    it('gives two mutants at one position distinct keys', () => {
      const survivors = collectSurvivors({
        files: {
          'src/a.ts': {
            mutants: [
              mutant({ replacement: 'true' }),
              mutant({ replacement: 'false' }),
            ],
          },
        },
      });

      expect(survivors).toHaveLength(2);
      expect(survivors[0].key).not.toBe(survivors[1].key);
    });

    // `a && b && c` mutates each sub-expression to `true` from the same starting
    // column. Only the end position tells them apart, and 12 of 652 survivors on
    // the first real run were this shape.
    it('gives two mutants sharing a start and a replacement distinct keys', () => {
      const survivors = collectSurvivors({
        files: {
          'src/a.ts': {
            mutants: [
              mutant({ location: { start: { line: 7, column: 9 }, end: { line: 7, column: 40 } } }),
              mutant({ location: { start: { line: 7, column: 9 }, end: { line: 7, column: 82 } } }),
            ],
          },
        },
      });

      expect(survivors).toHaveLength(2);
      expect(survivors[0].key).not.toBe(survivors[1].key);
    });

    it('reads an empty report as no survivors', () => {
      expect(collectSurvivors({ files: {} })).toEqual([]);
    });
  });

  describe('updateSurvivorAges', () => {
    const survivor = {
      key: 'src/a.ts|EqualityOperator|5:2',
      file: 'src/a.ts',
      mutator: 'EqualityOperator',
      line: 5,
      status: 'Survived',
    };

    // The whole point of the ledger: a survivor nobody fixed keeps its original
    // commit, so the summary can say how long it has been standing.
    it('keeps the first commit for a survivor carried over from an earlier run', () => {
      const ages = updateSurvivorAges({
        previousAges: {
          [survivor.key]: { firstSeenSha: 'aaa111', firstSeenAt: '2026-08-01T00:00:00.000Z' },
        },
        survivors: [survivor],
        sha: 'ccc333',
        timestamp: '2026-09-03T00:00:00.000Z',
      });

      expect(ages).toEqual({
        [survivor.key]: { firstSeenSha: 'aaa111', firstSeenAt: '2026-08-01T00:00:00.000Z' },
      });
    });

    it('stamps a newly found survivor with the current commit', () => {
      const ages = updateSurvivorAges({
        previousAges: {},
        survivors: [survivor],
        sha: 'ccc333',
        timestamp: '2026-09-03T00:00:00.000Z',
      });

      expect(ages).toEqual({
        [survivor.key]: { firstSeenSha: 'ccc333', firstSeenAt: '2026-09-03T00:00:00.000Z' },
      });
    });

    it('forgets a survivor that is no longer reported', () => {
      const ages = updateSurvivorAges({
        previousAges: {
          'src/gone.ts|EqualityOperator|1:1': {
            firstSeenSha: 'aaa111',
            firstSeenAt: '2026-08-01T00:00:00.000Z',
          },
        },
        survivors: [],
        sha: 'ccc333',
        timestamp: '2026-09-03T00:00:00.000Z',
      });

      expect(ages).toEqual({});
    });
  });

  describe('splitByBudget', () => {
    const weights: Record<string, number> = {
      'src/a.ts': 10,
      'src/b.ts': 20,
      'src/c.ts': 30,
    };
    const weightOf = (file: string): number => weights[file];

    it('measures every file when the whole list fits in one run', () => {
      expect(splitByBudget({ files: ['src/a.ts', 'src/b.ts'], weightOf, budget: 100 })).toEqual({
        batch: ['src/a.ts', 'src/b.ts'],
        pending: [],
      });
    });

    // Carrying the rest forward is what keeps a big push from timing out and
    // leaving the recorded commit behind, which makes the next range bigger yet.
    it('leaves what does not fit for the next run', () => {
      expect(splitByBudget({
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        weightOf,
        budget: 35,
      })).toEqual({
        batch: ['src/a.ts', 'src/b.ts'],
        pending: ['src/c.ts'],
      });
    });

    // A file heavier than the entire budget would otherwise never be measured
    // and would block everything queued behind it.
    it('takes one oversized file rather than measuring nothing', () => {
      expect(splitByBudget({ files: ['src/c.ts', 'src/a.ts'], weightOf, budget: 5 })).toEqual({
        batch: ['src/c.ts'],
        pending: ['src/a.ts'],
      });
    });
  });

  describe('isPartialRun', () => {
    it('reads a run that parked files as part of a longer measurement', () => {
      expect(isPartialRun({ pending: ['src/a.ts'], seeding: false })).toBe(true);
    });

    // The batch that empties the seed queue still carries files the ledger has
    // never seen. Gating it turned the last batch of the first real seed red for
    // 486 survivors that were the seed's whole point.
    it('reads the batch that finishes a seed as part of one too', () => {
      expect(isPartialRun({ pending: [], seeding: true })).toBe(true);
    });

    it('reads an ordinary run that measured its whole scope as a verdict', () => {
      expect(isPartialRun({ pending: [], seeding: false })).toBe(false);
    });
  });

  describe('nextTotal', () => {
    // Recording the partial total would raise the bar to include the run's own
    // new survivors, and the regression it hid would then never be caught.
    it('keeps the settled bar when a run parked part of its scope', () => {
      expect(nextTotal({
        previousTotal: 12,
        currentTotal: 400,
        parked: true,
        seeding: false,
      })).toBe(12);
    });

    // The seed is the ledger filling up on purpose, so its growth is the new bar.
    it('takes the new total when the seed is what parked the files', () => {
      expect(nextTotal({
        previousTotal: 12,
        currentTotal: 400,
        parked: true,
        seeding: true,
      })).toBe(400);
    });

    it('takes the new total when the run measured everything it was given', () => {
      expect(nextTotal({
        previousTotal: 12,
        currentTotal: 9,
        parked: false,
        seeding: false,
      })).toBe(9);
    });

    // Nothing to hold on to on the very first run, so the partial total is still
    // better than no bar at all.
    it('takes the first total it sees when there is no bar yet', () => {
      expect(nextTotal({
        previousTotal: null,
        currentTotal: 400,
        parked: true,
        seeding: false,
      })).toBe(400);
    });
  });

  describe('checkRatchet', () => {
    it('passes when the survivor count holds steady', () => {
      expect(checkRatchet({ previousTotal: 12, currentTotal: 12 })).toEqual({
        ok: true,
        delta: 0,
      });
    });

    it('passes and lowers the bar when survivors were fixed', () => {
      expect(checkRatchet({ previousTotal: 12, currentTotal: 9 })).toEqual({
        ok: true,
        delta: -3,
      });
    });

    it('fails when the run adds survivors', () => {
      expect(checkRatchet({ previousTotal: 12, currentTotal: 14 })).toEqual({
        ok: false,
        delta: 2,
      });
    });

    // A run that parked files measured part of its scope. Reading that total as
    // a regression would fail every batch of the baseline seed.
    it('holds its fire when the run measured only part of its scope', () => {
      expect(checkRatchet({ previousTotal: 12, currentTotal: 400, partial: true })).toEqual({
        ok: true,
        delta: 388,
      });
    });

    // The very first run has nothing to compare against and must not be red.
    it('passes when there is no recorded total yet', () => {
      expect(checkRatchet({ previousTotal: null, currentTotal: 400 })).toEqual({
        ok: true,
        delta: 0,
      });
    });
  });
});
