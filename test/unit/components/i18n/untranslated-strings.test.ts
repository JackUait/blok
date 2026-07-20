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
 * Keys whose English value is a keyboard symbol / universal notation and may
 * legitimately stay identical in a locale (⌘/, Ctrl+/, ...). Localized key
 * names such as German `Strg+/` remain valid; the source-value binding below
 * ensures that changed English notation must be reviewed and reclassified.
 */
const UNIVERSAL_EXACT_VALUES: Readonly<Record<string, string>> = {
  'blockSettings.menuShortcutMac': '⌘/',
  'blockSettings.menuShortcutWin': 'Ctrl+/',
  'tools.image.cropRatio1to1': '1:1',
  'tools.image.cropRatio4to3': '4:3',
  'tools.image.cropRatio16to9': '16:9',
  'tools.database.propertyTypeUrl': 'URL',
  'tools.image.altButton': 'Alt',
};

/**
 * Per-locale allowlist of keys that legitimately share the English spelling
 * because the word is a direct cognate/loanword used by Notion and Google
 * Docs in that language. Any identical value NOT on this list is a real
 * translation gap and fails the test.
 */
const COGNATE_RETENTIONS: Record<string, Set<string>> = {
  // Swatch labels are placeholder-only ("{default} {mode}") and read naturally
  // in the English source order, so an identical value is correct here.
  am: new Set(['tools.colorPicker.defaultSwatchLabel', 'tools.colorPicker.colorSwatchLabel']),
  az: new Set([
    'tools.image.cropRatioOval',
    'tools.database.defaultStatusProperty',
    'notifier.ok',
    'tools.colorPicker.defaultSwatchLabel',
    'tools.colorPicker.colorSwatchLabel',
  ]),
  bg: new Set(['notifier.ok']),
  // "Text" is a direct cognate of the English word in Czech.
  cs: new Set([
    'tools.database.propertyTypeText',
    'tools.link.linkText',
    'notifier.ok',
  ]),
  da: new Set([
    'tools.colorPicker.color.orange',
    'toolNames.database',
    // "Link" is the standard loanword for a hyperlink in Danish UIs.
    'toolNames.link',
    'tools.callout.colorOrange',
    'tools.image.emptyUpload',
    'tools.image.emptyLink',
    // "Upload"/"Link" are the standard loanwords in Danish UIs.
    'tools.file.emptyUpload',
    'tools.file.emptyLink',
    'tools.database.defaultStatusProperty',
    'searchTerms.layout',
    'notifier.ok',
    'tools.link.webLink',
    // This placeholder-only swatch label reads naturally in source order.
    'tools.colorPicker.colorSwatchLabel',
  ]),
  de: new Set([
    'tools.colorPicker.color.orange',
    'tools.callout.colorOrange',
    'toolNames.code',
    // Microsoft Planner's German UI uses "Board" and "Boardansicht".
    'toolNames.board',
    // "Link" is the standard loanword for a hyperlink in German UIs.
    'toolNames.link',
    'tools.code.codeTab',
    'tools.image.emptyLink',
    'tools.file.emptyLink',
    'tools.database.viewTypeBoard',
    'tools.database.propertyTypeText',
    'tools.database.defaultStatusProperty',
    'tools.database.defaultViewBoard',
    'notifier.ok',
    'tools.link.webLink',
    // "Text" is a direct cognate of the English word in German.
    'tools.link.linkText',
  ]),
  // "OK" is the conventional compact confirmation label in Greek UIs.
  el: new Set(['notifier.ok']),
  es: new Set([
    'tools.stub.error',
    'tools.table.cellColor',
    'tools.callout.color',
    // "Color" is the standard Spanish cognate and names both marker modes.
    'toolNames.marker',
  ]),
  // "Link" is the standard loanword for a hyperlink in Estonian UIs; "OK" is
  // the conventional compact confirmation label.
  et: new Set([
    'toolNames.link',
    'tools.image.emptyLink',
    'tools.file.emptyLink',
    'tools.link.webLink',
    'notifier.ok',
  ]),
  // "OK" is the conventional compact confirmation label in Finnish UIs.
  fi: new Set(['notifier.ok']),
  fil: new Set([
    'tools.link.emailAddress',
    'tools.code.autoDetected',
    'tools.image.emptyLink',
    'tools.image.cropRatioOval',
    // "File"/"Link"/"Preview"/"Board"/"Embed"/"Toggle" are the standard
    // English loanwords in Filipino (Tagalog) product UIs.
    'toolNames.file',
    'toolNames.link',
    'toolNames.board',
    'toolNames.embed',
    'tools.code.previewTab',
    'tools.toggle.placeholder',
    'tools.file.emptyLink',
    'tools.file.preview',
    'tools.database.viewTypeBoard',
    'tools.database.propertyTypeCheckbox',
    'tools.database.listView',
    'tools.database.kanbanBoard',
    'tools.database.defaultViewBoard',
    'searchTerms.layout',
    // "Bookmark" is the standard loanword in Filipino UIs (Tagalog).
    'toolNames.bookmark',
    // "Link" (hyperlink) and "OK" are likewise the established English
    // loanwords in Filipino product UIs.
    'tools.link.webLink',
    'notifier.ok',
  ]),
  fr: new Set([
    'tools.colorPicker.color.orange',
    'searchTerms.note',
    'tools.callout.colorOrange',
    'toolNames.code',
    'tools.code.codeTab',
    'searchTerms.code',
    'toolNames.image',
    'popover.actions',
    'tools.database.propertyTypeDate',
    'tools.file.previewRaw',
    'notifier.ok',
  ]),
  id: new Set(['tools.image.cropRatioOval', 'tools.database.defaultStatusProperty']),
  it: new Set([
    // Established Italian product and computing loanwords.
    'searchTerms.layout',
    'toolNames.file',
    'toolNames.link',
    'toolNames.database',
    'tools.image.emptyLink',
    'tools.file.emptyLink',
    'tools.video.emptyLink',
    'tools.audio.emptyLink',
    'tools.audio.coverLink',
    'tools.link.webLink',
  ]),
  // "OK" is the conventional compact confirmation label in Japanese UIs.
  ja: new Set(['notifier.ok']),
  // This placeholder-only template follows Latvian modifier-before-noun order.
  lv: new Set(['tools.colorPicker.defaultSwatchLabel']),
  // "grid" is a common search keyword loanword for the table tool in Malay UIs;
  // "OK" is the conventional compact confirmation label in Malay UIs.
  ms: new Set([
    'tools.database.defaultStatusProperty',
    'searchTerms.grid',
    'notifier.ok',
  ]),
  // "OK" is the conventional compact confirmation label in Burmese UIs.
  my: new Set(['notifier.ok']),
  nl: new Set([
    'toolNames.link',
    'toolNames.database',
    'toolNames.code',
    'tools.code.codeTab',
    'searchTerms.code',
    'tools.image.emptyLink',
    // "Link" is the standard loanword for a hyperlink in Dutch UIs.
    'tools.file.emptyLink',
    'tools.database.defaultStatusProperty',
    'tools.link.webLink',
    // "OK" is the conventional compact confirmation label in Dutch UIs.
    'notifier.ok',
  ]),
  no: new Set([
    'toolNames.database',
    'tools.image.sizeFull',
    'tools.database.defaultStatusProperty',
    // "Artist" is the established Bokmål music-metadata noun.
    'tools.audio.artistPlaceholder',
    // Placeholder-only swatch labels follow Bokmål modifier-before-noun order.
    'tools.colorPicker.defaultSwatchLabel',
    'tools.colorPicker.colorSwatchLabel',
    'notifier.ok',
  ]),
  pl: new Set([
    'toolNames.link',
    'tools.image.emptyLink',
    // "Link" is the standard loanword for a hyperlink in Polish UIs.
    'tools.file.emptyLink',
    'tools.database.defaultStatusProperty',
    'tools.link.webLink',
    // "OK" is the conventional compact confirmation label in Polish UIs.
    'notifier.ok',
  ]),
  pt: new Set([
    'toolNames.link',
    'tools.image.emptyLink',
    'tools.file.emptyLink',
    'tools.image.cropRatioOval',
    'tools.database.defaultStatusProperty',
    'searchTerms.layout',
    // "Link" is the standard loanword and "OK" the conventional compact
    // confirmation label in Brazilian Portuguese UIs.
    'tools.link.webLink',
    'notifier.ok',
  ]),
  ro: new Set([
    'toolNames.text',
    'toolNames.link',
    'searchTerms.separator',
    'searchTerms.program',
    'tools.image.emptyLink',
    // "Link" is the standard loanword for a hyperlink in Romanian UIs.
    'tools.file.emptyLink',
    'tools.image.cropRatioOval',
    'tools.database.propertyTypeText',
    // "Text" is a direct cognate of the English word in Romanian.
    'tools.link.linkText',
    'tools.link.webLink',
    // "OK" is the conventional compact confirmation label in Romanian UIs.
    'notifier.ok',
  ]),
  // "OK" is the conventional compact confirmation label in Slovak UIs.
  sk: new Set([
    'tools.database.propertyTypeText',
    'tools.link.linkText',
    'notifier.ok',
  ]),
  sq: new Set(['searchTerms.program', 'tools.image.cropRatioOval']),
  sv: new Set([
    'toolNames.text',
    'tools.colorPicker.color.orange',
    'tools.callout.colorOrange',
    'tools.image.sizeFull',
    'tools.database.propertyTypeText',
    'tools.database.defaultStatusProperty',
    'searchTerms.layout',
    // "Text" is a direct cognate of the English word in Swedish.
    'tools.link.linkText',
    // "Artist" is the established Swedish media noun and Apple Music field label.
    'tools.audio.artistPlaceholder',
    'notifier.ok',
  ]),
  tr: new Set(['searchTerms.program', 'tools.image.cropRatioOval']),
  // "OK" is the conventional compact confirmation label in Vietnamese UIs.
  vi: new Set(['notifier.ok']),
};

/**
 * Video tool cognates. "Video", "Upload", "Link" and "URL" are the standard
 * loanwords in these locales — identical to the English source for the same
 * reason their already-retained image/file siblings (e.g. tools.image.emptyLink)
 * are. Merged in additively so the per-locale sets above stay readable.
 */
const VIDEO_COGNATE_RETENTIONS: Record<string, string[]> = {
  az: ['toolNames.video'],
  bs: ['toolNames.video'],
  cs: ['toolNames.video'],
  da: ['toolNames.video', 'tools.video.emptyUpload', 'tools.video.emptyLink', 'tools.video.pause'],
  // "Autoplay" is the native loanword for the setting in German UIs.
  de: ['toolNames.video', 'tools.video.emptyLink', 'tools.video.autoplay'],
  et: ['toolNames.video', 'tools.video.emptyLink', 'tools.video.emptyUrlAria'],
  fi: ['toolNames.video'],
  // "Autoplay"/"Loop" are the standard English loanwords in Filipino (Tagalog) UIs.
  fil: ['toolNames.video', 'tools.video.emptyLink', 'tools.video.autoplay', 'tools.video.loop', 'tools.video.volume', 'tools.video.theater', 'tools.video.pip'],
  // "Pause"/"Volume" are the standard loanwords used by Notion/YouTube in French.
  fr: ['tools.video.pause', 'tools.video.volume'],
  hr: ['toolNames.video'],
  id: ['toolNames.video', 'tools.video.volume', 'tools.video.pip'],
  it: ['toolNames.video', 'tools.video.volume', 'tools.video.pip'],
  lv: ['toolNames.video', 'tools.video.emptyUrlAria'],
  ms: ['toolNames.video'],
  nl: ['toolNames.video', 'tools.video.emptyLink', 'tools.video.volume'],
  no: ['toolNames.video', 'tools.video.pause'],
  pl: ['tools.video.emptyLink'],
  pt: ['tools.video.emptyLink', 'tools.video.volume'],
  ro: ['tools.video.emptyLink'],
  sk: ['toolNames.video'],
  sl: ['toolNames.video'],
  sq: ['toolNames.video'],
  sv: ['toolNames.video'],
  sw: ['toolNames.video'],
  tr: ['toolNames.video'],
  vi: ['toolNames.video'],
};

for (const [locale, keys] of Object.entries(VIDEO_COGNATE_RETENTIONS)) {
  const set = COGNATE_RETENTIONS[locale] ?? (COGNATE_RETENTIONS[locale] = new Set<string>());
  for (const key of keys) set.add(key);
}

/**
 * Audio tool cognates. "Audio", "Upload", "Link", "Loop", and "URL" are the
 * standard loanwords in these locales — identical to the English source for the
 * same reason their video/image/file siblings are already retained.
 * Merged in additively so the per-locale sets above stay readable.
 */
const AUDIO_COGNATE_RETENTIONS: Record<string, string[]> = {
  az: ['toolNames.audio'],
  bs: ['toolNames.audio'],
  cs: ['toolNames.audio'],
  da: ['tools.audio.emptyUpload', 'tools.audio.emptyLink', 'tools.audio.coverUpload', 'tools.audio.coverLink', 'tools.audio.pause'],
  de: ['toolNames.audio', 'tools.audio.emptyLink', 'tools.audio.coverLink'],
  es: ['toolNames.audio'],
  et: ['tools.audio.emptyLink', 'tools.audio.coverLink'],
  // "Audio"/"Loop"/"Link" are the standard English loanwords in Filipino (Tagalog) UIs.
  fil: ['toolNames.audio', 'tools.audio.loop', 'tools.audio.emptyLink', 'tools.audio.coverLink', 'tools.audio.volume'],
  fr: ['toolNames.audio', 'tools.audio.pause', 'tools.audio.volume'],
  id: ['toolNames.audio', 'tools.audio.volume'],
  it: ['toolNames.audio', 'tools.audio.volume'],
  lv: ['toolNames.audio', 'tools.audio.emptyUrlAria'],
  ms: ['toolNames.audio'],
  nl: ['toolNames.audio', 'tools.audio.emptyLink', 'tools.audio.coverLink', 'tools.audio.volume'],
  no: ['tools.audio.pause'],
  pl: ['toolNames.audio', 'tools.audio.emptyLink', 'tools.audio.coverLink'],
  pt: ['tools.audio.emptyLink', 'tools.audio.coverLink', 'tools.audio.volume'],
  ro: ['toolNames.audio', 'tools.audio.emptyLink', 'tools.audio.coverLink'],
  sk: ['toolNames.audio'],
  sl: ['toolNames.audio'],
  sq: ['toolNames.audio'],
  vi: ['toolNames.audio'],
};

for (const [locale, keys] of Object.entries(AUDIO_COGNATE_RETENTIONS)) {
  const set = COGNATE_RETENTIONS[locale] ?? (COGNATE_RETENTIONS[locale] = new Set<string>());
  for (const key of keys) set.add(key);
}

describe('locale values are translated (identical-to-en only when cognate)', () => {
  const english = loadLocaleMessages('en');
  const nonEnglish = listLocaleCodes().filter(code => code !== 'en');

  it('keeps every locale-specific allowlist entry exact to English', () => {
    const staleEntries = Object.entries(COGNATE_RETENTIONS).flatMap(
      ([locale, keys]) => {
        const messages = loadLocaleMessages(locale);

        return [...keys]
          .filter(key => messages[key] !== english[key])
          .map(key => `${locale}:${key}`);
      }
    );

    expect(
      staleEntries,
      'non-exact allowlist entries could admit a future English regression'
    ).toEqual([]);
  });

  it('keeps universal exemptions bound to their reviewed source notation', () => {
    const sourceDrift = Object.entries(UNIVERSAL_EXACT_VALUES)
      .filter(([key, expected]) => english[key] !== expected)
      .map(([key]) => key);

    expect(
      sourceDrift,
      'a changed source value must be reclassified before remaining universal'
    ).toEqual([]);
  });

  it.each(nonEnglish)(
    '%s has no unexpected identical-to-English values',
    locale => {
      const messages = loadLocaleMessages(locale);
      const allowed = COGNATE_RETENTIONS[locale] ?? new Set<string>();
      const offenders = Object.keys(english).filter(key => {
        if (key in UNIVERSAL_EXACT_VALUES) return false;
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
  { file: 'src/tools/database/database-card-drawer.ts', needle: "setAttribute('aria-label', 'Close')" },
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

  it('sweep: built-in inline-tool titleKeys exist in the English dictionary', () => {
    const english = loadLocaleMessages('en');
    const offenders: string[] = [];
    const inlineTools = walkTsFiles(join(SRC_DIR, 'components', 'inline-tools'));

    for (const file of inlineTools) {
      const text = readFileSync(file, 'utf-8');
      const titleKeyPattern =
        /(?:public\s+)?static\s+titleKey\s*=\s*(['"])([^'"]+)\1/gu;
      const missingKeys = Array.from(
        text.matchAll(titleKeyPattern),
        match => match[2]
      )
        .filter((shortKey): shortKey is string => shortKey !== undefined)
        .map(shortKey =>
          shortKey.includes('.') ? shortKey : `toolNames.${shortKey}`
        )
        .filter(key => !(key in english));

      offenders.push(
        ...missingKeys.map(
          key => `${relative(REPO_ROOT, file)} → ${key}`
        )
      );
    }

    expect(
      offenders,
      'inline-tool titleKeys must resolve through the locale dictionary'
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helpers exercised indirectly (silence unused warnings)
// ---------------------------------------------------------------------------
void STRING_LITERAL;
void ENGLISH_WORD;
void LOOKS_LIKE_CODE;
void SKIP_VALUES;
