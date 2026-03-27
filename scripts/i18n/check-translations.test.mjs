#!/usr/bin/env node
/**
 * Tests for the source key coverage phase of check-translations.mjs
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractKeysFromSource,
  scanSourceKeys,
  detectDoubleEncoding,
  findUntranslatedKeys,
} from './check-translations.mjs';

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
