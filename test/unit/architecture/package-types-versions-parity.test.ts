import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `exports` subpaths are invisible to consumers on `moduleResolution: "node"` —
 * that resolver never reads `exports`, only `typesVersions`. Ship an entry point
 * in `exports` without a matching `typesVersions` mapping and every such
 * consumer gets TS2307 on an entry point the package otherwise advertises
 * (this is exactly what happened to `./migrate`).
 *
 * This law makes the omission a red test: every `exports` subpath that declares
 * `types` MUST have a `typesVersions["*"]` entry pointing at the same file.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  typesVersions?: Record<string, Record<string, string[]>>;
};

const subpathTypes = (): Array<{ subpath: string; types: string }> => {
  return Object.entries(packageJson.exports)
    .filter(([subpath]) => subpath !== '.' && !subpath.includes('*'))
    .flatMap(([subpath, value]) => {
      const types = typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>).types
        : undefined;

      return typeof types === 'string' ? [{ subpath, types }] : [];
    });
};

describe('package.json typesVersions ↔ exports parity law', () => {
  it('maps every typed exports subpath in typesVersions', () => {
    const mappings = packageJson.typesVersions?.['*'] ?? {};

    const missing = subpathTypes()
      .map(({ subpath }) => subpath.replace(/^\.\//, ''))
      .filter((key) => mappings[key] === undefined);

    expect(
      missing,
      `typesVersions["*"] is missing entries for: ${missing.join(', ')} — ` +
      'consumers on moduleResolution "node" get TS2307 for these entry points'
    ).toEqual([]);
  });

  it('points each typesVersions entry at the same file as its exports "types"', () => {
    const mappings = packageJson.typesVersions?.['*'] ?? {};

    const mismatched = subpathTypes().filter(({ subpath, types }) => {
      const key = subpath.replace(/^\.\//, '');
      const mapped = mappings[key]?.[0];

      return mapped !== undefined && mapped !== types;
    });

    expect(mismatched, 'typesVersions and exports.types disagree').toEqual([]);
  });
});
