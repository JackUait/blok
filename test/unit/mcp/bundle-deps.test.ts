// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PACKAGE_DIR = resolve(__dirname, '../../../packages/mcp');
const DIST = resolve(PACKAGE_DIR, 'dist');

const packageName = (specifier: string): string => {
  const segments = specifier.split('/');

  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
};

const bareImports = (file: string): string[] =>
  ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles
    .map(({ fileName }) => fileName)
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:'));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp bundle', () => {
  it('imports only packages its manifest declares (requires yarn build:mcp)', () => {
    expect(existsSync(DIST), 'packages/mcp/dist must exist').toBe(true);

    const files = readdirSync(DIST).filter((name) => name.endsWith('.mjs'));
    const manifest: unknown = JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf8'));
    const dependencies = typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
      && typeof manifest.dependencies === 'object' && manifest.dependencies !== null
      ? Object.keys(manifest.dependencies)
      : [];
    const undeclared = [...new Set(files.flatMap((name) => bareImports(resolve(DIST, name)).map(packageName)))]
      .filter((name) => !dependencies.includes(name))
      .sort();

    expect(files).toContain('mcp.mjs');
    expect(undeclared).toEqual([]);
  });
});
