import { readCustomToolsFile } from '../shared/custom-tools-file';
import { McpConfigError } from './config';

import type { BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail: (path: string, message: string) => never = (path, message) => {
  throw new McpConfigError(`Invalid file at ${path}: ${message}`);
};

export const parseCustomToolsFile = (value: unknown): BlokCustomToolsFile => {
  try {
    return readCustomToolsFile(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new McpConfigError(`Invalid --manifest file: ${error.message}`);
    }
    throw error;
  }
};

const OVERRIDE_KEYS = new Set(['hidden', 'hiddenActions', 'guidance']);

const assertOverrides: (value: unknown) => asserts value is ManifestOverrides = (value) => {
  if (!isRecord(value)) {
    fail('$', 'expected an object');
  }
  for (const [tool, entry] of Object.entries(value)) {
    const at = `$.${tool}`;

    if (!isRecord(entry)) {
      fail(at, 'expected an object');
    }
    const unknownKey = Object.keys(entry).find(key => !OVERRIDE_KEYS.has(key));

    if (unknownKey !== undefined) {
      fail(`${at}.${unknownKey}`, 'unknown key');
    }
    if (entry.hidden !== undefined && typeof entry.hidden !== 'boolean') {
      fail(`${at}.hidden`, 'expected a boolean');
    }
    if (entry.hiddenActions !== undefined
      && !(Array.isArray(entry.hiddenActions) && entry.hiddenActions.every((name: unknown) => typeof name === 'string'))) {
      fail(`${at}.hiddenActions`, 'expected an array of strings');
    }
    if (entry.guidance !== undefined && typeof entry.guidance !== 'string') {
      fail(`${at}.guidance`, 'expected a string');
    }
  }
};

export const parseOverridesFile = (value: unknown): ManifestOverrides => {
  assertOverrides(value);

  return value;
};
