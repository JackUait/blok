# BoldInlineTool Refactor Design

## Problem

The `BoldInlineTool` class at `src/components/inline-tools/inline-tool-bold.ts` is 2,213 lines. It handles multiple concerns:

- Core tool interface (render, toggle, state checking)
- Collapsed selection state machine (exiting bold with caret)
- DOM manipulation utilities
- Global event listener management
- Range/selection utilities
- Normalization logic

This makes the file hard to understand and modify.

## Solution

Extract two new modules:

1. **CollapsedBoldExitHandler** - Singleton that manages the state machine for exiting bold with a collapsed caret
2. **bold-dom-utils** - Pure utility functions for DOM manipulation

## New File Structure

```
src/components/inline-tools/
├── inline-tool-bold.ts              # ~800 lines (down from 2,213)
├── collapsed-bold-exit-handler.ts   # ~350 lines (new)
├── utils/
│   └── bold-dom-utils.ts            # ~200 lines (new)
```

## CollapsedBoldExitHandler

### Purpose

When a user presses Cmd+B with the caret inside bold text, subsequent typing should appear outside the bold element. This handler tracks that intent and enforces it as the DOM changes.

### Data Structure

```typescript
interface CollapsedExitRecord {
  boundary: Text;           // Text node after bold where typing goes
  boldElement: HTMLElement; // The <strong> element being exited
  allowedLength: number;    // Original bold text length (overflow moves outside)
  hasLeadingSpace: boolean; // Whether boundary started with whitespace
  hasTypedContent: boolean; // Whether user typed non-whitespace
  leadingWhitespace: string; // Preserved leading whitespace
}
```

### Public API

```typescript
class CollapsedBoldExitHandler {
  static getInstance(): CollapsedBoldExitHandler;

  // Called when user toggles bold off with collapsed caret
  exitBold(selection: Selection, boldElement: HTMLElement): Range | undefined;

  // Called on selection change / input to maintain state
  maintain(): void;

  // Check if tracking any exits
  hasActiveRecords(): boolean;

  // Clean up disconnected elements
  pruneDisconnectedRecords(): void;
}
```

### Responsibilities

- Own the `collapsedExitRecords` Set
- Provide `exitBold()` for when user toggles bold off with collapsed caret
- Provide `maintain()` to enforce exit state on DOM changes
- Provide `pruneDisconnectedRecords()` for cleanup

### Does NOT Handle

- Global event listener registration
- Inline toolbar or tool rendering
- Non-collapsed selections (range wrapping/unwrapping)

## bold-dom-utils

### Purpose

Pure functions for DOM manipulation related to bold formatting. No state, no side effects beyond immediate DOM changes. Testable in isolation and reusable by other inline tools.

### Functions

```typescript
// Element normalization
export function ensureStrongElement(element: HTMLElement): HTMLElement;
export function isBoldTag(node: Element): boolean;
export function isBoldElement(node: Node | null): node is Element;

// Text node management
export function ensureTextNodeAfter(boldElement: HTMLElement): Text | null;
export function resolveBoundary(record: { boundary: Text; boldElement: HTMLElement }): { boundary: Text; boldElement: HTMLElement } | null;

// State checks
export function isElementEmpty(element: HTMLElement): boolean;
export function hasBoldParent(node: Node | null): boolean;
export function findBoldElement(node: Node | null): HTMLElement | null;

// Caret utilities
export function setCaret(selection: Selection, node: Text, offset: number): void;
export function setCaretAfterNode(selection: Selection, node: Node): void;
```

## Integration

### refreshSelectionState (in BoldInlineTool)

```typescript
private static refreshSelectionState(source: 'selectionchange' | 'input'): void {
  const selection = window.getSelection();

  CollapsedBoldExitHandler.getInstance().maintain();
  // ... rest of normalization
}
```

### toggleCollapsedSelection (in BoldInlineTool)

```typescript
private toggleCollapsedSelection(): void {
  const selection = window.getSelection();
  const insideBold = findBoldElement(range.startContainer);

  if (insideBold) {
    const updatedRange = CollapsedBoldExitHandler.getInstance().exitBold(selection, insideBold);
    // ... update selection
  } else {
    this.startCollapsedBold(range);
  }
}
```

### What Stays in BoldInlineTool

- `render()`, `toggleBold()`, `isSelectionVisuallyBold()` - core tool interface
- `wrapWithBold()`, `unwrapBoldTags()` - range-based formatting
- `startCollapsedBold()` - creating new bold elements for collapsed caret
- Global listener registration and dispatch
- Toolbar button state updates

## Testing Approach

- **bold-dom-utils.ts** - Unit test each pure function in isolation
- **CollapsedBoldExitHandler** - Unit test the state machine with mocked DOM
- **BoldInlineTool** - Existing E2E tests cover integration

## Future Opportunity

The range-based wrapping/unwrapping logic (~300 lines) could later be extracted to a `RangeFormatter` utility if other inline tools need similar patterns.
