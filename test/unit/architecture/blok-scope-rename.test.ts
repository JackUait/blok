import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Legacy-name law: after the @bloklabs/* rebrand, the only places allowed to
 * mention the legacy personal scope are migration artifacts (the legacy
 * grammar the codemod rewrites FROM, codemod fixtures), historical
 * changelogs, and the release deprecation runbook. Everything else must use
 * the @bloklabs/* family names.
 */
const ALLOWLIST: RegExp[] = [
  // README documents the rename itself ("renamed from …") for old-name arrivals.
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^packages\/cli\/CHANGELOG\.md$/,
  /^src\/cli\/.*legacy/,
  /^src\/cli\/codemod\//,
  /^packages\/cli\/(test\/)?fixtures\//,
  /^docs\/superpowers\//,
  /^scripts\/deprecate-legacy\.mjs$/,
];

describe('@blok scope rename', () => {
  it('root package is @bloklabs/core', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { name: string };

    expect(pkg.name).toBe('@bloklabs/core');
  });

  it('core has no react peers or adapter exports; @bloklabs/react is a workspace with hard peers', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      peerDependencies?: Record<string, string>;
      exports: Record<string, unknown>;
    };

    expect(pkg.peerDependencies?.react).toBeUndefined();
    expect(pkg.exports['./react']).toBeUndefined();

    const reactPkg = JSON.parse(readFileSync('packages/react/package.json', 'utf-8')) as {
      name: string;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: unknown;
    };

    expect(reactPkg.name).toBe('@bloklabs/react');
    expect(reactPkg.peerDependencies).toMatchObject({
      'react': expect.any(String) as string,
      'react-dom': expect.any(String) as string,
      '@bloklabs/core': expect.any(String) as string,
    });
    expect(reactPkg.peerDependenciesMeta).toBeUndefined();
  });

  it('core declares zero peer dependencies; @bloklabs/vue is a workspace with hard peers', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      peerDependencies?: unknown;
      peerDependenciesMeta?: unknown;
      exports: Record<string, unknown>;
    };

    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.peerDependenciesMeta).toBeUndefined();
    expect(pkg.exports['./vue']).toBeUndefined();

    const vuePkg = JSON.parse(readFileSync('packages/vue/package.json', 'utf-8')) as {
      name: string;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: unknown;
    };

    expect(vuePkg.name).toBe('@bloklabs/vue');
    expect(vuePkg.peerDependencies).toMatchObject({
      'vue': expect.any(String) as string,
      '@bloklabs/core': expect.any(String) as string,
    });
    expect(vuePkg.peerDependenciesMeta).toBeUndefined();
  });

  it('@bloklabs/angular is a workspace with hard peers; core has no ./angular export', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      exports: Record<string, unknown>;
    };

    expect(pkg.exports['./angular']).toBeUndefined();

    const ngPkg = JSON.parse(readFileSync('packages/angular/package.json', 'utf-8')) as {
      name: string;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: unknown;
    };

    expect(ngPkg.name).toBe('@bloklabs/angular');
    expect(ngPkg.peerDependencies).toMatchObject({
      '@angular/core': expect.any(String) as string,
      '@bloklabs/core': expect.any(String) as string,
    });
    expect(ngPkg.peerDependenciesMeta).toBeUndefined();
  });

  it('has no stray legacy-scope references outside the allowlist', () => {
    // Assembled at runtime so this file does not match its own search.
    const legacyScope = ['@jack', 'uait/'].join('');
    let files: string[] = [];

    try {
      files = execFileSync('git', ['grep', '-l', legacyScope], { encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean);
    } catch {
      // git grep exits 1 when there are no matches at all — that's a pass
    }

    const strays = files.filter((file) => !ALLOWLIST.some((pattern) => pattern.test(file)));

    expect(strays).toEqual([]);
  });
});
