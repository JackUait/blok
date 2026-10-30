// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expandRecipe, generate, normalizeIds } from '../../../scripts/generate-documents-ops-fixture.mjs';

/**
 * Pins fixtures/documents/ops.json to the committed runtime bundle. The C#
 * DocumentOpsFixtureTests (Jint) and the Go jsruntime tests (goja) read it.
 * Regenerate with `node scripts/generate-documents-ops-fixture.mjs`.
 */
const FIXTURE = fileURLToPath(new URL('./fixtures/documents/ops.json', import.meta.url));

describe('documents ops fixture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches what the bundle answers under node:vm', async () => {
    const committed: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    expect(committed, 'Run `node scripts/generate-documents-ops-fixture.mjs`.').toStrictEqual(await generate());
  }, 120_000);

  it('expands a recipe with the index in every item', () => {
    expect(expandRecipe({ parts: ['[', { repeat: 4, join: ',', items: ['a{i}', 'b{i}'] }, ']'] })).toBe('[a0,b1,a2,b3]');
  });

  it('rewrites only the clock part of an import id', () => {
    expect(normalizeIds('{"id":"md-mvve8e62-0","x":"html-ab12-3","y":"md-x"}'))
      .toBe('{"id":"md-X-0","x":"html-X-3","y":"md-x"}');
  });
});
