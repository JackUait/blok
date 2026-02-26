import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/cli/commands/migrationContent', () => ({
  migrationContent: '# Fake Migration Content\n\nSome content here.',
}));

import { getMigrationDoc } from '../../../../src/cli/commands/migration';

describe('cli/commands/migration', () => {
  it('returns migration content with LLM preamble', () => {
    const result = getMigrationDoc('1.0.0');

    expect(result).toContain('# Blok Migration Guide (for LLM-assisted migration)');
    expect(result).toContain('Current Blok version: 1.0.0');
    expect(result).toContain('# Fake Migration Content');
  });

  it('includes instruction for LLMs in the preamble', () => {
    const result = getMigrationDoc('1.0.0');

    expect(result).toContain('Apply these changes systematically');
  });

  it('separates preamble from content with horizontal rule', () => {
    const result = getMigrationDoc('1.0.0');
    const parts = result.split('---');

    expect(parts.length).toBeGreaterThanOrEqual(2);
  });
});
