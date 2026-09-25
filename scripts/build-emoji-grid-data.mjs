/**
 * Build script: split the emoji-mart native set into the two files the
 * emoji picker loads at runtime.
 *
 * - emoji-grid.json: what the grid draws. Categories in order as
 *   `{ id, emojis }`, each emoji `[id, name, ...skinNatives]`; the base native
 *   is the first skin. Objects at the category level let TypeScript infer the
 *   imported JSON's type without a cast.
 * - emoji-keywords.json: English search keywords, one array per grid emoji in
 *   the same flattened order. Position-aligned instead of keyed because keys
 *   cost ~4KB brotli; the loader rejects a length mismatch and the drift test
 *   byte-compares both files, so they cannot fall out of step unnoticed.
 *
 * Emojis with an unknown id or no skins are skipped.
 *
 * Usage:  node scripts/build-emoji-grid-data.mjs
 * Output: src/components/utils/emoji/emoji-grid.json, emoji-keywords.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * @typedef {object} EmojiMartSet
 * @property {Array<{ id: string, emojis: string[] }>} categories
 * @property {Record<string, { id: string, name: string, keywords: string[], skins: Array<{ native: string }> }>} emojis
 */

/**
 * @param {EmojiMartSet} data
 * @returns {{ grid: Array<{ id: string, emojis: string[][] }>, keywords: string[][] }}
 */
export function buildEmojiGridData(data) {
  /** @type {Array<{ id: string, emojis: string[][] }>} */
  const grid = [];
  /** @type {string[][]} */
  const keywords = [];

  for (const category of data.categories) {
    /** @type {string[][]} */
    const rows = [];

    for (const emojiId of category.emojis) {
      const emoji = data.emojis[emojiId];

      if (emoji === undefined || emoji.skins.length === 0) {
        continue;
      }

      rows.push([emoji.id, emoji.name, ...emoji.skins.map(skin => skin.native)]);
      keywords.push(emoji.keywords);
    }

    grid.push({ id: category.id, emojis: rows });
  }

  return { grid, keywords };
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sizes(bytes) {
  const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });

  return `${bytes.length} raw, ${gzipSync(bytes, { level: 9 }).length} gzip, ${brotli.length} brotli`;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const emojiMartPath = join(ROOT, 'node_modules/@emoji-mart/data/sets/15/native.json');
  const { grid, keywords } = buildEmojiGridData(JSON.parse(readFileSync(emojiMartPath, 'utf-8')));

  const OUTPUT_DIR = process.env.BLOK_EMOJI_GRID_OUTPUT_DIR ??
    join(ROOT, 'src/components/utils/emoji');

  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [name, value] of [['emoji-grid.json', grid], ['emoji-keywords.json', keywords]]) {
    const bytes = Buffer.from(JSON.stringify(value), 'utf-8');

    writeFileSync(join(OUTPUT_DIR, name), bytes);
    console.log(`${name}: ${sizes(bytes)}`);
  }

  console.log(`emojis: ${keywords.length}`);
}
