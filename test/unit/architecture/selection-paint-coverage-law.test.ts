import { describe, expect, it } from 'vitest';
import { defaultBlockTools } from '../../../src/tools';
import { CONTAINER_FIXTURES, FIXTURE_EXEMPTIONS, LEAF_FIXTURES } from '../../playwright/fixtures/selection-paint-fixtures';

/**
 * test/playwright/tests/ui/selection-paint-matrix.spec.ts checks the selection
 * tint on the pixels of every tool in its fixture table. A tool missing from
 * the table is never checked, so a new tool must join it or say why not.
 */
describe('every built-in block tool is in the selection-paint matrix', () => {
  it('has a fixture or a stated exemption', () => {
    const covered = new Set([ ...LEAF_FIXTURES, ...CONTAINER_FIXTURES ].map((fixture) => fixture.tool));
    const missing = Object.keys(defaultBlockTools).filter((tool) => !covered.has(tool) && FIXTURE_EXEMPTIONS[tool] === undefined);

    expect(missing).toEqual([]);
  });

  it('exempts only tools that exist, each with a reason', () => {
    const stale = Object.entries(FIXTURE_EXEMPTIONS).filter(([ tool, reason ]) => !(tool in defaultBlockTools) || reason.trim().length < 10);

    expect(stale).toEqual([]);
  });
});
