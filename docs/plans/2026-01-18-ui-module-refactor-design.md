# UI Module Refactor Design

**Date:** 2026-01-18
**Status:** Design Approved
**Issue:** `src/components/modules/ui.ts` is 1,362 lines with mixed responsibilities

## Problem Statement

The `ui.ts` file has become a "God Module" that handles too many concerns:

- DOM structure creation
- Event delegation for all document-level events
- Keyboard handling (Enter, Backspace, Escape, Tab, Undo/Redo)
- Selection management and inline toolbar coordination
- Block hover detection with extended zone
- Mobile viewport detection
- Read-only state toggling
- Empty state tracking for placeholders

This causes:
1. **Cognitive Load** - Hard to find and modify specific behaviors
2. **Testing Difficulty** - Can't test behaviors in isolation
3. **Maintainability Issues** - Changes in one area can affect others

## Proposed Solution

Extract `ui.ts` into a focused orchestrator plus specialized controllers and handlers:

- **Controllers** for stateful behaviors (Keyboard, Selection, BlockHover)
- **Handlers** for simple one-off behaviors (Click, Touch)
- **UI class** remains as thin orchestrator for DOM and coordination

## High-Level Architecture

```
src/components/modules/ui/
├── index.ts                  # Main UI class (~200 lines)
├── controllers/
│   ├── _base.ts             # Base Controller class
│   ├── keyboard.ts          # KeyboardController (~250 lines)
│   ├── selection.ts         # SelectionController (~200 lines)
│   └── blockHover.ts        # BlockHoverController (~150 lines)
├── handlers/
│   ├── click.ts             # Document click handler (~150 lines)
│   └── touch.ts             # Redactor touch handler (~100 lines)
├── constants.ts             # UI-specific constants
└── __tests__/
    ├── ui.test.ts           # Orchestrator tests (~20 tests)
    ├── controllers/
    │   ├── keyboard.test.ts # (~40 tests)
    │   ├── selection.test.ts# (~30 tests)
    │   └── blockHover.test.ts# (~20 tests)
    └── handlers/
        ├── click.test.ts    # (~25 tests)
        └── touch.test.ts    # (~15 tests)
```

## Controller Pattern

Each controller:
- Extends `Controller` base class with `enable()` / `disable()` methods
- Receives `Blok` modules via constructor (dependency injection)
- Binds/unbinds its own DOM events
- Can dispatch events via `eventsDispatcher`
- Is testable in isolation with mocked dependencies

```typescript
// controllers/_base.ts
export abstract class Controller {
  protected listeners = new Listeners();
  protected readOnlyMutableListeners = new Listeners();

  protected enable(): void {
    // Subclasses implement
  }

  protected disable(): void {
    this.listeners.clearAll();
    this.readOnlyMutableListeners.clearAll();
  }
}
```

## Handler Pattern

Handlers are simple pure functions:
- Take all dependencies as parameters
- Return event handler functions
- Have no state
- Trivial to test

```typescript
// handlers/click.ts
export interface ClickHandlerDependencies {
  Blok: BlokModules;
  nodes: { holder: HTMLElement; redactor: HTMLElement };
}

export function createDocumentClickedHandler(
  deps: ClickHandlerDependencies
): (event: MouseEvent) => void {
  return (event: MouseEvent): void => {
    // Handler logic
  };
}
```

## Individual Modules

### KeyboardController

Handles all document-level keyboard events.

**Responsibilities:**
- Route keypress to appropriate handler (Enter, Backspace, Escape, Tab, Z)
- Manage keyboard-specific state (`lastUndoRedoTime`)
- Coordinate with BlockManager, BlockSelection, Caret, Toolbar

**Key Methods:**
- `handleKeydown()` - Main router
- `handleEnter()`, `handleBackspace()`, `handleEscape()`, `handleTab()`, `handleZ()` - Specific handlers
- `handleDefault()` - Default behavior routing

**Test Coverage:** ~40 tests

### SelectionController

Manages selection changes and coordinates InlineToolbar visibility.

**Responsibilities:**
- Listen to `selectionchange` events (debounced)
- Determine if inline toolbar should show/hide
- Update current block based on selection focus
- Handle cross-block selection edge cases

**Key Methods:**
- `handleSelectionChange()` - Main handler
- `shouldIgnoreSelectionChange()` - Guard for fake background elements
- `shouldCloseInlineToolbar()` - Guard for closing conditions
- `shouldUpdateCurrentBlock()` - Guard for block updates

**Test Coverage:** ~30 tests

### BlockHoverController

Detects when user hovers over blocks, including extended hover zone.

**Responsibilities:**
- Listen to `mousemove` events (throttled)
- Find block by element hit or extended zone
- Emit `BlockHovered` events
- Track last hovered block to avoid duplicate events

**Key Methods:**
- `handleBlockHovered()` - Main handler
- `findHoveredBlock()` - Check direct hit or extended zone
- `findBlockInHoverZone()` - Extended zone detection

**Test Coverage:** ~20 tests

### Click Handler

Handles document click events.

**Responsibilities:**
- Clear current block when clicking outside editor
- Close BlockSettings when appropriate
- Move toolbar when clicking in redactor after closing settings
- Clear block selection
- Close inline toolbar

**Key Functions:**
- `createDocumentClickedHandler()` - Factory function
- `analyzeClickContext()` - Pure function to determine click state

**Test Coverage:** ~25 tests

### Touch Handler

Handles redactor touch events.

**Responsibilities:**
- Change current block on touch
- Move and open toolbar
- Handle clicks on wrapper using `elementFromPoint`

**Test Coverage:** ~15 tests

## Read-Only State Coordination

UI class coordinates enable/disable of all controllers and handlers:

```typescript
export class UI extends Module<UINodes> {
  private keyboardController: KeyboardController;
  private selectionController: SelectionController;
  private blockHoverController: BlockHoverController;

  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (readOnlyEnabled) {
      this.disableInteractiveListeners();
      return;
    }

    this.enableInteractiveListeners();

    // Preserve idle callback behavior
    const idleCallback = window.requestIdleCallback;
    if (typeof idleCallback === 'function') {
      idleCallback(this.enableInteractiveListeners.bind(this), { timeout: 2000 });
    }
  }

  private enableInteractiveListeners(): void {
    this.keyboardController?.enable();
    this.selectionController?.enable();
    this.blockHoverController?.enable();
    this.bindClickHandlers();
  }
}
```

## Constants

Extract UI-specific constants:

```typescript
// constants.ts
export const HOVER_ZONE_SIZE = 100;
export const KEYS_REQUIRING_CARET_CAPTURE = new Set(['Enter', 'Backspace', 'Delete', 'Tab']);
```

## Testing Strategy

Each module is tested in isolation with mocked dependencies. The main UI class tests verify orchestration only.

**Controller Test Pattern:**
- Mock Blok modules minimally
- Test event handling with fake events
- Verify side effects on mocks
- ~150 total tests across all modules

**Handler Test Pattern:**
- Pass mock dependencies
- Test with fake events
- Verify correct method calls
- Pure functions tested directly

**UI Orchestrator Test Pattern:**
- Verify controllers are instantiated
- Verify read-only coordination
- Don't test controller internals

## Implementation Phases

**Phase 1: Infrastructure**
- Create directory structure
- Create `Controller` base class
- Create empty controller files
- Update imports

**Phase 2: KeyboardController**
- Implement keyboard controller
- Add tests
- Update UI to use it
- Remove keyboard methods from UI

**Phase 3: SelectionController**
- Implement selection controller
- Add tests
- Update UI to use it
- Remove selection logic from UI

**Phase 4: BlockHoverController**
- Implement hover controller
- Add tests
- Update UI to use it
- Remove hover logic from UI

**Phase 5: Handlers**
- Implement click and touch handlers
- Add tests
- Update UI to use them
- Remove click/touch logic from UI

**Phase 6: Cleanup**
- Remove remaining unused code from UI
- Ensure all tests pass
- Verify E2E tests pass

## Verification

After each phase:
```bash
yarn test              # Unit tests
yarn build:test && yarn e2e  # E2E tests
yarn lint             # Linting
```

## Benefits

1. **Focused Files** - Each file has single responsibility
2. **Testability** - Each module tested in isolation
3. **Cognitive Load** - Easier to find and modify specific behaviors
4. **Extensibility** - Easy to add new keyboard shortcuts or behaviors
5. **No Breaking Changes** - Public API remains unchanged
