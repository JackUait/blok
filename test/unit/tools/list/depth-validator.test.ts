/**
 * Unit tests for ListDepthValidator
 */

import { describe, it, expect } from 'vitest';
import { ListDepthValidator, resolveTargetDepth, selectPointerDepth } from '../../../../src/tools/list/depth-validator';
import type { BlocksAPI } from '../../../../src/tools/list/marker-calculator';

describe('ListDepthValidator', () => {
  // Mock block factory
  const createMockBlock = (options: {
    name?: string;
    depth?: number;
  } = {}) => {
    const { name = 'list', depth = 0 } = options;

    const roleItem = document.createElement('div');
    roleItem.setAttribute('role', 'listitem');
    if (depth > 0) {
      roleItem.style.marginLeft = `${depth * 27}px`;
    }

    return {
      id: `block-${Math.random()}`,
      name,
      holder: {
        querySelector: (selector: string) => {
          if (selector === '[role="listitem"]') return roleItem;
          return null;
        },
      },
    };
  };

  const createMockBlocksAPI = (blocks: ReturnType<typeof createMockBlock>[]): BlocksAPI => {
    return {
      getBlockByIndex: (index: number) => blocks[index] ?? undefined,
      getBlockIndex: () => 0,
      getBlocksCount: () => blocks.length,
      getCurrentBlockIndex: () => 0,
    };
  };

  describe('getMaxAllowedDepth', () => {
    it('allows one level of nesting for the first item (index 0)', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      // First-in-group items can nest to depth 1 (one level)
      expect(validator.getMaxAllowedDepth(0)).toBe(1);
    });

    it('allows one level of nesting when previous block is not a list item', () => {
      const blocks = [createMockBlock({ name: 'paragraph' })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('allows one level of nesting when there is no previous block', () => {
      const blocks: ReturnType<typeof createMockBlock>[] = [];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Index 1 but no blocks at all — still first-in-group
      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('returns previous.depth + 1 when previous is a list item at depth 0', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('returns previous.depth + 1 when previous is a nested list item', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
      expect(validator.getMaxAllowedDepth(2)).toBe(2);
    });

    it('returns 1 when previous is at depth 0', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(1)).toBe(1);
    });

    it('returns 2 when previous is at depth 1', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getMaxAllowedDepth(2)).toBe(2);
    });
  });

  describe('isValidDepth', () => {
    it('returns true for depth 0 at index 0', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, 0)).toBe(true);
    });

    it('allows depth 0 and 1 at index 0, rejects deeper', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, 0)).toBe(true);
      expect(validator.isValidDepth(0, 1)).toBe(true);
      expect(validator.isValidDepth(0, 2)).toBe(false);
    });

    it('returns true for valid depth after a list item', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(1, 0)).toBe(true);
      expect(validator.isValidDepth(1, 1)).toBe(true);
    });

    it('returns false for depth exceeding max allowed', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(1, 2)).toBe(false);
    });

    it('returns false for negative depth', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.isValidDepth(0, -1)).toBe(false);
    });
  });

  describe('getTargetDepthForMove', () => {
    it('caps depth to 1 for first position (first-in-group max is 1)', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 2 })).toBe(1);
    });

    it('caps depth to max allowed', () => {
      const blocks = [createMockBlock({ depth: 0 })];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Max allowed at index 1 is 1, so depth 2 should be capped to 1
      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 2 })).toBe(1);
    });

    it('matches next block depth when next is deeper and within max allowed', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Dropping at index 1 with current depth 0, next is depth 1
      // Max allowed at index 1 is 1 (previous is depth 0)
      // Should match next depth to become sibling
      const result = validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0 });
      expect(result).toBe(1);
    });

    it('matches next depth at index 0 since first-in-group allows depth 1', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // At index 0, max is 1, next depth 1 > current 0 and within max → promote to 1
      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 0 })).toBe(1);
    });

    it('matches previous depth when previous is deeper and no next list item', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      // Dropping at index 2 (after the depth 1 item), current depth 0
      // Previous is depth 1, no next list item
      const result = validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 });
      expect(result).toBe(1);
    });

    it('matches a deeper previous depth even when a shallower next list item follows (nest from the bottom)', () => {
      // Video repro: First(0), Second(1), Third(0). Dropping a block in the gap
      // below the nested Second item (and above the shallower Third) must NEST to
      // depth 1 — prev(1), dropped(1), next(0) is a valid structure. A shallower
      // next item must NOT pull the drop back to root. Only a *deeper* next item
      // (handled by shouldMatchNextDepth) overrides the previous-depth match.
      const blocks = [
        createMockBlock({ depth: 0 }), // index 0: First
        createMockBlock({ depth: 1 }), // index 1: Second (previous)
        createMockBlock({ depth: 0 }), // index 2: placeholder for the moved block
        createMockBlock({ depth: 0 }), // index 3: Third (next, shallower)
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 })).toBe(1);
    });

    it('keeps current depth when no adjustments needed', () => {
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 0 }),
      ];
      const blocksAPI = createMockBlocksAPI(blocks);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0 })).toBe(0);
    });

    it('handles empty editor', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getTargetDepthForMove({ blockIndex: 0, currentDepth: 0 })).toBe(0);
    });

    describe('skipDepthPromotion (group move flag)', () => {
      it('skips shouldMatchNextDepth promotion when skipDepthPromotion is true', () => {
        // Reproduces the group-drag bug: root item (d0) is followed by its child (d1).
        // Without the flag, shouldMatchNextDepth bumps root to d1 (treats child as sibling).
        // With the flag, root stays at d0.
        //
        // blockIndex=1 → prev=blocks[0]=Second(d0), next=blocks[2]=NestedA(d1)
        const blocks = [
          createMockBlock({ depth: 0 }), // index 0: Second (prev)
          createMockBlock({ depth: 0 }), // index 1: placeholder for the moved block
          createMockBlock({ depth: 1 }), // index 2: NestedA (next)
        ];
        const blocksAPI = createMockBlocksAPI(blocks);
        const validator = new ListDepthValidator(blocksAPI);

        // Without flag: next(d1) > current(d0) and d1 ≤ maxAllowed(1) → promotes to 1
        expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0 })).toBe(1);
        // With flag: promotion skipped → stays at 0
        expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0, skipDepthPromotion: true })).toBe(0);
      });

      it('skips shouldMatchPreviousDepth promotion when skipDepthPromotion is true', () => {
        const blocks = [
          createMockBlock({ depth: 0 }),
          createMockBlock({ depth: 1 }),
        ];
        const blocksAPI = createMockBlocksAPI(blocks);
        const validator = new ListDepthValidator(blocksAPI);

        // Index 2, prev=depth-1, no next → would promote to 1
        expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 })).toBe(1);
        expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0, skipDepthPromotion: true })).toBe(0);
      });

      it('still caps depth exceeding maxAllowedDepth even when skipDepthPromotion is true', () => {
        const blocks = [createMockBlock({ depth: 0 })];
        const blocksAPI = createMockBlocksAPI(blocks);
        const validator = new ListDepthValidator(blocksAPI);

        // Max allowed at index 1 is 1; depth 2 must still be capped
        expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 2, skipDepthPromotion: true })).toBe(1);
      });

      it('preserves valid depth without promoting when skipDepthPromotion is true', () => {
        const blocks = [
          createMockBlock({ depth: 0 }),
          createMockBlock({ depth: 1 }),
        ];
        const blocksAPI = createMockBlocksAPI(blocks);
        const validator = new ListDepthValidator(blocksAPI);

        // Depth 1 at index 1 is valid; should stay 1
        expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 1, skipDepthPromotion: true })).toBe(1);
        // Depth 2 at index 1: max=1, so capped to 1 even with skipDepthPromotion
        expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 2, skipDepthPromotion: true })).toBe(1);
      });
    });
  });

  describe('resolveTargetDepth (single source of truth for indicator + drop)', () => {
    // Convenience: a context with everything at root, overridable per case.
    const ctx = (over: Partial<Parameters<typeof resolveTargetDepth>[0]>): Parameters<typeof resolveTargetDepth>[0] => ({
      currentDepth: 0,
      previousIsListItem: false,
      previousDepth: 0,
      nextIsListItem: false,
      nextDepth: 0,
      ...over,
    });

    it('keeps a root block at root with no nesting context', () => {
      expect(resolveTargetDepth(ctx({}))).toBe(0);
    });

    it('nests from the TOP: matches a deeper next list item (becomes its sibling)', () => {
      // First(0), [drop], Nested(1) → match the deeper next → depth 1.
      expect(resolveTargetDepth(ctx({
        previousIsListItem: true, previousDepth: 0, nextIsListItem: true, nextDepth: 1,
      }))).toBe(1);
    });

    it('nests from the BOTTOM: appends into a deeper previous sub-list despite a shallower next', () => {
      // First(0), Second(1), [drop], Third(0) → prev(1) wins, shallower next(0) must not pull to root.
      expect(resolveTargetDepth(ctx({
        previousIsListItem: true, previousDepth: 1, nextIsListItem: true, nextDepth: 0,
      }))).toBe(1);
    });

    it('matches a deeper previous when there is no next item', () => {
      expect(resolveTargetDepth(ctx({ previousIsListItem: true, previousDepth: 2 }))).toBe(2);
    });

    it('caps to maxAllowed = previousDepth + 1 when the source is too deep', () => {
      expect(resolveTargetDepth(ctx({ currentDepth: 3, previousIsListItem: true, previousDepth: 1 }))).toBe(2);
    });

    it('allows ONE level after a non-list (or absent) predecessor — first-in-group rule', () => {
      // This is the rule that used to drift: a non-list predecessor caps at 1, NOT 0.
      expect(resolveTargetDepth(ctx({ currentDepth: 2, previousIsListItem: false }))).toBe(1);
      expect(resolveTargetDepth(ctx({ currentDepth: 1, previousIsListItem: false }))).toBe(1);
      // A root (depth 0) source after a non-list block still resolves to root.
      expect(resolveTargetDepth(ctx({ currentDepth: 0, previousIsListItem: false }))).toBe(0);
    });

    it('does not match a next item deeper than maxAllowed', () => {
      // prev(1) → max 2; next(5) is unreachable, so it is ignored.
      expect(resolveTargetDepth(ctx({ previousIsListItem: true, previousDepth: 1, nextIsListItem: true, nextDepth: 5 }))).toBe(0);
    });

    it('skipDepthPromotion keeps the current depth but still caps', () => {
      // Group moves preserve relative structure: no promotion to neighbours...
      expect(resolveTargetDepth(ctx({
        currentDepth: 0, previousIsListItem: true, previousDepth: 1, nextIsListItem: true, nextDepth: 1, skipDepthPromotion: true,
      }))).toBe(0);
      // ...but an over-deep source is still capped.
      expect(resolveTargetDepth(ctx({
        currentDepth: 3, previousIsListItem: true, previousDepth: 1, skipDepthPromotion: true,
      }))).toBe(2);
    });

    it('getTargetDepthForMove and resolveTargetDepth agree for the same DOM neighbours', () => {
      // The class method is a thin DOM-reading wrapper over the pure function.
      const blocks = [
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 1 }),
        createMockBlock({ depth: 0 }),
        createMockBlock({ depth: 0 }),
      ];
      const validator = new ListDepthValidator(createMockBlocksAPI(blocks));

      expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 })).toBe(
        resolveTargetDepth({
          currentDepth: 0,
          previousIsListItem: true,
          previousDepth: 1,
          nextIsListItem: true,
          nextDepth: 0,
        })
      );
    });
  });

  describe('selectPointerDepth (clientX → discrete indent step)', () => {
    const INDENT = 27;

    it('returns 0 at the base-left origin', () => {
      expect(selectPointerDepth(100, 100, INDENT)).toBe(0);
    });

    it('clamps to 0 when the cursor sits left of the origin', () => {
      expect(selectPointerDepth(40, 100, INDENT)).toBe(0);
    });

    it('snaps to one level after a full indent step to the right', () => {
      expect(selectPointerDepth(100 + INDENT, 100, INDENT)).toBe(1);
    });

    it('snaps to two levels after two indent steps', () => {
      expect(selectPointerDepth(100 + 2 * INDENT, 100, INDENT)).toBe(2);
    });

    it('rounds to the nearest step at the half-way boundary', () => {
      // 1.5 steps rounds up to 2; 1.4 steps rounds down to 1.
      expect(selectPointerDepth(100 + Math.round(1.5 * INDENT), 100, INDENT)).toBe(2);
      expect(selectPointerDepth(100 + Math.round(1.4 * INDENT), 100, INDENT)).toBe(1);
    });
  });

  describe('resolveTargetDepth with pointerDepth (cursor controls nesting)', () => {
    const ctx = (over: Partial<Parameters<typeof resolveTargetDepth>[0]>): Parameters<typeof resolveTargetDepth>[0] => ({
      currentDepth: 0,
      previousIsListItem: false,
      previousDepth: 0,
      nextIsListItem: false,
      nextDepth: 0,
      ...over,
    });

    it('uses the cursor depth, clamped to previousDepth + 1', () => {
      // Cursor wants depth 3, but previous is depth 1 → max allowed is 2.
      expect(resolveTargetDepth(ctx({ pointerDepth: 3, previousIsListItem: true, previousDepth: 1 }))).toBe(2);
    });

    it('lets the cursor outdent to root even when auto would nest from the bottom', () => {
      // prev(1), next(0): auto returns 1 ("nest from the bottom"); cursor at 0 overrides → 0.
      expect(resolveTargetDepth(ctx({
        pointerDepth: 0, previousIsListItem: true, previousDepth: 1, nextIsListItem: true, nextDepth: 0,
      }))).toBe(0);
    });

    it('lets the cursor nest under a same-depth previous item', () => {
      // prev(0), no next, source(0): auto stays at 0; cursor at 1 nests → 1.
      expect(resolveTargetDepth(ctx({ pointerDepth: 1, previousIsListItem: true, previousDepth: 0 }))).toBe(1);
    });

    it('ignores the cursor when there is no predecessor at all (root of the document)', () => {
      // No predecessor (neither list nor any other block) → no legal nesting
      // parent, so the cursor is ignored and auto-resolution applies (root).
      expect(resolveTargetDepth(ctx({ pointerDepth: 2, previousIsListItem: false, currentDepth: 0 }))).toBe(0);
    });

    it('BUG 2: the cursor nests under a NON-list predecessor when one exists (previousExists)', () => {
      // A list item dragged right and dropped after a paragraph: previousIsListItem
      // is false, but a predecessor DOES exist, so the cursor may nest one level
      // under it — matching Notion (nest under any preceding block).
      expect(resolveTargetDepth(ctx({ pointerDepth: 1, previousIsListItem: false, previousExists: true }))).toBe(1);
      // Still capped at the first-in-group max of 1 for a non-list predecessor.
      expect(resolveTargetDepth(ctx({ pointerDepth: 3, previousIsListItem: false, previousExists: true }))).toBe(1);
      // Cursor at the edge still lands at root.
      expect(resolveTargetDepth(ctx({ pointerDepth: 0, previousIsListItem: false, previousExists: true }))).toBe(0);
    });

    it('falls back to auto-resolution when pointerDepth is undefined', () => {
      // No cursor info → unchanged behaviour (deeper previous pulls the drop in).
      expect(resolveTargetDepth(ctx({ previousIsListItem: true, previousDepth: 1 }))).toBe(1);
    });

    it('BUG 3: holds at the deepest legal depth for a far-right over-drag (no fall-through to auto)', () => {
      // prev(0) → maxAllowed 1. A far-right cursor (raw step 22) must CAP at the
      // deepest legal depth (1) and HOLD there, rather than fall through to
      // neighbour auto-resolution (which returned 0). The pointer is authoritative
      // and deterministic whenever a nesting-context predecessor exists.
      expect(resolveTargetDepth(ctx({ pointerDepth: 22, previousIsListItem: true, previousDepth: 0 }))).toBe(1);
      // prev(1) → maxAllowed 2, a far-right over-drag caps and holds at 2.
      expect(resolveTargetDepth(ctx({ pointerDepth: 22, previousIsListItem: true, previousDepth: 1 }))).toBe(2);
    });
  });

  describe('getTargetDepthForMove with pointerDepth (drop honors the cursor — BUG 1)', () => {
    it('honors pointerDepth so the applied drop matches the indicator (no auto override)', () => {
      // First(0), Second(1), [drop slot], no next. Auto "nests from the bottom"
      // to depth 1, but a cursor at the content edge (pointerDepth 0) previews
      // ROOT — and the drop MUST land at root to match that preview.
      const blocks = [
        createMockBlock({ depth: 0 }), // index 0: First
        createMockBlock({ depth: 1 }), // index 1: Second (previous)
        createMockBlock({ depth: 0 }), // index 2: placeholder for the moved block
      ];
      const validator = new ListDepthValidator(createMockBlocksAPI(blocks));

      // Without the cursor: auto nests from the bottom → 1 (unchanged behaviour).
      expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0 })).toBe(1);
      // With the cursor at root: the drop honors it → 0.
      expect(validator.getTargetDepthForMove({ blockIndex: 2, currentDepth: 0, pointerDepth: 0 })).toBe(0);
    });

    it('honors a deeper pointerDepth, clamped to the legal max', () => {
      const blocks = [
        createMockBlock({ depth: 0 }), // index 0: previous list item at depth 0
        createMockBlock({ depth: 0 }), // index 1: placeholder for the moved block
      ];
      const validator = new ListDepthValidator(createMockBlocksAPI(blocks));

      // prev(0) → max 1; cursor wants 1 → nests to 1.
      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0, pointerDepth: 1 })).toBe(1);
      // cursor over-drags (raw 5) → caps and holds at the legal max 1.
      expect(validator.getTargetDepthForMove({ blockIndex: 1, currentDepth: 0, pointerDepth: 5 })).toBe(1);
    });
  });

  describe('getBlockDepth', () => {
    it('returns 0 for blocks with no margin-left', () => {
      const block = createMockBlock({ depth: 0 });
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(block)).toBe(0);
    });

    it('calculates depth from margin-left', () => {
      const block = createMockBlock({ depth: 2 });
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(block)).toBe(2);
    });

    it('returns 0 for undefined block', () => {
      const blocksAPI = createMockBlocksAPI([]);
      const validator = new ListDepthValidator(blocksAPI);

      expect(validator.getBlockDepth(undefined)).toBe(0);
    });
  });
});
