// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConfigError } from '../../../src/mcp/config';
import { parseCustomToolsFile, parseOverridesFile } from '../../../src/mcp/custom-tools-file';
import { readCustomToolsFile } from '../../../src/shared/custom-tools-file';

import type { BlokCustomToolsFile, ManifestOverrides, SnapshotBlockStatics } from '../../../types/tool-manifest';

const statics: SnapshotBlockStatics = {
  toolbox: [],
  richTextFields: ['body'],
  acceptsChildren: false,
  ownsChildren: false,
  isLayout: false,
  deletesChildren: false,
  selfPlacesChildren: false,
  restrictedInTableCell: false,
  conversion: {},
  convertible: { import: false, export: false },
  hasPrepareInsert: false,
};

const block: BlokCustomToolsFile['blocks'][number] = {
  name: 'callout_x',
  description: { summary: 'A callout.', data: { type: 'object' } },
  statics,
  sanitize: { body: { strong: true, a: { href: true } }, enabled: true },
};

const validFile: BlokCustomToolsFile = { formatVersion: 1, blocks: [block] };

const thrownBy = (operation: () => unknown): unknown => {
  try {
    operation();
  } catch (error) {
    return error;
  }

  throw new Error('Expected an error');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCustomToolsFile', () => {
  it('accepts a version 1 file without changing its description, statics or sanitizer', () => {
    const value = structuredClone(validFile);
    const before = structuredClone(value);
    const parsed = parseCustomToolsFile(value);

    expect(parsed).toEqual(before);
    expect(parsed).toEqual(readCustomToolsFile(value));
    expect(value).toEqual(before);
  });

  it('accepts an empty blocks list', () => {
    const value: BlokCustomToolsFile = { formatVersion: 1, blocks: [] };

    expect(parseCustomToolsFile(value)).toEqual(value);
  });

  const invalidFiles: Array<{ label: string; value: unknown; message: string }> = [
    { label: 'null root', value: null, message: 'Not a Blok custom tools file: /' },
    { label: 'array root', value: [], message: 'Not a Blok custom tools file: /' },
    { label: 'unsupported version', value: { formatVersion: 2, blocks: [] }, message: '/formatVersion' },
    { label: 'missing blocks', value: { formatVersion: 1 }, message: '/ missing required field "blocks"' },
    { label: 'non-array blocks', value: { formatVersion: 1, blocks: {} }, message: '/blocks' },
    {
      label: 'missing block name',
      value: { formatVersion: 1, blocks: [{ description: block.description, statics }] },
      message: '/blocks/0 missing required field "name"',
    },
    {
      label: 'missing description',
      value: { formatVersion: 1, blocks: [{ name: 'callout_x', statics }] },
      message: '/blocks/0 missing required field "description"',
    },
    {
      label: 'incomplete snapshot statics',
      value: { formatVersion: 1, blocks: [{ ...block, statics: {} }] },
      message: '/blocks/0/statics missing required field "toolbox"',
    },
    {
      label: 'non-object sanitizer',
      value: { formatVersion: 1, blocks: [{ ...block, sanitize: 'b' }] },
      message: '/blocks/0/sanitize',
    },
  ];

  it.each(invalidFiles)('wraps the shared validation error for a $label without losing its text', ({ value, message }) => {
    const sharedError = thrownBy(() => readCustomToolsFile(value));

    if (!(sharedError instanceof TypeError)) {
      throw new Error('Expected a shared validation TypeError');
    }

    const configError = thrownBy(() => parseCustomToolsFile(value));

    expect(configError).toBeInstanceOf(McpConfigError);
    if (!(configError instanceof McpConfigError)) {
      throw new Error('Expected an MCP configuration error');
    }
    expect(configError.message).toContain(sharedError.message);
    expect(sharedError.message).toContain(message);
  });
});

describe('parseOverridesFile', () => {
  it('accepts hidden, hiddenActions and guidance without changing them', () => {
    const value: ManifestOverrides = {
      table: { hidden: false, hiddenActions: ['mergeCells'], guidance: 'Prefer two columns.' },
      embed: { hidden: true },
    };
    const before = structuredClone(value);

    expect(parseOverridesFile(value)).toEqual(before);
    expect(value).toEqual(before);
  });

  it.each([{}, { table: {} }, { table: { hiddenActions: [], guidance: '' } }])
    ('accepts an empty override shape %j', (value) => {
      expect(parseOverridesFile(value)).toEqual(value);
    });

  const invalidOverrides: Array<{ label: string; value: unknown; path: string }> = [
    { label: 'null root', value: null, path: '$' },
    { label: 'array root', value: [], path: '$' },
    { label: 'string root', value: 'table', path: '$' },
    { label: 'null tool entry', value: { table: null }, path: '$.table' },
    { label: 'array tool entry', value: { table: [] }, path: '$.table' },
    { label: 'unknown key', value: { table: { hide: true } }, path: '$.table.hide' },
    { label: 'non-boolean hidden', value: { table: { hidden: 'yes' } }, path: '$.table.hidden' },
    { label: 'string hiddenActions', value: { table: { hiddenActions: 'mergeCells' } }, path: '$.table.hiddenActions' },
    { label: 'non-string action', value: { table: { hiddenActions: ['mergeCells', 1] } }, path: '$.table.hiddenActions' },
    { label: 'non-string guidance', value: { table: { guidance: false } }, path: '$.table.guidance' },
  ];

  it.each(invalidOverrides)('refuses a $label with a configuration error naming $path', ({ value, path }) => {
    const error = thrownBy(() => parseOverridesFile(value));

    expect(error).toBeInstanceOf(McpConfigError);
    if (!(error instanceof McpConfigError)) {
      throw new Error('Expected an MCP configuration error');
    }
    expect(error.message).toContain(path);
  });
});
