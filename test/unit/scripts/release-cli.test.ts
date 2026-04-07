import { describe, it, expect } from 'vitest';
import { gprPublishCommand } from '../../../scripts/release.mjs';

describe('release.mjs gprPublishCommand', () => {
  it('builds publish command from pack JSON and directory', () => {
    const packJson = JSON.stringify([{ filename: 'jackuait-blok-cli-1.0.0.tgz' }]);
    const cmd = gprPublishCommand({ packJson, packDir: '/tmp', tag: 'latest' });

    expect(cmd).toBe('npm publish /tmp/jackuait-blok-cli-1.0.0.tgz --tag latest');
  });

  it('handles beta tags', () => {
    const packJson = JSON.stringify([{ filename: 'jackuait-blok-cli-1.0.0-beta.1.tgz' }]);
    const cmd = gprPublishCommand({ packJson, packDir: '/tmp', tag: 'beta' });

    expect(cmd).toBe('npm publish /tmp/jackuait-blok-cli-1.0.0-beta.1.tgz --tag beta');
  });
});
