# Block Class Decoupling Design

**Date:** 2026-01-13
**Status:** Design
**Goal:** Reduce `src/components/block/index.ts` cognitive load by extracting focused manager classes

## Current State

The `Block` class is ~1,100 lines with multiple responsibilities mixed together. Some extraction has already been done:
- `InputManager` - handles input elements
- `MutationHandler` - handles DOM mutations
- `TunesManager` - manages block tunes

This design continues that pattern by extracting 4 additional managers.

---

## Managers to Extract

### 1. SelectionManager

**File:** `src/components/block/selection-manager.ts`

**Purpose:** Encapsulate block selection logic including fake cursor behavior.

**Extracted from Block:**
- `selected` getter/setter
- Fake cursor toggle logic using `SelectionUtils`
- Content element CSS class management for selection state

**Interface:**

```typescript
class SelectionManager {
  constructor(
    private holder: HTMLDivElement,
    private getContentElement: () => HTMLElement | null,
    private getStretched: () => boolean,
    private blokEventBus: EventsDispatcher<BlokEventMap> | null,
    private styleManager: StyleManager
  ) {}

  set selected(state: boolean)
  get selected(): boolean

  private handleFakeCursor(state: boolean): void
}
```

**Key responsibilities:**
- Toggle `data-blok-selected` attribute
- Delegate content element styling to `StyleManager`
- Coordinate fake cursor add/remove with the event bus
- Handle mutex via `FakeCursorAboutToBeToggled` / `FakeCursorHaveBeenSet` events

---

### 2. DataPersistenceManager

**File:** `src/components/block/data-persistence-manager.ts`

**Purpose:** Handle all data extraction, caching, and in-place updates.

**Extracted from Block:**
- `save()` method
- `extractToolData()` private method
- `data` getter
- `setData()` method
- `validate()` method
- `exportDataAsString()` method
- `preservedData`, `preservedTunes` getters
- `lastSavedData`, `lastSavedTunes` properties

**Interface:**

```typescript
class DataPersistenceManager {
  private lastSavedData: BlockToolData;
  private lastSavedTunes: { [name: string]: BlockTuneData };

  constructor(
    private toolInstance: IBlockTool,
    private getToolRenderedElement: () => HTMLElement | null,
    private tunesManager: TunesManager,
    private name: string,
    private getIsEmpty: () => boolean,
    private inputManager: InputManager,
    private callToolUpdated: () => void,
    private toggleEmptyMark: () => void
  ) {}

  async save(): Promise<undefined | BlockSaveResult>
  async setData(newData: BlockToolData): Promise<boolean>
  async validate(data: BlockToolData): Promise<boolean>
  async exportDataAsString(): Promise<string>

  get data(): Promise<BlockToolData>
  get preservedData(): BlockToolData
  get preservedTunes(): { [name: string]: BlockTuneData }

  private async extractToolData(): Promise<BlockToolData | undefined>
  private sanitizeEmptyFields(extracted: BlockToolData): BlockToolData
}
```

**Key responsibilities:**
- Call tool's `save()` method with error handling
- Extract tunes data via `TunesManager`
- Cache last successfully saved data
- Support in-place data updates via tool's `setData()` if available
- Fallback to direct innerHTML manipulation for simple text blocks
- Validate saved data using tool's `validate()` method
- Convert block data to string for export

---

### 3. StyleManager

**File:** `src/components/block/style-manager.ts`

**Purpose:** Manage block visual state including stretched mode and CSS classes.

**Extracted from Block:**
- `stretched` getter/setter
- `setStretchState()` method
- Static `styles` object
- Content element CSS class management

**Interface:**

```typescript
class StyleManager {
  private static readonly styles = {
    wrapper: 'relative opacity-100 my-[-0.5em] py-[0.5em] first:mt-0 ...',
    content: 'relative mx-auto transition-colors duration-150 ease-out max-w-content',
    contentSelected: 'bg-selection rounded-[4px] ...',
    contentStretched: 'max-w-none',
  };

  constructor(
    private holder: HTMLDivElement,
    private contentElement: HTMLElement | null
  ) {}

  setStretchState(state: boolean, selected: boolean): void
  get stretched(): boolean

  updateContentState(selected: boolean, stretched: boolean): void
  getContentClasses(selected: boolean, stretched: boolean): string
}
```

**Key responsibilities:**
- Toggle `data-blok-stretched` attribute
- Update content element CSS classes based on selected/stretched state
- Provide class name computation for both SelectionManager and direct access
- Centralize style constants in one place

---

### 4. ToolRenderer

**File:** `src/components/block/tool-renderer.ts`

**Purpose:** Handle tool element composition, rendering, and DOM lifecycle.

**Extracted from Block:**
- `compose()` private method
- `addToolDataAttributes()` private method
- `pluginsContent` getter
- `toolRenderedElement` property and management
- `contentElement` property
- `ready` promise and `readyResolver`

**Interface:**

```typescript
class ToolRenderer {
  private toolRenderedElement: HTMLElement | null = null;
  private contentElement: HTMLElement | null = null;
  public ready: Promise<void>;
  private readyResolver: (() => void) | null = null;

  constructor(
    private toolInstance: IBlockTool,
    private name: string,
    private id: string,
    private tunesManager: TunesManager,
    private config: ToolConfig
  ) {}

  compose(): HTMLDivElement

  get pluginsContent(): HTMLElement
  get contentElement(): HTMLElement | null

  refreshToolRootElement(holder: HTMLDivElement): void

  private addToolDataAttributes(element: HTMLElement, wrapper: HTMLDivElement): void
  private handleAsyncRender(pluginsContent: Promise<HTMLElement>, contentNode: HTMLElement, wrapper: HTMLDivElement): void
  private handleSyncRender(pluginsContent: HTMLElement, contentNode: HTMLElement, wrapper: HTMLDivElement): void
}
```

**Key responsibilities:**
- Create wrapper and content div elements with proper Tailwind classes
- Call tool's `render()` method (handles both sync and async)
- Add `data-blok-*` attributes for testing and debugging
- Handle placeholder text (except for paragraph tool)
- Coordinate tune wrapping via `TunesManager.wrapContent()`
- Manage the `ready` promise for async render completion
- Refresh tool root reference after DOM operations

---

## Remaining Block Class

After extraction, `Block` focuses on coordination and delegation:

**What stays in Block:**

| Responsibility | Methods/Properties |
|----------------|-------------------|
| Identity | `id`, `name`, `parentId`, `contentIds` |
| Tool reference | `tool`, `toolInstance`, `settings`, `config` |
| Constructor | Wire managers together with proper dependencies |
| Tool lifecycle | `call()`, `mergeWith()`, `destroy()` |
| Input delegation (thin wrappers) | `inputs`, `currentInput`, `firstInput`, etc. |
| Queries | `isEmpty`, `hasMedia`, `mergeable`, `focusable`, `sanitize` |
| Toolbox | `getActiveToolboxEntry()` |
| Tunes | `getTunes()` |
| Mutations | `didMutated`, `unwatchBlockMutations` |
| Drag & drop | `setupDraggable()`, `cleanupDraggable()` |
| Events | `dispatchChange()`, `updateCurrentInput()` |

**Expected result:** ~400 lines (down from ~1,100)

---

## Dependency Graph

```
Block
├── ToolRenderer
│   └── TunesManager (existing)
├── StyleManager
├── SelectionManager
│   └── StyleManager
├── DataPersistenceManager
│   ├── InputManager (existing)
│   └── TunesManager (existing)
├── InputManager (existing)
├── MutationHandler (existing)
└── TunesManager (existing)
```

---

## Implementation Notes

1. **Order of extraction:** ToolRenderer → StyleManager → SelectionManager → DataPersistenceManager
   - ToolRenderer has no dependencies on other new managers
   - StyleManager depends on ToolRenderer
   - SelectionManager depends on StyleManager
   - DataPersistenceManager has complex callbacks into Block

2. **Testing:** Each manager should be unit testable in isolation
   - Mock tool instances for ToolRenderer
   - Mock DOM elements for StyleManager
   - Mock event bus for SelectionManager

3. **Backward compatibility:** Public `Block` API remains unchanged
   - All existing consumers work without modification
   - Delegation is transparent from outside
