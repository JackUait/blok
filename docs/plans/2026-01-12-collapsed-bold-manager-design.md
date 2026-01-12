# Collapsed Bold Manager Design

**Date:** 2026-01-12  
**Status:** Approved  
**Goal:** Decouple `inline-tool-bold.ts` by extracting collapsed selection logic into a unified manager

## Problem

`inline-tool-bold.ts` is ~750 lines, significantly larger than `inline-tool-italic.ts` (~280 lines) despite implementing the same conceptual formatting operation. The complexity comes from sophisticated "typeahead absorption" behavior that:

1. Tracks previous text lengths
2. Absorbs characters typed before the bold element
3. Handles leading whitespace specially
4. Uses MutationObserver for real-time synchronization

This behavior is required (battle-tested), but the logic is scattered across static methods making it hard to maintain and debug.

## Solution

Create a unified `CollapsedBoldManager` singleton that consolidates all collapsed selection logic.

### File Structure

```
src/components/inline-tools/services/
├── collapsed-bold-manager.ts      # NEW - unified manager
├── collapsed-bold-exit-handler.ts # DELETED - absorbed into manager
├── bold-normalization-pass.ts     # UNCHANGED
└── inline-tool-event-manager.ts   # UNCHANGED
```

### CollapsedBoldManager API

```typescript
class CollapsedBoldManager {
  static getInstance(): CollapsedBoldManager;
  
  // Called by BoldInlineTool.toggleCollapsedSelection()
  enter(range: Range): Range | undefined;
  exit(selection: Selection, boldElement: HTMLElement): Range | undefined;
  
  // Called by event handlers (via InlineToolEventManager)
  synchronize(selection: Selection | null): void;
  enforceLengths(selection: Selection | null): void;
  guardBoundaryKeydown(event: KeyboardEvent): void;
  moveCaretAfterBoundary(selection: Selection): void;
  
  // For normalization pass to check before removing "empty" elements
  isActivePlaceholder(element: HTMLElement): boolean;
}
```

### Data Attributes (Centralized)

```typescript
private static readonly ATTR = {
  COLLAPSED_LENGTH: 'data-blok-bold-collapsed-length',
  COLLAPSED_ACTIVE: 'data-blok-bold-collapsed-active',
  PREV_LENGTH: 'data-blok-bold-prev-length',
  LEADING_WHITESPACE: 'data-blok-bold-leading-ws',
} as const;
```

### Method Migration

| New Method | Source | Purpose |
|------------|--------|---------|
| `enter()` | `startCollapsedBold()` | Create empty `<strong>` for typing |
| `exit()` | `CollapsedBoldExitHandler.exitBold()` | Move caret outside bold |
| `synchronize()` | `synchronizeCollapsedBold()` | Absorb typed characters |
| `enforceLengths()` | `enforceCollapsedBoldLengths()` | Split overflow text |
| `guardBoundaryKeydown()` | `guardCollapsedBoundaryKeydown()` | Pre-keystroke caret fix |
| `moveCaretAfterBoundary()` | `moveCaretAfterBoundaryBold()` | Post-input caret fix |

### BoldInlineTool Integration

```typescript
// BEFORE (inline logic)
private toggleCollapsedSelection(): void {
  // ...60 lines of logic...
  return this.startCollapsedBold(range);  // another 50 lines
}

// AFTER (delegation)
private toggleCollapsedSelection(): void {
  const selection = window.getSelection();
  const range = selection?.getRangeAt(0);
  const insideBold = findBoldElement(range?.startContainer);
  
  const manager = CollapsedBoldManager.getInstance();
  const updatedRange = insideBold 
    ? manager.exit(selection, insideBold)
    : manager.enter(range);
    
  // ... selection restoration & notification (~10 lines)
}
```

## Migration Strategy

Incremental extraction, not big-bang:

1. **Create `CollapsedBoldManager`** with existing `CollapsedBoldExitHandler` logic as foundation
2. **Move methods one at a time** from `BoldInlineTool`, running tests after each:
   - `enter()` ← `startCollapsedBold()` + `insertCollapsedBoldInto*`
   - `synchronize()` ← `synchronizeCollapsedBold()`
   - `enforceLengths()` ← `enforceCollapsedBoldLengths()` + `splitCollapsedBoldText()`
   - `guardBoundaryKeydown()` ← `guardCollapsedBoundaryKeydown()`
   - `moveCaretAfterBoundary()` ← `moveCaretAfterBoundaryBold()` + helpers
3. **Delete `collapsed-bold-exit-handler.ts`** once absorbed
4. **Update imports** in `BoldNormalizationPass` to use new manager's `isActivePlaceholder()`

## Testing

| Area | Existing Tests | Notes |
|------|---------------|-------|
| Collapsed bold entry | E2E in Playwright | Verify typing creates bold text |
| Collapsed bold exit | E2E in Playwright | Verify Cmd+B again exits |
| Typeahead absorption | E2E | Characters typed "before" get absorbed |
| Boundary guards | E2E | Caret positioning after toggle |

Each extraction is a single commit with tests passing. No behavior changes - pure refactor.

## Expected Outcome

- `inline-tool-bold.ts`: ~750 → ~300 lines (60% reduction)
- `collapsed-bold-manager.ts`: ~400 lines (all collapsed logic)
- `collapsed-bold-exit-handler.ts`: deleted
