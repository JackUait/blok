import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readVersion(pkgPath: string): string {
  return JSON.parse(readFileSync(resolve(ROOT, pkgPath), 'utf-8')).version as string;
}

describe('package version parity', () => {
  it('packages/cli/package.json version matches root package.json version', () => {
    const rootVersion = readVersion('package.json');
    const cliVersion = readVersion('packages/cli/package.json');

    expect(cliVersion).toBe(rootVersion);
  });
});
