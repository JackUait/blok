import { readFile } from 'node:fs/promises';

import type { McpContractFlags } from '../view/mcp-contracts';

import { McpConfigError } from './config';
import type { ParsedCli } from './config';
import { parseCustomToolsFile, parseOverridesFile } from './custom-tools-file';
import { DEFAULTS } from './options';
import type { BlokMcpOptions } from './options';

// The MCP conformance harness uses this module to work out the contractRevision Node reports.

const readJsonFile = async (path: string): Promise<unknown> => {
  const text = await readFile(path, 'utf-8').catch((thrown: unknown) => {
    if (thrown instanceof Error && 'code' in thrown && thrown.code === 'ENOENT') {
      throw new McpConfigError(`Cannot read "${path}": no such file`);
    }
    throw thrown;
  });

  try {
    const value: unknown = JSON.parse(text);

    return value;
  } catch (thrown) {
    if (thrown instanceof SyntaxError) {
      throw new McpConfigError(`Invalid JSON in "${path}": ${thrown.message}`);
    }
    throw thrown;
  }
};

/** The --manifest and --manifest-overrides files, read and checked. */
export const readManifestFiles = async (files: ParsedCli['files']): Promise<Pick<BlokMcpOptions, 'manifest' | 'overrides'>> => ({
  ...(files.manifest !== undefined && { manifest: parseCustomToolsFile(await readJsonFile(files.manifest)) }),
  ...(files.overrides !== undefined && { overrides: parseOverridesFile(await readJsonFile(files.overrides)) }),
});

/** The start options the contracts depend on. createSource gives null only when no source is set. */
export const contractFlagsOf = (
  options: Pick<BlokMcpOptions, 'manifest' | 'overrides' | 'pageTitles' | 'richTextFields' | 'sync' | 'source' | 'uploads' | 'comments'>
): McpContractFlags => ({
  manifest: options.manifest,
  overrides: options.overrides,
  pageTitles: options.pageTitles ?? DEFAULTS.pageTitles,
  richTextFields: options.richTextFields,
  sync: options.sync !== undefined,
  source: options.source !== undefined,
  uploads: options.uploads !== undefined,
  comments: options.comments,
});
