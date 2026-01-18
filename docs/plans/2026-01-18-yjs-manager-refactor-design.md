# YjsManager Refactor Design

**Date:** 2026-01-18
**Status:** Design
**Author:** Claude Code

## Problem Statement

The `YjsManager` class ([`src/components/modules/yjsManager.ts`](../../src/components/modules/yjsManager.ts)) is 1,162 lines with at least 7 distinct responsibilities:

1. Yjs Document Management - Creating/managing Y.Doc, Y.Array, Y.Map instances
2. Event Observation & Emission - Observing Yjs changes and emitting BlockChangeEvents
3. Undo/Redo Coordination - Managing Yjs UndoManager + custom move undo stacks
4. Caret Position Tracking - Capturing/restoring caret snapshots for undo/redo
5. Smart Undo Grouping - Boundary character detection and checkpoint creation
6. Block CRUD Operations - addBlock, removeBlock, moveBlock, updateBlockData
7. Data Serialization - Converting between Yjs format and OutputBlockData

This complexity impacts:
- **Reliability:** Complex interactions between concerns (e.g., caret tracking with move operations)
- **Maintainability:** High cognitive load per file
- **Extensibility:** Difficult to add features like custom undo stacks

## Goals

1. **Reliability** - Reduce bugs from complex interactions by separating concerns
2. **Maintainability** - Make code easier to understand and modify
3. **Extensibility** - Enable adding new features without touching core logic
4. **Testability** - Each module has focused, well-structured tests

## Architecture

### File Structure

```
src/components/modules/yjs/
├── index.ts                  # YjsManager facade (~200 lines)
├── document-store.ts         # Y.Doc + block CRUD (~250 lines)
├── undo-history.ts           # Undo/redo + move history + caret (~300 lines)
├── serializer.ts             # Y.Map <-> OutputBlockData conversion (~200 lines)
├── block-observer.ts         # Yjs events -> BlockChangeEvent (~200 lines)
└── types.ts                  # Shared types (~50 lines)
```

### Component Diagram

```
                    ┌─────────────────────┐
                    │    YjsManager       │
                    │   (facade)          │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  UndoHistory    │  │  DocumentStore  │  │  BlockObserver  │
│                 │◄─┤                 │─►│                 │
│ - move stacks   │  │  - ydoc         │  │ - callbacks     │
│ - caret stacks  │  │  - yblocks      │  │ - event mapping │
│ - smart grouping│  │  - transactions │  └─────────────────┘
└─────────────────┘  └────────▲────────┘
                              │
                              │ uses
                              │
                     ┌────────┴────────┐
                     │   Serializer    │
                     │                 │
                     │ - Y↔OutputData  │
                     └─────────────────┘
```

## Component Specifications

### types.ts - Shared Types

```typescript
export interface BlockChangeEvent {
  type: 'add' | 'remove' | 'update' | 'move';
  blockId: string;
  origin: 'local' | 'undo' | 'redo' | 'load' | 'remote';
}

export interface CaretSnapshot {
  blockId: string;
  inputIndex: number;
  offset: number;
}

export interface CaretHistoryEntry {
  before: CaretSnapshot | null;
  after: CaretSnapshot | null;
}

export interface SingleMoveEntry {
  blockId: string;
  fromIndex: number;
  toIndex: number;
}

export type MoveHistoryEntry = SingleMoveEntry[];
export type BlockChangeCallback = (event: BlockChangeEvent) => void;
export type TransactionOrigin = 'local' | 'undo' | 'redo' | 'load' | 'remote';
```

### serializer.ts - YBlockSerializer

**Responsibility:** Convert between Yjs and OutputBlockData formats (stateless)

```typescript
export class YBlockSerializer {
  public outputDataToYBlock(blockData: OutputBlockData): Y.Map<unknown>;
  public yBlockToOutputData(yblock: Y.Map<unknown>): OutputBlockData;
  public objectToYMap(obj: Record<string, unknown>): Y.Map<unknown>;
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown>;
}

// Constants
export const CAPTURE_TIMEOUT_MS = 500;
export const BOUNDARY_TIMEOUT_MS = 100;
export const BOUNDARY_CHARACTERS = new Set([' ', '\t', '.', '?', '!', ',', ';', ':']);
```

### document-store.ts - DocumentStore

**Responsibility:** Own the Yjs document and provide atomic block operations

```typescript
export class DocumentStore {
  private ydoc: Y.Doc;
  public readonly yblocks: Y.Array<Y.Map<unknown>>;
  private serializer: YBlockSerializer;

  constructor(serializer: YBlockSerializer);

  // Block operations
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown>;
  public removeBlock(id: string): void;
  public moveBlock(id: string, toIndex: number, origin: TransactionOrigin): void;
  public getBlockById(id: string): Y.Map<unknown> | undefined;
  public updateBlockData(id: string, key: string, value: unknown): void;
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void;

  // Utilities
  public findBlockIndex(id: string): number;
  public transact(fn: () => void, origin: TransactionOrigin): void;

  // Serialization (delegates to serializer)
  public toJSON(): OutputBlockData[];
  public fromJSON(blocks: OutputBlockData[]): void;

  // Lifecycle
  public destroy(): void;
}
```

### block-observer.ts - BlockObserver

**Responsibility:** Observe Yjs events and emit domain events

```typescript
export class BlockObserver {
  private changeCallbacks: BlockChangeCallback[];
  private isPerformingUndoRedo: boolean;

  public observe(yblocks: Y.Array<Y.Map<unknown>>, undoManager: Y.UndoManager): void;
  public onBlocksChanged(callback: BlockChangeCallback): () => void;
  public mapTransactionOrigin(origin: unknown): TransactionOrigin;

  // Called by UndoHistory during undo/redo to prevent recursive events
  public setPerformingUndoRedo(value: boolean): void;

  public destroy(): void;
}
```

### undo-history.ts - UndoHistory

**Responsibility:** Manage all undo/redo state (Yjs UndoManager, moves, caret, smart grouping)

```typescript
export class UndoHistory {
  private yblocks: Y.Array<Y.Map<unknown>>;
  private undoManager: Y.UndoManager;
  private blockObserver: BlockObserver;
  private blok: BlokModules;

  // Move history
  private moveUndoStack: MoveHistoryEntry[];
  private moveRedoStack: MoveHistoryEntry[];
  private pendingMoveGroup: SingleMoveEntry[] | null;

  // Caret history
  private caretUndoStack: CaretHistoryEntry[];
  private caretRedoStack: CaretHistoryEntry[];
  private pendingCaretBefore: CaretSnapshot | null;
  private hasPendingCaret: boolean;

  // Smart grouping
  private pendingBoundary: boolean;
  private boundaryTimestamp: number;
  private boundaryTimeoutId: ReturnType<typeof setTimeout> | null;

  constructor(
    yblocks: Y.Array<Y.Map<unknown>>,
    blockObserver: BlockObserver,
    blok: BlokModules
  );

  // Public API
  public undo(): void;
  public redo(): void;
  public canUndo(): boolean;
  public canRedo(): boolean;
  public stopCapturing(): void;
  public clear(): void;

  // Move grouping
  public startMoveGroup(): void;
  public endMoveGroup(): void;
  public transactMoves(fn: () => void): void;

  // Caret tracking
  public markCaretBeforeChange(): void;
  public captureCaretSnapshot(): CaretSnapshot | null;
  public updateLastCaretAfterPosition(): void;

  // Smart grouping
  public hasPendingBoundary(): boolean;
  public markBoundary(): void;
  public clearBoundary(): void;
  public checkAndHandleBoundary(): void;
  public static isBoundaryCharacter(char: string): boolean;

  public get undoManager(): Y.UndoManager;  // Exposed for BlockObserver

  public destroy(): void;
}
```

### index.ts - YjsManager Facade

**Responsibility:** Coordinate all components and provide public API

```typescript
export class YjsManager extends Module {
  private documentStore: DocumentStore;
  private undoHistory: UndoHistory;
  private serializer: YBlockSerializer;
  private blockObserver: BlockObserver;

  constructor(params: ModuleConfig);

  // CRUD operations
  public fromJSON(blocks: OutputBlockData[]): void;
  public toJSON(): OutputBlockData[];
  public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown>;
  public removeBlock(id: string): void;
  public moveBlock(id: string, toIndex: number): void;
  public updateBlockData(id: string, key: string, value: unknown): void;
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void;
  public getBlockById(id: string): Y.Map<unknown> | undefined;

  // Undo/redo
  public undo(): void;
  public redo(): void;
  public stopCapturing(): void;
  public markCaretBeforeChange(): void;
  public captureCaretSnapshot(): CaretSnapshot | null;
  public updateLastCaretAfterPosition(): void;
  public transactMoves(fn: () => void): void;
  public transact(fn: () => void): void;

  // Smart grouping
  public hasPendingBoundary(): boolean;
  public markBoundary(): void;
  public clearBoundary(): void;
  public checkAndHandleBoundary(): void;
  public static isBoundaryCharacter(char: string): boolean;

  // Events
  public onBlocksChanged(callback: BlockChangeCallback): () => void;

  // Internal helpers (exposed for UndoHistory)
  public yMapToObject(ymap: Y.Map<unknown>): Record<string, unknown>;

  // Lifecycle
  public destroy(): void;

  // Module state
  public set state(Blok: BlokModules);
}

// Re-export types
export type { BlockChangeEvent, CaretSnapshot } from './types';
```

## API Design

### Hybrid Approach

YjsManager remains the primary public API, but key components can be accessed for advanced use:

```typescript
// Standard usage - through YjsManager
blok.YjsManager.addBlock({ id: 'b1', type: 'paragraph', data: {} });
blok.YjsManager.undo();

// Advanced usage - access internal components (if needed)
const history = blok.YjsManager.undoHistory;  // For custom undo tracking
const store = blok.YjsManager.documentStore;  // For direct Yjs access
```

## Testing Strategy

### Test Files

```
test/unit/components/modules/yjs/
├── serializer.test.ts       # Data conversion
├── document-store.test.ts   # Y.Doc operations, CRUD
├── block-observer.test.ts   # Event emission
├── undo-history.test.ts     # Undo/redo, moves, caret, grouping
└── yjs-manager.test.ts      # Facade coordination
```

### Test Principles

1. **Unit tests focus on behavior** - Test public APIs, not private methods
2. **Use factories for test data** - Create helpers to build Y.Map instances
3. **Mock dependencies appropriately** - e.g., BlockObserver tests mock Yjs observer
4. **Test edge cases** - Empty arrays, null values, boundary conditions
5. **Integration tests** - YjsManager tests verify components work together

### Example Test Structure

```typescript
// serializer.test.ts
describe('YBlockSerializer', () => {
  it('converts OutputBlockData to Y.Map', () => {
    const serializer = new YBlockSerializer();
    const data = { id: 'b1', type: 'paragraph', data: { text: 'Hello' } };
    const yblock = serializer.outputDataToYBlock(data);
    expect(yblock.get('id')).toBe('b1');
  });
});

// document-store.test.ts
describe('DocumentStore', () => {
  it('adds and retrieves blocks', () => {
    const store = new DocumentStore(new YBlockSerializer());
    store.addBlock({ id: 'b1', type: 'paragraph', data: {} });
    expect(store.getBlockById('b1')).toBeDefined();
  });
});

// undo-history.test.ts
describe('UndoHistory', () => {
  it('tracks caret positions', () => {
    // Test caret tracking behavior
  });
});
```

## Error Handling

1. **Graceful degradation** - Missing blocks return undefined, operations are no-ops
2. **Type validation** - Serializer throws on malformed data (existing behavior)
3. **History integrity** - Undo/redo operations verify stack state before acting
4. **Transaction safety** - DocumentStore.transact() wraps operations atomically

## Migration Strategy

1. **Create new folder structure** - `src/components/modules/yjs/`
2. **Implement modules incrementally** - One at a time, with tests
3. **Update imports** - Change from `../yjsManager` to `../yjs`
4. **Delete original file** - Only after all tests pass
5. **Update module index.ts** - Export YjsManager from new location

## Success Criteria

- [ ] All files under 300 lines
- [ ] Each module has focused responsibility
- [ ] All existing tests pass
- [ ] New test files for each module
- [ ] No breaking changes to public API
- [ ] Types properly exported
