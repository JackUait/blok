import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/cli/commands/migrationContent', () => ({
  migrationContent: '# Migrating from EditorJS to Blok\n\nThis guide covers the breaking changes.',
}));

import { run } from '../../../src/cli/index';

describe('cli integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('--migration outputs complete document to stdout', () => {
    const chunks: string[] = [];

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));

      return true;
    });

    run(['--migration'], '0.6.0-beta.5');

    const output = chunks.join('');

    expect(output).toContain('# Blok Migration Guide (for LLM-assisted migration)');
    expect(output).toContain('Current Blok version: 0.6.0-beta.5');
    expect(output).toContain('# Migrating from EditorJS to Blok');
    expect(output).toContain('This guide covers the breaking changes');
  });

  it('--help lists all available commands', () => {
    const chunks: string[] = [];

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));

      return true;
    });

    run(['--help'], '0.6.0-beta.5');

    const output = chunks.join('');

    expect(output).toContain('--migration');
    expect(output).toContain('--output');
    expect(output).toContain('--help');
  });
});
