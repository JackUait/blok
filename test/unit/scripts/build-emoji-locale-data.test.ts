import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');

describe('build-emoji-locale-data', () => {
  it('removes stale Sorani output when CLDR has no annotations', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'blok-emoji-locales-'));
    const staleSoraniOutput = join(outputDir, 'ku.json');

    try {
      writeFileSync(staleSoraniOutput, '{"😀":{"n":"stale"}}', 'utf8');

      const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts/build-emoji-locale-data.mjs')],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            BLOK_EMOJI_LOCALE_OUTPUT_DIR: outputDir,
          },
        }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(staleSoraniOutput)).toBe(false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
