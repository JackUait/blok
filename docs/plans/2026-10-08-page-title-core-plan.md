# Built-in Page Title (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blok renders and owns a page title and emoji icon that the host can place anywhere, that follow narrow/wide width, and that round-trip through `save()` / `render()` with undo and collaborative sync.

**Architecture:** Title and icon live in a new Yjs map `page` (keys `title`, `icon`), added to the undo scope after the `values` map. `YjsManager` gets page-field read/write/observe methods modelled on `setValue`/`onValuesChanged`. A new `PageTitle` module draws the header (icon row + `h1`) inside the editor wrapper before the redactor, or into a host element, and syncs width, direction, read-only and i18n. Saver writes `title`/`icon` into `OutputData`; core boot and `blocks.render` seed them.

**Tech Stack:** TypeScript, Yjs, Tailwind v4 + plain CSS in `src/styles/`, Vitest (jsdom), Playwright.

**Spec:** `docs/plans/2026-10-08-page-title-design.md`

**This is plan 1 of 4.** Follow-up plans, each written after this one lands:
2. Server converters (JS runtime + C# `CollabDocConverter`/`YDocConverter`) carry `title`/`icon`.
3. Framework adapters: React `<BlokTitle />`, Vue, Angular.
4. Playground moves onto the built-in title (gets icon undo); exports (Markdown `# title` first line, view/server HTML `h1`); docs reference page.

## Changes from the spec found while planning

Each one is measured, with the source cited:

- **The header root carries `data-blok-interface="blok"`.** The `--blok-*` tokens and dark theme are declared on `:where([data-blok-interface])` (`src/styles/colors.css:82,570,767`). The theme attribute lives on `<html>` (`themeManager.ts:125`). Without the attribute, a title outside the wrapper gets no colors.
- **Title and icon round-trip even when `title` is off.** Saver always writes the `page` map and load always seeds it. Turning the header off must not drop a saved title.
- **The CSS variable is `--blok-content-column`, not `--blok-content-inset`.** A side gutter in px is only right for an element exactly as wide as the editor. A column max-width (`720px`, or `none` in full mode) is right for any host section: `max-width: var(--blok-content-column); margin-inline: auto`. It is pure CSS, with no ResizeObserver.
- **Find:** the title is searchable but not replaceable. `Find.ownsRange` requires the range inside the redactor (`find/index.ts:590-602`). Replace stays block-only.
- **`title` goes in `BlokMountOptions`, not `BlokState`.** `BlokState` keys need a live setter wired through all three adapters (`test/unit/architecture/reactive-config-contract-law.test.ts`). Runtime changes go through `blok.title` instead.

## Global Constraints

- Opt-in: with no `title` config there is no header DOM. Saved `title`/`icon` still round-trip.
- Storage: Yjs map `page`, keys `title` (string) and `icon` (`PageIcon`). Never inside `values`.
- `yBlocksMap` stays the FIRST `Y.Map` in `undoScope` (`undo-history.ts:385` picks `blocksScope` as the first `Y.Map`).
- Saved output: empty title is an absent `title` field; no icon is an absent `icon` field.
- No line clamp, no ellipsis. `overflow-wrap: anywhere`. Newlines in pasted text become one space.
- Narrow containers: fixed container-query tiers. No `cqw`/`vw` units.
- Focus ring only through the modality-gated `focus-visible` variant (`src/styles/main.css:104`). A click never shows a ring.
- Radius: role tokens only (`--blok-radius-control`, `--blok-radius-control-lg`). Enforced by `radius-law.test.ts`.
- No inline `<svg>` in `src/`. Use `IconEmojiSmile` from `src/components/icons/index.ts`.
- No blue selected states. The open-picker state uses `--blok-item-hover-bg`.
- i18n: every new key in all 68 locales under `src/components/i18n/locales/`.
- Comments: short, only for what silently breaks.
- Unit tests: `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`. No `any`, `@ts-ignore` or `!`.
- E2E: no CSS class selectors. Use roles or `data-blok-testid`.
- Commits: one per task, push to `main` (trunk-based). Never `git commit -a`. Fail if `git diff --cached` has files you did not stage. Docs under `docs/plans/` need `git add -f`.
- Test runs: only the files named in each task. Full `yarn test` is not run (user rule). The final gate is in Task 12.

## Review Focus

Most likely first:

1. **`blocks.render(data)` with the same blocks but a new title.** Today the echo check (`api/blocks.ts:346`) returns early when blocks match. A host that renames the page and re-renders would see nothing change. Expected: the title updates and the caret is kept. Pinned in Task 3.
2. **Collaboration on, with a config `title`.** The document comes from the server (`core.ts:500`). Expected: the config title is not seeded locally, so it does not fight the server. The title arrives through the remote path, and nothing throws. Pinned in Task 3.
3. **IME composition in the title.** Expected: Enter while `isComposing` confirms the composition and never splits. Pinned in Task 7.
4. **Destroy with an external holder.** Expected: `blok.destroy()` removes the header from the host element, so no dead title stays in the app's DOM. Pinned in Task 5.
5. **`holder` selector that matches nothing.** Expected: boot logs a clear error and falls back to the inside-the-editor placement. The editor still boots. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/modules/yjs/document-store.ts` (modify) | `page` Y.Map, undo scope, reset, `pageFromJSON` |
| `src/components/modules/yjs/index.ts` (modify) | `getPageField`, `setPageField`, `onPageChange`, `loadPage` |
| `src/components/modules/yjs/page-fields.ts` (create) | `PageFields` type + `readPageFields()` (pure: Y.Map → `{ title?, icon? }`) |
| `types/api/title.d.ts` (create) | Public `Title` API + `TitleConfig` + `TitleChange` |
| `types/configs/blok-config.d.ts` (modify) | `title?: boolean \| TitleConfig` in `BlokMountOptions` |
| `types/data-formats/output-data.d.ts` (modify) | `title?`, `icon?` on `OutputData` and `LooseOutputData` |
| `src/components/utils/title-config.ts` (create) | `normalizeTitleConfig()` |
| `src/components/modules/saver.ts` (modify) | write `title`/`icon` |
| `src/components/core.ts` (modify) | keep `title`/`icon` in default-block data; seed on boot |
| `src/components/modules/api/blocks.ts` (modify) | seed on `render`, also on a blocks echo |
| `src/components/modules/pageTitle/index.ts` (create) | `PageTitle` module: lifecycle, mount, sync, callbacks |
| `src/components/modules/pageTitle/header-dom.ts` (create) | builds header / icon row / `h1` elements |
| `src/components/modules/pageTitle/title-keyboard.ts` (create) | Enter split, ArrowDown, undo keys, paste |
| `src/components/modules/pageTitle/icon-control.ts` (create) | Add icon / Change icon / picker |
| `src/components/modules/blockEvents/composers/keyboardNavigation.ts` (modify) | Backspace at first block start → title |
| `src/components/modules/caret.ts` (modify) | ArrowUp at first line of first block → title |
| `src/components/modules/ui.ts` (modify) | forward width + direction to `PageTitle` |
| `src/blok.ts` (modify) | `blok.title` pre-ready API |
| `src/styles/page-title.css` (create) + `src/styles/main.css` (import) | header styles |
| `types/events/editor-events.ts` (modify) | publish `'setting:changed'` |

---

### Task 1: `page` map in DocumentStore

**Files:**
- Create: `src/components/modules/yjs/page-fields.ts`
- Modify: `src/components/modules/yjs/document-store.ts:160` (field), `:199-210` (getters), `:2672-2675` (reset)
- Test: `test/unit/components/modules/yjs/document-store.test.ts:49` (scope expectation), new cases in the same file

**Interfaces:**
- Produces: `DocumentStore.page: Y.Map<unknown>`; `DocumentStore.pageFromJSON(fields: PageFields): void` (origin `'load'`, not undoable); `PageFields = { title?: string; icon?: PageIcon }`; `readPageFields(map: Y.Map<unknown>): PageFields`.

- [ ] **Step 1: Write the failing tests**

In `document-store.test.ts`, change the scope expectation at line 49 and add cases:

```ts
expect(store.undoScope).toEqual([store.blocksMap, store.rootOrder, store.values, store.page]);
```

```ts
describe('page map', () => {
  it('seeds title and icon from JSON and reads them back', () => {
    const store = createDocumentStore();

    store.pageFromJSON({ title: 'Plans', icon: { type: 'emoji', value: '🚀' } });

    expect(readPageFields(store.page)).toEqual({ title: 'Plans', icon: { type: 'emoji', value: '🚀' } });
  });

  it('drops fields the incoming JSON lacks', () => {
    const store = createDocumentStore();

    store.pageFromJSON({ title: 'Plans', icon: { type: 'emoji', value: '🚀' } });
    store.pageFromJSON({});

    expect(readPageFields(store.page)).toEqual({});
  });

  it('treats an empty title as absent', () => {
    const store = createDocumentStore();

    store.pageFromJSON({ title: '' });

    expect(store.page.has('title')).toBe(false);
  });

  it('gives a fresh page map after a lineage reset', () => {
    const store = createDocumentStore();
    const before = store.page;

    store.pageFromJSON({ title: 'Old' });
    store.resetForRelineage();

    expect(store.page).not.toBe(before);
    expect(readPageFields(store.page)).toEqual({});
  });
});
```

Import `readPageFields` from `../../../../../src/components/modules/yjs/page-fields`.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts`
Expected: FAIL. `store.page` is undefined and `page-fields` doesn't resolve.

- [ ] **Step 3: Implement**

`src/components/modules/yjs/page-fields.ts`:

```ts
import type * as Y from 'yjs';
import type { PageIcon } from '../../../../types/tools/page';

export type PageFieldKey = 'title' | 'icon';

export interface PageFields {
  title?: string;
  icon?: PageIcon;
}

const isPageIcon = (value: unknown): value is PageIcon => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type } = value as { type?: unknown };
  const field = type === 'emoji' ? 'value' : type === 'image' ? 'url' : null;

  return field !== null && typeof (value as Record<string, unknown>)[field] === 'string';
};

/** Absent and malformed both read as "none", so a bad peer write never reaches the DOM. */
export const readPageFields = (map: Y.Map<unknown>): PageFields => {
  const title = map.get('title');
  const icon = map.get('icon');

  return {
    ...(typeof title === 'string' && title !== '' && { title }),
    ...(isPageIcon(icon) && { icon }),
  };
};

export const writePageField = (map: Y.Map<unknown>, key: PageFieldKey, value: string | PageIcon | null | undefined): void => {
  if (value === undefined || value === null || value === '') {
    map.delete(key);

    return;
  }
  map.set(key, value);
};
```

In `document-store.ts`:

```ts
// line 160, after yValues
private yPage: Y.Map<unknown> = this.ydoc.getMap('page');
```

```ts
public get page(): Y.Map<unknown> {
  return this.yPage;
}

public get undoScope(): UndoScopeType[] {
  // blocksMap first: UndoHistory takes the first Y.Map as the blocks scope.
  return [this.yBlocksMap, this.yRootOrder, this.yValues, this.yPage];
}

/** Origin 'load': not undoable, and the page observer stays silent. */
public pageFromJSON(fields: PageFields): void {
  this.ydoc.transact(() => {
    writePageField(this.yPage, 'title', fields.title);
    writePageField(this.yPage, 'icon', fields.icon);
  }, 'load');
}
```

In `resetForRelineage()`, after line 2675 `this.yValues = this.ydoc.getMap('values');`:

```ts
this.yPage = this.ydoc.getMap('page');
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test test/unit/components/modules/yjs/document-store.test.ts test/unit/components/modules/yjs/lineage-reset.test.ts test/unit/components/modules/yjs/undo-gesture.test.ts`
Expected: PASS. The last two prove the scope change broke nothing.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/yjs/page-fields.ts src/components/modules/yjs/document-store.ts test/unit/components/modules/yjs/document-store.test.ts
git diff --cached --name-only   # must list exactly these 3 files
git commit -m "feat(yjs): page map for the built-in title and icon"
git pull --rebase && git push
```

---

### Task 2: Page-field read, write and observe in YjsManager

**Files:**
- Modify: `src/components/modules/yjs/index.ts` (fields near `:73-76`, `observeDocument` `:207-218`, new methods next to `setValue` `:908`)
- Test: `test/unit/components/modules/yjs/page-fields.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `DocumentStore.page`, `pageFromJSON`, `PageFields`, `PageFieldKey`, `writePageField`.
- Produces:
  - `YjsManager.getPageFields(): PageFields`
  - `YjsManager.setPageField(key: PageFieldKey, value: string | PageIcon | null, options?: { typing?: boolean }): void` (an undo step; `typing` continues a run)
  - `YjsManager.loadPage(fields: PageFields): void` (not undoable)
  - `YjsManager.onPageChange(listener: (key: PageFieldKey, source: 'undo' | 'redo' | 'remote') => void): () => void`

- [ ] **Step 1: Write the failing tests**

`test/unit/components/modules/yjs/page-fields.test.ts`. A real `Core` gives a real undo history:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Core } from '../../../../../src/components/core';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { YjsManager } from '../../../../../src/components/modules/yjs';

describe('YjsManager page fields', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (): Promise<YjsManager> => {
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [] } });

    await core.isReady;

    return core.moduleInstances.YjsManager;
  };

  it('undoes a title write and tells the listener the source', async () => {
    const yjs = await boot();
    const listener = vi.fn();

    yjs.onPageChange(listener);
    yjs.setPageField('title', 'Plans');
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({});
    expect(listener).toHaveBeenCalledWith('title', 'undo');
  });

  it('keeps one typing run as one undo step', async () => {
    const yjs = await boot();

    yjs.setPageField('title', 'P', { typing: true });
    yjs.setPageField('title', 'Pl', { typing: true });
    yjs.setPageField('title', 'Pla', { typing: true });
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({});
  });

  it('undoes an icon change', async () => {
    const yjs = await boot();

    yjs.setPageField('icon', { type: 'emoji', value: '🚀' });
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields().icon).toBeUndefined();
  });

  it('does not put a load in the undo history', async () => {
    const yjs = await boot();

    yjs.loadPage({ title: 'Loaded' });
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({ title: 'Loaded' });
  });

  it('reports a peer write as remote', async () => {
    const yjs = await boot();
    const listener = vi.fn();
    const peer = new Y.Doc();

    yjs.onPageChange(listener);
    Y.applyUpdate(peer, yjs.encodeStateAsUpdate());
    peer.getMap('page').set('title', 'From a peer');
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });

    expect(yjs.getPageFields()).toEqual({ title: 'From a peer' });
    expect(listener).toHaveBeenCalledWith('title', 'remote');
  });

  it('keeps listening after a lineage reset', async () => {
    const yjs = await boot();
    const listener = vi.fn();
    const peer = new Y.Doc();

    yjs.onPageChange(listener);
    yjs.resetForRelineage();
    peer.getMap('page').set('title', 'After reset');
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });

    expect(listener).toHaveBeenCalledWith('title', 'remote');
  });

  it('a host track() key named title does not touch the page title', async () => {
    const yjs = await boot();

    yjs.setValue('title', 'host value');

    expect(yjs.getPageFields()).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/yjs/page-fields.test.ts`
Expected: FAIL. `onPageChange is not a function`.

- [ ] **Step 3: Implement in `yjs/index.ts`**

Fields, next to `valueListeners` (`:73-76`):

```ts
private readonly pageListeners = new Set<(key: PageFieldKey, source: 'undo' | 'redo' | 'remote') => void>();
private observedPage: Y.Map<unknown> | null = null;
```

In `observeDocument()` (`:207-218`), after the `values` lines:

```ts
this.observedPage?.unobserve(this.onPageChanged);
this.observedPage = this.documentStore.page;
this.observedPage.observe(this.onPageChanged);
```

Handler, next to `onValuesChanged`:

```ts
// Same source rules as onValuesChanged: own writes and loads stay silent.
private readonly onPageChanged = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
  const { undoManager } = this.undoHistory;

  if (transaction.local && transaction.origin !== undoManager) {
    return;
  }
  const replay = undoManager.redoing ? 'redo' : 'undo';
  const source = transaction.local ? replay : 'remote';

  event.keysChanged.forEach((key: string) => {
    if (key === 'title' || key === 'icon') {
      this.pageListeners.forEach((listener) => listener(key, source));
    }
  });
};
```

Methods, next to `setValue` (`:908`):

```ts
public getPageFields(): PageFields {
  return readPageFields(this.documentStore.page);
}

public loadPage(fields: PageFields): void {
  this.flushPendingBlockWrites();
  this.documentStore.pageFromJSON(fields);
}

public setPageField(key: PageFieldKey, value: string | PageIcon | null, options: { typing?: boolean } = {}): void {
  const current = this.documentStore.page.get(key);

  if (JSON.stringify(current ?? null) === JSON.stringify(value === '' ? null : value)) {
    return;
  }
  if (!this.Blok.BlockManager.isApplyingRemoteChange && !this.documentStore.isTransactingWithoutCapture) {
    // 'page:' keeps the typing run apart from a host track() key of the same name.
    this.undoHistory.beginValueEdit(`page:${key}`, options.typing === true);
  }
  this.transact(() => writePageField(this.documentStore.page, key, value));
}

public onPageChange(listener: (key: PageFieldKey, source: 'undo' | 'redo' | 'remote') => void): () => void {
  this.pageListeners.add(listener);

  return () => this.pageListeners.delete(listener);
}
```

Imports: `PageFieldKey`, `PageFields`, `readPageFields`, `writePageField` from `./page-fields`; `PageIcon` type from `../../../../types/tools/page`.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test test/unit/components/modules/yjs/page-fields.test.ts test/unit/components/modules/yjs/lineage-reset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/yjs/index.ts test/unit/components/modules/yjs/page-fields.test.ts
git diff --cached --name-only
git commit -m "feat(yjs): read, write and observe page fields"
git pull --rebase && git push
```

---

### Task 3: Public types, save and load

**Files:**
- Create: `types/api/title.d.ts`; export it from `types/api/index.d.ts` (next to `export * from './width';`, line ~25) and from the `from './api'` list in `types/index.d.ts` (~194-196)
- Modify: `types/data-formats/output-data.d.ts:109-131` (`OutputData`) and `:177` (`LooseOutputData`)
- Modify: `types/configs/blok-config.d.ts` (`BlokMountOptions`, next to `placeholder?` at `:558-560`)
- Modify: `src/components/modules/saver.ts:419-425` and `:1255-1260`
- Modify: `src/components/core.ts:311-317` (default block keeps title/icon) and `render()` `:484-512` (seed)
- Modify: `src/components/modules/api/blocks.ts:328-360` (`replaceDocument`)
- Test: `test/unit/components/modules/page-title-data.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 `loadPage`, `getPageFields`.
- Produces (in `types/api/title.d.ts`):

```ts
import type { PageIcon } from '../tools/page';

/** What changed the title or icon. `user`: typing, paste, the icon picker. `api`: `blok.title.set`. */
export interface TitleChange {
  source: 'user' | 'undo' | 'redo' | 'remote' | 'api';
}

export interface TitleConfig {
  /** Element or selector to draw the title in. Omitted: above the first block. */
  holder?: HTMLElement | string;
  /** Shown while the title is empty. Default: the `title.placeholder` message. */
  placeholder?: string;
  /** False hides the icon and "Add icon". Default true. */
  icon?: boolean;
  /** Every change, from any source. Save on `user`, `undo`, `redo` and `api`. */
  onChange?(title: string, change: TitleChange): void;
  /** Every icon change, from any source. `null`: removed. */
  onIconChange?(icon: PageIcon | null, change: TitleChange): void;
}

/** The page title and icon. The value lives in the document and is saved with it. */
export interface Title {
  get(): string;
  /** One undo step. Fires `onChange` with source `api`. */
  set(text: string): void;
  focus(position?: 'start' | 'end'): void;
  /** Moves the title into `holder`. Focus and caret are kept. */
  mount(holder: HTMLElement | string): void;
  readonly icon: {
    get(): PageIcon | null;
    /** One undo step. Fires `onIconChange` with source `api`. */
    set(icon: PageIcon | null): void;
  };
}
```

`OutputData` and `LooseOutputData` gain:

```ts
/** The page title. Absent when empty. */
title?: string;
/** The page icon. Absent when none. */
icon?: PageIcon;
```

`BlokMountOptions` gains:

```ts
/**
 * The page title and icon. `true` uses the defaults. Off by default; a saved
 * title and icon still round-trip when it is off.
 */
title?: boolean | TitleConfig;
```

- [ ] **Step 1: Write the failing tests**

`test/unit/components/modules/page-title-data.test.ts`. Use the same `beforeEach`/`afterEach` and `holder` as Task 2, then:

```ts
const boot = async (config: Partial<BlokConfig> = {}): Promise<Core> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, ...config });

  await core.isReady;

  return core;
};

it('saves the loaded title and icon', async () => {
  const core = await boot({ data: { title: 'Plans', icon: { type: 'emoji', value: '🚀' }, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
  const saved = await core.moduleInstances.Saver.save();

  expect(saved?.title).toBe('Plans');
  expect(saved?.icon).toEqual({ type: 'emoji', value: '🚀' });
});

it('keeps the title when the document has no blocks (default block path)', async () => {
  const core = await boot({ data: { title: 'Plans', blocks: [] } });
  const saved = await core.moduleInstances.Saver.save();

  expect(saved?.title).toBe('Plans');
});

it('saves no title field for an untitled page', async () => {
  const core = await boot({ data: { blocks: [] } });
  const saved = await core.moduleInstances.Saver.save();

  expect(saved).not.toHaveProperty('title');
  expect(saved).not.toHaveProperty('icon');
});

it('render() with the same blocks and a new title updates the title', async () => {
  const blocks = [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }];
  const core = await boot({ data: { title: 'Old', blocks } });

  await core.moduleInstances.API.methods.blocks.render({ title: 'New', blocks });

  expect(core.moduleInstances.YjsManager.getPageFields().title).toBe('New');
});

it('render() without a title clears it', async () => {
  const core = await boot({ data: { title: 'Old', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });

  await core.moduleInstances.API.methods.blocks.render({ blocks: [{ id: 'p2', type: 'paragraph', data: { text: 'other' } }] });

  expect(core.moduleInstances.YjsManager.getPageFields()).toEqual({});
});

it('does not seed the config title when collaboration owns the document', async () => {
  const loadPage = vi.spyOn(YjsManager.prototype, 'loadPage');

  await boot({ data: { title: 'Local', blocks: [] }, collaboration: COLLAB_CONFIG_WITHOUT_SERVER });

  expect(loadPage).not.toHaveBeenCalled();
});
```

For `COLLAB_CONFIG_WITHOUT_SERVER`, copy the smallest collaboration config an existing unit test boots `Core` with: `grep -rln "collaboration:" test/unit/components/core*.test.ts test/unit/components/modules/collaboration | head`. Use that file's provider stub so no socket opens. Import `YjsManager` from `../../../../src/components/modules/yjs` and `BlokConfig` from `../../../../types`.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/page-title-data.test.ts`
Expected: FAIL. `saved.title` is undefined, and the type errors show in the editor too.

- [ ] **Step 3: Implement**

`saver.ts`, at BOTH output builders (`:419-425` and `:1255-1260`):

```ts
output: {
  id: this.getDocumentRecordId(),
  time: +new Date(),
  ...this.Blok.YjsManager.getPageFields(),
  blocks: [],
  version: getBlokVersion(),
},
```

```ts
return {
  id: this.getDocumentRecordId(),
  time: +new Date(),
  ...this.Blok.YjsManager.getPageFields(),
  blocks: hostBlocks,
  version: getBlokVersion(),
};
```

`core.ts:311-317`, so the default-block rewrite keeps the page fields:

```ts
const { id, title, icon } = this.config.data;
// Keep the id and page fields: the Saver and boot seed read them from here.
this.config.data = {
  ...(typeof id === 'string' && id !== '' ? { id } : {}),
  ...(title !== undefined && { title }),
  ...(icon !== undefined && { icon }),
  blocks: [ defaultBlockData ],
};
```

`core.ts` `render()`, after the collaboration early return (`:500-502`). The page is seeded before blocks, so the header shows the title on first paint:

```ts
this.moduleInstances.YjsManager.loadPage({ title: data.title ?? undefined, icon: data.icon ?? undefined });
```

`api/blocks.ts` `replaceDocument`, right after the `adoptDocumentRecordId` block (`:350`) and BEFORE the echo check, so a rename-only render still lands:

```ts
// Before the echo check: a rename with the same blocks is still a change.
this.Blok.YjsManager.loadPage({ title: data.title ?? undefined, icon: data.icon ?? undefined });
```

`LooseOutputData.title` is `string | null | undefined` on the wire. `?? undefined` folds `null` into absent.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test test/unit/components/modules/page-title-data.test.ts test/unit/components/modules/saver.test.ts test/unit/components/modules/api/blocks.test.ts`
Expected: PASS. If a Saver or blocks snapshot test compares whole output objects, re-read the failure. An untitled document must still produce byte-identical output: no `title` key.

- [ ] **Step 5: Type check the published surface**

Run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`
Expected: PASS. `types/api/title.d.ts` imports only from `../tools/page`.

- [ ] **Step 6: Commit**

```bash
git add types/api/title.d.ts types/api/index.d.ts types/index.d.ts types/data-formats/output-data.d.ts types/configs/blok-config.d.ts src/components/modules/saver.ts src/components/core.ts src/components/modules/api/blocks.ts test/unit/components/modules/page-title-data.test.ts
git diff --cached --name-only
git commit -m "feat(saver): title and icon round-trip through save and render"
git pull --rebase && git push
```

---

### Task 4: Config normalizer, data attributes, i18n keys

**Files:**
- Create: `src/components/utils/title-config.ts`
- Modify: `src/components/constants/data-attributes.ts` (new "Page title" group after the `width` entry at `:121`), then run `node scripts/generate-data-attributes-dts.mjs`
- Modify: all 68 `src/components/i18n/locales/*.json`, then run `node scripts/generate-message-keys-dts.mjs`
- Test: `test/unit/components/utils/title-config.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export interface ResolvedTitleConfig {
  holder: HTMLElement | string | null;
  placeholder: string | null;   // null: use the i18n key
  icon: boolean;
  onChange: TitleConfig['onChange'] | null;
  onIconChange: TitleConfig['onIconChange'] | null;
}
export const normalizeTitleConfig: (value: BlokConfig['title']) => ResolvedTitleConfig | null;
```

- `DATA_ATTR.pageHeader = 'data-blok-page-header'`, `pageTitle = 'data-blok-page-title'`, `pageIconRow = 'data-blok-page-icon-row'`, `pageIcon = 'data-blok-page-icon'`, `pageAddIcon = 'data-blok-page-add-icon'`.
- Message keys: `title.placeholder` ("New page"), `title.ariaLabel` ("Page title"), `title.addIcon` ("Add icon"), `title.changeIcon` ("Change icon").

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeTitleConfig } from '../../../../src/components/utils/title-config';

describe('normalizeTitleConfig', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('is off when absent or false', () => {
    expect(normalizeTitleConfig(undefined)).toBeNull();
    expect(normalizeTitleConfig(false)).toBeNull();
  });

  it('true gives the defaults', () => {
    expect(normalizeTitleConfig(true)).toEqual({ holder: null, placeholder: null, icon: true, onChange: null, onIconChange: null });
  });

  it('keeps given fields', () => {
    const onChange = vi.fn();

    expect(normalizeTitleConfig({ holder: '#t', placeholder: 'Untitled', icon: false, onChange })).toEqual({
      holder: '#t', placeholder: 'Untitled', icon: false, onChange, onIconChange: null,
    });
  });

  it('treats an empty placeholder as the default', () => {
    expect(normalizeTitleConfig({ placeholder: '' })?.placeholder).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/components/utils/title-config.test.ts`
Expected: FAIL. The module isn't found.

- [ ] **Step 3: Implement**

```ts
import type { BlokConfig, TitleConfig } from '../../../types';

export interface ResolvedTitleConfig {
  holder: HTMLElement | string | null;
  placeholder: string | null;
  icon: boolean;
  onChange: NonNullable<TitleConfig['onChange']> | null;
  onIconChange: NonNullable<TitleConfig['onIconChange']> | null;
}

export const normalizeTitleConfig = (value: BlokConfig['title']): ResolvedTitleConfig | null => {
  if (value === undefined || value === false) {
    return null;
  }
  const config: TitleConfig = value === true ? {} : value;

  return {
    holder: config.holder ?? null,
    placeholder: config.placeholder === undefined || config.placeholder === '' ? null : config.placeholder,
    icon: config.icon !== false,
    onChange: config.onChange ?? null,
    onIconChange: config.onIconChange ?? null,
  };
};
```

Data attributes, after `width` (`:121`):

```ts
  // Page title
  /** Page title header root (icon row + title) */
  pageHeader: 'data-blok-page-header',
  /** Editable page title */
  pageTitle: 'data-blok-page-title',
  /** Row above the title holding the icon or "Add icon" */
  pageIconRow: 'data-blok-page-icon-row',
  /** Page icon button */
  pageIcon: 'data-blok-page-icon',
  /** "Add icon" button */
  pageAddIcon: 'data-blok-page-add-icon',
```

Then run `node scripts/generate-data-attributes-dts.mjs`.

i18n: invoke the `blok-translations` skill and add the four keys to every locale. `en.json`:

```json
"title.placeholder": "New page",
"title.ariaLabel": "Page title",
"title.addIcon": "Add icon",
"title.changeIcon": "Change icon",
```

Then run `node scripts/generate-message-keys-dts.mjs` and `yarn i18n:check`.

- [ ] **Step 4: Run to verify**

Run: `yarn test test/unit/components/utils/title-config.test.ts test/unit/architecture/published-types-no-src-refs.test.ts`
Expected: PASS. Also expect `yarn i18n:check` to report no missing keys.

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/title-config.ts test/unit/components/utils/title-config.test.ts src/components/constants/data-attributes.ts types/data-attributes.d.ts types/message-keys.d.ts src/components/i18n/locales/*.json
git diff --cached --name-only
git commit -m "feat(title): config normalizer, data attributes, messages"
git pull --rebase && git push
```

---

### Task 5: `PageTitle` module: header DOM, placement, text, callbacks

**Files:**
- Create: `src/components/modules/pageTitle/header-dom.ts`, `src/components/modules/pageTitle/index.ts`
- Modify: `src/components/modules/index.ts` (register after `UI`), `src/types-internal/blok-modules.d.ts` (`PageTitle: PageTitle`), `src/components/core.ts` `modulesToPrepare` (append `'PageTitle'` after `'PageReferences'`)
- Test: `test/unit/components/modules/pageTitle/page-title.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 YjsManager methods; Task 4 `normalizeTitleConfig`, `DATA_ATTR.page*`, message keys.
- Produces (used by Tasks 6-10):

```ts
class PageTitle extends Module {
  readonly isEnabled: boolean;
  readonly titleElement: HTMLElement | null;      // the h1
  readonly headerElement: HTMLElement | null;     // the root
  getText(): string;
  setText(text: string, source: 'api'): void;
  focus(position?: 'start' | 'end'): void;
  focusAtX(x: number | null): void;               // caret on title's last line at x
  appendAndFocus(text: string): void;             // Backspace-join from the first block
  mount(holder: HTMLElement | string): void;
  syncWidth(mode: EditorWidth): void;
  syncDirection(): void;
  toggleReadOnly(state: boolean): void;
  getIcon(): PageIcon | null;
  setIcon(icon: PageIcon | null, source: 'user' | 'api'): void;
}
```

`header-dom.ts`:

```ts
export interface HeaderNodes { header: HTMLElement; iconRow: HTMLElement; title: HTMLElement }
export const buildHeader: (labels: { placeholder: string; ariaLabel: string }) => HeaderNodes;
```

- [ ] **Step 1: Write the failing tests**

`page-title.test.ts`. Use the same holder and mock setup as Task 2. Then:

```ts
const boot = async (config: Partial<BlokConfig>): Promise<Core> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] }, ...config });

  await core.isReady;

  return core;
};
const titleIn = (root: ParentNode): HTMLElement | null => root.querySelector(`[${DATA_ATTR.pageTitle}]`);

it('draws nothing without the title config', async () => {
  await boot({});
  expect(titleIn(holder)).toBeNull();
});

it('draws the header inside the editor, before the blocks', async () => {
  await boot({ title: true });
  const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);
  const redactor = holder.querySelector(`[${DATA_ATTR.redactor}]`);

  expect(header?.nextElementSibling).toBe(redactor);
});

it('draws into an outside holder given by selector', async () => {
  const outside = document.createElement('section');

  outside.id = 'page-title';
  document.body.appendChild(outside);
  await boot({ title: { holder: '#page-title' } });

  expect(titleIn(outside)).not.toBeNull();
  expect(titleIn(holder)).toBeNull();
  outside.remove();
});

it('falls back to inside the editor when the holder selector matches nothing', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await boot({ title: { holder: '#missing' } });

  expect(titleIn(holder)).not.toBeNull();
  expect(error).toHaveBeenCalled();
});

it('shows the loaded title and the i18n placeholder', async () => {
  await boot({ title: true, data: { title: 'Plans', blocks: [] } });
  const title = titleIn(holder);

  expect(title?.textContent).toBe('Plans');
  expect(title?.getAttribute('data-placeholder')).toBe('New page');
  expect(title?.getAttribute('role')).toBe('textbox');
  expect(title?.getAttribute('aria-label')).toBe('Page title');
});

it('typing writes the document and fires onChange with source user', async () => {
  const onChange = vi.fn();
  const core = await boot({ title: { onChange } });
  const title = titleIn(holder);

  if (title === null) { throw new Error('no title'); }
  title.textContent = 'Plans';
  title.dispatchEvent(new InputEvent('input', { bubbles: true }));

  expect(core.moduleInstances.YjsManager.getPageFields().title).toBe('Plans');
  expect(onChange).toHaveBeenCalledWith('Plans', { source: 'user' });
});

it('turns newlines into spaces and leaves no stray br when emptied', async () => {
  await boot({ title: true });
  const title = titleIn(holder);

  if (title === null) { throw new Error('no title'); }
  title.textContent = 'a\nb';
  title.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(title.textContent).toBe('a b');

  title.innerHTML = '<br>';
  title.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(title.childNodes.length).toBe(0);
});

it('undo restores the text and fires onChange with source undo', async () => {
  const onChange = vi.fn();
  const core = await boot({ title: { onChange } });

  core.moduleInstances.PageTitle.setText('Plans', 'api');
  core.moduleInstances.YjsManager.stopCapturing();
  core.moduleInstances.YjsManager.undo();

  expect(titleIn(holder)?.textContent).toBe('');
  expect(onChange).toHaveBeenLastCalledWith('', { source: 'undo' });
});

it('read-only makes the title not editable, and back', async () => {
  const core = await boot({ title: true, readOnly: true });

  expect(titleIn(holder)?.getAttribute('contenteditable')).toBe('false');
  await core.moduleInstances.ReadOnly.toggle(false);
  expect(titleIn(holder)?.getAttribute('contenteditable')).toBe('true');
});

it('carries data-blok-interface so tokens and theme reach an outside holder', async () => {
  await boot({ title: true });
  expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.getAttribute(DATA_ATTR.interface)).toBe('blok');
});

it('destroy empties an outside holder', async () => {
  const outside = document.createElement('div');

  document.body.appendChild(outside);
  const core = await boot({ title: { holder: outside } });

  core.moduleInstances.PageTitle.destroy();

  expect(outside.childElementCount).toBe(0);
  outside.remove();
});

it('render() with a new title redraws the header', async () => {
  const blocks = [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }];
  const core = await boot({ title: true, data: { title: 'Old', blocks } });

  await core.moduleInstances.API.methods.blocks.render({ title: 'New', blocks });

  expect(titleIn(holder)?.textContent).toBe('New');
});

it('mount() moves the same element', async () => {
  const core = await boot({ title: true });
  const before = titleIn(holder);
  const target = document.createElement('div');

  document.body.appendChild(target);
  core.moduleInstances.PageTitle.mount(target);

  expect(titleIn(target)).toBe(before);
  target.remove();
});
```

`ReadOnly.toggle(state)` is the in-place switch (`readonly.ts`). Check its exact signature before running.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/pageTitle/page-title.test.ts`
Expected: FAIL. No header is found.

- [ ] **Step 3: Audit `[data-blok-interface]` users**

Run: `grep -rn "data-blok-interface\|DATA_ATTR.interface" src --include='*.ts' | grep -v "constants/data-attributes"`
For each hit that treats a `[data-blok-interface="blok"]` element as "the editor wrapper", e.g. `closest(...)` to find the owning editor or `querySelectorAll` to count editors, narrow it to also require `[${DATA_ATTR.editor}]`. List every hit and its verdict in the commit body. If a narrowing changes behaviour, add a unit test for that file.

- [ ] **Step 4: Implement `header-dom.ts`**

```ts
import { DATA_ATTR } from '../../constants/data-attributes';
import { BLOK_INTERFACE_VALUE } from '../../constants';

export interface HeaderNodes {
  header: HTMLElement;
  iconRow: HTMLElement;
  title: HTMLElement;
}

export const buildHeader = (labels: { placeholder: string; ariaLabel: string }): HeaderNodes => {
  const header = document.createElement('div');
  const iconRow = document.createElement('div');
  const title = document.createElement('h1');

  header.setAttribute(DATA_ATTR.pageHeader, '');
  // Tokens and theme are declared on [data-blok-interface]; an outside holder has no other source.
  header.setAttribute(DATA_ATTR.interface, BLOK_INTERFACE_VALUE);
  // Blok's block and editor key handling stand down; the title handles its own keys.
  header.setAttribute(DATA_ATTR.keyboardOwner, '');
  header.setAttribute('data-blok-testid', 'page-header');

  iconRow.setAttribute(DATA_ATTR.pageIconRow, '');

  title.setAttribute(DATA_ATTR.pageTitle, '');
  title.setAttribute('data-blok-testid', 'page-header-title');
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-multiline', 'false');
  title.setAttribute('aria-label', labels.ariaLabel);
  title.setAttribute('data-placeholder', labels.placeholder);
  title.spellcheck = false;

  header.append(iconRow, title);

  return { header, iconRow, title };
};
```

`BLOK_INTERFACE_VALUE` is the constant `ui.ts:794` writes. Import it from wherever `ui.ts` imports it.

- [ ] **Step 5: Implement `pageTitle/index.ts`**

```ts
import { Module } from '../../__module';
import { DATA_ATTR } from '../../constants/data-attributes';
import { I18nChanged } from '../../events';
import { logLabeled } from '../../utils';
import type { EditorWidth } from '../../../../types/api/width';
import type { PageIcon } from '../../../../types/tools/page';
import type { TitleChange } from '../../../../types/api/title';
import { normalizeTitleConfig, type ResolvedTitleConfig } from '../../utils/title-config';
import { buildHeader, type HeaderNodes } from './header-dom';

export class PageTitle extends Module {
  private resolved: ResolvedTitleConfig | null = null;
  private dom: HeaderNodes | null = null;
  private stopPageListener: (() => void) | null = null;
  private readOnly = false;

  public get isEnabled(): boolean { return this.dom !== null; }
  public get titleElement(): HTMLElement | null { return this.dom?.title ?? null; }
  public get headerElement(): HTMLElement | null { return this.dom?.header ?? null; }

  public prepare(): void {
    this.resolved = normalizeTitleConfig(this.config.title);
    if (this.resolved === null) {
      return;
    }
    const { I18n, UI, YjsManager, ReadOnly } = this.Blok;

    this.dom = buildHeader({
      placeholder: this.resolved.placeholder ?? I18n.t('title.placeholder'),
      ariaLabel: I18n.t('title.ariaLabel'),
    });
    this.placeInitially(this.resolved.holder);
    this.renderText();
    this.syncWidth(UI.getWidthMode());
    this.syncDirection();
    this.toggleReadOnly(ReadOnly.isEnabled);
    this.dom.title.addEventListener('input', this.onInput);
    this.stopPageListener = YjsManager.onPageChange((key, source) => this.onPageChange(key, source));
    this.eventsDispatcher.on(I18nChanged, this.relabel);
  }

  public getText(): string {
    return this.Blok.YjsManager.getPageFields().title ?? '';
  }

  public setText(text: string, source: 'api'): void {
    this.Blok.YjsManager.setPageField('title', text);
    this.renderText();
    this.notifyTitle({ source });
  }

  public mount(holder: HTMLElement | string): void {
    const target = typeof holder === 'string' ? document.querySelector<HTMLElement>(holder) : holder;

    if (target === null) {
      throw new Error(`blok.title.mount: no element matches "${String(holder)}"`);
    }
    if (this.dom !== null) {
      target.appendChild(this.dom.header);
    }
  }

  public syncWidth(mode: EditorWidth): void {
    if (mode === 'full') {
      this.dom?.header.setAttribute(DATA_ATTR.width, 'full');
    } else {
      this.dom?.header.removeAttribute(DATA_ATTR.width);
    }
  }

  public syncDirection(): void {
    this.dom?.header.setAttribute('dir', this.isRtl ? 'rtl' : 'ltr');
  }

  // ReadOnly calls this during its own prepare, before ours: dom may still be null.
  public toggleReadOnly(state: boolean): void {
    this.readOnly = state;
    if (this.dom !== null) {
      this.dom.title.contentEditable = state ? 'false' : 'true';
    }
  }

  public destroy(): void {
    this.stopPageListener?.();
    this.eventsDispatcher.off(I18nChanged, this.relabel);
    this.dom?.header.remove();
    this.dom = null;
  }

  private placeInitially(holder: HTMLElement | string | null): void {
    if (this.dom === null) {
      return;
    }
    const target = holder === null ? null
      : typeof holder === 'string' ? document.querySelector<HTMLElement>(holder) : holder;

    if (holder !== null && target === null) {
      logLabeled(`title.holder "${String(holder)}" matches no element; the title is drawn above the first block`, 'error');
    }
    if (target !== null) {
      target.appendChild(this.dom.header);

      return;
    }
    const { wrapper, redactor } = this.Blok.UI.nodes;

    wrapper.insertBefore(this.dom.header, redactor);
  }

  private readonly onInput = (event: Event): void => {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    const text = (title.textContent ?? '').replace(/\n/g, ' ');

    // A stray <br> hides the :empty placeholder.
    if (text === '') {
      title.replaceChildren();
    }
    this.Blok.YjsManager.setPageField('title', text, { typing: event instanceof InputEvent });
    this.notifyTitle({ source: 'user' });
  };

  private onPageChange(key: 'title' | 'icon', source: 'undo' | 'redo' | 'remote'): void {
    if (key === 'title') {
      this.renderText();
      this.notifyTitle({ source });
      if (source !== 'remote') {
        this.focus('end');
      }
    }
  }

  /** Keeps the caret offset, clamped. Writes no empty text node: the placeholder needs :empty. */
  private renderText(): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    const text = this.getText();

    if ((title.textContent ?? '') === text) {
      return;
    }
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;
    const caret = selection !== null && node !== null && title.contains(node) ? selection.anchorOffset : null;

    title.replaceChildren(...(text === '' ? [] : [text]));
    if (caret !== null && title.firstChild !== null) {
      selection?.setPosition(title.firstChild, Math.min(caret, text.length));
    }
  }

  private notifyTitle(change: TitleChange): void {
    this.resolved?.onChange?.(this.getText(), change);
  }

  private readonly relabel = (): void => {
    if (this.dom === null || this.resolved === null) {
      return;
    }
    const { I18n } = this.Blok;

    this.dom.title.setAttribute('data-placeholder', this.resolved.placeholder ?? I18n.t('title.placeholder'));
    this.dom.title.setAttribute('aria-label', I18n.t('title.ariaLabel'));
  };

  public focus(position: 'start' | 'end' = 'end'): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    title.focus();
    window.getSelection()?.setPosition(title, position === 'start' ? 0 : title.childNodes.length);
  }
}
```

A load (origin `'load'`) is silent to `onPageChange` on purpose: it is nobody's edit, so it must not fire `onChange`. Core boot seeds the page AFTER `prepare()`, so the header needs an explicit redraw after every load. Add:

```ts
/** Redraw from the document after a load. Fires no callbacks. */
public refresh(): void {
  this.renderText();
}
```

Call it right after each `loadPage` added in Task 3:
- in `core.ts` `render()`: `this.moduleInstances.PageTitle?.refresh();`
- in `api/blocks.ts` `replaceDocument`: `this.Blok.PageTitle?.refresh();`

Add both files to this task's commit.

`getIcon`/`setIcon` come in Task 8, and `focusAtX`/`appendAndFocus` in Task 7. Keep the class fields as they are.

Register the module in `src/components/modules/index.ts` after `UI`, add it to `BlokModules`, and append `'PageTitle'` to `modulesToPrepare` in `core.ts`.

- [ ] **Step 6: Run to verify they pass**

Run: `yarn test test/unit/components/modules/pageTitle/page-title.test.ts test/unit/components/modules/ui-controls-hidden-attr.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/pageTitle src/components/modules/index.ts src/types-internal/blok-modules.d.ts src/components/core.ts src/components/modules/api/blocks.ts test/unit/components/modules/pageTitle/page-title.test.ts
git diff --cached --name-only
git commit -m "feat(title): PageTitle module draws, places and edits the title"
git pull --rebase && git push
```

---

### Task 6: Width, direction and the public `blok.title` API

**Files:**
- Modify: `src/components/modules/ui.ts:480-488` (`setWidthMode`) and `:500-529` (`setDirection`)
- Modify: `src/blok.ts` (after the placeholder block, `:405-425`; replay inside `isReady.then`, `:500-551`)
- Modify: `types/index.d.ts` (`PendingBlok` `:567-584` and `class Blok` `:668-670`: `public title: Title;`)
- Modify: `types/events/editor-events.ts:252-257`; `src/components/events/SettingChanged.ts`
- Test: `test/unit/components/modules/pageTitle/page-title-api.test.ts` (create)

**Interfaces:**
- Consumes: Task 5 `PageTitle` methods.
- Produces: `blok.title: Title` (from Task 3 types), callable before `isReady`. `BlokEditorEventMap['setting:changed']: SettingChangedPayload`.

- [ ] **Step 1: Write the failing tests**

Boot through the public `Blok` class (`import Blok from '../../../../../src/blok'`). This tests the buffer, not internals:

```ts
it('title.set before ready lands after ready', async () => {
  const blok = new Blok({ holder, tools: { paragraph: { class: Paragraph } }, title: true });

  blok.title.set('Early');
  await blok.isReady;

  expect(blok.title.get()).toBe('Early');
  expect(holder.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent).toBe('Early');
});

it('title.set fires onChange with source api and is one undo step', async () => {
  const onChange = vi.fn();
  const blok = new Blok({ holder, tools: { paragraph: { class: Paragraph } }, title: { onChange } });

  await blok.isReady;
  blok.title.set('Plans');
  blok.history.undo();

  expect(onChange).toHaveBeenNthCalledWith(1, 'Plans', { source: 'api' });
  expect(blok.title.get()).toBe('');
});

it('width.set full marks the header too', async () => {
  const blok = new Blok({ holder, tools: { paragraph: { class: Paragraph } }, title: true });

  await blok.isReady;
  blok.width.set('full');
  const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);

  expect(header?.getAttribute(DATA_ATTR.width)).toBe('full');
  blok.width.set('narrow');
  expect(header?.hasAttribute(DATA_ATTR.width)).toBe(false);
});

it('a locale switch to RTL flips the header direction', async () => {
  const blok = new Blok({ holder, tools: { paragraph: { class: Paragraph } }, title: true });

  await blok.isReady;
  await blok.i18n.setLocale('ar');

  expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.getAttribute('dir')).toBe('rtl');
});

it('title.mount before ready moves the header once ready', async () => {
  const target = document.createElement('div');

  document.body.appendChild(target);
  const blok = new Blok({ holder, tools: { paragraph: { class: Paragraph } }, title: true });

  blok.title.mount(target);
  await blok.isReady;

  expect(target.querySelector(`[${DATA_ATTR.pageTitle}]`)).not.toBeNull();
  target.remove();
});
```

Check the exact i18n locale-switch API in `types/api/i18n.d.ts` before running. Use the method it declares.

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/pageTitle/page-title-api.test.ts`
Expected: FAIL. `blok.title` is undefined.

- [ ] **Step 3: Implement**

`ui.ts` `setWidthMode`, at the end:

```ts
this.Blok.PageTitle?.syncWidth(mode);
```

`ui.ts` `setDirection`, after the attribute writes (`:516-520`):

```ts
this.Blok.PageTitle?.syncDirection();
```

`blok.ts`, after the placeholder block. Same buffer shape as `width`:

```ts
const titleBuffer = { text: null as string | null, icon: undefined as PageIcon | null | undefined, holder: null as HTMLElement | string | null };
const getPageTitle = (): BlokModules['PageTitle'] | undefined =>
  (blok.moduleInstances as Partial<BlokModules>).PageTitle;

(this as Record<string, unknown>).title = {
  get: (): string => getPageTitle()?.getText() ?? titleBuffer.text ?? '',
  set: (text: string): void => {
    const pageTitle = getPageTitle();

    if (pageTitle === undefined) { titleBuffer.text = text; return; }
    pageTitle.setText(text, 'api');
  },
  focus: (position?: 'start' | 'end'): void => getPageTitle()?.focus(position),
  mount: (holder: HTMLElement | string): void => {
    const pageTitle = getPageTitle();

    if (pageTitle === undefined) { titleBuffer.holder = holder; return; }
    pageTitle.mount(holder);
  },
  icon: {
    get: (): PageIcon | null => getPageTitle()?.getIcon() ?? titleBuffer.icon ?? null,
    set: (icon: PageIcon | null): void => {
      const pageTitle = getPageTitle();

      if (pageTitle === undefined) { titleBuffer.icon = icon; return; }
      pageTitle.setIcon(icon, 'api');
    },
  },
};
```

Replay inside `isReady.then`, after the placeholder replay:

```ts
const pageTitle = (blok.moduleInstances as Partial<BlokModules>).PageTitle;

if (pageTitle !== undefined) {
  if (titleBuffer.holder !== null) { pageTitle.mount(titleBuffer.holder); }
  if (titleBuffer.text !== null) { pageTitle.setText(titleBuffer.text, 'api'); }
  if (titleBuffer.icon !== undefined) { pageTitle.setIcon(titleBuffer.icon, 'api'); }
}
titleBuffer.holder = null; titleBuffer.text = null; titleBuffer.icon = undefined;
```

`getIcon`/`setIcon` are added in Task 8. Until then, add them to `PageTitle` as minimal stubs so this compiles:

```ts
public getIcon(): PageIcon | null { return this.Blok.YjsManager.getPageFields().icon ?? null; }
public setIcon(icon: PageIcon | null, _source: 'user' | 'api'): void { this.Blok.YjsManager.setPageField('icon', icon); }
```

Task 8 replaces them.

Public event: add a `SettingChangedPayload` to `types/events/editor-events.ts`:

```ts
/** Fired when `theme.set`, `width.set` or `width.toggle` changes a setting at runtime. Never for the boot config. */
export type SettingChangedPayload =
  | { setting: 'theme'; value: ThemeMode }
  | { setting: 'width'; value: EditorWidth };
```

Add `'setting:changed': SettingChangedPayload;` to `BlokEditorEventMap`. Replace the type in `src/components/events/SettingChanged.ts` with `export type { SettingChangedPayload } from '../../../types/events/editor-events';`, the same as `I18nChanged.ts` does. Re-export `SettingChangedPayload` from `types/index.d.ts` (~205-224).

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test test/unit/components/modules/pageTitle/page-title-api.test.ts test/unit/components/modules/tabSync test/unit/architecture/published-types-no-src-refs.test.ts test/unit/architecture/blok-class-api-parity.test.ts`
Expected: PASS. Tab sync consumes `SettingChanged`, so its tests prove the type move broke nothing. If the class-parity test lives at a different path, find it with `ls test/unit/architecture | grep -i parity`.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/ui.ts src/blok.ts src/components/modules/pageTitle/index.ts types/index.d.ts types/events/editor-events.ts src/components/events/SettingChanged.ts test/unit/components/modules/pageTitle/page-title-api.test.ts
git diff --cached --name-only
git commit -m "feat(title): blok.title API; header follows width and direction; publish setting:changed"
git pull --rebase && git push
```

---

### Task 7: Keyboard between the title and the first block

**Files:**
- Create: `src/components/modules/pageTitle/title-keyboard.ts`
- Modify: `src/components/modules/pageTitle/index.ts` (wire it in `prepare`; add `focusAtX`, `appendAndFocus`)
- Modify: `src/components/modules/caret.ts:1040-1046` (ArrowUp exit with no previous block)
- Modify: `src/components/modules/blockEvents/composers/keyboardNavigation.ts:889-894` (Backspace exit with no previous block)
- Test: `test/unit/components/modules/pageTitle/title-keyboard.test.ts` (create); new cases in `test/unit/components/modules/blockEvents/composers/keyboardNavigation.onEnter.test.ts`'s sibling file `keyboardNavigation.titleJoin.test.ts` (create)

**Interfaces:**
- Consumes: Task 5 `PageTitle`.
- Produces: `PageTitle.focusAtX(x: number | null): void`; `PageTitle.appendAndFocus(text: string): void`; `bindTitleKeyboard(title: HTMLElement, host: TitleKeyboardHost): () => void`, where

```ts
export interface TitleKeyboardHost {
  isReadOnly(): boolean;
  /** Enter: text after the caret becomes a new first block. */
  split(html: string): void;
  /** ArrowDown on the last line. */
  toFirstBlock(x: number | null): void;
  undo(): void;
  redo(): void;
  /** Title text changed by a non-typing write (paste, Enter). */
  commit(): void;
}
```

- [ ] **Step 1: Write the failing tests (title side)**

`title-keyboard.test.ts`, driving a bare element and a host spy object:

```ts
const setup = (text: string, caret: number): { title: HTMLElement; host: { [K in keyof TitleKeyboardHost]: ReturnType<typeof vi.fn> } } => {
  const title = document.createElement('h1');

  title.contentEditable = 'true';
  title.textContent = text;
  document.body.appendChild(title);
  title.focus();
  window.getSelection()?.setPosition(title.firstChild, caret);
  const host = { isReadOnly: vi.fn(() => false), split: vi.fn(), toFirstBlock: vi.fn(), undo: vi.fn(), redo: vi.fn(), commit: vi.fn() };

  bindTitleKeyboard(title, host);

  return { title, host };
};
const press = (el: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  el.dispatchEvent(event);

  return event;
};

it('Enter splits: text after the caret goes to a new first block', () => {
  const { title, host } = setup('Hello world', 5);

  press(title, { key: 'Enter' });

  expect(title.textContent).toBe('Hello');
  expect(host.split).toHaveBeenCalledWith(' world');
  expect(host.commit).toHaveBeenCalled();
});

it('Enter during IME composition does nothing', () => {
  const { title, host } = setup('Hello', 5);
  const event = press(title, { key: 'Enter', isComposing: true });

  expect(host.split).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

it('Cmd+Z and Cmd+Shift+Z go to the editor history', () => {
  const { title, host } = setup('Hi', 2);

  press(title, { key: 'z', metaKey: true });
  press(title, { key: 'z', metaKey: true, shiftKey: true });
  press(title, { key: 'y', ctrlKey: true });

  expect(host.undo).toHaveBeenCalledTimes(1);
  expect(host.redo).toHaveBeenCalledTimes(2);
});

it('paste inserts plain text with newlines as spaces', () => {
  const { title, host } = setup('ab', 1);
  const data = new DataTransfer();

  data.setData('text/plain', 'x\n\ny');
  title.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));

  expect(title.textContent).toBe('ax yb');
  expect(host.commit).toHaveBeenCalled();
});

it('read-only: Enter does not split', () => {
  const { title, host } = setup('Hello', 2);

  host.isReadOnly.mockReturnValue(true);
  press(title, { key: 'Enter' });

  expect(host.split).not.toHaveBeenCalled();
});
```

jsdom has no layout, so `isCaretAtLastLine` can't be driven here. ArrowDown is covered in the E2E spec (Task 11). If jsdom lacks the `DataTransfer` constructor, build the event with `Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'x\n\ny' } })`.

- [ ] **Step 2: Write the failing tests (block side)**

`keyboardNavigation.titleJoin.test.ts`. Copy the mocked-modules harness from `keyboardNavigation.onEnter.test.ts` (fake `KeyboardEvent` with a `preventDefault` spy, `createBlock()`, hand-built `blok` object). Set `BlockManager.previousBlock: null` and the caret at input start. Then add `PageTitle: { isEnabled: true, appendAndFocus: vi.fn(), focus: vi.fn() }` plus `BlockManager.removeBlock: vi.fn()` and `getChildren`/`hasChildren` as the real BlockManager names them.

Look up the real names in `blockManager/blockManager.ts` first.

```ts
it('Backspace at the start of the first block joins its text into the title', () => {
  keyboardNavigation.handleBackspace(backspaceEvent);

  expect(blok.PageTitle.appendAndFocus).toHaveBeenCalledWith('hello');
  expect(blok.BlockManager.removeBlock).toHaveBeenCalledWith(mockBlock);
});

it('a first block with children only moves focus to the title', () => {
  hasChildren.mockReturnValue(true);
  keyboardNavigation.handleBackspace(backspaceEvent);

  expect(blok.PageTitle.focus).toHaveBeenCalledWith('end');
  expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
});

it('without a title, Backspace at the first block still does nothing', () => {
  blok.PageTitle.isEnabled = false;
  keyboardNavigation.handleBackspace(backspaceEvent);

  expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `yarn test test/unit/components/modules/pageTitle/title-keyboard.test.ts test/unit/components/modules/blockEvents/composers/keyboardNavigation.titleJoin.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `title-keyboard.ts`**

```ts
import { getCaretXPosition, isCaretAtLastLine } from '../../utils/caret';

export interface TitleKeyboardHost {
  isReadOnly(): boolean;
  split(html: string): void;
  toFirstBlock(x: number | null): void;
  undo(): void;
  redo(): void;
  commit(): void;
}

export const bindTitleKeyboard = (title: HTMLElement, host: TitleKeyboardHost): (() => void) => {
  const onKeydown = (event: KeyboardEvent): void => {
    const letter = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    const redo = (mod && event.shiftKey && letter === 'z') || (event.ctrlKey && !event.shiftKey && letter === 'y');

    if (redo || (mod && !event.shiftKey && letter === 'z')) {
      event.preventDefault();
      if (redo) { host.redo(); } else { host.undo(); }

      return;
    }
    if (event.isComposing || host.isReadOnly()) {
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && isCaretAtLastLine(title)) {
      event.preventDefault();
      host.toFirstBlock(getCaretXPosition());

      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const range = window.getSelection()?.getRangeAt(0);

    if (range === undefined || !title.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    range.setEnd(title, title.childNodes.length);
    const rest = document.createElement('div');

    rest.append(range.extractContents());
    title.normalize();
    host.commit();
    host.split(rest.innerHTML);
  };

  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    const range = window.getSelection()?.getRangeAt(0);

    if (range === undefined || !title.contains(range.commonAncestorContainer) || host.isReadOnly()) {
      return;
    }
    const text = document.createTextNode((event.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' '));

    range.deleteContents();
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    title.normalize();
    host.commit();
  };

  title.addEventListener('keydown', onKeydown);
  title.addEventListener('paste', onPaste);

  return () => {
    title.removeEventListener('keydown', onKeydown);
    title.removeEventListener('paste', onPaste);
  };
};
```

In `PageTitle.prepare()`, after the input listener:

```ts
this.unbindKeyboard = bindTitleKeyboard(this.dom.title, {
  isReadOnly: () => this.readOnly,
  // The title write and the insert land in the same task, so they join one undo step.
  split: (html) => {
    this.Blok.API.methods.blocks.insert(undefined, { text: html }, {}, 0, false);
    this.Blok.API.methods.caret.setToFirstBlock('start');
  },
  toFirstBlock: (x) => this.caretToFirstBlock(x),
  undo: () => this.Blok.API.methods.history.undo(),
  redo: () => this.Blok.API.methods.history.redo(),
  // A plain Event, not InputEvent: paste and Enter are their own undo steps.
  commit: () => this.dom?.title.dispatchEvent(new Event('input')),
});
```

Add the `private unbindKeyboard: (() => void) | null = null;` field. Call `this.unbindKeyboard?.()` in `destroy()`.

New `PageTitle` methods:

```ts
private caretToFirstBlock(x: number | null): void {
  const { API, BlockManager } = this.Blok;

  API.methods.caret.setToFirstBlock('start');
  const first = BlockManager.getBlockByIndex(0);

  if (first !== undefined && x !== null) {
    this.Blok.Caret.setToBlockAtXPosition(first, x, true);
  }
}

public focusAtX(x: number | null): void {
  const title = this.dom?.title;

  if (title === undefined) { return; }
  title.focus();
  if (x === null) { this.focus('end'); return; }
  setCaretAtXPosition(title, x, false);
}

/** Written before focus moves, so the undo step's caret-before stays in the block. */
public appendAndFocus(text: string): void {
  const title = this.dom?.title;

  if (title === undefined) { return; }
  const join = (title.textContent ?? '').length;

  title.append(text);
  title.normalize();
  title.dispatchEvent(new Event('input'));
  title.focus();
  window.getSelection()?.setPosition(title.firstChild ?? title, title.firstChild === null ? 0 : join);
}
```

`setCaretAtXPosition` comes from `../../utils/caret`.

Core hooks:

`caret.ts` at the final `return false;` of `navigateVerticalPrevious` (`:1046`), and at the "No block before container" exit (`:1031`):

```ts
if (this.Blok.PageTitle?.isEnabled === true && !this.Blok.ReadOnly.isEnabled) {
  this.Blok.PageTitle.focusAtX(caretX);

  return true;
}
return false;
```

Returning `true` makes `handleArrowLeftAndUp` prevent the default (`keyboardNavigation.ts:1466`). Check that this caller calls `preventDefault` on `true`. If it doesn't, call `event.preventDefault()` there under the same condition.

`keyboardNavigation.ts:889-894`:

```ts
/** Backspace at the start of the first Block: into the page title when there is one. */
if (previousBlock === null) {
  this.joinIntoTitle(currentBlock);

  return;
}
```

```ts
private joinIntoTitle(block: Block): void {
  const { PageTitle, BlockManager } = this.Blok;

  if (PageTitle?.isEnabled !== true) {
    return;
  }
  const inputs = block.holder.querySelectorAll('[contenteditable="true"]:not([data-blok-mutation-free])');
  const movable = !BlockManager.hasChildren(block) && inputs.length === 1;

  if (!movable) {
    PageTitle.focus('end');

    return;
  }
  PageTitle.appendAndFocus(block.currentInput?.textContent ?? '');
  void BlockManager.removeBlock(block);
}
```

Use the real names for `hasChildren`/`removeBlock` that you looked up in Step 2.

The heading-to-paragraph step at `:877-887` runs before this exit. That means a heading as the first block takes one Backspace to become a paragraph and a second to join. This matches the playground, which also lets core run first for headings, so it is kept as is.

- [ ] **Step 5: Run to verify they pass**

Run: `yarn test test/unit/components/modules/pageTitle/title-keyboard.test.ts test/unit/components/modules/blockEvents/composers/keyboardNavigation.titleJoin.test.ts test/unit/components/modules/blockEvents test/unit/components/modules/caret.test.ts`
Expected: PASS. The last two prove that with no title nothing changed.

- [ ] **Step 6: Commit**

```bash
git add src/components/modules/pageTitle src/components/modules/caret.ts src/components/modules/blockEvents/composers/keyboardNavigation.ts test/unit/components/modules/pageTitle/title-keyboard.test.ts test/unit/components/modules/blockEvents/composers/keyboardNavigation.titleJoin.test.ts
git diff --cached --name-only
git commit -m "feat(title): Enter, arrows and Backspace move between title and first block"
git pull --rebase && git push
```

---

### Task 8: Page icon

**Files:**
- Create: `src/components/modules/pageTitle/icon-control.ts`
- Modify: `src/components/modules/pageTitle/index.ts` (replace the Task 6 stubs; wire the control; icon page-change branch)
- Test: `test/unit/components/modules/pageTitle/icon-control.test.ts` (create)

**Interfaces:**
- Consumes: `EmojiPicker` (`src/tools/callout/emoji-picker/index.ts:163`; `open(anchor)`, `close()`, `isOpen()`, `getElement()`), `loadEmojiGrid()` (`src/components/utils/emoji/emoji-data.ts:29`), `IconEmojiSmile`.
- Produces:

```ts
export interface IconControlHost {
  getIcon(): PageIcon | null;
  setIcon(icon: PageIcon | null): void;
  isReadOnly(): boolean;
  labels(): { add: string; change: string };
  picker(): { i18n: { t(key: string): string }; locale: string };
}
export const createIconControl: (row: HTMLElement, host: IconControlHost) => { redraw(): void; destroy(): void };
```

`PageTitle.getIcon(): PageIcon | null`; `PageTitle.setIcon(icon: PageIcon | null, source: 'user' | 'api'): void` (an undo step, fires `onIconChange`).

- [ ] **Step 1: Write the failing tests**

Mock the picker module, which is a dependency, not the unit under test:

```ts
const open = vi.fn(async () => undefined);
const close = vi.fn();
let lastOptions: { onSelect(native: string): void; onRemove(): void } | null = null;

vi.mock('../../../../../src/tools/callout/emoji-picker', () => ({
  EmojiPicker: class {
    private readonly el = document.createElement('div');
    constructor(options: { onSelect(native: string): void; onRemove(): void }) { lastOptions = options; }
    public getElement(): HTMLElement { return this.el; }
    public isOpen(): boolean { return false; }
    public open = open;
    public close = close;
  },
}));
vi.mock('../../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiGrid: vi.fn(async () => [{ native: '🚀' }]),
}));
```

Cases:

```ts
it('no icon: shows Add icon; click sets a random emoji and opens the picker', async () => {
  const { row, host } = setup(null);

  const add = row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageAddIcon}]`);

  expect(add?.textContent).toContain('Add icon');
  add?.click();
  await vi.waitFor(() => expect(host.setIcon).toHaveBeenCalledWith({ type: 'emoji', value: '🚀' }));
  expect(open).toHaveBeenCalled();
});

it('icon set: shows the emoji; click opens the picker without changing it', () => {
  const { row, host } = setup({ type: 'emoji', value: '🌿' });
  const button = row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`);

  expect(button?.textContent).toBe('🌿');
  expect(button?.getAttribute('aria-label')).toBe('Change icon');
  button?.click();

  expect(open).toHaveBeenCalled();
  expect(host.setIcon).not.toHaveBeenCalled();
});

it('picker select and remove write the icon', () => {
  const { row, host } = setup({ type: 'emoji', value: '🌿' });

  row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.click();
  lastOptions?.onSelect('🔥');
  lastOptions?.onRemove();

  expect(host.setIcon).toHaveBeenNthCalledWith(1, { type: 'emoji', value: '🔥' });
  expect(host.setIcon).toHaveBeenNthCalledWith(2, null);
});

it('read-only: icon not clickable, Add icon absent', () => {
  const { row } = setup({ type: 'emoji', value: '🌿' }, { readOnly: true });

  expect(row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.disabled).toBe(true);

  const empty = setup(null, { readOnly: true });

  expect(empty.row.querySelector(`[${DATA_ATTR.pageAddIcon}]`)).toBeNull();
});

it('an image icon renders as an img', () => {
  const { row } = setup({ type: 'image', url: 'https://example.com/a.png' });

  expect(row.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
});
```

`setup(icon, { readOnly })` builds a row `div`, a host whose `getIcon` returns `icon` and `setIcon` is a `vi.fn()` that also updates `icon` and calls `redraw()`, and returns `{ row, host }`.

Also add to `page-title.test.ts`:

```ts
it('an icon change is undoable and fires onIconChange', async () => {
  const onIconChange = vi.fn();
  const core = await boot({ title: { onIconChange } });

  core.moduleInstances.PageTitle.setIcon({ type: 'emoji', value: '🚀' }, 'user');
  core.moduleInstances.YjsManager.stopCapturing();
  core.moduleInstances.YjsManager.undo();

  expect(core.moduleInstances.PageTitle.getIcon()).toBeNull();
  expect(onIconChange).toHaveBeenNthCalledWith(1, { type: 'emoji', value: '🚀' }, { source: 'user' });
  expect(onIconChange).toHaveBeenNthCalledWith(2, null, { source: 'undo' });
});

it('icon: false draws no icon row content', async () => {
  await boot({ title: { icon: false } });
  expect(holder.querySelector(`[${DATA_ATTR.pageAddIcon}]`)).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test test/unit/components/modules/pageTitle/icon-control.test.ts test/unit/components/modules/pageTitle/page-title.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `icon-control.ts`**

```ts
import { EmojiPicker } from '../../../tools/callout/emoji-picker';
import { IconEmojiSmile } from '../../icons';
import { DATA_ATTR } from '../../constants/data-attributes';
import { loadEmojiGrid } from '../../utils/emoji/emoji-data';
import type { PageIcon } from '../../../../types/tools/page';

export interface IconControlHost {
  getIcon(): PageIcon | null;
  setIcon(icon: PageIcon | null): void;
  isReadOnly(): boolean;
  labels(): { add: string; change: string };
  picker(): { i18n: { t(key: string): string }; locale: string };
}

const randomEmoji = async (): Promise<string> => {
  const emojis = await loadEmojiGrid();
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];

  if (emoji === undefined) {
    throw new Error('No emojis to pick from');
  }

  return emoji.native;
};

export const createIconControl = (row: HTMLElement, host: IconControlHost): { redraw(): void; destroy(): void } => {
  const slot: { picker: EmojiPicker | null; locale: string | null; watch: MutationObserver | null } = { picker: null, locale: null, watch: null };

  const openPicker = (anchor: HTMLElement): void => {
    const { i18n, locale } = host.picker();

    if (slot.picker === null || slot.locale !== locale) {
      slot.picker?.getElement().remove();
      slot.picker = new EmojiPicker({
        onSelect: (native) => host.setIcon({ type: 'emoji', value: native }),
        onRemove: () => host.setIcon(null),
        i18n, locale, curated: false, startInset: 0,
      });
      slot.locale = locale;
    }
    const element = slot.picker.getElement();

    if (!element.isConnected) {
      document.body.append(element);
    }
    // The picker has no close callback; it hides its root on close.
    slot.watch?.disconnect();
    slot.watch = new MutationObserver(() => {
      if (element.hidden) {
        anchor.setAttribute('aria-expanded', 'false');
        slot.watch?.disconnect();
      }
    });
    anchor.setAttribute('aria-expanded', 'true');
    slot.watch.observe(element, { attributes: true, attributeFilter: ['hidden'] });
    void slot.picker.open(anchor);
  };

  const redraw = (): void => {
    const icon = host.getIcon();
    const readOnly = host.isReadOnly();
    const { add, change } = host.labels();

    row.replaceChildren();
    row.toggleAttribute('data-has-icon', icon !== null);
    if (icon === null) {
      if (readOnly) {
        return;
      }
      const button = document.createElement('button');

      button.type = 'button';
      button.setAttribute(DATA_ATTR.pageAddIcon, '');
      button.setAttribute('data-blok-testid', 'page-header-add-icon');
      // A trusted constant from the icon module; the label goes in as text.
      button.innerHTML = IconEmojiSmile;
      const label = document.createElement('span');

      label.textContent = add;
      button.append(label);
      button.addEventListener('click', () => {
        void randomEmoji().then((native) => {
          host.setIcon({ type: 'emoji', value: native });
          const shown = row.querySelector<HTMLElement>(`[${DATA_ATTR.pageIcon}]`);

          openPicker(shown ?? button);
        }, () => openPicker(button));
      });
      row.append(button);
      // Loaded now so the click's random pick resolves at once.
      void loadEmojiGrid().catch(() => undefined);

      return;
    }
    const button = document.createElement('button');

    button.type = 'button';
    button.disabled = readOnly;
    button.setAttribute(DATA_ATTR.pageIcon, '');
    button.setAttribute('data-blok-testid', 'page-header-icon');
    button.setAttribute('aria-label', change);
    if (icon.type === 'emoji') {
      button.textContent = icon.value;
    } else {
      const img = document.createElement('img');

      img.src = icon.url;
      img.alt = '';
      button.append(img);
    }
    button.addEventListener('click', () => openPicker(button));
    row.append(button);
  };

  redraw();

  return {
    redraw,
    destroy: (): void => {
      slot.watch?.disconnect();
      slot.picker?.close();
      slot.picker?.getElement().remove();
      row.replaceChildren();
    },
  };
};
```

In `PageTitle`, replace the Task 6 stubs:

```ts
private iconControl: { redraw(): void; destroy(): void } | null = null;

public getIcon(): PageIcon | null {
  return this.Blok.YjsManager.getPageFields().icon ?? null;
}

public setIcon(icon: PageIcon | null, source: 'user' | 'api'): void {
  this.Blok.YjsManager.setPageField('icon', icon);
  this.iconControl?.redraw();
  this.resolved?.onIconChange?.(this.getIcon(), { source });
}
```

In `prepare()`, when `this.resolved.icon`:

```ts
this.iconControl = createIconControl(this.dom.iconRow, {
  getIcon: () => this.getIcon(),
  setIcon: (icon) => this.setIcon(icon, 'user'),
  isReadOnly: () => this.readOnly,
  labels: () => ({ add: this.Blok.I18n.t('title.addIcon'), change: this.Blok.I18n.t('title.changeIcon') }),
  picker: () => ({ i18n: this.Blok.API.methods.i18n, locale: this.Blok.I18n.getLocale() }),
});
```

Check `I18n.getLocale()`'s real name in `src/components/modules/i18n.ts`. The callout gets its locale somewhere near `src/tools/callout/index.ts:564`; copy that.

Make these changes too:
- `onPageChange`: `if (key === 'icon') { this.iconControl?.redraw(); this.resolved?.onIconChange?.(this.getIcon(), { source }); }`.
- `toggleReadOnly`: add `this.iconControl?.redraw();`.
- `refresh`: add `this.iconControl?.redraw();`, so a loaded icon shows.
- `relabel`: add `this.iconControl?.redraw();`.
- `destroy`: add `this.iconControl?.destroy();`.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn test test/unit/components/modules/pageTitle/ test/unit/architecture/no-inline-svg.test.ts`
Expected: PASS. If `no-inline-svg` lives elsewhere, find it with `ls test/unit/architecture | grep -i svg`.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/pageTitle test/unit/components/modules/pageTitle
git diff --cached --name-only
git commit -m "feat(title): page icon with Add icon, picker, remove and undo"
git pull --rebase && git push
```

---

### Task 9: Styles

**Files:**
- Create: `src/styles/page-title.css`
- Modify: `src/styles/main.css` (add `@import './page-title.css';` after `@import './bookmark.css';` at `:725`)
- Modify: `test/unit/styles/css-split-equivalence.test.ts` (byte budget changelog + multiplier), snapshots under `test/unit/styles/`
- Test: `test/unit/styles/page-title-css.test.ts` (create)

**Interfaces:**
- Produces: CSS custom property `--blok-content-column` on `[data-blok-page-header]` (`720px` default, `none` in full). Host sections use `max-width: var(--blok-content-column); margin-inline: auto`. It is declared so `css-vars-extraction` R3 passes.

- [ ] **Step 1: Write the failing test**

Vitest CSS imports return `''`, so read the file from disk, as the other style tests do:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/page-title.css', 'utf8');

describe('page title css', () => {
  it('uses the editor content column and drops it in full width', () => {
    expect(css).toMatch(/\[data-blok-page-header\]\s*\{[^}]*--blok-content-column:\s*var\(--blok-content-max-width,\s*var\(--max-width-content\)\)/);
    expect(css).toMatch(/\[data-blok-page-header\]\[data-blok-width="full"\]\s*\{[^}]*--blok-content-column:\s*var\(--blok-content-max-width,\s*none\)/);
  });

  it('never clamps or truncates the title', () => {
    expect(css).not.toMatch(/line-clamp|text-overflow|-webkit-box/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('steps sizes with container queries, never fluid units', () => {
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container/);
    expect(css).not.toMatch(/\d(cqw|cqi|vw)\b/);
  });

  it('paints the open picker state neutral, not blue', () => {
    expect(css).toMatch(/\[aria-expanded="true"\][^{]*\{[^}]*var\(--blok-item-hover-bg\)/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/styles/page-title-css.test.ts`
Expected: FAIL with ENOENT.

- [ ] **Step 3: Implement `src/styles/page-title.css`**

Values come from the playground (`src/playground/playground.css:119-180`). Colors come from Blok tokens:

```css
/* Page title header. Lives inside the editor wrapper or in a host element;
   the column math mirrors max-w-blok-content so both left edges line up. */
[data-blok-page-header] {
  --blok-content-column: var(--blok-content-max-width, var(--max-width-content));
  --blok-page-title-size: 40px;
  --blok-page-icon-box: 92px;
  --blok-page-icon-glyph: 78px;
  container-type: inline-size;
  box-sizing: border-box;
  max-width: var(--blok-content-column);
  margin-inline: auto;
  padding-inline: var(--blok-block-padding-inline, 2px);
}
[data-blok-page-header][data-blok-width="full"] {
  --blok-content-column: var(--blok-content-max-width, none);
}

[data-blok-page-icon-row] { display: flex; align-items: flex-end; min-height: 28px; margin-bottom: 4px; }
[data-blok-page-icon-row][data-has-icon] { min-height: 0; margin-bottom: 8px; }

[data-blok-page-icon] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--blok-page-icon-box);
  height: var(--blok-page-icon-box);
  margin-inline-start: -7px;
  padding: 0;
  border: 0;
  border-radius: var(--blok-radius-control-lg);
  background: transparent;
  font-size: var(--blok-page-icon-glyph);
  line-height: 1;
  cursor: pointer;
  transition: background-color 120ms ease;
}
[data-blok-page-icon] img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
[data-blok-page-icon]:disabled { color: inherit; cursor: default; }
[data-blok-page-icon]:hover:not(:disabled),
[data-blok-page-icon][aria-expanded="true"] { background: var(--blok-item-hover-bg); }

[data-blok-page-add-icon] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-inline-start: -6px;
  padding: 4px 8px 4px 6px;
  border: 0;
  border-radius: var(--blok-radius-control);
  background: transparent;
  color: var(--blok-text-secondary);
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 160ms ease, background-color 120ms ease, color 120ms ease;
}
[data-blok-page-add-icon] svg { width: 16px; height: 16px; }
[data-blok-page-header]:hover [data-blok-page-add-icon],
[data-blok-page-add-icon]:focus-visible { opacity: 1; }
/* Ring only after keyboard use: the same :where the focus-visible variant in main.css expands to. */
[data-blok-page-icon]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *),
[data-blok-page-add-icon]:focus-visible:where(:root:not([data-blok-modality="pointer"]) *) {
  outline: 2px solid var(--blok-focus-ring);
  outline-offset: 1px;
}
[data-blok-page-add-icon]:hover { background: var(--blok-item-hover-bg); color: var(--blok-text-primary); }
@media (hover: none) { [data-blok-page-add-icon] { opacity: 1; } }

[data-blok-page-title] {
  margin: 0;
  padding: 3px 0;
  color: var(--blok-text-primary);
  font-size: var(--blok-page-title-size);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  outline: none;
  cursor: text;
  caret-color: currentColor;
}
[data-blok-page-title]:empty::before {
  content: attr(data-placeholder);
  color: var(--color-block-placeholder);
  pointer-events: none;
}

/* Fixed tiers, not fluid units. The header is the container; a container
   query never matches the container itself, so tiers set the sizes on the
   children that use them. */
@container (max-width: 480px) {
  [data-blok-page-title] { --blok-page-title-size: 32px; }
  [data-blok-page-icon] { --blok-page-icon-box: 72px; --blok-page-icon-glyph: 60px; }
}
@container (max-width: 360px) {
  [data-blok-page-title] { --blok-page-title-size: 28px; }
  [data-blok-page-icon] { --blok-page-icon-box: 60px; --blok-page-icon-glyph: 50px; }
}
```

The E2E tier test in Task 11 measures these sizes. Showing "Add icon" on keyboard focus is not a ring, so it stays on plain `:focus-visible`.

Repeated length literals (`css-vars-extraction` R2) will flag `-7px`/`-6px`, `16px` and others if they repeat. Run the test and replace any flagged repeat with a declared custom property on `[data-blok-page-header]`.

- [ ] **Step 4: Update style gates**

1. Add the import to `main.css`.
2. Run: `yarn test test/unit/styles/`
3. Expected failures: the byte budget and the snapshots.
   - In `css-split-equivalence.test.ts`, add a changelog line, e.g. "page title header (page-title.css, +N bytes)". Raise the multiplier only by what this file needs. Measure the number from the failure output; never swallow a peer's bytes (see memory `css-quality-gates`).
   - Regenerate the snapshots: `yarn test test/unit/styles/ -u`.
4. Run `yarn test test/unit/architecture/radius-law.test.ts test/unit/styles/selected-state-neutral.test.ts`.

- [ ] **Step 5: Run to verify**

Run: `yarn test test/unit/styles/ test/unit/architecture/radius-law.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/page-title.css src/styles/main.css test/unit/styles
git diff --cached --name-only
git commit -m "feat(title): header styles follow the content column and step down on narrow widths"
git pull --rebase && git push
```

---

### Task 10: Hint and law sweeps

**Files:**
- Test only, unless a law fails.

- [ ] **Step 1: Run the architecture laws that scan new code**

Run: `yarn test test/unit/architecture/`
Expected: PASS. The likely reds and their fixes:
- `hint-delay-law`: no hint was added. If one is added later, use `onHover` from `src/components/utils/tooltip.ts`.
- `scoped-utility-body-mount-law`: the emoji picker is mounted on `document.body`. If this law flags `icon-control.ts`, copy the callout's exemption entry with the same reason (the picker is a top-layer surface).
- `multi-editor-document-listener-law`: no document listener was added. All listeners are on the title element.

- [ ] **Step 2: Run the lint on changed files**

Run: `npx eslint src/components/modules/pageTitle src/components/modules/yjs/page-fields.ts src/components/utils/title-config.ts src/components/modules/yjs/index.ts src/components/modules/yjs/document-store.ts src/components/modules/saver.ts src/components/core.ts src/components/modules/api/blocks.ts src/components/modules/ui.ts src/blok.ts src/components/modules/caret.ts src/components/modules/blockEvents/composers/keyboardNavigation.ts`
Expected: no errors. Fix any in the owning file.

- [ ] **Step 3: Type check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`
Expected: no errors (local tsc needs the 8GB heap).

- [ ] **Step 4: Commit fixes, if any**

```bash
git add <fixed files>
git diff --cached --name-only
git commit -m "fix(title): satisfy architecture laws"
git pull --rebase && git push
```

---

### Task 11: End-to-end behaviour

**Files:**
- Create: `test/playwright/tests/page-title.spec.ts`

Copy the boot pattern from `test/playwright/tests/read-only-hide-controls.spec.ts`: `ensureBlokBundleBuilt`, `gotoTestPage`, and a local `createBlok(page, config)` that resets `#blok` and runs `new window.Blok(config)`. Tools go in as `className` dot paths.

- [ ] **Step 1: Write the specs**

```ts
test.describe('page title', () => {
  test.beforeAll(() => { ensureBlokBundleBuilt(); });
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  const title = (page: Page): Locator => page.getByRole('textbox', { name: 'Page title' });
  const firstBlockText = (page: Page): Locator => page.getByTestId('block-wrapper').first().locator('[contenteditable="true"]');

  test('title in an outside holder, keyboard moves across the gap', async ({ page }) => {
    await page.evaluate(() => {
      const holder = document.createElement('div');
      const strip = document.createElement('div');

      holder.id = 'title-slot';
      strip.textContent = 'Created · Updated';
      strip.style.height = '80px';
      document.getElementById('blok')?.before(holder, strip);
    });
    await createBlok(page, { title: { holder: '#title-slot' }, data: { title: 'Plans', blocks: [{ type: 'paragraph', data: { text: 'Body' } }] } });

    await title(page).click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await expect(firstBlockText(page)).toBeFocused();

    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(title(page)).toBeFocused();
  });

  test('Enter splits; Backspace joins back; both undo', async ({ page }) => {
    await createBlok(page, { title: true, data: { title: 'Hello world', blocks: [] } });
    await title(page).click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i += 1) { await page.keyboard.press('ArrowLeft'); }
    await page.keyboard.press('Enter');

    await expect(title(page)).toHaveText('Hello');
    await expect(firstBlockText(page)).toHaveText(' world');

    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await expect(title(page)).toHaveText('Hello world');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(title(page)).toHaveText('Hello');
  });

  test('narrow and wide: the title lines up with the first block text', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createBlok(page, { title: true, data: { title: 'Plans', blocks: [{ type: 'paragraph', data: { text: 'Body' } }] } });

    const left = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.x ?? Number.NaN;

    expect(Math.abs(await left(title(page)) - await left(firstBlockText(page)))).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.blokInstance?.width.set('full'));
    expect(Math.abs(await left(title(page)) - await left(firstBlockText(page)))).toBeLessThanOrEqual(1);
  });

  test('narrow container steps the title font size down', async ({ page }) => {
    await createBlok(page, { title: true, data: { title: 'Plans', blocks: [] } });
    const size = (): Promise<string> => title(page).evaluate((el) => getComputedStyle(el).fontSize);

    expect(await size()).toBe('40px');
    await page.setViewportSize({ width: 420, height: 800 });
    expect(await size()).toBe('32px');
    await page.setViewportSize({ width: 340, height: 800 });
    expect(await size()).toBe('28px');
  });

  test('a long title wraps past two lines with no clamp', async ({ page }) => {
    await createBlok(page, { title: true, data: { title: 'Маркетинговая поддержка на 14 февраля '.repeat(6), blocks: [] } });
    const lines = await title(page).evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));

    expect(lines).toBeGreaterThan(2);
  });

  test('Add icon sets an emoji and opens the picker; icon change undoes', async ({ page }) => {
    await createBlok(page, { title: true, data: { blocks: [] } });
    await page.getByTestId('page-header').hover();
    await page.getByTestId('page-header-add-icon').click();

    await expect(page.getByTestId('page-header-icon')).toBeVisible();
    await expect(page.getByTestId('page-header-icon')).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await title(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('page-header-add-icon')).toBeAttached();
  });

  test('read-only: no editing, no Add icon', async ({ page }) => {
    await createBlok(page, { title: true, readOnly: true, data: { title: 'Plans', blocks: [] } });

    await expect(title(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByTestId('page-header-add-icon')).toHaveCount(0);
  });

  test('click on the icon shows no focus ring', async ({ page }) => {
    await createBlok(page, { title: true, data: { icon: { type: 'emoji', value: '🌿' }, blocks: [] } });
    await page.getByTestId('page-header-icon').click();
    await page.keyboard.press('Escape');

    const outline = await page.getByTestId('page-header-icon').evaluate((el) => getComputedStyle(el).outlineStyle);

    expect(outline).toBe('none');
  });
});
```

Use the block testid the existing specs use. Check `grep -rn "getByTestId('block" test/playwright/tests/*.spec.ts | head -3` and replace `'block-wrapper'` with it.

Don't assert the random emoji with `\p{Extended_Pictographic}`: flag emoji fail it (memory `history-track-host-values`).

Leave a 60ms gap between identical key presses that must be separate undo steps: `await page.waitForTimeout(60)` (Blok drops a second identical key within 50ms).

- [ ] **Step 2: Run**

Run: `yarn e2e test/playwright/tests/page-title.spec.ts`
Expected: PASS on the default project. If a test fails, treat it as a real defect in the owning task's code. Fix it there with a unit test first if the cause is in a unit-testable file.

- [ ] **Step 3: Commit**

```bash
git add test/playwright/tests/page-title.spec.ts
git diff --cached --name-only
git commit -m "test(title): end-to-end placement, keyboard, width, icon, read-only"
git pull --rebase && git push
```

---

### Task 12: Final gate and hand-off

- [ ] **Step 1: Related test sweep (user rule: no full `yarn test`)**

Run: `yarn test test/unit/components/modules/pageTitle test/unit/components/modules/yjs test/unit/components/modules/saver.test.ts test/unit/components/modules/api test/unit/components/modules/blockEvents test/unit/components/modules/caret.test.ts test/unit/components/modules/tabSync test/unit/architecture test/unit/styles`
Expected: PASS.

- [ ] **Step 2: Referencing tests**

Run: `grep -rln "undoScope\|SettingChangedPayload\|getPageFields\|setWidthMode\|setDirection" test/ | sort -u`
Run every file listed that Step 1 did not cover.

- [ ] **Step 3: E2E neighbours**

Run: `yarn e2e test/playwright/tests/page-title.spec.ts test/playwright/tests/api/history-track.spec.ts`
Expected: PASS. `history-track` shares the undo path.

- [ ] **Step 4: Verify in a browser**

Invoke the `verify` skill with a fixture page whose title is in an outside holder with a strip between it and the editor. Toggle width, switch to dark theme, and set the locale to `ar`. Screenshot each state and check the alignment and colors by eye.

- [ ] **Step 5: Push state**

Run: `git pull --rebase && git push && git status -sb`
Expected: `## main...origin/main` with nothing ahead.

- [ ] **Step 6: Release-note facts for the user**

Report these. None of them is BREAKING:
- New opt-in `title` config and `blok.title` API.
- `OutputData` gains optional `title` and `icon`. Older Blok versions drop them on their next save.
- `setting:changed` is now a typed public event.
- Collab persistence of the title needs plan 2 (server converters). Until it lands, a collaborative document's title syncs live but is not stored by the server.
