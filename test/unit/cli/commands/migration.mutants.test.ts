import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/cli/commands/migrationContent', () => ({
  migrationContent: '# Body\n',
}));

import { getMigrationDoc } from '../../../../src/cli/commands/migration';

/**
 * Mutation-coverage tests for `src/cli/commands/migration.ts`.
 *
 * The preamble is a document an LLM reads top to bottom, so its blank lines and
 * line breaks carry meaning: a dropped separator glues the version line onto the
 * horizontal rule, and a dropped blank line runs the heading into the prose.
 * Only an exact-string assertion sees that, which is why these tests compare the
 * whole emitted preamble rather than probing it with `toContain`.
 *
 * No mutants are left alive in this file.
 */

const EXPECTED_PREAMBLE = [
  '# Blok Migration Guide (for LLM-assisted migration)',
  '',
  '> This document contains everything needed to migrate a project from EditorJS to Blok.',
  '> Apply these changes systematically to the user\'s codebase.',
  '> Current Blok version: 9.9.9',
  '',
  '---',
  '',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getMigrationDoc mutants', () => {
  it('emits the preamble verbatim, then the migration body', () => {
    expect(getMigrationDoc('9.9.9')).toBe(`${EXPECTED_PREAMBLE}# Body\n`);
  });

  it('keeps every preamble line on its own line', () => {
    const lines = getMigrationDoc('9.9.9').split('\n');

    expect(lines.slice(0, 8)).toEqual([
      '# Blok Migration Guide (for LLM-assisted migration)',
      '',
      '> This document contains everything needed to migrate a project from EditorJS to Blok.',
      '> Apply these changes systematically to the user\'s codebase.',
      '> Current Blok version: 9.9.9',
      '',
      '---',
      '# Body',
    ]);
  });

  it('interpolates the version it was given', () => {
    expect(getMigrationDoc('0.0.1-beta.2')).toContain('> Current Blok version: 0.0.1-beta.2\n');
  });
});
