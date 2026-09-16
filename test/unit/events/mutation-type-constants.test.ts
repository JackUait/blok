/**
 * `types/events/block/*.ts` declare the four mutation-type constants with a
 * real `export const`, and `types/index.d.ts` re-exports them as VALUES. The
 * runtime entries never re-exported them, so
 * `import { BlockAddedMutationType } from '@bloklabs/core'` type-checked and
 * then blew up at runtime — which is why consumers hardcode 'block-added'.
 *
 * Both published entries that carry the type re-export must carry the runtime
 * value: `./index` (types/index.d.ts) and `./full` (types/full.d.ts re-exports
 * `export * from './index'`).
 */
import { describe, expect, it } from 'vitest';

import * as blokEntry from '../../../src/blok';
import * as fullEntry from '../../../src/full';

const MUTATION_TYPE_CONSTANTS = [
  ['BlockAddedMutationType', 'block-added'],
  ['BlockRemovedMutationType', 'block-removed'],
  ['BlockMovedMutationType', 'block-moved'],
  ['BlockChangedMutationType', 'block-changed'],
] as const;

describe('block mutation-type constants have a runtime value', () => {
  it.each(MUTATION_TYPE_CONSTANTS)('the core entry exports %s as %s', (name, value) => {
    expect(blokEntry[name]).toBe(value);
  });

  it.each(MUTATION_TYPE_CONSTANTS)('the full entry exports %s as %s', (name, value) => {
    expect(fullEntry[name]).toBe(value);
  });
});
