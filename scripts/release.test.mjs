#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { gprPublishCommand } from './release.mjs';

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
