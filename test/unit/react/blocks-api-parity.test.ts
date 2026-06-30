// test/unit/react/blocks-api-parity.test.ts
//
// ROOT-CAUSE GUARD against React/core block-API drift.
//
// `UseBlocksApi` is hand-authored and has NO structural link to core's `Blocks`
// contract (types/api/blocks.d.ts). So when core grows a method, nothing fails
// and the React surface silently falls behind — exactly how `render`, `clear`,
// `insertInsideParent`, and `isSyncingFromYjs` went missing.
//
// This map forces a DECISION for every member of core's `Blocks`: expose it,
// document the React rename that covers it, or mark it deliberately internal.
//   - Compile-time: `Record<keyof Blocks, …>` makes `tsc` (yarn lint) reject a
//     NEW core member until it is classified here.
//   - Runtime: the assertions below verify each 'exposed'/'renamed' member is
//     actually reachable on the hook's surface (read from the pre-ready
//     EMPTY_API, which is a complete UseBlocksApi witness), and that 'internal'
//     members are NOT leaked. So a classification that lies also fails.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBlocks } from '../../../src/react/useBlocks';
import type { Blocks } from '../../../types/api/blocks';
import type { UseBlocksApi } from '../../../src/react/blocks-snapshot';

type Classification =
  // Present on UseBlocksApi under the SAME name.
  | { kind: 'exposed' }
  // Covered by a differently-named React API (richer/id-relative wrapper).
  | { kind: 'renamed'; reactNames: ReadonlyArray<keyof UseBlocksApi> }
  // Deliberately NOT on the React surface (internal mutation-control primitive).
  | { kind: 'internal'; reason: string };

const CORE_TO_REACT: Record<keyof Blocks, Classification> = {
  isSyncingFromYjs: { kind: 'exposed' },
  isPointerDragActive: {
    kind: 'internal',
    reason: 'read-side of the pointer-drag suppression flag; consumed by adapter commit-debounce, not app code',
  },
  clear: { kind: 'exposed' },
  render: { kind: 'exposed' },
  renderFromHTML: { kind: 'exposed' },
  // Core's importMarkdown REPLACES the whole document; React models markdown
  // import as the ADDITIVE, position-aware insertMarkdown (replace is composed
  // from clear() + insertMarkdown or the controlled `data` prop).
  importMarkdown: { kind: 'renamed', reactNames: ['insertMarkdown'] },
  // React exposes id-relative removal; core's index-based delete is the engine.
  delete: { kind: 'renamed', reactNames: ['remove'] },
  move: { kind: 'exposed' },
  getBlockByIndex: { kind: 'exposed' },
  getById: { kind: 'exposed' },
  getCurrentBlockIndex: { kind: 'exposed' },
  getBlockIndex: { kind: 'exposed' },
  getBlockByElement: { kind: 'exposed' },
  getChildren: { kind: 'exposed' },
  // React models reparenting as nest/unnest (subtree-aware), not a raw setter.
  setBlockParent: { kind: 'renamed', reactNames: ['nest', 'unnest'] },
  getBlocksCount: { kind: 'exposed' },
  insert: { kind: 'exposed' },
  insertMany: { kind: 'exposed' },
  composeBlockData: { kind: 'exposed' },
  update: { kind: 'exposed' },
  convert: { kind: 'exposed' },
  stopBlockMutationWatching: {
    kind: 'internal',
    reason: 'block-replace internal; not a consumer-facing creation primitive',
  },
  splitBlock: { kind: 'exposed' },
  insertInsideParent: { kind: 'exposed' },
  transact: { kind: 'exposed' },
  transactWithoutCapture: { kind: 'exposed' },
  setPointerDragActive: {
    kind: 'internal',
    reason: 'pointer-drag suppression flag; owned by DragManager, not app code',
  },
};

describe('React block-API parity with core Blocks contract', () => {
  // Witness the LIVE (editor-ready) surface, NOT the pre-ready EMPTY_API. Reading
  // `useBlocks(null)` would only prove EMPTY_API has a key — a method present in
  // the interface + EMPTY_API but NEVER wired into the live `return {…}` object
  // would leak EMPTY_API's no-op stub and this guard would stay falsely green.
  // A minimal non-null editor builds the real api object (its method closures are
  // not invoked at construction, so a bare blocks bag + on/off is enough).
  const minimalEditor = {
    blocks: {} as never,
    on: () => undefined,
    off: () => undefined,
  } as unknown as Parameters<typeof useBlocks>[0];

  const { result: live } = renderHook(() => useBlocks(minimalEditor));
  const reactKeys = new Set(Object.keys(live.current));

  // Pre-ready completeness: EMPTY_API must expose the EXACT same key set as the
  // live surface, so a mutator called before the editor resolves is a real no-op
  // (not `undefined`). Catches a method added live but forgotten in EMPTY_API.
  const { result: preReady } = renderHook(() => useBlocks(null));
  const emptyKeys = new Set(Object.keys(preReady.current));

  it('the pre-ready (EMPTY_API) surface exposes the same keys as the live surface', () => {
    expect([...emptyKeys].sort()).toEqual([...reactKeys].sort());
  });

  for (const [coreName, classification] of Object.entries(CORE_TO_REACT)) {
    it(`core "${coreName}" is accounted for on the live React surface`, () => {
      if (classification.kind === 'exposed') {
        expect(reactKeys).toContain(coreName);
      } else if (classification.kind === 'renamed') {
        for (const reactName of classification.reactNames) {
          expect(reactKeys).toContain(reactName);
        }
      } else {
        // 'internal': keep the omission honest — it must NOT be silently exposed.
        expect(reactKeys).not.toContain(coreName);
      }
    });
  }
});
