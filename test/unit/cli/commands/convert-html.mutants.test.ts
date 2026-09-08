import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertHtml } from '../../../../src/cli/commands/convert-html/index';
import { ROOT_PACKAGE_VERSION } from '../../../helpers/packageVersion';

/**
 * Mutation-coverage tests for `src/cli/commands/convert-html/index.ts`.
 *
 * No mutants are left alive in this file.
 *
 * All three sat on `typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ :
 * 'dev'`. Vitest supplies `__CLI_VERSION__` as a runtime global, so the guard is
 * a live check here and stubbing the global away is what reaches the fallback.
 * With the guard forced true the version reads back as `undefined` and
 * `JSON.stringify` drops the key entirely, which is why the assertions check the
 * key is present with the expected value rather than only comparing it.
 */

interface Converted {
  version?: string;
  blocks: { type: string; data: Record<string, unknown> }[];
}

const isConverted = (value: unknown): value is Converted =>
  typeof value === 'object' && value !== null && Array.isArray((value as Converted).blocks);

const convert = (html: string): Converted => {
  const parsed: unknown = JSON.parse(convertHtml(html));

  if (!isConverted(parsed)) {
    throw new Error('convertHtml did not emit an OutputData document');
  }

  return parsed;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('convertHtml mutants - version stamp', () => {
  it('stamps the build-time version', () => {
    const output = convert('<p>x</p>');

    expect('version' in output).toBe(true);
    expect(output.version).toBe(ROOT_PACKAGE_VERSION);
  });

  it('falls back to dev when no build-time version was injected', () => {
    vi.stubGlobal('__CLI_VERSION__', undefined);

    const output = convert('<p>x</p>');

    expect('version' in output).toBe(true);
    expect(output.version).toBe('dev');
  });

  it('stamps the version even on an empty document', () => {
    const output = convert('');

    expect(output.blocks).toEqual([]);
    expect(output.version).toBe(ROOT_PACKAGE_VERSION);
  });
});
