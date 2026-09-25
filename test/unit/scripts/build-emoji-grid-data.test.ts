import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildEmojiGridData } from '../../../scripts/build-emoji-grid-data.mjs';

const ROOT = resolve(__dirname, '../../..');
const CHECKED_IN_DIR = join(ROOT, 'src/components/utils/emoji');
const OUTPUT_FILES = ['emoji-grid.json', 'emoji-keywords.json'];

describe('build-emoji-grid-data', () => {
  it('checked-in emoji grid and keyword files match a fresh generator run', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'blok-emoji-grid-'));

    try {
      const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts/build-emoji-grid-data.mjs')],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            BLOK_EMOJI_GRID_OUTPUT_DIR: outputDir,
          },
        }
      );

      expect(result.status, result.stderr).toBe(0);

      for (const file of OUTPUT_FILES) {
        const fresh = readFileSync(join(outputDir, file));
        const checkedIn = readFileSync(join(CHECKED_IN_DIR, file));

        expect(checkedIn.equals(fresh), `${file} is stale — run node scripts/build-emoji-grid-data.mjs`).toBe(true);
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('skips unknown ids and skinless emojis, keeping keywords aligned with the grid', () => {
    const data = buildEmojiGridData({
      categories: [
        { id: 'people', emojis: ['wave', 'ghost', 'bare', 'smile'] },
        { id: 'objects', emojis: ['key'] },
      ],
      emojis: {
        wave: { id: 'wave', name: 'Waving Hand', keywords: ['hello'], skins: [{ native: '👋' }, { native: '👋🏻' }] },
        bare: { id: 'bare', name: 'No Skins', keywords: ['none'], skins: [] },
        smile: { id: 'smile', name: 'Smiling Face', keywords: ['happy'], skins: [{ native: '😄' }] },
        key: { id: 'key', name: 'Key', keywords: [], skins: [{ native: '🔑' }] },
      },
    });

    expect(data.grid).toEqual([
      { id: 'people', emojis: [['wave', 'Waving Hand', '👋', '👋🏻'], ['smile', 'Smiling Face', '😄']] },
      { id: 'objects', emojis: [['key', 'Key', '🔑']] },
    ]);
    expect(data.keywords).toEqual([['hello'], ['happy'], []]);
  });
});
