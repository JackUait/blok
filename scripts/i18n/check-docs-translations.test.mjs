#!/usr/bin/env node

/**
 * Tests for check-docs-translations.mjs
 *
 * Run with: node scripts/i18n/check-docs-translations.test.mjs
 */

import assert from 'node:assert/strict';
import { extractKeys, findMissingKeys, findExtraKeys, discoverLocales } from './check-docs-translations.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function createTempDir() {
  const dir = join(tmpdir(), `i18n-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLangFile(dir, locale, content) {
  writeFileSync(join(dir, `${locale}.json`), JSON.stringify(content));
}

// ─── extractKeys ─────────────────────────────────────────────────────────────

console.log('\nextractKeys()');

test('returns leaf keys as dot-notation paths from a flat object', () => {
  const result = extractKeys({ a: '1', b: '2' });
  assert.deepEqual(result, new Set(['a', 'b']));
});

test('recurses into nested objects', () => {
  const result = extractKeys({ nav: { home: 'Home', about: 'About' } });
  assert.deepEqual(result, new Set(['nav.home', 'nav.about']));
});

test('handles deeply nested objects', () => {
  const result = extractKeys({ a: { b: { c: 'deep' } } });
  assert.deepEqual(result, new Set(['a.b.c']));
});

test('handles mixed depth', () => {
  const result = extractKeys({ top: 'value', nested: { key: 'val' } });
  assert.deepEqual(result, new Set(['top', 'nested.key']));
});

test('returns empty set for empty object', () => {
  assert.deepEqual(extractKeys({}), new Set());
});

// ─── findMissingKeys ─────────────────────────────────────────────────────────

console.log('\nfindMissingKeys(sourceKeys, targetKeys)');

test('returns keys present in source but not in target', () => {
  const source = new Set(['a', 'b', 'c']);
  const target = new Set(['a', 'b']);
  assert.deepEqual(findMissingKeys(source, target), ['c']);
});

test('returns empty array when target has all source keys', () => {
  const source = new Set(['a', 'b']);
  const target = new Set(['a', 'b', 'c']); // extra keys are ok here
  assert.deepEqual(findMissingKeys(source, target), []);
});

test('returns all keys when target is empty', () => {
  const source = new Set(['x', 'y']);
  assert.deepEqual(findMissingKeys(source, new Set()).sort(), ['x', 'y']);
});

test('returns sorted results', () => {
  const source = new Set(['z', 'a', 'm']);
  const result = findMissingKeys(source, new Set());
  assert.deepEqual(result, ['a', 'm', 'z']);
});

// ─── findExtraKeys ────────────────────────────────────────────────────────────

console.log('\nfindExtraKeys(sourceKeys, targetKeys)');

test('returns keys present in target but not in source', () => {
  const source = new Set(['a', 'b']);
  const target = new Set(['a', 'b', 'c']);
  assert.deepEqual(findExtraKeys(source, target), ['c']);
});

test('returns empty array when target has no extra keys', () => {
  const source = new Set(['a', 'b', 'c']);
  const target = new Set(['a', 'b']);
  assert.deepEqual(findExtraKeys(source, target), []);
});

test('returns sorted results', () => {
  const source = new Set(['a']);
  const target = new Set(['a', 'z', 'm']);
  assert.deepEqual(findExtraKeys(source, target), ['m', 'z']);
});

// ─── discoverLocales ─────────────────────────────────────────────────────────

console.log('\ndiscoverLocales(dir, sourceLocale)');

test('discovers all .json files in directory as locales', () => {
  const dir = createTempDir();
  try {
    writeLangFile(dir, 'en', {});
    writeLangFile(dir, 'ru', {});
    writeLangFile(dir, 'de', {});
    const result = discoverLocales(dir, 'en');
    assert.deepEqual(result.sort(), ['de', 'ru']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('excludes the source locale from results', () => {
  const dir = createTempDir();
  try {
    writeLangFile(dir, 'en', {});
    writeLangFile(dir, 'fr', {});
    const result = discoverLocales(dir, 'en');
    assert.deepEqual(result, ['fr']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('returns empty array when only source locale exists', () => {
  const dir = createTempDir();
  try {
    writeLangFile(dir, 'en', {});
    const result = discoverLocales(dir, 'en');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('ignores non-.json files', () => {
  const dir = createTempDir();
  try {
    writeLangFile(dir, 'en', {});
    writeLangFile(dir, 'ru', {});
    writeFileSync(join(dir, 'index.ts'), '// not a locale');
    writeFileSync(join(dir, 'README.md'), '# readme');
    const result = discoverLocales(dir, 'en');
    assert.deepEqual(result, ['ru']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('handles future languages — discovers any .json locale automatically', () => {
  const dir = createTempDir();
  try {
    writeLangFile(dir, 'en', {});
    writeLangFile(dir, 'ru', {});
    writeLangFile(dir, 'zh', {});
    writeLangFile(dir, 'ar', {});
    writeLangFile(dir, 'pt-BR', {});
    const result = discoverLocales(dir, 'en').sort();
    assert.deepEqual(result, ['ar', 'pt-BR', 'ru', 'zh']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`\x1b[32mAll ${passed} tests passed\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${failed} test(s) failed\x1b[0m (${passed} passed)\n`);
  process.exit(1);
}
