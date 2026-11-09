import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bumpCargoWorkspaceVersion,
  isNewCrateRateLimit,
  publishOrder,
  publishedCrates,
} from '../../../scripts/release-cargo.mjs';

const WORKSPACE = `[workspace.package]
edition = "2024"
version = "2.1.0"
publish = false

[workspace.dependencies]
blok-a = { path = "crates/a", version = "=2.1.0" }
blok-b = { path = "crates/b", version = "=2.1.0" }
serde = "1.0.0"
`;

describe('bumpCargoWorkspaceVersion', () => {
  it('moves the workspace version and every blok pin to the release', () => {
    const bumped = bumpCargoWorkspaceVersion(WORKSPACE, '2.2.0');

    expect(bumped).toContain('version = "2.2.0"\npublish = false');
    expect(bumped).toContain('blok-a = { path = "crates/a", version = "=2.2.0" }');
    expect(bumped).toContain('blok-b = { path = "crates/b", version = "=2.2.0" }');
    expect(bumped).toContain('serde = "1.0.0"');
    expect(bumped).toContain('edition = "2024"');
  });

  it('refuses a workspace it cannot bump', () => {
    expect(() => bumpCargoWorkspaceVersion('[workspace]\n', '2.2.0')).toThrow();
  });
});

describe('publishedCrates', () => {
  it('lists the crates pinned in workspace.dependencies', () => {
    expect(publishedCrates(WORKSPACE)).toEqual(['blok-a', 'blok-b']);
  });
});

describe('publishOrder', () => {
  it('puts each crate after the crates it needs', () => {
    const order = publishOrder({ 'blok-mcp': ['blok-a', 'blok-b'], 'blok-b': ['blok-a'], 'blok-a': [] });

    expect(order).toEqual(['blok-a', 'blok-b', 'blok-mcp']);
  });

  it('refuses a cycle', () => {
    expect(() => publishOrder({ 'blok-a': ['blok-b'], 'blok-b': ['blok-a'] })).toThrow(/cycle/);
  });
});

describe('isNewCrateRateLimit', () => {
  it('spots crates.io refusing a burst of new crates', () => {
    expect(isNewCrateRateLimit('error: failed to publish: the remote server responded with an error (status 429 Too Many Requests): You have published too many new crates in a short period of time. Please try again after Mon, 09 Nov 2026 12:30:00 GMT')).toBe(true);
    expect(isNewCrateRateLimit('error: crate blok-a@2.2.0 already exists')).toBe(false);
  });
});

describe('release.mjs and the Rust workspace', () => {
  const source = readFileSync(join(__dirname, '../../../scripts/release.mjs'), 'utf-8');

  it('bumps the Rust workspace and refreshes Cargo.lock', () => {
    expect(source).toContain('bumpCargoWorkspaceVersion(');
    expect(source).toContain('cargo update --workspace --offline');
  });

  it('commits and restores the Rust manifest and lock with the rest', () => {
    expect(source).toMatch(/git add [^\n]*RUST_RELEASE_FILES/);
    expect(source).toMatch(/git checkout -- [^\n]*RUST_RELEASE_FILES/);
  });
});
