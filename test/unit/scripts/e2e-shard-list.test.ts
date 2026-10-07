// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assignShards, parseShard } from '../../../scripts/e2e-shard-list.mjs';
import { parseSpecSeconds } from '../../../scripts/e2e-shard-seconds.mjs';

const load = (files: string[], seconds: Record<string, number>): number =>
  files.reduce((sum, file) => sum + (seconds[file] ?? 0), 0);

describe('assignShards', () => {
  it('puts every spec file in exactly one shard', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts', 'e.spec.ts', 'new.spec.ts'];
    const shards = assignShards(files, { 'a.spec.ts': 5, 'b.spec.ts': 4, 'c.spec.ts': 3, 'd.spec.ts': 2, 'e.spec.ts': 1 }, 3);

    expect(shards.flat().sort()).toEqual([...files].sort());
    expect(shards).toHaveLength(3);
  });

  // Playwright's own --shard takes contiguous runs, so one slow folder lands in one shard.
  it('balances by measured seconds, not by position', () => {
    const seconds = { 'slow/1.spec.ts': 100, 'slow/2.spec.ts': 100, 'fast/1.spec.ts': 10, 'fast/2.spec.ts': 10, 'fast/3.spec.ts': 10, 'fast/4.spec.ts': 10 };
    const shards = assignShards(Object.keys(seconds), seconds, 2);
    const loads = shards.map((files) => load(files, seconds));

    expect(loads).toEqual([120, 120]);
  });

  it('weighs a spec with no timing as the median spec', () => {
    const seconds = { 'a.spec.ts': 9, 'b.spec.ts': 3, 'c.spec.ts': 1 };
    const shards = assignShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts'], seconds, 2);

    expect(shards).toEqual([['a.spec.ts'], ['b.spec.ts', 'new.spec.ts', 'c.spec.ts']]);
  });

  // Every shard job computes its own slice, so all of them must agree.
  it('gives the same split whatever order the files arrive in', () => {
    const seconds = { 'a.spec.ts': 2, 'b.spec.ts': 2, 'c.spec.ts': 2, 'd.spec.ts': 2 };

    expect(assignShards(['d.spec.ts', 'c.spec.ts', 'b.spec.ts', 'a.spec.ts'], seconds, 2))
      .toEqual(assignShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'], seconds, 2));
  });
});

describe('parseShard', () => {
  it('reads a 1-based shard fraction', () => {
    expect(parseShard('2/3')).toEqual({ index: 2, total: 3 });
  });

  it.each(['0/3', '4/3', '1', 'a/b'])('rejects %s', (value) => {
    expect(() => parseShard(value)).toThrow();
  });
});

describe('parseSpecSeconds', () => {
  it('sums each spec file per project from a Playwright list-reporter log', () => {
    const log = [
      '2026-10-07T08:58:40.6Z   ✓    1 [chromium-undo] › test/playwright/tests/undo-audit/w4.spec.ts:559:9 › W4 › one (2.9s)',
      '2026-10-07T08:58:40.8Z   ✓    3 [chromium-undo] › test/playwright/tests/undo-audit/w4.spec.ts:330:7 › W4 › two (310ms)',
      '2026-10-07T08:58:41.3Z   ✘    2 [chromium] › test/playwright/tests/a.spec.ts:7:7 › a › retried (1.2m)',
      '2026-10-07T08:58:41.4Z   -    4 [chromium] › test/playwright/tests/a.spec.ts:9:7 › a › skipped',
      '2026-10-07T08:58:41.5Z   1 passed (1.8m)',
    ].join('\n');

    expect(parseSpecSeconds(log)).toEqual({
      'chromium-undo': { 'undo-audit/w4.spec.ts': 3.21 },
      chromium: { 'a.spec.ts': 72 },
    });
  });

  it('reads through colour codes', () => {
    const log = '2026-10-07T08:58:40Z   \u001b[32m✓\u001b[39m  \u001b[2m1\u001b[22m \u001b[2m[firefox] › test/playwright/tests/b.spec.ts:3:5 › b\u001b[22m\u001b[2m (4.5s)\u001b[22m';

    expect(parseSpecSeconds(log)).toEqual({ firefox: { 'b.spec.ts': 4.5 } });
  });
});
