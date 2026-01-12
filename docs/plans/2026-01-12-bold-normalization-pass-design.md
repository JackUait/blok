# Bold Tool: Normalization Pass Refactor

**Date:** 2026-01-12  
**Status:** Design Complete  
**Problem:** DOM normalization sprawl causing redundant work and maintenance burden

## Problem Statement

The `BoldInlineTool` has 8+ methods performing overlapping DOM normalization tasks:

| Method | Purpose |
|--------|---------|
| `normalizeAllBoldTags()` | Convert `<b>` → `<strong>` across entire blok |
| `normalizeBoldInNode()` | Same, scoped to a mutation target |
| `normalizeBoldTagsWithinBlok()` | Same, scoped by selection context |
| `replaceNbspInBlock()` | Replace `\u00A0` with spaces in block |
| `replaceNbspWithinRange()` | Same, scoped to a range |
| `replaceNbspWithSpace()` | Single text node nbsp fix |
| `removeEmptyBoldElements()` | Clean up empty `<strong>` tags |
| `normalizeWhitespaceAround()` | Fix nbsp around merged bold |

A single `wrapWithBold()` call triggers 4-5 separate DOM traversals doing redundant work.

## Solution: BoldNormalizationPass

Consolidate all normalization into a single class that performs cleanup in one traversal.

### Interface

```typescript
interface NormalizationOptions {
  /** Convert <b> to <strong> (default: true) */
  convertLegacyTags?: boolean;
  /** Replace non-breaking spaces with regular spaces (default: true) */
  normalizeWhitespace?: boolean;
  /** Remove empty <strong> elements (default: true) */
  removeEmpty?: boolean;
  /** Merge adjacent <strong> elements (default: true) */
  mergeAdjacent?: boolean;
  /** Node to exclude from empty-removal (e.g., caret position) */
  preserveNode?: Node | null;
}

class BoldNormalizationPass {
  constructor(options?: NormalizationOptions);
  
  /** Run normalization on a scoped element */
  run(scope: Element): void;
  
  /** Convenience: normalize the block containing the current selection */
  static normalizeAroundSelection(
    selection: Selection | null, 
    options?: NormalizationOptions
  ): void;
}
```

### Implementation Strategy

**Two-phase approach:**

1. **Phase 1 (Traversal):** Single `TreeWalker` pass
   - Text nodes: replace nbsp with spaces in-place
   - `<b>` elements: convert to `<strong>`, collect in array
   - `<strong>` elements: collect in array

2. **Phase 2 (Structural):** Iterate collected elements
   - Check `isConnected` (may have been merged away)
   - Remove empty elements (respecting `preserveNode`)
   - Merge with previous sibling if adjacent

### File Location

```
src/components/inline-tools/services/bold-normalization-pass.ts
```

### Methods to Remove from BoldInlineTool

After refactor, these methods are deleted:

- `normalizeAllBoldTags()` (static)
- `normalizeBoldInNode()` (static)
- `normalizeBoldTagsWithinBlok()` (static)
- `replaceNbspInBlock()` (static)
- `replaceNbspWithinRange()` (instance)
- `replaceNbspWithSpace()` (static)
- `removeEmptyBoldElements()` (static)
- `normalizeWhitespaceAround()` (instance)

### Updated Call Sites

Each action method calls normalization once at the end:

```typescript
// wrapWithBold, unwrapBoldTags, toggleCollapsedSelection, startCollapsedBold
BoldNormalizationPass.normalizeAroundSelection(window.getSelection(), {
  preserveNode: caretElement,  // optional
});
```

### MutationObserver Integration

The observer callback simplifies to:

```typescript
mutations.forEach((mutation) => {
  mutation.addedNodes.forEach((node) => {
    const scope = findBlokScope(node);
    if (scope) {
      new BoldNormalizationPass().run(scope);
    }
  });
});
```

### Estimated Impact

- **Lines removed from `inline-tool-bold.ts`:** ~150
- **New file size:** ~100 lines
- **Net reduction:** ~50 lines
- **DOM traversals per operation:** 4-5 → 1

## Testing Strategy

1. Existing E2E tests validate behavior unchanged
2. New unit tests for `BoldNormalizationPass` in isolation:
   - `<b>` → `<strong>` conversion
   - nbsp replacement
   - Empty element removal (with preserveNode edge case)
   - Adjacent merging

## Migration Path

1. Create `BoldNormalizationPass` with full implementation
2. Add unit tests for the new class
3. Update `wrapWithBold` to use new pass, verify E2E tests pass
4. Update remaining methods one-by-one
5. Remove obsolete methods
6. Update MutationObserver callback

## Risks

- **Ordering sensitivity:** Merging must happen after empty removal to avoid merging then removing
- **Selection preservation:** Must not disrupt caret position during normalization
- **Scope detection:** Need reliable way to find containing block from selection

## Decision

Proceed with implementation using the migration path above.
