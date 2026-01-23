# List Tool Refactoring Design

**Date:** 2025-01-19
**Status:** Approved
**Goal:** Refactor `ListItem` class (~1,400 lines) to improve reliability, extensibility, and maintainability.

## Problem Statement

The current `ListItem` class in `src/tools/list/index.ts` has too many responsibilities:
- Block lifecycle management
- DOM creation and manipulation
- Keyboard interaction handling
- Marker calculation and updates
- Depth validation and adjustment
- Content operations (split, merge, parse)
- Paste handling and style conversion
- Toolbar offset calculation

This causes:
- **Hard to test** - Behaviors difficult to isolate
- **Hard to understand** - New contributors struggle
- **Hard to extend** - Features require touching many methods
- **Fragile** - Changes break unrelated functionality

## Architecture: Hybrid Approach

Use composition for complex stateful behaviors, pure modules for simple utilities.

```
src/tools/list/
├── index.ts                    # ListItem class (orchestrator, ~200 lines)
├── types.ts                    # Existing types
├── constants.ts                # Existing constants
├── depth-validator.ts          # Existing (unchanged)
├── marker-calculator.ts        # Existing (unchanged)
├── ordered-marker-manager.ts   # NEW - Ordered list marker DOM updates
├── keyboard-handler.ts         # NEW - Keyboard interaction logic
├── dom-builder.ts              # NEW - DOM creation (pure functions)
├── content-operations.ts       # NEW - Content utilities (pure functions)
└── tests/
    ├── ordered-marker-manager.test.ts
    ├── keyboard-handler.test.ts
    ├── dom-builder.test.ts
    └── content-operations.test.ts
```

## Key Components

### 1. ListItem (Orchestrator)

Implements `BlockTool` interface, delegates to collaborators:
- Manages block lifecycle callbacks
- Holds state (data, element, settings)
- Executes intents from `KeyboardHandler`
- ~200 lines (down from ~1,400)

### 2. KeyboardHandler Class

Analyzes keyboard input and returns intent objects:

```typescript
interface KeyboardIntent {
  type: 'split' | 'exit' | 'outdent' | 'indent' | 'convert' | 'none';
  data?: unknown;
}

class KeyboardHandler {
  handleKeyDown(event: KeyboardEvent): KeyboardIntent;
}
```

- Returns intent only - no state mutations
- `ListItem` executes the intent (calls API, mutates state)
- Testable with mock context, no API side effects

### 3. OrderedMarkerManager Class

Handles ordered list marker DOM updates:

```typescript
class OrderedMarkerManager {
  updateMarker(): void;
  updateSiblingMarkers(): void;
  updateAllMarkers(): void;
}
```

- Only instantiated for ordered lists
- Wraps existing `ListDepthValidator` and `ListMarkerCalculator`
- Bullet/checklist markers use static helpers (no class needed)

### 4. DOM Builder Module

Pure functions for DOM creation:

```typescript
function buildListItem(context: DOMBuilderContext): BuildResult;
function buildWrapper(context: DOMBuilderContext): HTMLElement;
function buildStandardContent(context: DOMBuilderContext): HTMLElement;
function buildChecklistContent(context: DOMBuilderContext): HTMLElement;
function createMarker(style: ListItemStyle, depth: number): HTMLElement;
```

- Returns element references needed by `ListItem`
- No coupling to `ListItem` internals
- Easy to test: input context → output DOM structure

### 5. Content Operations Module

Pure utilities for content manipulation:

```typescript
function splitContentAtCursor(contentEl: HTMLElement, range: Range): SplitContentResult;
function fragmentToHTML(fragment: DocumentFragment): string;
function parseHTML(html: string): DocumentFragment;
function isAtStart(element: HTMLElement, range: Range): boolean;
function isEntireContentSelected(element: HTMLElement, range: Range): boolean;
```

- All pure functions - no dependencies on `ListItem` state
- Directly ported from existing private methods
- Testable with DOM fixtures

## Test Strategy

| Module | Test Focus | Setup Complexity |
|--------|------------|------------------|
| `content-operations` | Pure DOM functions - edge cases, empty states | Low (DOM fixtures) |
| `keyboard-handler` | Intent objects for all key combinations | Medium (mock API) |
| `ordered-marker-manager` | Marker updates, renumbering logic | Medium (mock API + DOM) |
| `dom-builder` | Output structure, attributes, event binding | Low (input → output) |
| `ListItem` | Integration, lifecycle, API delegation | High (full block setup) |

## Implementation Checklist

- [ ] Create `content-operations.ts` + tests
- [ ] Create `dom-builder.ts` + tests
- [ ] Create `keyboard-handler.ts` + tests
- [ ] Create `ordered-marker-manager.ts` + tests
- [ ] Refactor `ListItem` to use new modules
- [ ] Remove dead code from `ListItem`
- [ ] Run full test suite
- [ ] Update E2E tests if needed

## Success Criteria

- `ListItem` class reduced to ~200 lines
- All new modules have unit tests
- Existing tests still pass
- No behavioral changes
- E2E tests pass
