import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Legacy-name law: after the @blok/* rebrand, the only places allowed to
 * mention the legacy personal scope are migration artifacts (the legacy
 * grammar the codemod rewrites FROM, codemod fixtures), historical
 * changelogs, and the release deprecation runbook. Everything else must use
 * the @blok/* family names.
 */
const ALLOWLIST: RegExp[] = [
  /^CHANGELOG\.md$/,
  /^packages\/cli\/CHANGELOG\.md$/,
  /^src\/cli\/.*legacy/,
  /^src\/cli\/codemod\//,
  /^packages\/cli\/(test\/)?fixtures\//,
  /^docs\/superpowers\//,
  /^scripts\/deprecate-legacy\.mjs$/,
  // Dropped to specific migration-doc paths in the final rebrand task:
  /^docs\//,
];

describe('@blok scope rename', () => {
  it('root package is @blok/core', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { name: string };

    expect(pkg.name).toBe('@blok/core');
  });

  it('core has no react peers or adapter exports; @blok/react is a workspace with hard peers', () => {
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

    expect(reactPkg.name).toBe('@blok/react');
    expect(reactPkg.peerDependencies).toMatchObject({
      'react': expect.any(String) as string,
      'react-dom': expect.any(String) as string,
      '@blok/core': expect.any(String) as string,
    });
    expect(reactPkg.peerDependenciesMeta).toBeUndefined();
  });

  it('core declares zero peer dependencies; @blok/vue is a workspace with hard peers', () => {
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

    expect(vuePkg.name).toBe('@blok/vue');
    expect(vuePkg.peerDependencies).toMatchObject({
      'vue': expect.any(String) as string,
      '@blok/core': expect.any(String) as string,
    });
    expect(vuePkg.peerDependenciesMeta).toBeUndefined();
  });

  it('@blok/angular is a workspace with hard peers; core has no ./angular export', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      exports: Record<string, unknown>;
    };

    expect(pkg.exports['./angular']).toBeUndefined();

    const ngPkg = JSON.parse(readFileSync('packages/angular/package.json', 'utf-8')) as {
      name: string;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: unknown;
    };

    expect(ngPkg.name).toBe('@blok/angular');
    expect(ngPkg.peerDependencies).toMatchObject({
      '@angular/core': expect.any(String) as string,
      '@blok/core': expect.any(String) as string,
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
