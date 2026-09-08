// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findDrift, mergeReports } from '../../../scripts/mutation-baseline.mjs';

const fileEntry = (source: string, statuses: string[]) => ({
  language: 'typescript',
  source,
  mutants: statuses.map((status, i) => ({ id: `${i}`, status })),
});

describe('findDrift', () => {
  // A Stryker report embeds the source it measured, so drift is decidable
  // without a git checkout: the recorded source either still matches the file
  // on disk or every span in that file's entry points at the wrong text.
  it('splits the report into fresh, drifted and deleted files', () => {
    const report = {
      files: {
        'src/a.ts': fileEntry('const a = 1;', ['Survived']),
        'src/b.ts': fileEntry('const b = 1;', ['Killed', 'NoCoverage']),
        'src/gone.ts': fileEntry('const c = 1;', ['Survived']),
      },
    };
    const disk = new Map([
      ['src/a.ts', 'const a = 1;'],
      ['src/b.ts', 'const b = 2;'],
    ]);

    const drift = findDrift({ report, readSource: (p: string) => disk.get(p) });

    expect(drift.current).toEqual(['src/a.ts']);
    expect(drift.drifted).toEqual(['src/b.ts']);
    expect(drift.deleted).toEqual(['src/gone.ts']);
  });

  it('counts the live mutants stranded in each bucket', () => {
    const report = {
      files: {
        'src/a.ts': fileEntry('same', ['Survived', 'Killed']),
        'src/b.ts': fileEntry('old', ['Survived', 'NoCoverage', 'Killed']),
      },
    };
    const disk = new Map([['src/a.ts', 'same'], ['src/b.ts', 'new']]);

    const drift = findDrift({ report, readSource: (p: string) => disk.get(p) });

    expect(drift.liveInCurrent).toBe(1);
    expect(drift.liveInDrifted).toBe(2);
  });
});

describe('mergeReports', () => {
  it('replaces a baseline entry with the freshly measured one', () => {
    const baseline = { files: { 'src/a.ts': fileEntry('old', ['Survived']) }, schemaVersion: '2' };
    const fresh = { files: { 'src/a.ts': fileEntry('new', ['Killed']) }, schemaVersion: '2' };

    const { report } = mergeReports({ baseline, fresh });

    expect(report.files['src/a.ts'].source).toBe('new');
    expect(report.files['src/a.ts'].mutants).toEqual([{ id: '0', status: 'Killed' }]);
  });

  it('keeps baseline files the fresh run did not measure', () => {
    const baseline = {
      files: { 'src/a.ts': fileEntry('a', ['Survived']), 'src/b.ts': fileEntry('b', ['Survived']) },
    };
    const fresh = { files: { 'src/a.ts': fileEntry('a2', ['Killed']) } };

    const { report } = mergeReports({ baseline, fresh });

    expect(Object.keys(report.files).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(report.files['src/b.ts'].source).toBe('b');
  });

  // A file the fresh run proves is gone must LEAVE the baseline. Carrying its
  // entry forward keeps its survivors in every future total, and no sweep can
  // ever retire them because the source they belong to does not exist.
  it('drops files named as deleted', () => {
    const baseline = {
      files: { 'src/a.ts': fileEntry('a', ['Survived']), 'src/gone.ts': fileEntry('g', ['Survived']) },
    };

    const { report } = mergeReports({ baseline, fresh: { files: {} }, deleted: ['src/gone.ts'] });

    expect(Object.keys(report.files)).toEqual(['src/a.ts']);
  });

  it('reports what it changed', () => {
    const baseline = {
      files: { 'src/a.ts': fileEntry('a', ['Survived']), 'src/gone.ts': fileEntry('g', ['Survived']) },
    };
    const fresh = { files: { 'src/a.ts': fileEntry('a2', ['Killed', 'Survived']) } };

    const { summary } = mergeReports({ baseline, fresh, deleted: ['src/gone.ts'] });

    expect(summary).toEqual({ replaced: 1, added: 0, dropped: 1, carried: 0 });
  });

  it('adds a file the baseline never measured', () => {
    const baseline = { files: { 'src/a.ts': fileEntry('a', ['Survived']) } };
    const fresh = { files: { 'src/new.ts': fileEntry('n', ['Survived']) } };

    const { report, summary } = mergeReports({ baseline, fresh });

    expect(summary.added).toBe(1);
    expect(report.files['src/new.ts'].source).toBe('n');
  });

  // The merged file is fed straight back to Stryker's own report consumers, so
  // the envelope has to stay the baseline's, not the scoped run's narrower one.
  it('keeps the baseline envelope, not the scoped one', () => {
    const baseline = { files: {}, schemaVersion: '2', thresholds: { high: 80 }, config: { mutate: ['**'] } };
    const fresh = { files: {}, schemaVersion: '2', thresholds: { high: 60 }, config: { mutate: ['src/a.ts'] } };

    const { report } = mergeReports({ baseline, fresh });

    expect(report.thresholds).toEqual({ high: 80 });
    expect(report.config).toEqual({ mutate: ['**'] });
  });

  // The merged file is handed back to Stryker's own report consumers, so it has
  // to stay a Stryker report. Counting how the merge went is our bookkeeping and
  // belongs beside the report, never inside it.
  it('keeps its own bookkeeping out of the report', () => {
    const baseline = { files: { 'src/a.ts': fileEntry('a', ['Survived']) }, schemaVersion: '2' };

    const { report } = mergeReports({ baseline, fresh: { files: {} } });

    expect(report).not.toHaveProperty('summary');
  });
});
