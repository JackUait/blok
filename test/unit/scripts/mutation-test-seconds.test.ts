// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseFileSeconds } from '../../../scripts/mutation-test-seconds.mjs';

describe('parseFileSeconds', () => {
  it('reads each test file and its time from a CI vitest log', () => {
    const log = [
      '2026-09-28T02:53:57.7560727Z  ✓  unit  test/unit/a.test.ts (71 tests) 805ms',
      '2026-09-28T02:53:58.8196807Z  ✓  unit  test/unit/b/c.test.tsx (2 tests | 1 skipped) 1.5s',
      '2026-09-28T02:53:59.0000000Z  ×  unit  test/unit/d.test.ts (3 tests | 1 failed) 20ms',
      '2026-09-28T02:53:59.0000000Z ✓ built in 49ms',
    ].join('\n');

    expect(parseFileSeconds(log)).toEqual({
      'test/unit/a.test.ts': 0.805,
      'test/unit/b/c.test.tsx': 1.5,
      'test/unit/d.test.ts': 0.02,
    });
  });

  // Raw CI logs colour the marker and the project name.
  it('reads through colour codes', () => {
    const log = '2026-09-28T02:53:57Z \u001b[32m✓\u001b[39m \u001b[30;46m unit \u001b[49;39m test/unit/a.test.ts \u001b[2m(71 tests)\u001b[22m\u001b[33m 805\u001b[2mms\u001b[22m\u001b[39m';

    expect(parseFileSeconds(log)).toEqual({ 'test/unit/a.test.ts': 0.805 });
  });
});
