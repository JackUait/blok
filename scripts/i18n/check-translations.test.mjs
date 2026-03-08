#!/usr/bin/env node
/**
 * Tests for the source key coverage phase of check-translations.mjs
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { extractKeysFromSource } from './check-translations.mjs';

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
