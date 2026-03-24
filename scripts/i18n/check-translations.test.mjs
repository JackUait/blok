#!/usr/bin/env node
/**
 * Tests for the source key coverage phase of check-translations.mjs
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractKeysFromSource, scanSourceKeys } from './check-translations.mjs';

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
