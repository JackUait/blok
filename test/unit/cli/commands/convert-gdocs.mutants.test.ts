import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertGdocs } from '../../../../src/cli/commands/convert-gdocs/index';
import { ROOT_PACKAGE_VERSION } from '../../../helpers/packageVersion';

/**
 * Mutation-coverage tests for `src/cli/commands/convert-gdocs/index.ts`.
 *
 * No mutants are left alive in this file.
 *
 * Vitest supplies `__CLI_VERSION__` as a runtime global, so the
 * `typeof … !== 'undefined'` guard is a live check here: stubbing the global
 * away is what exercises the `dev` fallback.
 */

/** Wraps markup the way Google Docs wraps a clipboard payload. */
const gdocs = (html: string): string => `<b id="docs-internal-guid-test">${html}</b>`;

interface ConvertedBlock {
  type: string;
  data: Record<string, unknown>;
}

interface Converted {
  version?: string;
  blocks: ConvertedBlock[];
}

const isConverted = (value: unknown): value is Converted =>
  typeof value === 'object' && value !== null && Array.isArray((value as Converted).blocks);

const convert = (html: string): Converted => {
  const parsed: unknown = JSON.parse(convertGdocs(html));

  if (!isConverted(parsed)) {
    throw new Error('convertGdocs did not emit an OutputData document');
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

describe('convertGdocs mutants - version stamp', () => {
  it('stamps the build-time version', () => {
    expect(convert(gdocs('<p>text</p>')).version).toBe(ROOT_PACKAGE_VERSION);
  });

  it('falls back to dev when no build-time version was injected', () => {
    vi.stubGlobal('__CLI_VERSION__', undefined);

    expect(convert(gdocs('<p>text</p>')).version).toBe('dev');
  });
});

describe('convertGdocs mutants - shared HTML preprocess pass', () => {
  it('turns bullet paragraphs into list blocks', () => {
    const blocks = convert(gdocs('<p>&bull; first</p><p>&bull; second</p>')).blocks;

    expect(blocks.map((block) => block.type)).toEqual(['list', 'list']);
    expect(blocks.map((block) => block.data.text)).toEqual(['first', 'second']);
  });

  it('rewrites legacy strikethrough before the sanitizer can drop it', () => {
    const blocks = convert(gdocs('<p><del>gone</del> kept</p>')).blocks;

    expect(blocks[0].data.text).toBe('<s>gone</s> kept');
  });

  it('removes non-breaking-space spacer paragraphs', () => {
    const blocks = convert(gdocs('<p>a</p><p>&nbsp;</p><p>b</p>')).blocks;

    expect(blocks.map((block) => block.data.text)).toEqual(['a', 'b']);
  });
});
