import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/cli/commands/migration', () => ({
  getMigrationDoc: vi.fn(() => 'mock migration content'),
}));

vi.mock('../../../src/cli/utils/output', () => ({
  writeOutput: vi.fn(),
}));

import { run } from '../../../src/cli/index';
import { getMigrationDoc } from '../../../src/cli/commands/migration';
import { writeOutput } from '../../../src/cli/utils/output';

describe('cli/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs migration command when --migration flag is present', () => {
    run(['--migration'], '1.0.0');

    expect(getMigrationDoc).toHaveBeenCalledWith('1.0.0');
    expect(writeOutput).toHaveBeenCalledWith('mock migration content', undefined);
  });

  it('passes --output value to writeOutput', () => {
    run(['--migration', '--output', 'guide.md'], '1.0.0');

    expect(writeOutput).toHaveBeenCalledWith('mock migration content', 'guide.md');
  });

  it('prints help when --help flag is present', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    run(['--help'], '1.0.0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('--migration'));
    expect(getMigrationDoc).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  it('prints help when no flags are present', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    run([], '1.0.0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));

    stdoutSpy.mockRestore();
  });
});
