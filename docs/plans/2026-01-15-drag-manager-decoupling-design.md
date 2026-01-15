# Drag Manager Decoupling Design Document

**Date:** 2026-01-15
**Status:** Design
**Author:** AI Assistant

## 1. Overview

### 1.1 Problem Statement

The current `DragManager` class ([`dragManager.ts`](../../src/components/modules/dragManager.ts)) is a monolithic 1,215-line file with multiple responsibilities that are tightly coupled. This creates several issues:

1. **Testability**: The single class is difficult to unit test comprehensively due to tight coupling between concerns
2. **Bug Surface Area**: Changes in one area can inadvertently affect unrelated functionality
3. **Feature Growth**: Adding new drag-related features requires modifying the large class, increasing complexity
4. **Maintainability**: Understanding the full drag flow requires reading through 1,200+ lines

### 1.2 Goals

1. **Improve Testability**: Each component should be independently testable with clear inputs/outputs
2. **Reduce Bug Surface Area**: Changes to one concern should not affect others
3. **Enable Feature Growth**: New features should be addable without touching core drag logic
4. **Maintain Compatibility**: The refactored system must be a drop-in replacement for the existing `DragManager`

### 1.3 Non-Negotiable Constraints

- All new code MUST be covered by behavior tests
- No breaking changes to the public API of `DragManager`
- All existing functionality must be preserved
- Must support the existing drag & drop feature set:
  - Single-block drag
  - Multi-block drag (with selection)
  - List item descendants (nested list items move together)
  - Alt-key duplication
  - Auto-scroll near viewport edges
  - Drop indicator with depth calculation
  - Accessibility announcements

## 2. Current Architecture Analysis

### 2.1 Responsibilities Identified

The current `DragManager` has **9 distinct responsibilities**:

| Responsibility | Lines | Description |
|----------------|-------|-------------|
| **State Management** | 45-73, 79-96 | Tracks drag state, provides `isDragging` getter, `cancelTracking()` |
| **Preview Creation** | 212-318 | Creates single/multi-block preview elements |
| **Drag Threshold** | 324-339 | Checks if mouse moved enough to start drag |
| **Drop Target Detection** | 405-497 | Finds target block and edge, updates indicator |
| **Left Drop Zone Fallback** | 1142-1206 | Finds target when cursor is left of content |
| **List Depth Calculation** | 1040-1097 | Calculates nesting depth for dropped blocks |
| **List Item Descendants** | 1099-1140 | Finds nested list items that move together |
| **Auto-Scroll** | 555-626 | Scrolls viewport when cursor near edges |
| **Move Operations** | 709-980 | Single/multi-block move logic |
| **Duplicate Operation** | 727-797 | Alt-key block duplication |
| **A11y Announcements** | 387-403, 499-552, 800-856 | Screen reader announcements |
| **Event Handling** | 149-209, 320-701 | Mouse/keyboard event binding and dispatch |
| **Cleanup** | 982-1037 | Removes preview, indicators, listeners |

### 2.2 Key Dependencies

The `DragManager` depends on these Blok modules:
- `BlockManager` - Block CRUD operations, index management
- `BlockSelection` - Multi-block selection state
- `UI` - DOM wrapper, content rect
- `Toolbar` - Toolbar positioning
- `I18n` - Localization strings
- `YjsManager` - Undo/redo transaction grouping

### 2.3 State Structure

```typescript
interface DragState {
  sourceBlock: Block;              // Primary block being dragged
  sourceBlocks: Block[];           // All blocks (for multi-block drag)
  isMultiBlockDrag: boolean;       // True for multi-block drag
  targetBlock: Block | null;       // Current drop target
  targetEdge: 'top' | 'bottom' | null;
  previewElement: HTMLElement;
  startX: number;
  startY: number;
  isDragging: boolean;             // True after threshold passed
  lastAnnouncedDropIndex: number | null;
  pendingAnnouncementIndex: number | null;
  announcementTimeoutId: ReturnType<typeof setTimeout> | null;
  autoScrollInterval: number | null;
  scrollContainer: HTMLElement | null;
}
```

## 3. Proposed Architecture

### 3.1 Directory Structure

```
src/components/modules/drag/
├── index.ts                    # Public exports (DragManager alias)
├── DragController.ts           # Main orchestrator (entry point)
├── state/
│   ├── DragState.ts           # State type definition
│   └── DragStateMachine.ts    # State management + transitions
├── preview/
│   ├── DragPreview.ts         # Preview element manager
│   └── PreviewFactory.ts      # Creates single/multi-block previews
├── target/
│   ├── DropTargetFinder.ts   # Finds block under cursor
│   ├── DropIndicator.ts       # Manages drop indicator styling
│   └── ListItemDepth.ts       # Calculates list nesting depth
├── operations/
│   ├── MoveOperation.ts       # Executes block move
│   └── DuplicateOperation.ts  # Executes block duplication
├── a11y/
│   └── DragA11y.ts            # Screen reader announcements
└── utils/
    ├── drag.constants.ts      # Configuration constants
    └── AutoScroll.ts          # Auto-scroll logic
```

### 3.2 Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         DragController                           │
│                      (Main Orchestrator)                         │
│  - setupDragHandle()                                            │
│  - Coordinates all components                                   │
└──────────────┬──────────────────────────────────────────────────┘
               │
    ┌──────────┼──────────────────────────────────────────────┐
    │          │                                              │
    ▼          ▼                                              ▼
┌─────────┐ ┌──────────────┐ ┌────────────────────────────────┐
│  State  │ │   Preview    │ │        Target System           │
│Machine  │ │   System     │ │  - DropTargetFinder            │
│         │ │              │ │  - DropIndicator               │
│-getIdle │ │-create()     │ │  - ListItemDepth               │
│-getTrack│ │-updatePos()  │ │  - findTarget()                │
│-getDrag │ │-show()       │ │  - updateIndicator()           │
│-set...  │ │-hide()       │ │                                │
└─────────┘ └──────────────┘ └────────────────────────────────┘
               │                  │
               ▼                  ▼
         ┌──────────┐     ┌──────────────┐
         │ AutoScroll│     │  Operations  │
         │          │     │              │
         │-start()  │     │-Move         │
         │-stop()   │     │-Duplicate    │
         └──────────┘     └──────────────┘
                                │
                                ▼
                         ┌──────────┐
                         │  A11y    │
                         │          │
                         │-announce │
                         │Started() │
                         │-announce │
                         │Position()│
                         │-announce │
                         │Complete()│
                         └──────────┘
```

## 4. Component Specifications

### 4.1 State Management

**File:** `state/DragStateMachine.ts`

**Responsibility:** Manage drag state transitions and provide type-safe state access.

**State Types:**
```typescript
type DragStateType = 'idle' | 'tracking' | 'dragging' | 'dropped';

interface TrackingState {
  type: 'tracking';
  sourceBlock: Block;
  sourceBlocks: Block[];
  isMultiBlockDrag: boolean;
  previewElement: HTMLElement;
  startX: number;
  startY: number;
  scrollContainer: HTMLElement | null;
}

interface DraggingState extends TrackingState {
  type: 'dragging';
  targetBlock: Block | null;
  targetEdge: 'top' | 'bottom' | null;
}
```

**Public API:**
```typescript
class DragStateMachine {
  // State getters
  getState(): DragStateType;
  isIdle(): boolean;
  isTracking(): boolean;
  isDragging(): boolean;

  // State transitions
  startTracking(params: TrackingParams): void;
  startDragging(): void;
  updateTarget(targetBlock: Block, targetEdge: 'top' | 'bottom'): void;
  drop(): DropResult | null;
  cancel(): void;

  // Data access (only valid in certain states)
  getSourceBlock(): Block | null;
  getSourceBlocks(): Block[];
  getPreviewElement(): HTMLElement | null;
  getTarget(): { block: Block | null; edge: 'top' | 'bottom' | null };
}
```

### 4.2 Preview System

**File:** `preview/PreviewFactory.ts`

**Responsibility:** Create drag preview elements for single and multi-block drags.

**Public API:**
```typescript
class PreviewFactory {
  createPreview(
    contentElement: HTMLElement,
    isStretched: boolean
  ): HTMLElement;

  createMultiBlockPreview(blocks: Block[]): HTMLElement;
}
```

**File:** `preview/DragPreview.ts`

**Responsibility:** Manage preview element lifecycle and positioning.

**Public API:**
```typescript
class DragPreview {
  constructor(element: HTMLElement, config: DragConfig);

  show(): void;
  hide(): void;
  updatePosition(x: number, y: number): void;
  destroy(): void;
}
```

### 4.3 Target System

**File:** `target/DropTargetFinder.ts`

**Responsibility:** Find the drop target block and edge based on cursor position.

**Public API:**
```typescript
class DropTargetFinder {
  findTarget(
    clientX: number,
    clientY: number,
    previewElement: HTMLElement,
    sourceBlocks: Block[]
  ): DropTarget | null;
}

interface DropTarget {
  block: Block;
  edge: 'top' | 'bottom';
}
```

**File:** `target/DropIndicator.ts`

**Responsibility:** Manage visual drop indicator on target blocks.

**Public API:**
```typescript
class DropIndicator {
  show(targetBlock: Block, edge: 'top' | 'bottom', depth: number): void;
  clear(): void;
  destroy(): void;
}
```

**File:** `target/ListItemDepth.ts`

**Responsibility:** Calculate the nesting depth for dropped list items.

**Public API:**
```typescript
class ListItemDepth {
  getDepth(block: Block): number | null;
  calculateTargetDepth(targetBlock: Block, targetEdge: 'top' | 'bottom'): number;
}
```

### 4.4 Operations

**File:** `operations/MoveOperation.ts`

**Responsibility:** Execute block move operations.

**Public API:**
```typescript
class MoveOperation {
  execute(params: MoveParams): MoveResult;
}

interface MoveParams {
  sourceBlock: Block;
  sourceBlocks: Block[];
  targetBlock: Block;
  targetEdge: 'top' | 'bottom';
}
```

**File:** `operations/DuplicateOperation.ts`

**Responsibility:** Execute block duplication operations.

**Public API:**
```typescript
class DuplicateOperation {
  async execute(params: DuplicateParams): Promise<Block[]>;
}

interface DuplicateParams {
  sourceBlocks: Block[];
  targetBlock: Block;
  targetEdge: 'top' | 'bottom';
}
```

### 4.5 Accessibility

**File:** `a11y/DragA11y.ts`

**Responsibility:** Generate screen reader announcements for drag operations.

**Public API:**
```typescript
class DragA11y {
  announceDragStarted(blockCount: number): void;
  announceDropPosition(position: number, total: number): void;
  announceDropComplete(params: DropCompleteParams): void;
  announceDuplicateComplete(params: DuplicateCompleteParams): void;
  announceCancelled(): void;

  // Throttling
  clearPendingAnnouncements(): void;
}
```

### 4.6 Utilities

**File:** `utils/drag.constants.ts`

**Exports:**
```typescript
export const DRAG_CONFIG = {
  dragThreshold: 5,
  previewOffsetX: 10,
  previewOffsetY: 0,
  leftDropZone: 50,
} as const;

export function hasPassedThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold?: number
): boolean;
```

**File:** `utils/AutoScroll.ts`

**Public API:**
```typescript
class AutoScroll {
  constructor(scrollContainer: HTMLElement | null);

  start(clientY: number): void;
  stop(): void;
  destroy(): void;
}
```

**File:** `utils/ListItemDescendants.ts`

**Public API:**
```typescript
class ListItemDescendants {
  getDescendants(block: Block): Block[];
}
```

### 4.7 Main Orchestrator

**File:** `DragController.ts`

**Responsibility:** Coordinate all components and handle event flow.

**Public API:**
```typescript
class DragController extends Module {
  // Module compatibility (same as current DragManager)
  get isDragging(): boolean;
  setupDragHandle(dragHandle: HTMLElement, block: Block): () => void;
  cancelTracking(): void;

  // Module lifecycle
  async prepare(): Promise<void>;
  destroy(): void;
}
```

**Internal Flow:**
```
mousedown → stateMachine.startTracking()
           → previewFactory.createPreview()
           → bind event listeners

mousemove → if !isDragging && passedThreshold:
              → stateMachine.startDragging()
              → preview.show()
              → a11y.announceDragStarted()
           → preview.updatePosition()
           → targetFinder.findTarget()
           → indicator.show() or clear()
           → autoScroll.start() or stop()
           → a11y.announceDropPosition()

mouseup/Escape → if isDragging && hasTarget:
                  → operation.execute()
                  → a11y.announceComplete()
                → cleanup all components
```

## 5. Data Flow Diagrams

### 5.1 Drag Start Flow

```
User mousedowns on drag handle
         │
         ▼
┌─────────────────────┐
│ DragController      │
│ setupDragHandle()   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ DragStateMachine    │────▶│ PreviewFactory      │
│ startTracking()     │     │ createPreview()     │
└─────────────────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ Event listeners     │
│ bound to document   │
└─────────────────────┘
```

### 5.2 Drag Active Flow

```
User moves mouse
         │
         ▼
┌─────────────────────┐     ┌─────────────────────┐
│ DragStateMachine    │────▶│ DragPreview         │
│ (check threshold)   │     │ updatePosition()    │
└─────────────────────┘     └─────────────────────┘
          │
          ▼ (if threshold passed)
┌─────────────────────┐     ┌─────────────────────┐
│ DropTargetFinder    │────▶│ DropIndicator       │
│ findTarget()        │     │ show() / clear()    │
└─────────────────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ AutoScroll          │
│ start() / stop()    │
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ DragA11y            │
│ announcePosition()  │
└─────────────────────┘
```

### 5.3 Drop Flow

```
User releases mouse
         │
         ▼
┌─────────────────────┐
│ DragStateMachine    │
│ drop()              │
└─────────┬───────────┘
          │
          ▼ (if Alt key)
┌─────────────────────┐
│ DuplicateOperation  │
│ execute()           │
└─────────┬───────────┘
          │
          ▼ (else)
┌─────────────────────┐
│ MoveOperation       │
│ execute()           │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ DragA11y            │
│ announceComplete()  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Cleanup all         │
│ components          │
└─────────────────────┘
```

## 6. Testing Strategy

### 6.1 Unit Tests

Each component will have dedicated unit tests:

| Component | Test File | Key Test Scenarios |
|-----------|-----------|-------------------|
| DragStateMachine | `DragStateMachine.test.ts` | State transitions, invalid state access |
| PreviewFactory | `PreviewFactory.test.ts` | Single/multi-block preview creation |
| DragPreview | `DragPreview.test.ts` | Position updates, show/hide |
| DropTargetFinder | `DropTargetFinder.test.ts` | Target detection, left zone fallback |
| DropIndicator | `DropIndicator.test.ts` | Indicator display, depth styling |
| ListItemDepth | `ListItemDepth.test.ts` | Depth calculation, edge cases |
| MoveOperation | `MoveOperation.test.ts` | Single/multi-block moves |
| DuplicateOperation | `DuplicateOperation.test.ts` | Block duplication |
| DragA11y | `DragA11y.test.ts` | Announcement generation, throttling |
| AutoScroll | `AutoScroll.test.ts` | Scroll zones, RAF handling |
| ListItemDescendants | `ListItemDescendants.test.ts` | Descendant collection |

### 6.2 Integration Tests

Integration tests will verify component interactions:

| Test Suite | Description |
|------------|-------------|
| `DragController.integration.test.ts` | Full drag flow from mousedown to mouseup |
| `MultiBlockDrag.integration.test.ts` | Multi-block drag scenarios |
| `ListNesting.integration.test.ts` | List item depth calculations |
| `AltKeyDuplication.integration.test.ts` | Alt-key duplication flow |
| `AutoScroll.integration.test.ts` | Auto-scroll behavior |

### 6.3 E2E Tests

Existing E2E tests must pass after refactoring:

- `test/playwright/tests/modules/dragManager.spec.ts`
- Any other tests that involve drag & drop

## 7. Implementation Phases

### Phase 1: Pure Utilities (Low Risk)
Extract pure functions with no dependencies:
- `utils/drag.constants.ts` - Already exists
- `utils/AutoScroll.ts` - Already exists
- `target/ListItemDepth.ts` - Already exists
- `utils/ListItemDescendants.ts` - Already exists

**Deliverable:** 4 utility files with tests

### Phase 2: State Management (Low Risk)
Create state machine without modifying drag logic:
- `state/DragState.ts` - Type definitions
- `state/DragStateMachine.ts` - State management

**Deliverable:** State machine with tests, no integration yet

### Phase 3: Preview System (Medium Risk)
Extract preview creation and management:
- `preview/PreviewFactory.ts`
- `preview/DragPreview.ts`

**Deliverable:** Preview system with tests

### Phase 4: Target System (Medium Risk)
Extract drop target detection:
- `target/DropTargetFinder.ts`
- `target/DropIndicator.ts`

**Deliverable:** Target system with tests

### Phase 5: Operations (Medium Risk)
Extract move/duplicate operations:
- `operations/MoveOperation.ts`
- `operations/DuplicateOperation.ts`

**Deliverable:** Operations with tests

### Phase 6: Accessibility (Low Risk)
Extract a11y announcements:
- `a11y/DragA11y.ts`

**Deliverable:** A11y system with tests

### Phase 7: Main Orchestrator (High Risk)
Create DragController and integrate all components:
- `DragController.ts`
- `index.ts` (exports DragController as DragManager)

**Deliverable:** Complete drag system

### Phase 8: Verification
- Run full unit test suite
- Run E2E tests
- Fix any issues found

### Phase 9: Migration
- Delete old `dragManager.ts`
- Update imports
- Final verification

## 8. Rollback Strategy

If critical issues are found:

1. **Git-based rollback:** The work is in a separate worktree, so the main repository is untouched
2. **Feature flag:** Can add a feature flag to switch between old/new implementations
3. **Gradual migration:** Can migrate components incrementally while keeping old DragManager functional

## 9. Success Criteria

- [ ] All unit tests pass for new components
- [ ] All existing E2E tests pass
- [ ] No regression in drag & drop functionality
- [ ] Code coverage for new components >= 90%
- [ ] TypeScript type checking passes
- [ ] ESLint passes with no new warnings
- [ ] Public API remains backward compatible

## 10. Open Questions

None at this time. Design is ready for implementation.

---

**Document Version:** 1.0
**Last Updated:** 2026-01-15
