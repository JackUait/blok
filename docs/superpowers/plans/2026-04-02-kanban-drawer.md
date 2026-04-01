# Kanban Card Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the absolutely-positioned peek panel with a flex-sibling drawer that takes layout space beside the board.

**Architecture:** The outer wrapper (`data-blok-tool="database"`) becomes a flex container for two children: a board area div (`data-blok-database-board`) holding columns, and a drawer div (`data-blok-database-drawer`) that slides in from the right with a width animation. The drawer has the same content as the current peek panel (title input + nested Blok editor).

**Tech Stack:** TypeScript, Vitest, plain CSS with CSS variables, DOM APIs

---

### Task 1: Create DatabaseCardDrawer test + implementation

**Files:**
- Create: `test/unit/tools/database/database-card-drawer.test.ts`
- Create: `src/tools/database/database-card-drawer.ts`

This task is independent of all other tasks. It creates the new drawer component and its tests from scratch — no existing files are modified.

- [ ] **Step 1: Write the failing test file**

Create `test/unit/tools/database/database-card-drawer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { KanbanCardData } from '../../../../src/tools/database/types';

const makeCard = (overrides: Partial<KanbanCardData> = {}): KanbanCardData => ({
  id: 'card-1',
  columnId: 'col-1',
  position: 'a0',
  title: 'Test card',
  ...overrides,
});

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DatabaseCardDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a drawer element ([data-blok-database-drawer]) when opened', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const el = options.wrapper.querySelector('[data-blok-database-drawer]');

    expect(el).not.toBeNull();
    expect(drawer.isOpen).toBe(true);
  });

  it('removes drawer element when closed', () => {
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).not.toBeNull();

    drawer.close();

    expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    expect(drawer.isOpen).toBe(false);
  });

  it('calls onTitleChange(cardId, newTitle) when title input fires input event', () => {
    const onTitleChange = vi.fn();
    const options = createOptions({ onTitleChange });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard({ id: 'card-42', title: 'Original title' });

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();

    titleInput.value = 'Updated title';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onTitleChange).toHaveBeenCalledWith('card-42', 'Updated title');
  });

  it('calls onClose when close button ([data-blok-database-drawer-close]) is clicked', () => {
    const onClose = vi.fn();
    const options = createOptions({ onClose });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

    expect(closeBtn).not.toBeNull();

    closeBtn.click();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables title input (readOnly = true) in read-only mode', () => {
    const options = createOptions({ readOnly: true });
    const drawer = new DatabaseCardDrawer(options);
    const card = makeCard();

    drawer.open(card);

    const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

    expect(titleInput).not.toBeNull();
    expect(titleInput.readOnly).toBe(true);
  });

  describe('layout', () => {
    it('drawer is NOT absolutely positioned', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.position).not.toBe('absolute');
    });

    it('drawer has flex-shrink 0 to maintain width', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.flexShrink).toBe('0');
    });

    it('drawer has initial width of 0 for animation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.width).toBe('0px');
    });
  });

  describe('accessibility', () => {
    it('drawer has role="complementary" and aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.getAttribute('role')).toBe('complementary');
      expect(el.getAttribute('aria-label')).toBeTruthy();
    });

    it('close button has aria-label="Close"', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLButtonElement;

      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
    });

    it('title input has aria-label', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLInputElement;

      expect(titleInput.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('styling', () => {
    it('drawer has a border-left for visual separation', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.borderLeft).toBeTruthy();
    });

    it('drawer has a background color', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const el = options.wrapper.querySelector('[data-blok-database-drawer]') as HTMLElement;

      expect(el.style.backgroundColor).toBeTruthy();
    });

    it('title input has styling for font size and padding', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const titleInput = options.wrapper.querySelector('[data-blok-database-drawer-title]') as HTMLElement;

      expect(titleInput.style.fontSize).toBeTruthy();
      expect(titleInput.style.padding).toBeTruthy();
    });

    it('close button has no default border or background', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.style.background).toBe('none');
      expect(closeBtn.style.borderStyle).toBe('none');
      expect(closeBtn.style.cursor).toBe('pointer');
    });

    it('close button displays the x character', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const closeBtn = options.wrapper.querySelector('[data-blok-database-drawer-close]') as HTMLElement;

      expect(closeBtn.textContent).toBe('\u00d7');
    });

    it('editor holder has padding', () => {
      const options = createOptions();
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);

      const editorHolder = options.wrapper.querySelector('[data-blok-database-drawer-editor]') as HTMLElement;

      expect(editorHolder.style.padding).toBeTruthy();
    });
  });

  describe('close notification consistency', () => {
    it('calls onClose callback when close() is called directly', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card = makeCard();

      drawer.open(card);
      onClose.mockClear();

      drawer.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose callback when open() is called while already open', () => {
      const onClose = vi.fn();
      const options = createOptions({ onClose });
      const drawer = new DatabaseCardDrawer(options);
      const card1 = makeCard({ id: 'card-1' });
      const card2 = makeCard({ id: 'card-2' });

      drawer.open(card1);
      onClose.mockClear();

      drawer.open(card2);

      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/database/database-card-drawer.test.ts`
Expected: FAIL — module `database-card-drawer` does not exist

- [ ] **Step 3: Write the implementation**

Create `src/tools/database/database-card-drawer.ts`:

```typescript
import type { OutputData } from '../../../types';
import type { KanbanCardData } from './types';

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
}

export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  onTitleChange: (cardId: string, title: string) => void;
  onDescriptionChange: (cardId: string, description: OutputData) => void;
  onClose: () => void;
}

/**
 * Side drawer that opens when a kanban card is clicked.
 * Sits beside the board as a flex sibling, taking layout space.
 * Contains a title input and a nested Blok editor for the card description.
 */
export class DatabaseCardDrawer {
  private readonly wrapper: HTMLElement;
  private readonly readOnly: boolean;
  private readonly onTitleChange: (cardId: string, title: string) => void;
  private readonly onDescriptionChange: (cardId: string, description: OutputData) => void;
  private readonly onClose: () => void;

  private drawer: HTMLDivElement | null = null;
  private currentCardId: string | null = null;
  private blokInstance: BlokInstance | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: CardDrawerOptions) {
    this.wrapper = options.wrapper;
    this.readOnly = options.readOnly;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
  }

  get isOpen(): boolean {
    return this.drawer !== null;
  }

  open(card: KanbanCardData): void {
    if (this.drawer) {
      this.close();
    }

    this.currentCardId = card.id;

    const drawer = document.createElement('div');

    drawer.setAttribute('data-blok-database-drawer', '');
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Card details');
    drawer.style.flexShrink = '0';
    drawer.style.width = '0px';
    drawer.style.overflow = 'hidden';
    drawer.style.display = 'flex';
    drawer.style.flexDirection = 'column';
    drawer.style.borderLeft = '1px solid var(--blok-popover-border, #e8e8eb)';
    drawer.style.backgroundColor = 'var(--blok-popover-bg, #fff)';
    drawer.style.boxShadow = '-4px 0 12px rgba(0, 0, 0, 0.08)';

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '0';
    closeBtn.style.right = '0';
    closeBtn.style.background = 'none';
    closeBtn.style.borderStyle = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    drawer.appendChild(closeBtn);

    const titleInput = document.createElement('input');

    titleInput.setAttribute('data-blok-database-drawer-title', '');
    titleInput.setAttribute('aria-label', 'Card title');
    titleInput.style.fontSize = '20px';
    titleInput.style.padding = '16px 20px 8px';
    titleInput.style.border = 'none';
    titleInput.style.outline = 'none';
    titleInput.style.width = '100%';
    titleInput.style.fontWeight = '600';
    titleInput.style.backgroundColor = 'transparent';
    titleInput.value = card.title;
    titleInput.readOnly = this.readOnly;
    titleInput.addEventListener('input', () => {
      if (this.currentCardId !== null) {
        this.onTitleChange(this.currentCardId, titleInput.value);
      }
    });
    drawer.appendChild(titleInput);

    const divider = document.createElement('hr');

    drawer.appendChild(divider);

    const editorHolder = document.createElement('div');

    editorHolder.setAttribute('data-blok-database-drawer-editor', '');
    editorHolder.style.flex = '1';
    editorHolder.style.overflow = 'auto';
    editorHolder.style.padding = '0 8px';
    drawer.appendChild(editorHolder);

    this.wrapper.appendChild(drawer);
    this.drawer = drawer;

    requestAnimationFrame(() => {
      drawer.style.width = '400px';
    });

    this.initNestedEditor(editorHolder, card);

    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      const target = e.target as Node | null;

      if (target && editorHolder.contains(target)) {
        return;
      }

      this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);

    titleInput.focus();
  }

  close(): void {
    const wasOpen = this.drawer !== null;

    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    if (this.blokInstance) {
      try {
        const instance = this.blokInstance;
        const cardId = this.currentCardId;

        instance.save().then((data) => {
          if (cardId !== null) {
            this.onDescriptionChange(cardId, data);
          }
          instance.destroy();
        }).catch(() => {
          instance.destroy();
        });
      } catch {
        // Blok may already be destroyed
      }
      this.blokInstance = null;
    }

    if (this.drawer) {
      this.drawer.remove();
      this.drawer = null;
    }

    this.currentCardId = null;

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.close();
  }

  private initNestedEditor(editorHolder: HTMLElement, card: KanbanCardData): void {
    import('../../blok').then(({ Blok }) => {
      const cardId = card.id;
      const blok = new Blok({
        holder: editorHolder,
        data: card.description,
        readOnly: this.readOnly,
        onChange: async () => {
          try {
            const data = await this.blokInstance?.save();

            if (data !== undefined) {
              this.onDescriptionChange(cardId, data);
            }
          } catch {
            // save may fail if editor is being destroyed
          }
        },
      });

      this.blokInstance = blok as unknown as BlokInstance;
    }).catch(() => {
      // Blok import may fail in unit tests (jsdom), drawer still works for title
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/tools/database/database-card-drawer.test.ts`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/database/database-card-drawer.ts test/unit/tools/database/database-card-drawer.test.ts
git commit -m "feat(database): add DatabaseCardDrawer component with tests"
```

---

### Task 2: Add board area wrapper to DatabaseView

**Files:**
- Modify: `test/unit/tools/database/database-view.test.ts`
- Modify: `src/tools/database/database-view.ts`

This task is independent of Task 1. It restructures the board layout without touching the drawer or orchestrator.

- [ ] **Step 1: Update the view test file**

In `test/unit/tools/database/database-view.test.ts`, add a new test inside `describe('createBoard')` after the existing tests, and update the styling tests that check wrapper layout properties to check the board area instead.

**Add** this test inside `describe('createBoard')` (after the "does not render empty placeholder" test at line 266):

```typescript
    it('wraps columns inside a board area element ([data-blok-database-board])', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const boardArea = board.querySelector('[data-blok-database-board]');

      expect(boardArea).not.toBeNull();

      const column = boardArea!.querySelector('[data-blok-database-column]');

      expect(column).not.toBeNull();
    });
```

**Replace** the `'board wrapper has flex-start alignment and gap between columns'` test (lines 363-370) with:

```typescript
    it('board area has flex-start alignment and gap between columns', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const columns = [makeColumn({ id: 'col-1', position: 'a0' })];
      const board = view.createBoard(columns, () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.alignItems).toBe('flex-start');
      expect(boardArea.style.gap).toBeTruthy();
    });
```

**Replace** the `'board wrapper has padding'` test (lines 372-377) with:

```typescript
    it('board area has padding', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.padding).toBeTruthy();
    });
```

**Replace** the `'board wrapper has updated padding of 6px 4px'` test (lines 474-479) with:

```typescript
    it('board area has updated padding of 6px 4px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.padding).toBe('6px 4px');
    });
```

**Replace** the `'board wrapper has updated gap of 12px'` test (lines 481-486) with:

```typescript
    it('board area has updated gap of 12px', () => {
      const view = new DatabaseView({ readOnly: false, i18n });
      const board = view.createBoard([], () => []);

      const boardArea = board.querySelector('[data-blok-database-board]') as HTMLElement;

      expect(boardArea.style.gap).toBe('12px');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/database/database-view.test.ts`
Expected: FAIL — no `[data-blok-database-board]` element exists yet

- [ ] **Step 3: Update the view implementation**

In `src/tools/database/database-view.ts`, modify the `createBoard` method to wrap columns inside a board area div. The outer wrapper becomes a simple flex container.

**Replace** lines 26-53 of `createBoard` (the entire method body) with:

```typescript
  createBoard(columns: KanbanColumnData[], getCards: (columnId: string) => KanbanCardData[]): HTMLDivElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-tool', 'database');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Kanban board');
    wrapper.style.display = 'flex';

    const boardArea = document.createElement('div');

    boardArea.setAttribute('data-blok-database-board', '');
    boardArea.style.display = 'flex';
    boardArea.style.overflowX = 'auto';
    boardArea.style.alignItems = 'flex-start';
    boardArea.style.gap = '12px';
    boardArea.style.padding = '6px 4px';
    boardArea.style.flex = '1';
    boardArea.style.minWidth = '0';

    for (const col of columns) {
      const columnEl = this.createColumnElement(col, getCards(col.id));

      boardArea.appendChild(columnEl);
    }

    if (!this.readOnly) {
      const addColumnBtn = document.createElement('button');

      addColumnBtn.setAttribute('data-blok-database-add-column', '');
      addColumnBtn.setAttribute('aria-label', this.i18n.t('tools.database.addColumn'));
      addColumnBtn.textContent = '+ ' + this.i18n.t('tools.database.addColumn');
      boardArea.appendChild(addColumnBtn);
    }

    wrapper.appendChild(boardArea);

    return wrapper;
  }
```

**Also update** the `appendColumn` method (lines 83-91) to find the board area:

```typescript
  appendColumn(wrapper: HTMLElement, col: KanbanColumnData): void {
    const columnEl = this.createColumnElement(col, []);
    const boardArea = wrapper.querySelector('[data-blok-database-board]') as HTMLElement | null;
    const container = boardArea ?? wrapper;
    const addColumnBtn = container.querySelector('[data-blok-database-add-column]');

    if (addColumnBtn) {
      container.insertBefore(columnEl, addColumnBtn);
    } else {
      container.appendChild(columnEl);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/tools/database/database-view.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/database/database-view.ts test/unit/tools/database/database-view.test.ts
git commit -m "feat(database): add board area wrapper for drawer layout"
```

---

### Task 3: Wire up drawer in orchestrator + update integration tests

**Files:**
- Modify: `test/unit/tools/database/database.test.ts`
- Modify: `src/tools/database/index.ts`

This task depends on Tasks 1 and 2 both being complete.

- [ ] **Step 1: Update integration test imports and references**

In `test/unit/tools/database/database.test.ts`:

**Replace** line 5:
```typescript
import { DatabaseCardPeek } from '../../../../src/tools/database/database-card-peek';
```
with:
```typescript
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
```

**Replace** line 389 (inside `'destroys cardPeek when rerender is triggered by card drop'` test):
```typescript
      const peekDestroySpy = vi.spyOn(DatabaseCardPeek.prototype, 'destroy');
```
with:
```typescript
      const drawerDestroySpy = vi.spyOn(DatabaseCardDrawer.prototype, 'destroy');
```

**Replace** line 408:
```typescript
      peekDestroySpy.mockClear();
```
with:
```typescript
      drawerDestroySpy.mockClear();
```

**Replace** line 419:
```typescript
      expect(peekDestroySpy).toHaveBeenCalled();
```
with:
```typescript
      expect(drawerDestroySpy).toHaveBeenCalled();
```

**Replace** line 422:
```typescript
      peekDestroySpy.mockRestore();
```
with:
```typescript
      drawerDestroySpy.mockRestore();
```

**Rename** the describe block on line 376 from `'rerenderBoard destroys cardPeek subsystem'` to `'rerenderBoard destroys cardDrawer subsystem'`.

**Rename** the it block on line 377 from `'destroys cardPeek when rerender is triggered by card drop'` to `'destroys cardDrawer when rerender is triggered by card drop'`.

**Also rename** the describe on line 426 from `'handleColumnRecolor is not defined as a method'` — this stays as-is (it doesn't reference peek).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/database/database.test.ts`
Expected: FAIL — `index.ts` still imports `DatabaseCardPeek`

- [ ] **Step 3: Update the orchestrator**

In `src/tools/database/index.ts`:

**Replace** line 11:
```typescript
import { DatabaseCardPeek } from './database-card-peek';
```
with:
```typescript
import { DatabaseCardDrawer } from './database-card-drawer';
```

**Replace** line 33:
```typescript
  private cardPeek: DatabaseCardPeek | null = null;
```
with:
```typescript
  private cardDrawer: DatabaseCardDrawer | null = null;
```

**Replace** line 100 in `destroy()`:
```typescript
    this.cardPeek?.destroy();
```
with:
```typescript
    this.cardDrawer?.destroy();
```

**Replace** lines 254-266 in `initSubsystems()` (the `this.cardPeek = new DatabaseCardPeek(...)` block):
```typescript
    this.cardDrawer = new DatabaseCardDrawer({
      wrapper,
      readOnly: this.readOnly,
      onTitleChange: (cardId, title) => {
        this.model.updateCard(cardId, { title });
        this.sync.syncUpdateCard({ cardId, changes: { title } });
      },
      onDescriptionChange: (cardId, description: OutputData) => {
        this.model.updateCard(cardId, { description });
        this.sync.syncUpdateCard({ cardId, changes: { description } });
      },
      onClose: () => { /* no-op; drawer handles its own DOM cleanup */ },
    });
```

**Replace** lines 271-272 in the keyboard `onEscape` handler:
```typescript
        if (this.cardPeek?.isOpen) {
          this.cardPeek.close();
```
with:
```typescript
        if (this.cardDrawer?.isOpen) {
          this.cardDrawer.close();
```

**Replace** line 387 in `handleCardClick()`:
```typescript
    this.cardPeek?.open(card);
```
with:
```typescript
    this.cardDrawer?.open(card);
```

**Replace** line 403 in `rerenderBoard()`:
```typescript
    this.cardPeek?.destroy();
```
with:
```typescript
    this.cardDrawer?.destroy();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/tools/database/database.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "feat(database): wire DatabaseCardDrawer into orchestrator"
```

---

### Task 4: Update CSS and delete old peek files

**Files:**
- Modify: `src/styles/main.css`
- Delete: `src/tools/database/database-card-peek.ts`
- Delete: `test/unit/tools/database/database-card-peek.test.ts`

This task depends on Task 3 being complete (so no code references peek anymore).

- [ ] **Step 1: Update CSS — rename peek to drawer and add board area styles**

In `src/styles/main.css`:

**Replace** the CSS variable `--blok-database-peek-border` with `--blok-database-drawer-border` in all three theme blocks:
- Line 724: `--blok-database-peek-border: #e8e8eb;` → `--blok-database-drawer-border: #e8e8eb;`
- Line 830: `--blok-database-peek-border: rgba(255, 255, 255, 0.1);` → `--blok-database-drawer-border: rgba(255, 255, 255, 0.1);`
- Line 936: `--blok-database-peek-border: rgba(255, 255, 255, 0.1);` → `--blok-database-drawer-border: rgba(255, 255, 255, 0.1);`

**Replace** the peek hr rule (lines 1615-1622):
```css
/**
 * Peek panel overlay — divider style.
 */
[data-blok-database-peek] hr {
  border: none;
  border-top: 1px solid var(--blok-database-peek-border);
  margin: 0;
}
```
with:
```css
/**
 * Drawer — divider style.
 */
[data-blok-database-drawer] hr {
  border: none;
  border-top: 1px solid var(--blok-database-drawer-border);
  margin: 0;
}
```

**Replace** the peek title placeholder rule (lines 1624-1630):
```css
/**
 * Peek title input — appearance reset is in inline styles;
 * this rule handles the placeholder color.
 */
[data-blok-database-peek-title]::placeholder {
  color: var(--blok-database-add-text);
}
```
with:
```css
/**
 * Drawer title input — placeholder color.
 */
[data-blok-database-drawer-title]::placeholder {
  color: var(--blok-database-add-text);
}
```

**Replace** the peek slide-in transition rule (lines 1660-1665):
```css
/**
 * Peek panel — slide-in transition.
 */
[data-blok-database-peek] {
  transition: transform 200ms ease;
}
```
with:
```css
/**
 * Drawer — width transition for slide-in animation.
 */
[data-blok-database-drawer] {
  transition: width 200ms ease;
}
```

- [ ] **Step 2: Delete old peek files**

```bash
rm src/tools/database/database-card-peek.ts
rm test/unit/tools/database/database-card-peek.test.ts
```

- [ ] **Step 3: Run full test suite**

Run: `yarn test`
Expected: All database tests PASS, no references to deleted peek files

- [ ] **Step 4: Run lint**

Run: `yarn lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(database): rename peek to drawer in CSS, delete old peek files"
```
