# Caret Utilities Refactor Design

**Date:** 2026-01-19
**Status:** Approved
**Issue:** Decouple `src/components/utils/caret.ts` (1100 lines) into focused, maintainable modules

## Problem Statement

The `caret.ts` file is too large and handles multiple distinct responsibilities:

1. **Selection reading** - Getting caret position and offset
2. **Focus operations** - Setting focus and caret position
3. **Boundary detection** - Checking if at start/end of input
4. **Line detection** - Checking if on first/last line
5. **X-position navigation** - Notion-style horizontal position preservation
6. **Inline removal tracking** - MutationObserver for empty inline element detection

This monolithic structure reduces:
- **Reliability** - Changes in one area can inadvertently affect others
- **Extensibility** - Adding new caret-related features requires modifying a large file
- **Maintainability** - Difficult to understand and test in isolation

## Goals

1. **Separate concerns** - Each module has a single, well-defined responsibility
2. **Maintain backward compatibility** - All existing imports continue to work
3. **Improve testability** - Each module can be tested in isolation
4. **Clear boundaries** - Minimal dependencies between modules

## Proposed Structure

```
src/components/utils/caret/
├── index.ts              # Public API (re-exports)
├── selection.ts          # Reading selection state
├── focus.ts              # Focus operations
├── boundaries.ts         # Start/end boundary detection
├── lines.ts              # First/last line detection
├── navigation.ts         # X-position navigation (Notion-style)
├── inline-removal.ts     # MutationObserver for empty inline detection
└── constants.ts          # Shared constants
```

## Module Breakdown

### 1. `selection.ts` (~100 lines)

**Responsibility:** Reading selection/caret state from the DOM

**Exports:**
- `getCaretNodeAndOffset(): [Node | null, number]` - Get current caret node and offset
- `getCaretOffset(input?: HTMLElement): number` - Get character offset from element start

**Dependencies:**
- External: `window.getSelection()`, `document.createRange()`

**Dependencies on other caret modules:** None (foundation module)

---

### 2. `focus.ts` (~120 lines)

**Responsibility:** Setting focus and caret position

**Exports:**
- `focus(element: HTMLElement, atStart?: boolean): void` - Set focus at start/end

**Internal helpers (exported for testing):**
- `createAndFocusTextNode(parent: Node, prepend?: boolean): void`
- `findTextNode(node: ChildNode | null, toStart: boolean): ChildNode | null`
- `setSelectionToElement(element: HTMLElement, selection: Selection, atFirstLine: boolean): void`

**Dependencies:**
- External: `window.getSelection()`, `document.createRange()`
- Caret modules: `./selection.js` (getCaretNodeAndOffset)

---

### 3. `boundaries.ts` (~130 lines)

**Responsibility:** Detecting if caret is at input boundaries

**Exports:**
- `isCaretAtStartOfInput(input: HTMLElement): boolean` - Check if at start
- `isCaretAtEndOfInput(input: HTMLElement): boolean` - Check if at end

**Internal helpers (exported for testing):**
- `checkContenteditableSliceForEmptiness(contenteditable: HTMLElement, fromNode: Node, offsetInsideNode: number, direction: 'left' | 'right'): boolean`

**Dependencies:**
- External: `window.getSelection()`, `document.createRange()`, `dom.js` (Dom utility)
- Caret modules: `./selection.js` (getCaretNodeAndOffset)

---

### 4. `lines.ts` (~200 lines)

**Responsibility:** Detecting if caret is on first/last line

**Exports:**
- `isCaretAtFirstLine(input: HTMLElement): boolean` - Check if on first line
- `isCaretAtLastLine(input: HTMLElement): boolean` - Check if on last line

**Internal helpers (exported for testing):**
- `getValidCaretRect(range: Range, input: HTMLElement): DOMRect` - Get DOMRect with fallbacks

**Dependencies:**
- External: `window.getSelection()`, `dom.js` (Dom utility)
- Caret modules: `./selection.js` (getCaretNodeAndOffset)

---

### 5. `navigation.ts` (~250 lines)

**Responsibility:** X-position navigation for Notion-style block navigation

**Exports:**
- `getCaretXPosition(): number | null` - Get horizontal position
- `setCaretAtXPosition(element: HTMLElement, targetX: number, atFirstLine: boolean): void` - Set caret at X coordinate

**Internal helpers (exported for testing):**
- `setCaretAtXPositionInNativeInput(input: HTMLInputElement | HTMLTextAreaElement, targetX: number, atFirstLine: boolean): void`
- `setCaretAtXPositionInContentEditable(element: HTMLElement, targetX: number, atFirstLine: boolean): void`
- `findBestPositionInRange(input: HTMLInputElement | HTMLTextAreaElement, start: number, end: number, targetX: number): number`
- `getTargetYPosition(element: HTMLElement, targetNode: Node, atFirstLine: boolean): number | null`
- `getCaretPositionFromPoint(x: number, y: number): { node: Node; offset: number } | null`

**Dependencies:**
- External: `window.getSelection()`, `document.caretPositionFromPoint()`, `dom.js` (Dom utility)
- Caret modules: `./selection.js` (getCaretNodeAndOffset), `./lines.js` (getValidCaretRect)

---

### 6. `inline-removal.ts` (~200 lines)

**Responsibility:** Tracking empty inline element removal via MutationObserver

**Exports:**
- `findNbspAfterEmptyInline(root: HTMLElement): { node: Text; offset: number } | null` - Find NBSP after empty inline removal

**Internal (module-level):**
- `NBSP_CHAR = '\u00A0'`
- `whitespaceFollowingRemovedEmptyInline: WeakSet<Text>`
- `inlineRemovalObserver: MutationObserver | null`
- `observedDocuments: WeakSet<Document>`

**Internal helpers (exported for testing):**
- `isElementVisuallyEmpty(element: Element): boolean`
- `ensureInlineRemovalObserver(doc: Document): void`

**Dependencies:**
- External: `window.MutationObserver`, `document.createTreeWalker()`, `dom.js` (isCollapsedWhitespaces)
- Caret modules: `./selection.js` (getCaretNodeAndOffset)

---

### 7. `constants.ts` (~10 lines)

**Responsibility:** Shared constants

**Exports:**
- `NBSP_CHAR = '\u00A0'`

---

### 8. `index.ts` (~20 lines)

**Responsibility:** Public API and backward compatibility

**Re-exports all public functions** from each module, maintaining the current API surface.

---

## Dependency Graph

```
index.ts
├── selection.ts          ← No dependencies on other caret modules
├── focus.ts              ← selection.ts
├── boundaries.ts         ← selection.ts
├── lines.ts              ← selection.ts
├── navigation.ts         ← selection.ts, lines.ts
└── inline-removal.ts     ← selection.ts
```

**Key:** `selection.ts` is the foundation with no intra-caret dependencies.

## Test Structure

```
test/unit/utils/caret/
├── selection.test.ts       ~150 lines
├── boundaries.test.ts      ~250 lines
├── focus.test.ts           ~150 lines (new coverage)
├── lines.test.ts           ~150 lines
├── navigation.test.ts      ~200 lines (new coverage)
└── inline-removal.test.ts  ~200 lines (new coverage)
```

### Test Coverage by Module

**selection.test.ts**
- `getCaretNodeAndOffset`: null selection, text node focus, element child focus, Firefox edge case, empty element
- `getCaretOffset`: no selection, character offset calculation, missing container fallback

**boundaries.test.ts**
- `isCaretAtStartOfInput`: empty input, native input at/not-at start, contenteditable at/not-at start, whitespace-only content
- `isCaretAtEndOfInput`: empty input, native input at/not-at end, contenteditable at/not-at end, whitespace-only content
- `checkContenteditableSliceForEmptiness`: left/right directions, NBSP detection, visual width check, pre-formatted content

**focus.test.ts** (new)
- `focus`: empty element, element with text node, nested elements, native input, atStart/atEnd variants
- Edge cases: no selection, element disconnected from DOM

**lines.test.ts**
- `isCaretAtFirstLine`: INPUT always true, textarea first/not-first line, contenteditable with selection
- `isCaretAtLastLine`: INPUT always true, textarea last/not-last line, contenteditable with selection
- `getValidCaretRect`: valid rect, zero-dimension fallbacks

**navigation.test.ts** (new)
- `getCaretXPosition`: valid range, zero-dimension fallback
- `setCaretAtXPosition`: contenteditable positioning, native input positioning, edge cases
- `getCaretPositionFromPoint`: standard API usage

**inline-removal.test.ts** (new)
- `isElementVisuallyEmpty`: single tags, native inputs, nested empty elements, NBSP detection
- `findNbspAfterEmptyInline`: caret position tracking, empty inline detection, WeakSet tracking

### Test Helpers

A shared test utility file:

```typescript
// test/unit/utils/caret/helpers.ts
export const setupSelection = (node: Node, offset: number): void => { ... }
export const createContenteditable = (content: string): HTMLElement => { ... }
export const createNativeInput = (value: string): HTMLInputElement => { ... }
```

## Migration Strategy

### Phase 1: Create New Files (Non-Breaking)

Create all new module files **without** modifying the original `caret.ts`. Order:

1. `caret/selection.ts` + tests
2. `caret/inline-removal.ts` + tests
3. `caret/boundaries.ts` + tests
4. `caret/focus.ts` + tests
5. `caret/lines.ts` + tests
6. `caret/navigation.ts` + tests
7. `caret/index.ts` (re-exports)
8. `test/unit/utils/caret/helpers.ts`

### Phase 2: Update Imports

Once all new files exist and have passing tests:

1. Update internal imports to use `./caret/...` instead of `./caret`
2. Verify all tests still pass
3. Only then delete the original `caret.ts`

### Phase 3: Cleanup

1. Delete original `src/components/utils/caret.ts`
2. Migrate/split original `test/unit/utils/caret.test.ts`
3. Run full test suite

## Implementation Order

1. Create `caret/selection.ts` + tests
2. Create `caret/inline-removal.ts` + tests
3. Create `caret/boundaries.ts` + tests
4. Create `caret/focus.ts` + tests
5. Create `caret/lines.ts` + tests
6. Create `caret/navigation.ts` + tests
7. Create `caret/index.ts` (re-exports)
8. Update all import statements
9. Delete original files
10. Run full test suite

## Success Criteria

- [ ] All existing functionality preserved
- [ ] All existing tests pass
- [ ] New tests provide coverage for previously untested code paths
- [ ] Each module has a single, clear responsibility
- [ ] No circular dependencies
- [ ] Zero breaking changes to public API

## Files Summary

**To create:** 8 modules + 7 test files = 15 files
**To delete:** 1 original `caret.ts`, 1 original `caret.test.ts`
**Net change:** +13 files, but each is focused and maintainable
