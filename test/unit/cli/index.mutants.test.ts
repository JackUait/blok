import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mutation-targeted coverage for `src/cli/index.ts`.
 *
 * Every live mutant recorded for this file is killed here; no survivor is left,
 * so this block carries no equivalence proofs.
 */

const HTML_JSON = '{"source":"html"}';
const GDOCS_JSON = '{"source":"gdocs"}';
const STDIN_HTML = '<p>test</p>';

const mocks = vi.hoisted(() => ({
  // A plain function, not an arrow: the CLI calls it with `new`.
  jsdomCtor: vi.fn(function mockJsdom() {
    return {
      window: {
        DOMParser: class MockDOMParser {},
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
        // Handed back so the gdocs branch does not blank out jsdom's own
        // `globalThis.document` for the rest of this file.
        document: globalThis.document,
      },
    };
  }),
  convertHtml: vi.fn(() => '{"source":"html"}'),
  convertGdocs: vi.fn(() => '{"source":"gdocs"}'),
  readFileSync: vi.fn(() => '<p>test</p>'),
  writeOutput: vi.fn(),
  getMigrationDoc: vi.fn(() => 'migration doc'),
}));

vi.mock('jsdom', () => ({ JSDOM: mocks.jsdomCtor }));
vi.mock('../../../src/cli/commands/convert-html/index', () => ({ convertHtml: mocks.convertHtml }));
vi.mock('../../../src/cli/commands/convert-gdocs/index', () => ({ convertGdocs: mocks.convertGdocs }));
vi.mock('../../../src/cli/commands/migration', () => ({ getMigrationDoc: mocks.getMigrationDoc }));
vi.mock('../../../src/cli/utils/output', () => ({ writeOutput: mocks.writeOutput }));
vi.mock('node:fs', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();

  return {
    ...actual,
    default: { ...actual, readFileSync: mocks.readFileSync },
    readFileSync: mocks.readFileSync,
  };
});

import { run } from '../../../src/cli/index';

describe('cli/index mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes --convert-html to the html converter and never to the gdocs one', async () => {
    await run(['--convert-html'], '1.0.0');

    expect(mocks.convertHtml).toHaveBeenCalledWith(STDIN_HTML);
    expect(mocks.convertGdocs).not.toHaveBeenCalled();
    expect(mocks.writeOutput).toHaveBeenCalledWith(HTML_JSON, undefined);
  });

  it('routes --convert-gdocs to the gdocs converter and never to the html one', async () => {
    await run(['--convert-gdocs'], '1.0.0');

    expect(mocks.convertGdocs).toHaveBeenCalledWith(STDIN_HTML);
    expect(mocks.convertHtml).not.toHaveBeenCalled();
    expect(mocks.writeOutput).toHaveBeenCalledWith(GDOCS_JSON, undefined);
  });

  it('seeds an empty JSDOM and reads fd 0 as utf-8 for --convert-html', async () => {
    await run(['--convert-html'], '1.0.0');

    expect(mocks.jsdomCtor).toHaveBeenCalledWith('');
    expect(mocks.readFileSync).toHaveBeenCalledWith(0, 'utf-8');
  });

  it('seeds an empty JSDOM and reads fd 0 as utf-8 for --convert-gdocs', async () => {
    await run(['--convert-gdocs'], '1.0.0');

    expect(mocks.jsdomCtor).toHaveBeenCalledWith('');
    expect(mocks.readFileSync).toHaveBeenCalledWith(0, 'utf-8');
  });

  it('takes the argument AFTER --output as the convert-html destination', async () => {
    await run(['--convert-html', '--output', 'out.json'], '1.0.0');

    expect(mocks.writeOutput).toHaveBeenCalledWith(HTML_JSON, 'out.json');
  });

  it('lets --help win over a command flag that appears later', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run(['--help', '--migration'], '1.0.0');

    expect(mocks.getMigrationDoc).not.toHaveBeenCalled();
    expect(mocks.writeOutput).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Usage: blok-cli'));

    stdout.mockRestore();
  });
});
