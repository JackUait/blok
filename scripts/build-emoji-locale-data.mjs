/**
 * Build script: generate trimmed emoji locale JSON files.
 *
 * Reads @emoji-mart/data to get the set of ~1,870 base emoji characters,
 * then intersects each CLDR locale's annotations with that set and writes
 * per-locale JSON files consumed at runtime by the emoji picker.
 *
 * Usage:  node scripts/build-emoji-locale-data.mjs
 * Output: src/tools/callout/emoji-picker/locales/{locale}.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ */
/*  1. Collect the set of base emoji native characters from emoji-mart */
/* ------------------------------------------------------------------ */

const emojiMartPath = join(ROOT, 'node_modules/@emoji-mart/data/sets/15/native.json');
const emojiMartData = JSON.parse(readFileSync(emojiMartPath, 'utf-8'));

const emojiNatives = new Set();

for (const emoji of Object.values(emojiMartData.emojis)) {
  if (emoji.skins?.[0]?.native) {
    emojiNatives.add(emoji.skins[0].native);
  }
}

console.log(`emoji-mart base emojis: ${emojiNatives.size}`);

/* ------------------------------------------------------------------ */
/*  2. Blok locales and CLDR mapping                                  */
/* ------------------------------------------------------------------ */

const BLOK_LOCALES = [
  'am', 'ar', 'az', 'bg', 'bn', 'bs', 'cs', 'da', 'de', 'dv',
  'el', 'es', 'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi',
  'hr', 'hu', 'hy', 'id', 'it', 'ja', 'ka', 'km', 'kn', 'ko',
  'ku', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my',
  'ne', 'nl', 'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd',
  'si', 'sk', 'sl', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'th',
  'tr', 'ug', 'uk', 'ur', 'vi', 'yi', 'zh',
];

/**
 * Map Blok locale codes to CLDR directory names where they differ.
 * CLDR uses 'no' directly (not 'nb'), so no mapping needed for Norwegian.
 */
const CLDR_LOCALE_MAP = {};

/* ------------------------------------------------------------------ */
/*  3. Process each locale                                            */
/* ------------------------------------------------------------------ */

const OUTPUT_DIR = join(ROOT, 'src/tools/callout/emoji-picker/locales');

mkdirSync(OUTPUT_DIR, { recursive: true });

const report = [];

for (const locale of BLOK_LOCALES) {
  const cldrLocale = CLDR_LOCALE_MAP[locale] ?? locale;
  const cldrPath = join(
    ROOT,
    'node_modules/cldr-annotations-full/annotations',
    cldrLocale,
    'annotations.json'
  );

  let cldrData;

  try {
    cldrData = JSON.parse(readFileSync(cldrPath, 'utf-8'));
  } catch {
    report.push({ locale, cldrLocale, entries: 0, note: 'MISSING CLDR data' });
    continue;
  }

  const annotations = cldrData.annotations?.annotations;

  if (!annotations) {
    report.push({ locale, cldrLocale, entries: 0, note: 'no annotations key' });
    continue;
  }

  const output = {};

  for (const native of emojiNatives) {
    /*
     * CLDR often omits U+FE0F (variation selector-16) from its keys while
     * emoji-mart includes it.  Try the original first, then the stripped form.
     */
    const entry = annotations[native] ?? annotations[native.replace(/\uFE0F/g, '')];

    if (!entry) continue;

    const name = entry.tts?.[0];
    const keywords = entry.default;

    if (!name) continue;

    output[native] = { n: name, k: keywords ?? [] };
  }

  const count = Object.keys(output).length;

  if (count > 0) {
    const outPath = join(OUTPUT_DIR, `${locale}.json`);

    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  }

  report.push({ locale, cldrLocale, entries: count });
}

/* ------------------------------------------------------------------ */
/*  4. Coverage report                                                */
/* ------------------------------------------------------------------ */

console.log('\n--- Coverage Report ---\n');
console.log('Locale  CLDR     Entries  Coverage  Note');
console.log('------  -------  -------  --------  ----');

let totalEntries = 0;
let localesGenerated = 0;

for (const r of report) {
  const pct = ((r.entries / emojiNatives.size) * 100).toFixed(1);
  const note = r.note ?? '';
  const cldr = r.cldrLocale !== r.locale ? r.cldrLocale : '';

  console.log(
    `${r.locale.padEnd(8)}${(cldr || r.locale).padEnd(9)}${String(r.entries).padStart(5)}    ${pct.padStart(5)}%  ${note}`
  );
  totalEntries += r.entries;

  if (r.entries > 0) localesGenerated++;
}

console.log(`\nLocales generated: ${localesGenerated} / ${BLOK_LOCALES.length}`);
console.log(`Average entries per locale: ${Math.round(totalEntries / localesGenerated)}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
