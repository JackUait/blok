import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { writeOutput } from '../../../../src/cli/utils/output';

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: vi.fn(),
    },
    writeFileSync: vi.fn(),
  };
});

describe('cli/utils/output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes content to stdout when no outputPath given', () => {
    writeOutput('hello world');

    expect(stdoutSpy).toHaveBeenCalledWith('hello world');
  });

  it('writes content to file when outputPath is given', () => {
    writeOutput('hello world', 'output.md');

    expect(fs.writeFileSync).toHaveBeenCalledWith('output.md', 'hello world', 'utf-8');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('logs success message to stderr when writing to file', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeOutput('content', 'output.md');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('output.md'));

    stderrSpy.mockRestore();
  });
});
