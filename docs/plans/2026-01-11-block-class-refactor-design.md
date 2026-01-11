# Block Class Refactoring Design

## Goal

Refactor `src/components/block/index.ts` (1,457 lines) for improved maintainability by extracting two cohesive modules. Target: ~550-600 lines remaining in the Block class.

## File Structure

```
src/components/block/
├── index.ts              # Block class (slimmed down)
├── input-manager.ts      # Input tracking and navigation
└── mutation-handler.ts   # Mutation observation and handling
```

## Module 1: InputManager

**File:** `input-manager.ts`

Handles all input-related DOM queries, caching, and navigation.

### Interface

```typescript
export class InputManager {
  private cachedInputs: HTMLElement[] = [];
  private inputIndex = 0;

  constructor(
    private readonly holder: HTMLElement,
    private readonly onFocus: () => void
  ) {}

  // Public getters
  get inputs(): HTMLElement[]
  get currentInput(): HTMLElement | undefined
  set currentInput(element: HTMLElement | undefined)
  get currentInputIndex(): number
  get firstInput(): HTMLElement | undefined
  get lastInput(): HTMLElement | undefined
  get nextInput(): HTMLElement | undefined
  get previousInput(): HTMLElement | undefined

  // Methods
  updateCurrentInput(): void      // Uses SelectionUtils to find active input
  dropCache(): void               // Clears cachedInputs
  addInputEvents(): void          // Attaches focus listeners
  removeInputEvents(): void       // Detaches focus listeners
  destroy(): void                 // Cleanup
}
```

### Migrated Code

From Block class:
- `cachedInputs` property
- `inputIndex` property
- `inputs` getter (lines 796-819)
- `currentInput` getter/setter (lines 825-850)
- `currentInputIndex` getter (lines 832-834)
- `firstInput` getter (lines 856-858)
- `lastInput` getter (lines 864-868)
- `nextInput` getter (lines 874-876)
- `previousInput` getter (lines 882-884)
- `updateCurrentInput` method (lines 594-653)
- `handleFocus` method (lines 1227-1237)
- `addInputEvents` method (lines 1242-1253)
- `removeInputEvents` method (lines 1258-1266)

## Module 2: MutationHandler

**File:** `mutation-handler.ts`

Handles mutation observation, filtering, and tool root change detection.

### Interface

```typescript
export class MutationHandler {
  private redactorDomChangedCallback: ((payload: RedactorDomChangedPayload) => void) | null = null;

  constructor(
    private readonly getToolElement: () => HTMLElement | null,
    private readonly blokEventBus: EventsDispatcher<BlokEventMap> | null,
    private readonly onMutation: (mutations: MutationRecord[] | undefined) => void
  ) {}

  // Methods
  watch(): void                   // Subscribe to RedactorDomChanged event
  unwatch(): void                 // Unsubscribe from event
  handleMutation(mutationsOrInputEvent: MutationRecord[] | InputEvent | undefined): void
  detectToolRootChange(mutations: MutationRecord[]): HTMLElement | null
  destroy(): void                 // Cleanup
}
```

### Design Decisions

1. `getToolElement` is a getter function because `toolRenderedElement` can change during Block's lifetime
2. `detectToolRootChange` returns the new element (or null) instead of mutating state - Block handles the update
3. `shouldFireUpdate` logic (mutation-free element checking) lives inside `handleMutation`
4. `onMutation` callback lets Block trigger its side effects

### Migrated Code

From Block class:
- `redactorDomChangedCallback` property (line 791)
- `watchBlockMutations` method (lines 1363-1390)
- `unwatchBlockMutations` method (lines 1396-1398)
- `detectToolRootChange` method (lines 1425-1441)
- `shouldFireUpdate` logic inside `didMutated` (lines 1296-1330)

## Block Class Changes

### Constructor Integration

```typescript
constructor({ ... }: BlockConstructorOptions, eventBus?: EventsDispatcher<BlokEventMap>) {
  // ... existing setup ...

  this.inputManager = new InputManager(
    this.holder,
    () => this.inputManager.updateCurrentInput()
  );

  this.mutationHandler = new MutationHandler(
    () => this.toolRenderedElement,
    this.blokEventBus,
    (mutations) => this.didMutated(mutations)
  );

  const bindEvents = (): void => {
    this.mutationHandler.watch();
    this.inputManager.addInputEvents();
    this.toggleInputsEmptyMark();
  };

  // ... rest unchanged ...
}
```

### Simplified didMutated

```typescript
private readonly didMutated = (mutationsOrInputEvent?: MutationRecord[] | InputEvent): void => {
  const newToolRoot = this.mutationHandler.handleMutation(mutationsOrInputEvent);

  if (newToolRoot) {
    this.toolRenderedElement = newToolRoot;
  }

  this.inputManager.dropCache();
  this.inputManager.updateCurrentInput();
  this.toggleInputsEmptyMark();
  this.call(BlockToolAPI.UPDATED);
  this.emit('didMutated', this);
};
```

### Destroy Integration

```typescript
public destroy(): void {
  this.mutationHandler.destroy();
  this.inputManager.destroy();
  // ... rest unchanged ...
}
```

### Forwarding Getters

Block keeps public getters that forward to InputManager:

```typescript
public get inputs(): HTMLElement[] {
  return this.inputManager.inputs;
}

public get currentInput(): HTMLElement | undefined {
  return this.inputManager.currentInput;
}

// ... etc for other input getters
```

## Public API

No changes to Block's public API. External code continues to interact with Block directly. The extracted modules are internal implementation details.

## Estimated Results

- `input-manager.ts`: ~150 lines
- `mutation-handler.ts`: ~120 lines
- `index.ts` (Block): ~550-600 lines (down from 1,457)
