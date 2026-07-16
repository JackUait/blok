#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { gprPublishCommand } from './release.mjs';
import { collectGprRewriteFiles } from './release-manifest.mjs';

describe('gprPublishCommand', () => {
  it('builds a publish command targeting a .tgz tarball', () => {
    const cmd = gprPublishCommand({
      packJson: '[{"filename":"dodopizza-blok-0.10.0-beta.11.tgz"}]',
      packDir: '/tmp',
      tag: 'beta',
    });

    assert.match(cmd, /^npm publish \/tmp\/.*\.tgz --tag beta$/);
  });

  it('uses the filename from npm pack JSON output', () => {
    const cmd = gprPublishCommand({
      packJson: '[{"filename":"dodopizza-blok-1.0.0.tgz"}]',
      packDir: '/tmp',
      tag: 'latest',
    });

    assert.ok(
      cmd.includes('dodopizza-blok-1.0.0.tgz'),
      `should use filename from pack JSON, got: ${cmd}`
    );
  });

  it('joins packDir and filename into a full path', () => {
    const cmd = gprPublishCommand({
      packJson: '[{"filename":"dodopizza-blok-0.5.0.tgz"}]',
      packDir: '/var/folders/tmp',
      tag: 'beta',
    });

    assert.ok(
      cmd.startsWith('npm publish /var/folders/tmp/dodopizza-blok-0.5.0.tgz'),
      `should join packDir and filename, got: ${cmd}`
    );
  });
});

describe('collectGprRewriteFiles', () => {
  const roots = [];

  const makePackage = (manifest, files) => {
    const root = mkdtempSync(join(tmpdir(), 'blok-release-test-'));

    roots.push(root);

    for (const [relPath, content] of Object.entries(files)) {
      mkdirSync(join(root, relPath, '..'), { recursive: true });
      writeFileSync(join(root, relPath), content);
    }

    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));

    return root;
  };

  after(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('collects every file under the manifest `files` entries, recursively', () => {
    const root = makePackage(
      { name: '@bloklabs/react', files: ['dist', 'types', 'src'] },
      {
        'dist/index.mjs': 'import "@bloklabs/core";',
        'types/index.d.ts': 'import type { Blok } from "@bloklabs/core";',
        'src/hooks/useBlok.ts': 'import "@bloklabs/core/adapters";',
        'vite.config.mjs': 'not shipped',
      },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(collected.includes(join(root, 'dist/index.mjs')));
    assert.ok(collected.includes(join(root, 'types/index.d.ts')));
    assert.ok(collected.includes(join(root, 'src/hooks/useBlok.ts')));
    assert.ok(
      !collected.includes(join(root, 'vite.config.mjs')),
      'files outside the shipped `files` list must not be rewritten',
    );
  });

  it('never includes the manifest itself (prepareManifestForGpr owns it)', () => {
    const root = makePackage(
      { name: '@bloklabs/react', files: ['dist'] },
      { 'dist/index.mjs': 'code' },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(!collected.includes(join(root, 'package.json')));
  });

  it('walks the whole pack dir when the manifest has no `files` list', () => {
    const root = makePackage(
      { name: '@bloklabs/angular' },
      {
        'fesm2022/bloklabs-angular.mjs': 'import "@bloklabs/core";',
        'fesm2022/bloklabs-angular.mjs.map': '{"sourcesContent":["@bloklabs/core"]}',
        'index.d.ts': 'import "@bloklabs/core";',
      },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(collected.includes(join(root, 'fesm2022/bloklabs-angular.mjs')));
    assert.ok(collected.includes(join(root, 'fesm2022/bloklabs-angular.mjs.map')));
    assert.ok(collected.includes(join(root, 'index.d.ts')));
    assert.ok(!collected.includes(join(root, 'package.json')));
  });

  it('includes npm auto-included root docs (README, CHANGELOG, LICENSE, NOTICE)', () => {
    const root = makePackage(
      { name: '@bloklabs/core', files: ['dist'] },
      {
        'dist/blok.mjs': 'code',
        'README.md': 'install @bloklabs/core',
        'CHANGELOG.md': 'notes',
        'LICENSE': 'Apache-2.0',
        'NOTICE': 'notice',
      },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(collected.includes(join(root, 'README.md')));
    assert.ok(collected.includes(join(root, 'CHANGELOG.md')));
    assert.ok(collected.includes(join(root, 'LICENSE')));
    assert.ok(collected.includes(join(root, 'NOTICE')));
  });

  it('skips binary assets', () => {
    const root = makePackage(
      { name: '@bloklabs/core', files: ['dist'] },
      {
        'dist/blok.mjs': 'code',
        'dist/font.woff2': 'binary',
        'dist/img.png': 'binary',
      },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(collected.includes(join(root, 'dist/blok.mjs')));
    assert.ok(!collected.includes(join(root, 'dist/font.woff2')));
    assert.ok(!collected.includes(join(root, 'dist/img.png')));
  });

  it('tolerates `files` entries pointing at single files or missing paths', () => {
    const root = makePackage(
      { name: '@bloklabs/core', files: ['dist', 'NOTICE', 'not-built-yet'] },
      {
        'dist/blok.mjs': 'code',
        'NOTICE': 'notice',
      },
    );

    const collected = collectGprRewriteFiles({
      packDir: root,
      manifestPath: join(root, 'package.json'),
    });

    assert.ok(collected.includes(join(root, 'NOTICE')));
    assert.ok(collected.includes(join(root, 'dist/blok.mjs')));
  });
});
