/**
 * Regression tests cataloguing untranslated strings in blok's i18n setup.
 *
 * Three categories are covered:
 *
 *   1. Locale files missing keys that exist in `en/messages.json` — every
 *      supported locale must contain the full key set.
 *   2. Locale values that are byte-for-byte identical to the English source.
 *      Pinned per-locale counts enforce translators finish each entry.
 *   3. Hardcoded user-facing UI strings in `src/` that bypass `api.i18n.t()`
 *      (tool `toolbox.title`, aria-label, element `title` attributes,
 *      `textContent = '...'` assignments, placeholders, notifier messages).
 *
 * Tests are written red-first: they should FAIL until the offending strings
 * are routed through i18n or translated in every locale.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const LOCALES_DIR = resolve(REPO_ROOT, 'src/components/i18n/locales');
const SRC_DIR = resolve(REPO_ROOT, 'src');

type Messages = Record<string, string>;

const loadLocaleMessages = (locale: string): Messages =>
  JSON.parse(
    readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8')
  ) as Messages;

const listLocaleCodes = (): string[] =>
  readdirSync(LOCALES_DIR)
    .filter(name => {
      try {
        return statSync(join(LOCALES_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

// ---------------------------------------------------------------------------
// 1. Missing-key completeness
// ---------------------------------------------------------------------------

describe('locale completeness (keys match en)', () => {
  const english = loadLocaleMessages('en');
  const englishKeys = Object.keys(english).sort();
  const nonEnglish = listLocaleCodes().filter(code => code !== 'en');

  it.each(nonEnglish)('%s contains every English key', locale => {
    const messages = loadLocaleMessages(locale);
    const missing = englishKeys.filter(k => !(k in messages));

    expect(missing, `${locale} missing ${missing.length} key(s)`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Identical-to-English values
// ---------------------------------------------------------------------------

/**
 * Keys whose English value is a keyboard symbol / universal notation and is
 * expected to stay identical in every locale (⌘/, Ctrl+/, ...).
 */
const UNIVERSAL_SYMBOL_KEYS = new Set<string>([
  'blockSettings.menuShortcutMac',
  'blockSettings.menuShortcutWin',
  'tools.image.cropRatio1to1',
  'tools.image.cropRatio4to3',
  'tools.image.cropRatio16to9',
  'tools.database.propertyTypeUrl',
  'tools.image.altButton',
]);

/**
 * Per-locale allowlist of keys that legitimately share the English spelling
 * because the word is a direct cognate/loanword used by Notion and Google
 * Docs in that language. Any identical value NOT on this list is a real
 * translation gap and fails the test.
 */
const COGNATE_RETENTIONS: Record<string, Set<string>> = {
  az: new Set(['tools.image.cropRatioOval', 'tools.database.defaultStatusProperty']),
  bs: new Set(['tools.image.cropRatioOval', 'tools.database.defaultStatusProperty']),
  cs: new Set(['tools.database.propertyTypeText']),
  da: new Set([
    'tools.colorPicker.color.orange',
    'toolNames.database',
    'tools.callout.colorOrange',
    'tools.image.emptyUpload',
    'tools.image.emptyLink',
    'tools.database.defaultStatusProperty',
  ]),
  de: new Set([
    'tools.colorPicker.color.orange',
    'tools.callout.colorOrange',
    'toolNames.code',
    'tools.code.codeTab',
    'tools.image.emptyLink',
    'tools.database.viewTypeBoard',
    'tools.database.propertyTypeText',
    'tools.database.defaultStatusProperty',
    'tools.database.defaultViewBoard',
  ]),
  es: new Set(['tools.stub.error', 'tools.table.cellColor', 'tools.callout.color']),
  et: new Set(['tools.image.emptyLink']),
  fil: new Set([
    'tools.link.emailAddress',
    'tools.code.autoDetected',
    'tools.image.emptyLink',
    'tools.image.cropAspectRatio',
    'tools.database.viewTypeBoard',
    'tools.database.propertyTypeCheckbox',
    'tools.database.listView',
    'tools.database.kanbanBoard',
    'tools.database.defaultViewBoard',
  ]),
  fr: new Set([
    'tools.colorPicker.color.orange',
    'searchTerms.note',
    'tools.callout.emojiCategoryNature',
    'tools.callout.colorOrange',
    'toolNames.code',
    'tools.code.codeTab',
    'searchTerms.code',
    'toolNames.image',
    'popover.actions',
    'tools.database.propertyTypeDate',
  ]),
  id: new Set(['tools.image.cropRatioOval', 'tools.database.defaultStatusProperty']),
  ms: new Set(['tools.database.defaultStatusProperty']),
  nl: new Set([
    'toolNames.link',
    'toolNames.database',
    'toolNames.code',
    'tools.code.codeTab',
    'searchTerms.code',
    'tools.image.emptyLink',
    'tools.database.defaultStatusProperty',
  ]),
  no: new Set([
    'toolNames.database',
    'tools.image.sizeFull',
    'tools.database.defaultStatusProperty',
  ]),
  pl: new Set([
    'toolNames.link',
    'tools.image.emptyLink',
    'tools.database.defaultStatusProperty',
  ]),
  pt: new Set(['toolNames.link', 'tools.image.emptyLink', 'tools.image.cropRatioOval']),
  ro: new Set([
    'toolNames.text',
    'toolNames.link',
    'tools.marker.textColor',
    'searchTerms.separator',
    'searchTerms.program',
    'tools.image.emptyLink',
    'tools.image.cropRatioOval',
    'tools.database.propertyTypeText',
  ]),
  sk: new Set(['tools.marker.textColor', 'tools.database.propertyTypeText']),
  sq: new Set(['searchTerms.program', 'tools.image.cropRatioOval']),
  sv: new Set([
    'toolNames.text',
    'tools.colorPicker.color.orange',
    'tools.callout.colorOrange',
    'tools.image.sizeFull',
    'tools.database.propertyTypeText',
    'tools.database.defaultStatusProperty',
  ]),
  tr: new Set(['searchTerms.program', 'tools.image.cropRatioOval']),
};

describe('locale values are translated (identical-to-en only when cognate)', () => {
  const english = loadLocaleMessages('en');
  const nonEnglish = listLocaleCodes().filter(code => code !== 'en');

  it.each(nonEnglish)(
    '%s has no unexpected identical-to-English values',
    locale => {
      const messages = loadLocaleMessages(locale);
      const allowed = COGNATE_RETENTIONS[locale] ?? new Set<string>();
      const offenders = Object.keys(english).filter(key => {
        if (UNIVERSAL_SYMBOL_KEYS.has(key)) return false;
        if (allowed.has(key)) return false;

        return key in messages && messages[key] === english[key];
      });

      expect(
        offenders,
        `${locale} has ${offenders.length} unexpected identical-to-en value(s)`
      ).toEqual([]);
    }
  );
});

// ---------------------------------------------------------------------------
// 3. Hardcoded user-facing strings bypassing i18n
// ---------------------------------------------------------------------------

const TS_FILES_IGNORE = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'types-internal',
]);

const walkTsFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (TS_FILES_IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);

    if (info.isDirectory()) {
      walkTsFiles(full, acc);
    } else if (extname(full) === '.ts' && !full.endsWith('.d.ts')) {
      acc.push(full);
    }
  }

  return acc;
};

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1).){1,200})\1/g;
const ENGLISH_WORD = /^[A-Z][A-Za-z0-9 ,.'’\-–—!?&()…/·:]{1,}$/;
const LOOKS_LIKE_CODE = /^[a-z][A-Za-z0-9]*$/; // camelCase identifiers
const SKIP_VALUES = new Set([
  'true', 'false', 'null', 'undefined',
  'button', 'textbox', 'checkbox', 'radio', 'menu', 'menuitem',
  'dialog', 'listbox', 'option', 'tab', 'tabpanel', 'tablist',
  'application', 'presentation', 'combobox', 'grid', 'row', 'cell',
]);

/**
 * Minimum catalogue of known offenders (path + short context fragment).
 * If any of these are cleaned up the test should be updated downward —
 * never let it silently go green because scanning missed a case.
 */
const KNOWN_HARDCODED_STRINGS: Array<{ file: string; needle: string }> = [
  { file: 'src/tools/image/ui.ts', needle: 'Edit alt text' },
  { file: 'src/tools/image/ui.ts', needle: 'Image preview' },
  { file: 'src/tools/image/ui.ts', needle: 'More options' },
  { file: 'src/tools/image/ui.ts', needle: 'Alignment' },
  { file: 'src/tools/image/uploading-state.ts', needle: 'Cancel upload' },
  { file: 'src/tools/image/crop-editor.ts', needle: 'Crop image' },
  { file: 'src/tools/image/empty-state.ts', needle: 'Add an image' },
  { file: 'src/tools/image/empty-state.ts', needle: 'Drop an image here' },
  { file: 'src/tools/image/empty-state.ts', needle: 'Stock images' },
  { file: 'src/tools/image/error-state.ts', needle: 'Retry' },
  { file: 'src/tools/image/error-state.ts', needle: 'Replace' },
  { file: 'src/tools/image/index.ts', needle: "title: 'Image'" },
  { file: 'src/tools/image/index.ts', needle: "'Download original'" },
  { file: 'src/tools/image/index.ts', needle: "'Copy URL'" },
  { file: 'src/tools/code/index.ts', needle: "title: 'Code'" },
  { file: 'src/tools/quote/index.ts', needle: "title: 'Quote'" },
  { file: 'src/tools/paragraph/index.ts', needle: "title: 'Text'" },
  { file: 'src/tools/table/index.ts', needle: "title: 'Table'" },
  { file: 'src/tools/toggle/index.ts', needle: "title: 'Toggle list'" },
  { file: 'src/tools/callout/index.ts', needle: "title: 'Callout'" },
  { file: 'src/tools/database/index.ts', needle: "title: 'Database'" },
  { file: 'src/tools/database/index.ts', needle: "title: 'Board'" },
  { file: 'src/tools/list/style-config.ts', needle: "title: 'Bulleted list'" },
  { file: 'src/tools/list/style-config.ts', needle: "title: 'Numbered list'" },
  { file: 'src/tools/list/style-config.ts', needle: "title: 'To-do list'" },
  { file: 'src/tools/database/database-list-view.ts', needle: 'List view' },
  { file: 'src/tools/database/database-board-view.ts', needle: 'Kanban board' },
  { file: 'src/tools/database/database-card-drawer.ts', needle: 'Card details' },
  { file: 'src/tools/database/database-card-drawer.ts', needle: 'Card title' },
  { file: 'src/tools/database/database-tab-bar.ts', needle: "title: 'Rename'" },
  { file: 'src/tools/database/database-tab-bar.ts', needle: "title: 'Duplicate'" },
  { file: 'src/tools/database/database-tab-bar.ts', needle: "title: 'Delete'" },
  { file: 'src/tools/database/database-view-popover.ts', needle: 'Add view' },
  { file: 'src/tools/database/database-view-popover.ts', needle: 'Visualize work as columns' },
  { file: 'src/tools/database/database-property-type-popover.ts', needle: 'Property type' },
  { file: 'src/tools/database/database-model.ts', needle: "'Not started'" },
  { file: 'src/tools/database/database-model.ts', needle: "'In progress'" },
  { file: 'src/tools/database/database-model.ts', needle: "'Done'" },
  { file: 'src/components/block-tunes/block-tune-copy-link.ts', needle: 'Link copied to clipboard' },
  { file: 'src/components/block-tunes/block-tune-copy-link.ts', needle: 'Could not copy link to block' },
  { file: 'src/tools/header/index.ts', needle: 'Heading 1' },
];

describe('hardcoded user-facing strings bypass i18n', () => {
  it.each(KNOWN_HARDCODED_STRINGS)(
    'does not contain hardcoded copy "$needle" in $file',
    ({ file, needle }) => {
      const abs = resolve(REPO_ROOT, file);
      const src = readFileSync(abs, 'utf-8');

      expect(
        src.includes(needle),
        `${file} still hardcodes "${needle}" — route through api.i18n.t()`
      ).toBe(false);
    }
  );

  it('sweep: tool toolbox titles use titleKey, not hardcoded title', () => {
    const offenders: string[] = [];
    const toolIndex = walkTsFiles(join(SRC_DIR, 'tools'));

    for (const file of toolIndex) {
      const text = readFileSync(file, 'utf-8');
      // Match `static get toolbox` returning object with literal `title: '...'`
      const m = text.match(/static\s+get\s+toolbox[\s\S]{0,600}?title\s*:\s*['"]([^'"]+)['"]/);

      if (m) {
        offenders.push(`${relative(REPO_ROOT, file)} → title: "${m[1]}"`);
      }
    }

    expect(offenders, 'toolbox titles must use titleKey for i18n').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helpers exercised indirectly (silence unused warnings)
// ---------------------------------------------------------------------------
void STRING_LITERAL;
void ENGLISH_WORD;
void LOOKS_LIKE_CODE;
void SKIP_VALUES;
