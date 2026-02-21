# Yjs DocumentStore Bounds Guards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent Yjs "Length exceeded!" crashes by adding index bounds validation to all `Y.Array` mutation operations in `DocumentStore`.

**Architecture:** Add clamping/validation guards before every `yblocks.insert()` call and verify index validity before `yblocks.delete()` in `DocumentStore`. The guards silently clamp out-of-bounds indices to valid ranges rather than throwing, since the upstream callers have already validated intent — an out-of-bounds index means stale state, not a programming error.

**Tech Stack:** TypeScript, Yjs (v13.6.28), Vitest

---

### Task 1: Write failing tests for addBlock bounds guard

**Files:**
- Modify: `test/unit/components/modules/yjs/document-store.test.ts`

**Step 1: Write the failing tests**

Add these tests inside the existing `describe('addBlock', ...)` block (after line 60):

```typescript
    it('clamps index to array length when index exceeds bounds', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });

      // Index 99 exceeds array length of 1 — should clamp to end
      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, 99);

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('block2');
    });

    it('clamps negative index to zero', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });

      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, -5);

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('block2');
    });
```

**Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts`

Expected: FAIL — Yjs throws "Length exceeded!" for index 99, and either throws or produces wrong results for -5.

---

### Task 2: Implement addBlock bounds guard

**Files:**
- Modify: `src/components/modules/yjs/document-store.ts` — `addBlock()` method (line 70)

**Step 3: Write minimal implementation**

Change line 70 from:

```typescript
      const insertIndex = index ?? this.yblocks.length;
```

to:

```typescript
      const insertIndex = Math.max(0, Math.min(index ?? this.yblocks.length, this.yblocks.length));
```

**Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts`

Expected: ALL tests PASS (both new and existing).

**Step 5: Commit**

```bash
git add test/unit/components/modules/yjs/document-store.test.ts src/components/modules/yjs/document-store.ts
git commit -m "fix(yjs): add bounds guard to addBlock index"
```

---

### Task 3: Write failing tests for moveBlock bounds guard

**Files:**
- Modify: `test/unit/components/modules/yjs/document-store.test.ts`

**Step 6: Write the failing tests**

Add these tests inside the existing `describe('moveBlock', ...)` block (after line 122):

```typescript
    it('clamps toIndex when it exceeds array length after delete', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      // toIndex 3 was valid before delete, but after deleting block1
      // the array is length 2, so insert at index 3 would exceed bounds.
      // Should clamp to index 2 (end of array).
      store.moveBlock('block1', 3, 'local');

      const result = store.toJSON();

      expect(result).toHaveLength(3);
      // block1 should be at the end
      expect(result[2].id).toBe('block1');
    });

    it('handles moving last block to position beyond bounds', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      // Moving block2 (at index 1) to index 2:
      // After delete, array is length 1, index 2 exceeds bounds.
      // Should clamp to index 1 (end).
      store.moveBlock('block2', 2, 'local');

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('block2');
    });

    it('clamps negative toIndex to zero', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      store.moveBlock('block3', -1, 'local');

      const result = store.toJSON();

      expect(result[0].id).toBe('block3');
    });
```

**Step 7: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts`

Expected: FAIL — Yjs throws "Length exceeded!" for toIndex 3 and toIndex 2 (post-delete), and either throws or produces wrong results for -1.

---

### Task 4: Implement moveBlock bounds guard

**Files:**
- Modify: `src/components/modules/yjs/document-store.ts` — `moveBlock()` method (lines 122-127)

**Step 8: Write minimal implementation**

Change lines 122-127 from:

```typescript
      this.yblocks.delete(fromIndex, 1);

      // toIndex is the final position. Since we just deleted from fromIndex,
      // the array is now shorter. The insertion index equals toIndex because
      // Y.Array.insert(n, [item]) places item at index n, shifting others right.
      this.yblocks.insert(toIndex, [this.serializer.outputDataToYBlock(blockData)]);
```

to:

```typescript
      this.yblocks.delete(fromIndex, 1);

      // Clamp toIndex to valid range after deletion shortened the array.
      // An out-of-bounds toIndex means the caller had stale state — clamp
      // to array bounds rather than letting Yjs throw "Length exceeded!".
      const clampedToIndex = Math.max(0, Math.min(toIndex, this.yblocks.length));
      this.yblocks.insert(clampedToIndex, [this.serializer.outputDataToYBlock(blockData)]);
```

**Step 9: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts`

Expected: ALL tests PASS (both new and existing).

**Step 10: Commit**

```bash
git add test/unit/components/modules/yjs/document-store.test.ts src/components/modules/yjs/document-store.ts
git commit -m "fix(yjs): add bounds guard to moveBlock index"
```

---

### Task 5: Run full test suite and verify no regressions

**Step 11: Run unit tests**

Run: `yarn test`

Expected: ALL unit tests pass.

**Step 12: Run lint**

Run: `yarn lint`

Expected: No new errors.

**Step 13: Run E2E tests**

Run: `yarn e2e`

Expected: ALL E2E tests pass.

**Step 14: Final commit if any adjustments were needed**

If the full suite revealed issues requiring changes, commit them:

```bash
git add -A
git commit -m "fix(yjs): address test suite feedback for bounds guards"
```
