# Toolbar Module Refactor Design Document

**Date:** 2025-01-16
**Status:** Design Approved
**Author:** Claude Code

---

## Overview

The `src/components/modules/toolbar/index.ts` file is approximately 1,300 lines and handles multiple responsibilities: toolbar positioning, click-vs-drag detection, tooltip creation, CSS styling, plus button handling, settings toggler handling, toolbox management, and event orchestration. This creates difficulties in:

- **Complexity:** Hard to understand and navigate due to intertwined logic
- **Testability:** Individual behaviors are difficult to test in isolation
- **Extensibility:** Adding new button types or positioning strategies requires touching this large file
- **Reliability:** Changes in one area can inadvertently affect unrelated functionality

This design document outlines a refactoring to split the Toolbar module into focused files following the existing patterns used by `blockManager/` and `drag/` modules.

---

## Architecture

### High-Level Structure

```
src/components/modules/toolbar/
├── index.ts              # Main Toolbar module (orchestration, ~200 lines)
├── blockSettings.ts      # Existing (no changes, ~780 lines)
├── inline.ts             # Existing (no changes, ~960 lines)
├── positioning.ts        # Toolbar positioning logic (~180 lines)
├── click-handler.ts      # Click-vs-drag detection utility (~130 lines)
├── tooltip.ts            # Tooltip creation utility (~80 lines)
├── styles.ts             # CSS class definitions (~100 lines)
├── plus-button.ts        # Plus button handler (~220 lines)
├── settings-toggler.ts   # Settings toggler handler (~150 lines)
├── constants.ts          # Constants (~20 lines)
└── types.ts              # Shared interfaces (~40 lines)
```

### File Responsibilities

| File | Exports | Responsibility |
|------|---------|----------------|
| `index.ts` | `Toolbar` class | Main orchestrator, manages module lifecycle, handles events, coordinates all components |
| `positioning.ts` | `ToolbarPositioner` class | Calculates Y position, moves toolbar, applies content offset, repositions on block changes |
| `click-handler.ts` | `ClickDragHandler` class | Detects click vs drag using threshold, manages document-level mouseup listeners |
| `tooltip.ts` | `createTooltipContent()` | Creates tooltip DOM with multi-line text styling |
| `styles.ts` | `getToolbarStyles()` | Returns CSS class objects for all toolbar elements |
| `plus-button.ts` | `PlusButtonHandler` class | Handles plus button clicks, manages toolbox open/close, inserts "/" |
| `settings-toggler.ts` | `SettingsTogglerHandler` class | Handles settings toggler clicks, opens BlockSettings, manages drag handle state |
| `constants.ts` | constants | `DRAG_THRESHOLD = 10`, `POSITION_TOLERANCE = 2` |
| `types.ts` | interfaces | `ToolbarNodes`, `PositioningOptions`, `ClickHandlerOptions` |

---

## Data Flow and Dependencies

### Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Toolbar (index.ts)                          │
│  - hoveredBlock: Block | null                                       │
│  - hoveredTarget: Element | null                                    │
│  - toolboxInstance: Toolbox | null                                  │
│  - nodes: ToolbarNodes                                              │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│ ToolbarPositioner│  │ ClickDragHandler │  │ PlusButton      │
│ Handler         │  │                  │  │ Handler         │
└─────────────────┘  └──────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│SettingsToggler  │
│ Handler         │
└─────────────────┘
```

### Dependency Direction

```
index.ts (imports all others)
  ├── positioning.ts
  │   └── depends on: Block, ToolbarNodes, constants
  ├── click-handler.ts
  │   └── depends on: constants
  ├── tooltip.ts
  │   └── depends on: Dom ($)
  ├── styles.ts
  │   └── depends on: twJoin, constants
  ├── plus-button.ts
  │   └── depends on: Blok, click-handler, tooltip
  ├── settings-toggler.ts
  │   └── depends on: Blok, click-handler
  └── constants.ts, types.ts
      └── no internal dependencies
```

**Key Design Decisions:**

1. **No circular dependencies** - All dependencies flow inward toward `index.ts`
2. **Handlers get Blok reference** - `PlusButtonHandler` and `SettingsTogglerHandler` receive `Blok` via constructor to access BlockManager, Caret, etc.
3. **Positioner is stateless-ish** - Only caches `lastToolbarY` for performance, receives state via parameters
4. **ClickDragHandler is reusable** - Could be used by Inline Toolbar in future (same pattern needed there)

---

## Testing Strategy

### Test File Structure

```
test/unit/components/modules/toolbar/
├── index.test.ts              # Main Toolbar orchestration
├── positioning.test.ts        # Positioning calculations
├── click-handler.test.ts      # Click vs drag detection
├── tooltip.test.ts            # Tooltip creation
├── plus-button.test.ts        # Plus button behavior
├── settings-toggler.test.ts   # Settings toggler behavior
└── blockSettings.test.ts      # Existing (no changes)
```

### Test Coverage by File

| Test File | Key Scenarios |
|-----------|---------------|
| `index.test.ts` | `moveAndOpen()` orchestrates positioning, `close()` cleans up all components, event subscriptions, read-only mode toggling |
| `positioning.test.ts` | `calculateToolbarY()` with mobile/desktop, nested list items, empty blocks; `repositionToolbar()` with tolerance check; `applyContentOffset()` |
| `click-handler.test.ts` | Click fires callback when no movement; Drag doesn't fire callback when threshold exceeded; Document mouseup listener is cleaned up |
| `tooltip.test.ts` | Creates multi-line tooltip; First word styled white; Multiple lines separated by gap |
| `plus-button.test.ts` | Inserts "/" and opens toolbox; Reuses empty paragraph; Handles Alt/Ctrl modifier for insert above |
| `settings-toggler.test.ts` | Opens BlockSettings on click; Closes BlockSettings when open; Skips toggle when `ignoreNextSettingsMouseUp` is set |

### Mock Strategy

Following existing patterns from `blockSettings.test.ts`:

```typescript
// Mock Blok modules at top level
vi.mock('../../../../src/components/core', () => {
  const mockBlok = { /* ... */ };
  return { Core: MockCore, mockBlok };
});

// Helper functions for test data
const createBlockStub = (options?: BlockOptions): Block => { /* ... */ };
const createBlokMock = (): BlokModules => { /* ... */ };
```

---

## Error Handling and Edge Cases

### Key Edge Cases

| Scenario | Current Behavior | Refactored Behavior |
|----------|------------------|---------------------|
| Toolbox not initialized yet | Returns early with `log(..., 'warn')` | Same - Positioner checks for null before calculating |
| Block hover during drag | Ignores hover event | Same - Positioner receives drag state via parameter |
| Mouse leaves element during click-drag | Document-level mouseup still fires | Same - ClickDragHandler uses document listener |
| Settings toggler clicked after block drop | `skipNextSettingsToggle()` sets flag | Same - Handler respects flag before callback |
| Multi-block selection with different hovered block | Uses first selected block as anchor | Same - Positioner handles this via passed block |
| Content offset for non-nested elements | Returns empty string | Same - Positioner checks `contentOffset.left > 0` |

### Error Handling Patterns

```typescript
// positioning.ts - Return null for invalid state
private calculateToolbarY(...): number | null {
  if (!targetBlock || !plusButton) return null;
  // ... calculation
}

// click-handler.ts - Always cleanup, even on error
public destroy(): void {
  for (const listener of this.pendingListeners) {
    document.removeEventListener('mouseup', listener, true);
  }
  this.pendingListeners.clear();
}

// handlers - Check Blok dependencies before use
public handleClick(): void {
  if (!this.Blok.BlockManager.currentBlock) return;
  // ... handle click
}
```

---

## Implementation Phases

### Phase 1: Setup (Foundation)
1. Create empty files with proper exports
2. Define all types in `types.ts`
3. Define constants in `constants.ts`
4. Move CSS getter to `styles.ts`

### Phase 2: Extract Positioning (Low Risk)
1. Create `positioning.ts` with `ToolbarPositioner` class
2. Move `calculateToolbarY()`, `repositionToolbar()`, `applyContentOffset()` methods
3. Update `index.ts` to use the positioner
4. Add `positioning.test.ts`
5. Run tests to verify no behavior change

### Phase 3: Extract Click Handler (Low Risk)
1. Create `click-handler.ts` with `ClickDragHandler` class
2. Move `setupClickVsDrag()`, `pendingMouseUpListeners` management
3. Update `plus-button.ts` and `settings-toggler.ts` to use it
4. Add `click-handler.test.ts`
5. Run tests

### Phase 4: Extract Tooltip (Very Low Risk)
1. Create `tooltip.ts` with `createTooltipContent()` function
2. Move from `index.ts`
3. Add `tooltip.test.ts`
4. Run tests

### Phase 5: Extract Plus Button & Settings Toggler (Medium Risk)
1. Create `plus-button.ts` with `PlusButtonHandler` class
2. Create `settings-toggler.ts` with `SettingsTogglerHandler` class
3. Move respective logic from `index.ts`
4. Update `index.ts` to instantiate and use handlers
5. Add tests for both
6. Run tests

### Phase 6: Finalize Main Module
1. Refactor `index.ts` to be pure orchestrator (~200 lines)
2. Add `index.test.ts` for orchestration behavior
3. Run all tests
4. Run E2E tests

### Phase 7: Cleanup
1. Remove unused code
2. Update imports
3. Verify lint and type check pass

---

## Success Criteria

The refactor is complete when:

1. **File size reduced**: `toolbar/index.ts` is under 250 lines (from ~1,300)
2. **All tests pass**: Unit and E2E tests maintain current coverage
3. **No behavior changes**: Editor functions identically from user perspective
4. **Lint passes**: No new ESLint or TypeScript errors
5. **Documentation updated**: This design document is committed and any relevant code comments are updated

---

## Benefits

After this refactor:

- **Testability**: Each component can be tested in isolation with focused test cases
- **Understandability**: Clear file names indicate responsibility, easier onboarding
- **Maintainability**: Changes to positioning don't affect button handling
- **Extensibility**: Adding new button types means creating a new file, not modifying a large one
- **Reliability**: Clear boundaries reduce risk of unintended side effects
