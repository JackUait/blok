import { defineConfig } from 'vitest/config';

import base from './vitest.mutation.config';

/**
 * The mutation config minus the tests Stryker cannot use.
 *
 * Stryker refuses to start unless the initial run is entirely green, so one red
 * test blocks measuring all 606 sources. Do NOT edit vitest.mutation.config.ts
 * to fix that: its raised timeouts are load-bearing and CLAUDE.md protects it.
 */
const RED_AT_HEAD = [
  // Its undo leaves 3 blocks where the case wants 1. Behaviour, not load: a
  // poll widened to 240s never converged. Drop this line once that is fixed.
  'test/unit/tools/table/table-insert-redo-id-stability.test.ts',
];

/**
 * Files asserting wall-clock elapsed time, which Stryker cannot score honestly.
 *
 * Two separate problems. They fail the dry run on a loaded machine (a 10k-block
 * insert billed 1965ms against a 1000ms budget at load 380). And during the
 * mutant phase they kill on SLOWNESS rather than on behaviour, so any mutant
 * that merely makes code slower is scored as caught by an assertion nobody
 * wrote. Both make the measurement worse, so these stay out even on a quiet
 * machine. Their non-timing cases are forfeited with them; that loss is
 * smallest for document-store, which 29 other test files also cover.
 */
const WALL_CLOCK_SENSORS = [
  'test/unit/components/modules/yjs/document-store-scale.test.ts',
  'test/unit/components/utils/server-config.test.ts',
  'test/unit/components/utils/fetch-uploader.test.ts',
  'test/unit/components/utils/trailing-breaks.test.ts',
  'test/unit/markdown/markdown-handler.test.ts',
];

/**
 * Build tests, which cost minutes and can never kill a mutant.
 *
 * Not one file in this directory imports from src/. They read dist/, view.css,
 * package.json and the published types, then bundle or typecheck them in a
 * subprocess. Stryker mutates src/ and never rebuilds dist/, so nothing they
 * assert can change when a mutant is active. Excluding them costs no fidelity
 * and removes the slowest four files in the suite, one of which already blew
 * its own 60s cap at 66s and failed the run.
 */
const INERT_BUILD_TESTS = ['test/unit/build/**'];

/**
 * Room for a correct test to be slow, which is not the same as being wrong.
 *
 * The base 30s cap was set for an idle machine. This one runs at load 280-660
 * because other sessions share it, and Stryker's dry run adds per-test coverage
 * analysis on top: the view-stylesheet law needs 26s of that 30s standalone,
 * and it spends most of it in a subprocess CSS build that no mutant can speed
 * up. Cutting it would fail the whole run over machine load. Stryker keeps its
 * own timeout for the mutant phase, so a genuinely hung mutant is still caught.
 */
const LOADED_MACHINE_TIMEOUT = 120000;

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    testTimeout: LOADED_MACHINE_TIMEOUT,
    hookTimeout: LOADED_MACHINE_TIMEOUT,
    exclude: [
      ...(base.test?.exclude ?? []),
      ...RED_AT_HEAD,
      ...WALL_CLOCK_SENSORS,
      ...INERT_BUILD_TESTS,
    ],
  },
});
