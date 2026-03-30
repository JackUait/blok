# CLDR Emoji Name Translations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate emoji names and keywords using Unicode CLDR annotations so non-English users see localized tooltips and can search in their own language.

**Architecture:** A build script extracts CLDR annotation data for the ~1,870 emojis emoji-mart uses, writes trimmed per-locale JSON files to the callout tool's directory, which are lazy-loaded at runtime when the emoji picker opens. Search matches against both translated and English terms.

**Tech Stack:** `cldr-annotations-full` (devDependency), Vite dynamic imports, existing i18n module

---

### Task 1: Install `cldr-annotations-full` and expose `getLocale()` on the public I18n API

This task sets up the two prerequisites: the CLDR data source and the ability for tools to read the current locale.

**Files:**
- Modify: `package.json` (add devDependency)
- Modify: `types/api/i18n.d.ts` (add `getLocale()`)
- Modify: `src/components/modules/api/i18n.ts` (wire `getLocale()`)
- Test: `test/unit/components/modules/api/i18n.test.ts`

- [ ] **Step 1: Install cldr-annotations-full**

```bash
yarn add -D cldr-annotations-full
```

- [ ] **Step 2: Write the failing test for `getLocale()`**

Read `test/unit/components/modules/api/i18n.test.ts`. If it doesn't exist, create it. Add:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetLocale = vi.fn().mockReturnValue('fr');

vi.mock('../../../../src/components/modules/i18n', () => ({
  I18n: vi.fn(),
}));

describe('I18nAPI', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('methods.getLocale() delegates to the I18n module getLocale()', async () => {
    const { I18nAPI } = await import('../../../../src/components/modules/api/i18n');

    const instance = new (I18nAPI as any)({ moduleInstances: { I18n: { getLocale: mockGetLocale, t: vi.fn(), has: vi.fn(), getEnglishTranslation: vi.fn() } }, config: {} });

    // Access the Blok property (Module base class stores it)
    Object.defineProperty(instance, 'Blok', {
      get: () => ({ I18n: { getLocale: mockGetLocale, t: vi.fn(), has: vi.fn(), getEnglishTranslation: vi.fn() } }),
    });

    const result = instance.methods.getLocale();

    expect(result).toBe('fr');
    expect(mockGetLocale).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
yarn test test/unit/components/modules/api/i18n.test.ts
```

Expected: FAIL — `getLocale` is not on the methods object.

- [ ] **Step 4: Add `getLocale()` to the public I18n API type**

In `types/api/i18n.d.ts`, add after `getEnglishTranslation`:

```typescript
  /**
   * Get the current locale code.
   *
   * @returns The active locale code (e.g., 'en', 'fr', 'ja')
   */
  getLocale(): string;
```

- [ ] **Step 5: Wire `getLocale()` in the API module**

In `src/components/modules/api/i18n.ts`, update the `cachedMethods` object inside the `methods` getter to add:

```typescript
getLocale: (): string => this.Blok.I18n.getLocale(),
```

- [ ] **Step 6: Run test to verify it passes**

```bash
yarn test test/unit/components/modules/api/i18n.test.ts
```

Expected: PASS

- [ ] **Step 7: Run full lint and existing tests**

```bash
yarn lint && yarn test
```

Expected: All pass. The new `getLocale` method on the type should not break existing code since it's an addition.

- [ ] **Step 8: Commit**

```bash
git add package.json yarn.lock types/api/i18n.d.ts src/components/modules/api/i18n.ts test/unit/components/modules/api/i18n.test.ts
git commit -m "feat(i18n): expose getLocale() on public API and add cldr-annotations-full devDep"
```

---

### Task 2: Build script — generate trimmed emoji locale JSON files

Creates the script that reads CLDR data, intersects with emoji-mart's emoji set, and writes per-locale JSON files.

**Files:**
- Create: `scripts/build-emoji-locale-data.mjs`
- Output: `src/tools/callout/emoji-picker/locales/*.json` (generated)

- [ ] **Step 1: Create the build script**

Create `scripts/build-emoji-locale-data.mjs`:

```javascript
// scripts/build-emoji-locale-data.mjs
//
// Generates per-locale emoji name/keyword JSON files from Unicode CLDR annotations.
// Only includes emojis present in @emoji-mart/data to keep files small.
//
// Usage: node scripts/build-emoji-locale-data.mjs

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'src/tools/callout/emoji-picker/locales');
const CLDR_BASE = path.join(ROOT, 'node_modules/cldr-annotations-full/annotations');

/**
 * Blok locale -> CLDR locale mapping for mismatches.
 * Most locales match 1:1; only exceptions listed here.
 */
const LOCALE_MAP = {
  no: 'nb',
};

/**
 * Blok's 68 supported locales (must match ALL_LOCALE_CODES in src/components/i18n/locales/index.ts).
 * English is excluded since emoji-mart already provides English names.
 */
const BLOK_LOCALES = [
  'am', 'ar', 'az', 'bg', 'bn', 'bs', 'cs', 'da', 'de', 'dv', 'el', 'es', 'et',
  'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'ja', 'ka',
  'km', 'kn', 'ko', 'ku', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne',
  'nl', 'no', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'sq', 'sr',
  'sv', 'sw', 'ta', 'te', 'th', 'tr', 'ug', 'uk', 'ur', 'vi', 'yi', 'zh',
];

async function loadEmojiMartNatives() {
  const raw = await readFile(
    path.join(ROOT, 'node_modules/@emoji-mart/data/sets/15/native.json'),
    'utf-8'
  );
  const data = JSON.parse(raw);
  const natives = new Set();

  for (const emoji of Object.values(data.emojis)) {
    const skins = /** @type {{ native: string }[]} */ (/** @type {any} */ (emoji)).skins;

    if (skins?.[0]?.native) {
      natives.add(skins[0].native);
    }
  }

  return natives;
}

async function loadCldrAnnotations(cldrLocale) {
  const filePath = path.join(CLDR_BASE, cldrLocale, 'annotations.json');

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  return parsed?.annotations?.annotations ?? null;
}

async function main() {
  console.log('Loading emoji-mart emoji set...');
  const emojiMartNatives = await loadEmojiMartNatives();

  console.log(`Found ${emojiMartNatives.size} emojis in emoji-mart\n`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];

  for (const blokLocale of BLOK_LOCALES) {
    const cldrLocale = LOCALE_MAP[blokLocale] ?? blokLocale;
    const annotations = await loadCldrAnnotations(cldrLocale);

    if (annotations === null) {
      report.push({ locale: blokLocale, cldr: cldrLocale, count: 0, status: 'SKIP (no CLDR data)' });
      continue;
    }

    const output = {};
    let count = 0;

    for (const [emoji, data] of Object.entries(annotations)) {
      if (!emojiMartNatives.has(emoji)) {
        continue;
      }

      const tts = /** @type {{ tts?: string[]; default?: string[] }} */ (data).tts;
      const keywords = /** @type {{ tts?: string[]; default?: string[] }} */ (data).default;

      if (!tts?.[0]) {
        continue;
      }

      const entry = { n: tts[0] };

      if (keywords?.length > 0) {
        entry.k = keywords;
      }

      output[emoji] = entry;
      count++;
    }

    if (count === 0) {
      report.push({ locale: blokLocale, cldr: cldrLocale, count: 0, status: 'SKIP (no matching emojis)' });
      continue;
    }

    const outPath = path.join(OUTPUT_DIR, `${blokLocale}.json`);

    await writeFile(outPath, JSON.stringify(output), 'utf-8');
    report.push({ locale: blokLocale, cldr: cldrLocale, count, status: 'OK' });
  }

  // Print coverage report
  console.log('\n--- Coverage Report ---\n');
  console.log('Locale  CLDR    Emojis  Status');
  console.log('------  ------  ------  ------');

  for (const r of report) {
    const pct = r.count > 0 ? `${Math.round((r.count / emojiMartNatives.size) * 100)}%` : '-';

    console.log(
      `${r.locale.padEnd(8)}${r.cldr.padEnd(8)}${String(r.count).padEnd(8)}${r.status}`
    );
  }

  const okCount = report.filter(r => r.status === 'OK').length;

  console.log(`\n${okCount}/${BLOK_LOCALES.length} locales generated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the build script**

```bash
node scripts/build-emoji-locale-data.mjs
```

Expected: Generates JSON files in `src/tools/callout/emoji-picker/locales/`. Logs a coverage report showing ~50-55 locales with data.

- [ ] **Step 3: Verify output format of a generated file**

```bash
node -e "const d = require('./src/tools/callout/emoji-picker/locales/fr.json'); const keys = Object.keys(d); console.log('Entries:', keys.length); console.log('Sample:', JSON.stringify(d[keys[0]], null, 2));"
```

Expected: ~1,500-1,900 entries. Sample has `n` (name) and `k` (keywords array).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-emoji-locale-data.mjs src/tools/callout/emoji-picker/locales/
git commit -m "feat(callout): add build script and generated CLDR emoji locale data"
```

---

### Task 3: Emoji locale loader module

Creates the module that lazy-loads and caches per-locale emoji translation data.

**Files:**
- Create: `src/tools/callout/emoji-picker/emoji-locale.ts`
- Create: `test/unit/tools/callout/emoji-picker/emoji-locale.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/tools/callout/emoji-picker/emoji-locale.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('emoji-locale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loadEmojiLocale returns locale data for a supported locale', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: {
        '😀': { n: 'visage souriant', k: ['joyeux', 'rire'] },
        '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
      },
    }));

    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('fr');

    expect(data).not.toBeNull();
    expect(data!['😀']).toEqual({ n: 'visage souriant', k: ['joyeux', 'rire'] });
  });

  it('loadEmojiLocale returns null for English (no separate file needed)', async () => {
    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('en');

    expect(data).toBeNull();
  });

  it('loadEmojiLocale returns null for unsupported locale', async () => {
    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const data = await loadEmojiLocale('xx');

    expect(data).toBeNull();
  });

  it('loadEmojiLocale caches result on second call', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/de.json', () => ({
      default: { '😀': { n: 'grinsendes Gesicht', k: ['grinsen'] } },
    }));

    const { loadEmojiLocale } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');
    const first = await loadEmojiLocale('de');
    const second = await loadEmojiLocale('de');

    expect(first).toBe(second);
  });

  it('getTranslatedName returns translated name when available', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: {
        '😀': { n: 'visage souriant', k: ['joyeux'] },
      },
    }));

    const { loadEmojiLocale, getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');

    expect(getTranslatedName('😀', 'fr')).toBe('visage souriant');
  });

  it('getTranslatedName returns null when locale not loaded', async () => {
    const { getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    expect(getTranslatedName('😀', 'fr')).toBeNull();
  });

  it('getTranslatedName returns null when emoji not in locale data', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: { '😀': { n: 'visage souriant', k: [] } },
    }));

    const { loadEmojiLocale, getTranslatedName } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');

    expect(getTranslatedName('🦄', 'fr')).toBeNull();
  });

  it('getTranslatedKeywords returns translated keywords when available', async () => {
    vi.doMock('../../../../../src/tools/callout/emoji-picker/locales/fr.json', () => ({
      default: { '😀': { n: 'visage souriant', k: ['joyeux', 'rire'] } },
    }));

    const { loadEmojiLocale, getTranslatedKeywords } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    await loadEmojiLocale('fr');

    expect(getTranslatedKeywords('😀', 'fr')).toEqual(['joyeux', 'rire']);
  });

  it('getTranslatedKeywords returns null when locale not loaded', async () => {
    const { getTranslatedKeywords } = await import('../../../../../src/tools/callout/emoji-picker/emoji-locale');

    expect(getTranslatedKeywords('😀', 'ja')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test test/unit/tools/callout/emoji-picker/emoji-locale.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the emoji locale loader**

Create `src/tools/callout/emoji-picker/emoji-locale.ts`:

```typescript
// src/tools/callout/emoji-picker/emoji-locale.ts

export interface EmojiLocaleEntry {
  /** Translated name (from CLDR tts field) */
  n: string;
  /** Translated keywords (from CLDR default field) */
  k?: string[];
}

export type EmojiLocaleData = Record<string, EmojiLocaleEntry>;

const cache = new Map<string, EmojiLocaleData>();

/**
 * Dynamic import map for emoji locale files.
 * Generated by scripts/build-emoji-locale-data.mjs.
 * English is omitted — emoji-mart provides English names natively.
 *
 * IMPORTANT: After re-running the build script, update this map
 * to match the generated files in ./locales/.
 */
const importers: Record<string, () => Promise<{ default: EmojiLocaleData }>> = {
  am: () => import('./locales/am.json'),
  ar: () => import('./locales/ar.json'),
  az: () => import('./locales/az.json'),
  bg: () => import('./locales/bg.json'),
  bn: () => import('./locales/bn.json'),
  bs: () => import('./locales/bs.json'),
  cs: () => import('./locales/cs.json'),
  da: () => import('./locales/da.json'),
  de: () => import('./locales/de.json'),
  el: () => import('./locales/el.json'),
  es: () => import('./locales/es.json'),
  et: () => import('./locales/et.json'),
  fa: () => import('./locales/fa.json'),
  fi: () => import('./locales/fi.json'),
  fil: () => import('./locales/fil.json'),
  fr: () => import('./locales/fr.json'),
  gu: () => import('./locales/gu.json'),
  he: () => import('./locales/he.json'),
  hi: () => import('./locales/hi.json'),
  hr: () => import('./locales/hr.json'),
  hu: () => import('./locales/hu.json'),
  hy: () => import('./locales/hy.json'),
  id: () => import('./locales/id.json'),
  it: () => import('./locales/it.json'),
  ja: () => import('./locales/ja.json'),
  ka: () => import('./locales/ka.json'),
  km: () => import('./locales/km.json'),
  kn: () => import('./locales/kn.json'),
  ko: () => import('./locales/ko.json'),
  ku: () => import('./locales/ku.json'),
  lo: () => import('./locales/lo.json'),
  lt: () => import('./locales/lt.json'),
  lv: () => import('./locales/lv.json'),
  mk: () => import('./locales/mk.json'),
  ml: () => import('./locales/ml.json'),
  mn: () => import('./locales/mn.json'),
  mr: () => import('./locales/mr.json'),
  ms: () => import('./locales/ms.json'),
  my: () => import('./locales/my.json'),
  ne: () => import('./locales/ne.json'),
  nl: () => import('./locales/nl.json'),
  no: () => import('./locales/no.json'),
  pa: () => import('./locales/pa.json'),
  pl: () => import('./locales/pl.json'),
  ps: () => import('./locales/ps.json'),
  pt: () => import('./locales/pt.json'),
  ro: () => import('./locales/ro.json'),
  ru: () => import('./locales/ru.json'),
  sd: () => import('./locales/sd.json'),
  si: () => import('./locales/si.json'),
  sk: () => import('./locales/sk.json'),
  sl: () => import('./locales/sl.json'),
  sq: () => import('./locales/sq.json'),
  sr: () => import('./locales/sr.json'),
  sv: () => import('./locales/sv.json'),
  sw: () => import('./locales/sw.json'),
  ta: () => import('./locales/ta.json'),
  te: () => import('./locales/te.json'),
  th: () => import('./locales/th.json'),
  tr: () => import('./locales/tr.json'),
  ug: () => import('./locales/ug.json'),
  uk: () => import('./locales/uk.json'),
  ur: () => import('./locales/ur.json'),
  vi: () => import('./locales/vi.json'),
  yi: () => import('./locales/yi.json'),
  zh: () => import('./locales/zh.json'),
};

/**
 * Load emoji locale data for a given locale.
 * Returns null for English or unsupported locales.
 * Caches results in a module-level map.
 */
export async function loadEmojiLocale(locale: string): Promise<EmojiLocaleData | null> {
  if (locale === 'en') {
    return null;
  }

  const cached = cache.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  const importer = importers[locale];

  if (importer === undefined) {
    return null;
  }

  try {
    const module = await importer();
    const data = module.default;

    cache.set(locale, data);

    return data;
  } catch {
    return null;
  }
}

/**
 * Get the translated name for an emoji in a loaded locale.
 * Returns null if the locale isn't loaded or the emoji has no translation.
 */
export function getTranslatedName(native: string, locale: string): string | null {
  const data = cache.get(locale);

  if (data === undefined) {
    return null;
  }

  return data[native]?.n ?? null;
}

/**
 * Get the translated keywords for an emoji in a loaded locale.
 * Returns null if the locale isn't loaded or the emoji has no translation.
 */
export function getTranslatedKeywords(native: string, locale: string): string[] | null {
  const data = cache.get(locale);

  if (data === undefined) {
    return null;
  }

  return data[native]?.k ?? null;
}
```

**Note for the implementer:** The `importers` map above includes ALL 67 non-English Blok locales. After running the build script (Task 2), some locales may not have generated files. The importer for those will fail at runtime and the `catch` block returns null (English fallback). If you want a tighter map, remove entries for locales that the build script reported as `SKIP`. However, having them present is harmless — Vite only bundles chunks that exist.

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test test/unit/tools/callout/emoji-picker/emoji-locale.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/callout/emoji-picker/emoji-locale.ts test/unit/tools/callout/emoji-picker/emoji-locale.test.ts
git commit -m "feat(callout): add emoji locale loader with lazy-loading and caching"
```

---

### Task 4: Dual-language search in `searchEmojis`

Updates the search function to match against both translated and English names/keywords.

**Files:**
- Modify: `src/tools/callout/emoji-picker/emoji-data.ts`
- Modify: `test/unit/tools/callout/emoji-picker/emoji-data.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/tools/callout/emoji-picker/emoji-data.test.ts` inside the existing `describe('emoji-data', ...)`:

```typescript
  it('searchEmojis matches against translated names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'ampoule', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis matches against translated keywords when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée', 'lumière'] },
    };
    const results = searchEmojis(emojis, 'idée', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis still matches English names when locale data is provided', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const localeData = {
      '💡': { n: 'ampoule', k: ['idée'] },
    };
    // 'light' is in the English name "Light Bulb", not in the French data
    const results = searchEmojis(emojis, 'light', localeData);

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });

  it('searchEmojis works without locale data (backward compatible)', async () => {
    const { loadEmojiData, searchEmojis } = await import('../../../../../src/tools/callout/emoji-picker/emoji-data');
    const emojis = await loadEmojiData();
    const results = searchEmojis(emojis, 'light');

    expect(results).toHaveLength(1);
    expect(results[0].native).toBe('💡');
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
yarn test test/unit/tools/callout/emoji-picker/emoji-data.test.ts
```

Expected: The translated-name and translated-keyword tests FAIL (searchEmojis doesn't accept a third argument yet). The backward-compatible test should PASS.

- [ ] **Step 3: Update `searchEmojis` to accept optional locale data**

In `src/tools/callout/emoji-picker/emoji-data.ts`, import the type and update the function:

Add at the top of the file:

```typescript
import type { EmojiLocaleData } from './emoji-locale';
```

Replace the `searchEmojis` function:

```typescript
export function searchEmojis(emojis: ProcessedEmoji[], query: string, localeData?: EmojiLocaleData | null): ProcessedEmoji[] {
  const lower = query.toLowerCase();
  return emojis.filter(emoji => {
    // English match (always available)
    if (emoji.name.toLowerCase().includes(lower) || emoji.keywords.some(k => k.includes(lower))) {
      return true;
    }

    // Translated match (when locale data is loaded)
    if (localeData !== undefined && localeData !== null) {
      const entry = localeData[emoji.native];

      if (entry !== undefined) {
        if (entry.n.toLowerCase().includes(lower)) {
          return true;
        }

        if (entry.k !== undefined && entry.k.some(k => k.toLowerCase().includes(lower))) {
          return true;
        }
      }
    }

    return false;
  });
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
yarn test test/unit/tools/callout/emoji-picker/emoji-data.test.ts
```

Expected: All tests PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add src/tools/callout/emoji-picker/emoji-data.ts test/unit/tools/callout/emoji-picker/emoji-data.test.ts
git commit -m "feat(callout): add dual-language emoji search with CLDR locale data"
```

---

### Task 5: Integrate translations into the EmojiPicker component

Passes locale to the picker, loads emoji locale data on open, displays translated names on tooltips, and updates tooltips when data arrives late.

**Files:**
- Modify: `src/tools/callout/emoji-picker/index.ts`
- Modify: `src/tools/callout/index.ts`
- Modify: `test/unit/tools/callout/emoji-picker/emoji-picker.test.ts`
- Modify: `test/unit/tools/callout/callout.test.ts`

- [ ] **Step 1: Write failing tests for translated tooltip display**

Add to `test/unit/tools/callout/emoji-picker/emoji-picker.test.ts`. First, add the mock for the emoji-locale module near the top (after the existing mocks):

```typescript
const mockLoadEmojiLocale = vi.fn().mockResolvedValue(null);
const mockGetTranslatedName = vi.fn().mockReturnValue(null);

vi.mock('../../../../../src/tools/callout/emoji-picker/emoji-locale', () => ({
  loadEmojiLocale: (...args: unknown[]) => mockLoadEmojiLocale(...args),
  getTranslatedName: (...args: unknown[]) => mockGetTranslatedName(...args),
}));
```

Then add these test cases inside the main `describe('EmojiPicker', ...)`:

```typescript
  describe('emoji name translations', () => {
    it('shows translated emoji names in tooltips when locale data is available', async () => {
      mockLoadEmojiLocale.mockResolvedValue({
        '💡': { n: 'ampoule', k: ['idée'] },
        '😀': { n: 'visage souriant', k: ['joyeux'] },
      });
      mockGetTranslatedName.mockImplementation((native: string) => {
        const names: Record<string, string> = { '💡': 'ampoule', '😀': 'visage souriant' };
        return names[native] ?? null;
      });

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'fr' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const bulbBtn = picker.getElement().querySelector('[data-emoji-native="💡"]') as HTMLButtonElement;

      expect(bulbBtn.title).toBe('ampoule');
    });

    it('falls back to English name when translated name is not available', async () => {
      mockLoadEmojiLocale.mockResolvedValue({
        '💡': { n: 'ampoule', k: ['idée'] },
      });
      mockGetTranslatedName.mockImplementation((native: string) => {
        if (native === '💡') return 'ampoule';
        return null;
      });

      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'fr' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      // 👍 has no French translation — should show English name
      const thumbsBtn = picker.getElement().querySelector('[data-emoji-native="👍"]') as HTMLButtonElement;

      expect(thumbsBtn.title).toBe('Thumbs Up');
    });

    it('uses English names when locale is en', async () => {
      const { EmojiPicker } = await import('../../../../../src/tools/callout/emoji-picker');
      const picker = new EmojiPicker({ onSelect: vi.fn(), onRemove: vi.fn(), i18n: { t: (k: string) => k } as never, locale: 'en' });
      container.appendChild(picker.getElement());
      await picker.open(container);

      const bulbBtn = picker.getElement().querySelector('[data-emoji-native="💡"]') as HTMLButtonElement;

      expect(bulbBtn.title).toBe('Light Bulb');
      expect(mockLoadEmojiLocale).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test test/unit/tools/callout/emoji-picker/emoji-picker.test.ts
```

Expected: FAIL — EmojiPickerOptions doesn't have `locale` yet.

- [ ] **Step 3: Update EmojiPicker to accept locale and load translated names**

In `src/tools/callout/emoji-picker/index.ts`:

Add import at the top:

```typescript
import { loadEmojiLocale, getTranslatedName, type EmojiLocaleData } from './emoji-locale';
```

Update the `EmojiPickerOptions` interface:

```typescript
interface EmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
  i18n: I18n;
  locale: string;
}
```

Add private fields to the `EmojiPicker` class:

```typescript
  private readonly _locale: string;
  private _localeData: EmojiLocaleData | null = null;
```

In the constructor, store the locale:

```typescript
  this._locale = options.locale;
```

Update `open()` — after `this._allEmojis = await loadEmojiData();`, add emoji locale loading:

```typescript
    // Load translated emoji names in parallel (non-blocking — English fallback if slow)
    if (this._locale !== 'en' && this._localeData === null) {
      const localeData = await loadEmojiLocale(this._locale);

      if (localeData !== null) {
        this._localeData = localeData;
      }
    }
```

Create a helper method `getDisplayName`:

```typescript
  private getDisplayName(emoji: ProcessedEmoji): string {
    return getTranslatedName(emoji.native, this._locale) ?? emoji.name;
  }
```

In `buildGrid()`, replace the two lines that use `emoji.name`:

```typescript
      btn.title = this.getDisplayName(emoji);
```

and:

```typescript
      onHover(btn, this.getDisplayName(emoji), { placement: 'bottom' });
```

Update `handleFilterChange()` — where `searchEmojis` is called, pass `this._localeData`:

```typescript
    const results = searchEmojis(this._allEmojis, query, this._localeData);
```

- [ ] **Step 4: Update CalloutTool to pass locale**

In `src/tools/callout/index.ts`, update the EmojiPicker construction in `openEmojiPicker()`:

```typescript
      this._emojiPicker = new EmojiPicker({
        onSelect: (native: string) => this.setEmoji(native),
        onRemove: () => this.setEmoji(''),
        i18n: this.api.i18n,
        locale: this.api.i18n.getLocale(),
      });
```

- [ ] **Step 5: Update the callout test mock API to include getLocale**

In `test/unit/tools/callout/callout.test.ts`, update `createMockAPI` — the `i18n` field:

```typescript
  i18n: { t: (k: string) => k, has: vi.fn().mockReturnValue(false), getLocale: vi.fn().mockReturnValue('en'), getEnglishTranslation: vi.fn().mockReturnValue('') },
```

- [ ] **Step 6: Run all affected tests**

```bash
yarn test test/unit/tools/callout/
```

Expected: All tests PASS.

- [ ] **Step 7: Run lint**

```bash
yarn lint
```

Expected: PASS. Fix any lint issues.

- [ ] **Step 8: Commit**

```bash
git add src/tools/callout/emoji-picker/index.ts src/tools/callout/index.ts test/unit/tools/callout/emoji-picker/emoji-picker.test.ts test/unit/tools/callout/callout.test.ts
git commit -m "feat(callout): display translated emoji names and dual-language search in picker"
```

---

### Task 6: Full verification

Run all quality gates and push.

**Files:** None — verification only.

- [ ] **Step 1: Run full test suite**

```bash
yarn test
```

Expected: All tests PASS.

- [ ] **Step 2: Run lint**

```bash
yarn lint
```

Expected: PASS.

- [ ] **Step 3: Verify build succeeds**

```bash
yarn build
```

Expected: PASS. Emoji locale JSON files should be code-split into separate chunks.

- [ ] **Step 4: Push**

```bash
git push
```
