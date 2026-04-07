import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/cli/commands/migration', () => ({
  getMigrationDoc: vi.fn(() => 'mock migration content'),
}));

vi.mock('../../../src/cli/utils/output', () => ({
  writeOutput: vi.fn(),
}));

const mockJSDOM = vi.fn(function MockJSDOM() {
  return {
    window: {
      DOMParser: class MockDOMParser {},
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    },
  };
});

vi.mock('jsdom', () => ({
  JSDOM: mockJSDOM,
}));

vi.mock('../../../src/cli/commands/convert-html/index', () => ({
  convertHtml: vi.fn(() => '{"version":"2.31.0","blocks":[]}'),
}));

vi.mock('../../../src/cli/commands/convert-gdocs/index', () => ({
  convertGdocs: vi.fn(() => '{"version":"2.31.0","blocks":[]}'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();

  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn(() => '<p>test</p>'),
    },
    readFileSync: vi.fn(() => '<p>test</p>'),
  };
});

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

  it('runs migration command when --migration flag is present', async () => {
    await run(['--migration'], '1.0.0');

    expect(getMigrationDoc).toHaveBeenCalledWith('1.0.0');
    expect(writeOutput).toHaveBeenCalledWith('mock migration content', undefined);
  });

  it('passes --output value to writeOutput', async () => {
    await run(['--migration', '--output', 'guide.md'], '1.0.0');

    expect(writeOutput).toHaveBeenCalledWith('mock migration content', 'guide.md');
  });

  it('prints help when --help flag is present', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run(['--help'], '1.0.0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('blok-cli'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('--migration'));
    expect(getMigrationDoc).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  it('prints help when no flags are present', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run([], '1.0.0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));

    stdoutSpy.mockRestore();
  });

  it('sets up JSDOM globals when --convert-html flag is present', async () => {
    await run(['--convert-html'], '1.0.0');

    expect(mockJSDOM).toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledWith('{"version":"2.31.0","blocks":[]}', undefined);
  });

  it('routes --convert-gdocs to convertGdocs handler', async () => {
    await run(['--convert-gdocs'], '1.0.0');

    expect(mockJSDOM).toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledWith('{"version":"2.31.0","blocks":[]}', undefined);
  });

  it('passes --output value for --convert-gdocs', async () => {
    await run(['--convert-gdocs', '--output', 'out.json'], '1.0.0');

    expect(writeOutput).toHaveBeenCalledWith('{"version":"2.31.0","blocks":[]}', 'out.json');
  });
});
