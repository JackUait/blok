# BlockManager Decoupling Design

**Date:** 2025-01-15
**Status:** Proposed
**Author:** Claude (with user validation)

## Problem Statement

The `BlockManager` class at `src/components/modules/blockManager/blockManager.ts` is approximately 1,037 lines with mixed responsibilities:
- Public API coordination (~35 methods)
- State management (currentBlockIndex, _blocks Proxy)
- Service coordination (repository, factory, hierarchy, yjsSync, operations)
- Event binding logic (bindBlockEvents, enableModuleBindings, disableModuleBindings)
- Keyboard shortcut management (setupKeyboardShortcuts, shouldHandleShortcut)
- Mutation tracking (blockDidMutated, syncBlockDataToYjs)
- Lifecycle management (prepare, toggleReadOnly, destroy)

This makes the class difficult to test and maintain.

## Goals

1. **Improve reliability** - Easier to test each responsibility in isolation
2. **Improve maintainability** - Clear separation of concerns
3. **Improve readability** - Smaller, focused modules
4. **Preserve public API** - No breaking changes for consumers

## Constraints

- Conservative approach: preserve BlockManager's public API
- Hybrid testing: unit tests for modules + integration tests
- All code changes must be covered by behavior tests

## Proposed Solution

Extract two new modules from BlockManager:

### 1. BlockEventBinder

**File:** `src/components/modules/blockManager/event-binder.ts`

**Responsibilities:**
- Bind/unbind block-level events (keydown, keyup, input, didMutated)
- Bind/unbind document-level events (cut)
- Enable/disable all bindings for read-only mode

**Dependencies:**
- `Blok.BlockEvents`
- `readOnlyMutableListeners`
- `eventsDispatcher`
- `getBlockIndex` callback

**API:**
```typescript
class BlockEventBinder {
  constructor(
    private blockEvents: BlockEvents,
    private listeners: ModuleListeners,
    private eventsDispatcher: EventsDispatcher,
    private getBlockIndex: (block: Block) => number
  ) {}

  bindBlockEvents(block: Block): void;
  enableBindings(blocks: Block[]): void;
  disableBindings(): void;
}
```

### 2. BlockShortcuts

**File:** `src/components/modules/blockManager/shortcuts.ts`

**Responsibilities:**
- Register/unregister keyboard shortcuts
- Check if shortcut should be handled (is target within editor)
- Delegate to provided handlers for move up/down actions

**Dependencies:**
- `Shortcuts` utility
- `UI.nodes.wrapper`

**API:**
```typescript
class BlockShortcuts {
  constructor(
    private wrapper: HTMLElement,
    private handlers: {
      onMoveUp: () => void;
      onMoveDown: () => void;
    }
  ) {}

  register(): void;
  unregister(): void;
  private shouldHandleShortcut(event: KeyboardEvent): boolean;
}
```

### 3. Refactored BlockManager

**Changes:**
- Add `eventBinder` and `shortcuts` private properties
- Initialize in `initializeServices()`
- Delegate in `prepare()`, `toggleReadOnly()`, `destroy()`
- Remove extracted methods and properties

**Lines removed:** ~150

## Architecture

```
Current:
┌─────────────────────────────────────────┐
│           BlockManager                  │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ Repository  │  │    Factory       │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  Hierarchy  │  │   YjsSync        │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ Operations  │  │ Events/Shortcuts │ │  ← Embedded
│  └─────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘

Target:
┌─────────────────────────────────────────┐
│           BlockManager                  │
│  ┌──────────────────────────────────┐   │
│  │     BlockEventBinder (new)       │   │
│  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │
│  │     BlockShortcuts (new)         │   │
│  └──────────────────────────────────┘   │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ Repository  │  │    Factory       │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐  ┌──────────────────┘  │
│  │  Hierarchy  │  │   YjsSync          │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐                        │
│  │ Operations  │                        │
│  └─────────────┘                        │
└─────────────────────────────────────────┘
```

## Test Strategy

### BlockEventBinder Tests

**File:** `test/unit/components/modules/blockManager/event-binder.test.ts`

- Binds keydown event to block holder
- Binds keyup event to block holder
- Binds input event to block holder
- Binds didMutated event and emits BlockChanged
- Enables bindings for all blocks when enabled
- Binds document cut event when enabled
- Disables all bindings when disabled
- Does not bind events when readOnly is enabled
- Delegates to BlockEvents methods correctly

### BlockShortcuts Tests

**File:** `test/unit/components/modules/blockManager/shortcuts.test.ts`

- Registers CMD+SHIFT+UP shortcut
- Registers CMD+SHIFT+DOWN shortcut
- Unregisters all shortcuts on destroy
- Handles shortcut when target is within wrapper
- Ignores shortcut when target is outside wrapper
- Calls onMoveUp handler when CMD+SHIFT+UP is pressed
- Calls onMoveDown handler when CMD+SHIFT+DOWN is pressed
- Prevents default behavior when shortcut is handled
- Handles multiple register/unregister cycles
- Does not throw if unregister called before register

### BlockManager Integration Tests

**Updates to existing test files:**

- Initializes BlockEventBinder with correct dependencies
- Delegates toggleReadOnly to BlockEventBinder
- Delegates block event binding through EventBinder lifecycle
- Initializes BlockShortcuts with wrapper and handlers
- Registers shortcuts during prepare phase
- Unregisters shortcuts during destroy
- moveCurrentBlockUp is called by shortcut
- moveCurrentBlockDown is called by shortcut

### E2E Regression Tests

Verify no behavioral regressions:
- Block selection and keyboard shortcuts still work
- Read-only toggle still works correctly
- Copy/cut/paste operations still work
- Block lifecycle events still fire correctly

**Total new test cases:** ~25

## Implementation Phases

### Phase 1: Create BlockEventBinder
1. Create `src/components/modules/blockManager/event-binder.ts`
2. Write unit tests in `test/unit/components/modules/blockManager/event-binder.test.ts`
3. Run tests - ensure all pass

### Phase 2: Create BlockShortcuts
1. Create `src/components/modules/blockManager/shortcuts.ts`
2. Write unit tests in `test/unit/components/modules/blockManager/shortcuts.test.ts`
3. Run tests - ensure all pass

### Phase 3: Refactor BlockManager
1. Update `blockManager.ts` to use the new modules
2. Update existing BlockManager tests for integration behavior
3. Run full test suite - fix any regressions

### Phase 4: E2E Regression Testing
1. Run `yarn build:test`
2. Run `yarn e2e` to verify no behavioral regressions
3. Fix any failing E2E tests

## File Structure After Refactor

```
src/components/modules/blockManager/
├── blockManager.ts         (refactored, ~850 lines)
├── event-binder.ts         (new, ~80 lines)
├── shortcuts.ts            (new, ~60 lines)
├── repository.ts           (existing)
├── factory.ts              (existing)
├── hierarchy.ts            (existing)
├── yjs-sync.ts             (existing)
├── operations.ts           (existing)
└── types.ts                (existing)

test/unit/components/modules/blockManager/
├── event-binder.test.ts    (new)
├── shortcuts.test.ts       (new)
├── factory.test.ts         (existing)
├── operations.test.ts      (existing)
└── ...                     (other existing tests)
```

## Success Criteria

- [ ] All new unit tests pass
- [ ] All existing tests still pass
- [ ] No E2E test regressions
- [ ] TypeScript type checking passes
- [ ] ESLint passes
- [ ] BlockManager line count reduced by ~150 lines
- [ ] No public API changes
- [ ] No behavioral changes in production

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing behavior | Comprehensive E2E regression tests |
| Circular dependency issues | Clear dependency direction, use callbacks |
| Test flakiness with event listeners | Proper cleanup in afterEach |
| Public API accidentally changed | Review all public methods before merging |

## References

- Current implementation: `src/components/modules/blockManager/blockManager.ts`
- Existing extracted modules: `repository.ts`, `factory.ts`, `hierarchy.ts`, `yjs-sync.ts`, `operations.ts`
- Project conventions: `CLAUDE.md`
