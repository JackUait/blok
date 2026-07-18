#!/usr/bin/env node
/**
 * Tests for check-translations.mjs
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractKeysFromSource,
  extractPlaceholders,
  findDuplicateJsonKeys,
  findLocaleIntegrityIssues,
  scanSourceKeys,
  detectDoubleEncoding,
  findUntranslatedKeys,
} from './check-translations.mjs';

function runCheckerFixture(sourceRaw, localeRaw) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'blok-i18n-checker-')));
  const scriptDir = join(root, 'scripts/i18n');
  const localesDir = join(root, 'src/components/i18n/locales');
  const scriptPath = join(scriptDir, 'check-translations.mjs');

  try {
    mkdirSync(scriptDir, { recursive: true });
    mkdirSync(join(localesDir, 'en'), { recursive: true });
    mkdirSync(join(localesDir, 'fr'), { recursive: true });
    writeFileSync(
      scriptPath,
      readFileSync(new URL('./check-translations.mjs', import.meta.url), 'utf8')
    );
    writeFileSync(join(localesDir, 'en/messages.json'), sourceRaw);
    writeFileSync(join(localesDir, 'fr/messages.json'), localeRaw);

    return spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('translation checker CLI integrity reporting', () => {
  it('reports source and target findings as errors without crashing on non-strings', () => {
    const sourceRaw = `{
      "message.placeholder": "Move {count}",
      "message.type": "Malformed",
      "message.source": "Source",
      "message.source": "Source"
    }`;
    const localeRaw = `{
      "message.placeholder": "Move",
      "message.placeholder": "Move",
      "message.type": ["é", 42],
      "message.source": "Source traduite"
    }`;

    const result = runCheckerFixture(sourceRaw, localeRaw);
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /en:message\.source: duplicate-json-key/);
    assert.match(output, /fr:message\.placeholder: duplicate-json-key/);
    assert.match(output, /fr:message\.placeholder: placeholder-mismatch/);
    assert.match(output, /fr:message\.type: non-string/);
    assert.doesNotMatch(output, /TypeError/);
  });

  it('exits successfully for clean locale files', () => {
    const sourceRaw = `{
      "message.value": "Move {count}"
    }`;
    const localeRaw = `{
      "message.value": "Déplacer {count}"
    }`;

    const result = runCheckerFixture(sourceRaw, localeRaw);
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0);
    assert.match(output, /Locale integrity check passed!/);
  });

  it('reports non-string source values without crashing on later locales', () => {
    const sourceRaw = `{
      "message.value": ["é", 42]
    }`;
    const localeRaw = `{
      "message.value": "Valeur"
    }`;

    const result = runCheckerFixture(sourceRaw, localeRaw);
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /en:message\.value: non-string/);
    assert.doesNotMatch(output, /TypeError/);
  });
});

describe('extractPlaceholders', () => {
  it('returns a sorted placeholder multiset', () => {
    assert.deepEqual(
      extractPlaceholders('{total}: {position} / {total}'),
      ['position', 'total', 'total']
    );
  });

  it('returns an empty array when a value has no placeholders', () => {
    assert.deepEqual(extractPlaceholders('Delete'), []);
  });
});

describe('findDuplicateJsonKeys', () => {
  it('returns each duplicate flat JSON key once', () => {
    const raw = `{
      "popover.search": "Search",
      "toolNames.text": "Text",
      "popover.search": "Find",
      "popover.search": "Lookup"
    }`;

    assert.deepEqual(findDuplicateJsonKeys(raw), ['popover.search']);
  });

  it('returns no duplicates for clean flat JSON', () => {
    const raw = `{
      "popover.search": "Search",
      "toolNames.text": "Text"
    }`;

    assert.deepEqual(findDuplicateJsonKeys(raw), []);
  });

  it('finds duplicate keys in compact flat JSON', () => {
    const raw = '{"popover.search":"Search","popover.search":"Find"}';

    assert.deepEqual(findDuplicateJsonKeys(raw), ['popover.search']);
  });

  it('compares decoded JSON keys', () => {
    const raw = '{"a":"First","\\u0061":"Second"}';

    assert.deepEqual(findDuplicateJsonKeys(raw), ['a']);
  });
});

describe('findLocaleIntegrityIssues', () => {
  it('reports non-string values', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Delete' },
        { 'message.key': 42 }
      ),
      [{ key: 'message.key', kind: 'non-string', value: 42 }]
    );
  });

  it('reports intrinsic issues on extra translation keys', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Delete' },
        { 'message.key': 'Supprimer', 'extra.key': 42 }
      ),
      [{ key: 'extra.key', kind: 'non-string', value: 42 }]
    );
  });

  it('reports whitespace-only values', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': '   ' },
        { 'message.key': '   ' }
      ),
      [{ key: 'message.key', kind: 'empty', value: '   ' }]
    );
  });

  it('reports a lost placeholder', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Move {count}' },
        { 'message.key': 'Move' }
      ),
      [{ key: 'message.key', kind: 'placeholder-mismatch', value: 'Move' }]
    );
  });

  it('reports an added placeholder', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Move' },
        { 'message.key': 'Move {count}' }
      ),
      [{ key: 'message.key', kind: 'placeholder-mismatch', value: 'Move {count}' }]
    );
  });

  it('reports placeholder duplicate-count drift', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': '{count} of {count}' },
        { 'message.key': '{count}' }
      ),
      [{ key: 'message.key', kind: 'placeholder-mismatch', value: '{count}' }]
    );
  });

  it('reports boundary whitespace drift', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': ' or ' },
        { 'message.key': 'or' }
      ),
      [{ key: 'message.key', kind: 'boundary-whitespace', value: 'or' }]
    );
  });

  it('reports non-NFC values', () => {
    const decomposed = 'Cafe\u0301';

    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Café' },
        { 'message.key': decomposed }
      ),
      [{ key: 'message.key', kind: 'non-nfc', value: decomposed }]
    );
  });

  it('reports Unicode replacement characters', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        { 'message.key': 'Merge' },
        { 'message.key': 'Mer\uFFFDge' }
      ),
      [{ key: 'message.key', kind: 'replacement-character', value: 'Mer\uFFFDge' }]
    );
  });

  for (const codePoint of [...Array(0x20).keys(), 0x7f]) {
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

    it(`reports ${label} control characters`, () => {
      const value = `Mer${String.fromCodePoint(codePoint)}ge`;

      assert.deepEqual(
        findLocaleIntegrityIssues(
          { 'message.key': 'Merge' },
          { 'message.key': value }
        ),
        [{ key: 'message.key', kind: 'control-character', value }]
      );
    });
  }

  it('returns no issues for clean translated values', () => {
    assert.deepEqual(
      findLocaleIntegrityIssues(
        {
          action: 'Move {count}',
          spaced: ' or ',
          clean: 'Merge',
        },
        {
          action: 'Déplacer {count}',
          spaced: ' ou ',
          clean: 'Fusionner',
        }
      ),
      []
    );
  });
});

describe('extractKeysFromSource', () => {
  it('extracts single-quoted static keys', () => {
    const source = `i18n.t('tools.stub.error')`;
    const keys = extractKeysFromSource(source);
    assert.deepEqual([...keys], ['tools.stub.error']);
  });

  it('extracts double-quoted static keys', () => {
    const source = `i18n.t("tools.stub.error")`;
    const keys = extractKeysFromSource(source);
    assert.deepEqual([...keys], ['tools.stub.error']);
  });

  it('skips dynamic keys (variable arguments)', () => {
    const source = `i18n.t(someVariable)`;
    const keys = extractKeysFromSource(source);
    assert.equal(keys.size, 0);
  });

  it('skips template literal keys', () => {
    const source = 'i18n.t(`tools.${name}`)';
    const keys = extractKeysFromSource(source);
    assert.equal(keys.size, 0);
  });

  it('skips strings without a dot (not valid i18n key format)', () => {
    const source = `api.i18n.t('key')`;
    const keys = extractKeysFromSource(source);
    assert.equal(keys.size, 0);
  });

  it('skips dynamic key prefixes ending with a dot', () => {
    const source = `i18n.t('tools.colorPicker.color.' + preset.name)`;
    const keys = extractKeysFromSource(source);
    assert.equal(keys.size, 0);
  });

  it('extracts multiple keys from multi-line source', () => {
    const source = `
      this.t('blockSettings.delete')
      this.t("popover.search")
      this.t(dynamicKey)
    `;
    const keys = extractKeysFromSource(source);
    assert.deepEqual([...keys].sort(), ['blockSettings.delete', 'popover.search']);
  });
});

describe('scanSourceKeys', () => {
  it('collects keys from all .ts files in a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-i18n-test-'));
    writeFileSync(join(dir, 'a.ts'), `i18n.t('tools.stub.error')`);
    writeFileSync(join(dir, 'b.ts'), `i18n.t("popover.search")`);

    const keys = scanSourceKeys(dir);
    assert.ok(keys.has('tools.stub.error'));
    assert.ok(keys.has('popover.search'));
  });

  it('recurses into subdirectories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-i18n-test-'));
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'c.ts'), `i18n.t('a11y.dragHandle')`);

    const keys = scanSourceKeys(dir);
    assert.ok(keys.has('a11y.dragHandle'));
  });

  it('ignores non-.ts files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-i18n-test-'));
    writeFileSync(join(dir, 'readme.md'), `i18n.t('should.be.ignored')`);

    const keys = scanSourceKeys(dir);
    assert.equal(keys.size, 0);
  });
});

describe('detectDoubleEncoding', () => {
  it('detects double-encoded UTF-8 values', () => {
    // Simulate double-encoding: "Цвет" → UTF-8 bytes → misread as Latin-1 → re-encode UTF-8
    const original = 'Цвет';
    const doubleEncoded = Buffer.from(Buffer.from(original, 'utf8').toString('latin1'), 'utf8').toString();
    const translation = {
      'good.key': 'Цвет',
      'bad.key': doubleEncoded,
    };
    const issues = detectDoubleEncoding(translation);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].key, 'bad.key');
    assert.equal(issues[0].corrected, 'Цвет');
  });

  it('returns empty array for clean translations', () => {
    const translation = {
      key1: 'Цвет',
      key2: 'Текст',
      key3: 'Hello',
    };
    const issues = detectDoubleEncoding(translation);
    assert.equal(issues.length, 0);
  });

  it('ignores non-string values', () => {
    const translation = {
      array: ['é', 42],
      object: { nested: 'é' },
      number: 42,
    };

    assert.deepEqual(detectDoubleEncoding(translation), []);
  });

  it('does not false-positive on multi-byte non-Latin scripts', () => {
    const translation = {
      tamil: 'நிறம்',
      japanese: 'カラー',
      chinese: '颜色',
      korean: '색상',
      arabic: 'اللون',
      greek: 'Χρώμα',
    };
    const issues = detectDoubleEncoding(translation);
    assert.equal(issues.length, 0);
  });

  it('does not false-positive on accented Latin characters', () => {
    const translation = {
      swedish: 'Färg',
      german: 'Überschrift',
      french: 'Supprimé',
    };
    const issues = detectDoubleEncoding(translation);
    assert.equal(issues.length, 0);
  });

  it('detects double-encoded CJK values', () => {
    // "カラー" (katakana for "color") double-encoded
    const original = 'カラー';
    const doubleEncoded = Buffer.from(Buffer.from(original, 'utf8').toString('latin1'), 'utf8').toString();
    const translation = { key: doubleEncoded };
    const issues = detectDoubleEncoding(translation);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].corrected, original);
  });
});

describe('findUntranslatedKeys', () => {
  it('detects values identical to English source', () => {
    const source = { 'key1': 'Delete', 'key2': 'Search' };
    const translation = { 'key1': 'Delete', 'key2': 'Поиск' };
    const keys = findUntranslatedKeys(source, translation);
    assert.deepEqual(keys, ['key1']);
  });

  it('returns empty for fully translated locale', () => {
    const source = { 'key1': 'Delete', 'key2': 'Search' };
    const translation = { 'key1': 'Удалить', 'key2': 'Поиск' };
    const keys = findUntranslatedKeys(source, translation);
    assert.equal(keys.length, 0);
  });

  it('returns empty when source and translation are the same object', () => {
    const source = { 'key1': 'Delete' };
    // English source compared to itself should return all keys,
    // but this function is only called for non-English locales
    const keys = findUntranslatedKeys(source, source);
    assert.deepEqual(keys, ['key1']);
  });

  it('handles missing keys gracefully', () => {
    const source = { 'key1': 'Delete', 'key2': 'Search' };
    const translation = { 'key1': 'Delete' };
    // key2 is missing, not untranslated — only flag exact matches
    const keys = findUntranslatedKeys(source, translation);
    assert.deepEqual(keys, ['key1']);
  });
});
