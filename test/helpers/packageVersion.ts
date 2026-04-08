import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo root — derived from this file's location.
 * This file is at test/helpers/packageVersion.ts
 * dirname(__filename) = test/helpers/
 * resolve(..., '../..') = repo root
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Read the `version` field from a package.json relative to the repo root.
 * Throws a descriptive error if the file is missing, malformed, or lacks a version field.
 */
export function readPackageVersion(relPath: string): string {
  const absPath = resolve(ROOT, relPath);
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to read or parse ${absPath}: ${(err as Error).message}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof (parsed as Record<string, unknown>).version !== 'string'
  ) {
    throw new Error(`No "version" string field found in ${absPath}`);
  }

  return (parsed as { version: string }).version;
}

export const ROOT_PACKAGE_VERSION = readPackageVersion('package.json');
