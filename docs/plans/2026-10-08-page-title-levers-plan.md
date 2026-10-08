# Page title core levers (plan 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three core gaps that plans 2–4 need: the published schema accepts a title, a host can write the title without an undo step, and a title whose holder left the page is not "enabled".

**Architecture:** Small changes to the shipped `PageTitle` module, `YjsManager.setPageField`, the instance `title` API in `src/blok.ts`, and `blokDocumentSchema`. No new modules.

**Overview and decisions:** `2026-10-08-page-title-followups-overview.md` (D6, D7).

**Order:** Do this plan first. Plan 2 needs Task 1. Plan 3 needs Task 3. Plan 4 needs Tasks 2 and 3.

## Global Constraints

- Same as the core plan (`2026-10-08-page-title-core-plan.md`, "Global Constraints"), in particular:
  - unit-test hygiene: `vi.clearAllMocks()` / `vi.restoreAllMocks()`; no `any`, `@ts-ignore` or `!`;
  - scoped test runs;
  - one commit per task;
  - never `git commit -a`.
- `types/api/title.d.ts` is not in `v1.16.1` (`git log v1.16.1 -- types/api/title.d.ts` is empty). So changing it is ordinary work, not BREAKING.
- `src/view/document-schema.ts` is published (in v1.16.1), so adding properties to it is additive.
- **Peer-session hazard.** At planning time another session had uncommitted changes in `src/view/document-schema.ts`. Before Task 1:
  - run `git status --short src/view/document-schema.ts`;
  - if it is dirty with changes that are not yours, do not stage it; wait until the peer commits, or apply your change on top and stage only your hunks with `git add -p`.

## Review Focus

1. **Schema with a title** (Task 1). `blokDocumentSchema` must accept `{ title: 'x', icon: { type: 'emoji', value: '🚀' }, blocks: [] }` and still reject unknown top-level keys.
2. **`record: false` in collab** (Task 2). The write must still reach peers. Only the local undo stack skips it. `transactWithoutCapture` already behaves this way for `setValue` (`yjs/index.ts:942-946`); test it for `setPageField` too.
3. **Detached header** (Task 3). After the app removes the holder, Backspace at the start of the first block behaves as if there were no title. Nothing moves into the title.

## File Structure

| File | Change |
|---|---|
| `src/view/document-schema.ts` | `title` and `icon` properties |
| `test/unit/view/document-schema.test.ts` | save→validate with a title |
| `src/components/modules/yjs/index.ts` | `setPageField(..., { record })` |
| `src/components/modules/pageTitle/index.ts` | `setText`/`setIcon` take `record`; `isEnabled` checks `isConnected`; `mount(null)` |
| `src/blok.ts` | `title.set(text, options)`, `title.icon.set(icon, options)`, `title.mount(null)` |
| `types/api/title.d.ts` | `TitleSetOptions`, `TitleChange.record`, `mount(holder \| null)` |
| `test/unit/components/modules/pageTitle/page-title-api.test.ts` | Task 2 and Task 3 API tests |
| `test/unit/components/modules/pageTitle/page-title.test.ts` | detached-header keyboard tests |
| `docs/` | none here. Plan 4 Task 11 documents the API. |

---

### Task 1: The published schema accepts `title` and `icon`

**Files:** `src/view/document-schema.ts`, `test/unit/view/document-schema.test.ts`, and the byte-pinned schema test added by 185e8e80 (find it with `git show --stat 185e8e80`).

- [ ] **Step 1: Failing test.** In `document-schema.test.ts`, save a real editor document after `blok.title.set('Plan')` and `blok.title.icon.set({ type: 'emoji', value: '🚀' })`, then validate it against `blokDocumentSchema` with the validator the file already uses. Expect valid. Add a case with `icon: { type: 'image', url: 'https://x/y.png' }` as well. Also add a case `{ blocks: [], extra: 1 }` that stays invalid.
- [ ] **Step 2: Run** `yarn test test/unit/view/document-schema.test.ts`. Expect FAIL (`additionalProperties`).
- [ ] **Step 3: Implement.** Add to `properties`:
  - `title`: `{ type: 'string', minLength: 1, description: 'The page title. Absent when empty.' }`;
  - `icon`: `{ oneOf: [ { type: 'object', required: ['type','value'], properties: { type: { const: 'emoji' }, value: { type: 'string' } } }, { type: 'object', required: ['type','url'], properties: { type: { const: 'image' }, url: { type: 'string' } } } ] }`.
  
  Read `readPageFields` (`src/components/modules/yjs/page-fields.ts:11-33`) first. It lets extra keys through, so do not add `additionalProperties: false` to the icon shapes.
- [ ] **Step 4: Run** the test again and expect PASS. Then update the pinned schema bytes the way 185e8e80 did, and run that test.
- [ ] **Step 5: Run** `yarn test test/unit/server-runtime` (the runtime serves the schema at `server-runtime.ts:467`) and `test/unit/view/blocks-to-plain-text.test.ts`. `blocks-to-plain-text.ts:68` reads `$defs` keys, so it must still pass.
- [ ] **Step 6: Commit** `fix(schema): accept the page title and icon in saved documents`.

### Task 2: Write the title or icon without an undo step

Decision D7: `record: false` fires `onChange` with source `'api'` and `record: false`.

**Files:** `src/components/modules/yjs/index.ts:965` (`setPageField`), `src/components/modules/pageTitle/index.ts:116-135` (`setText`, `setIcon`, `writeField`), `src/blok.ts:454-489`, `types/api/title.d.ts`, `test/unit/components/modules/pageTitle/page-title-api.test.ts`.

- [ ] **Step 1: Failing tests** in `page-title-api.test.ts`:
  - after `blok.title.set('Seed', { record: false })`, `blok.history.undo()` leaves the title `'Seed'` (the doc had no earlier step);
  - after `set('A')` then `set('B', { record: false })`, one undo gives `''`;
  - the same two cases for `blok.title.icon.set(icon, { record: false })`;
  - `onChange` gets `('Seed', { source: 'api', record: false })`, and a plain `set` gets `{ source: 'api' }` with no `record` key;
  - before ready: `set('Seed', { record: false })` is buffered and replayed without an undo step. Check the buffer at `blok.ts:458-461` and its replay at `:618-633`.
- [ ] **Step 2: Run** `yarn test test/unit/components/modules/pageTitle/page-title-api.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `setPageField(key, value, { typing?, record? })`: with `record === false`, wrap the write in `this.transactWithoutCapture(...)` and skip `beginValueEdit`. This mirrors `setValue` (`yjs/index.ts:942-946`).
  - Thread `record` through `writeField`/`setText`/`setIcon`, and add `record: false` to the change object only when it is false.
  - Store the options in `titleBuffer`.
  - Types: `export interface TitleSetOptions { /** False: no undo step. Peers still get it. */ record?: boolean }`; `set(text: string, options?: TitleSetOptions)`; `icon.set(icon, options?)`; `TitleChange { source: ...; record?: false }`.
- [ ] **Step 4: Run** the test again (PASS), then `test/unit/components/modules/pageTitle/` and `test/unit/components/modules/yjs/`.
- [ ] **Step 5: Collab test.** Two `DocumentStore`s joined with the existing sync helper (find the pattern in `test/unit/components/modules/yjs/*collab*` or `*remote*`). A `record: false` title on A reaches B.
- [ ] **Step 6: Commit** `feat(page-title): set the title or icon without an undo step`.

### Task 3: A title whose holder left the page is not enabled; `mount(null)` brings it back

Decision D6. This fixes overview Defect 3, which was found by reading code. Step 1 reproduces it before any fix.

**Files:** `src/components/modules/pageTitle/index.ts:44-46, 190-199, 255-268`, `src/blok.ts:465-476`, `types/api/title.d.ts`, `test/unit/components/modules/pageTitle/page-title.test.ts`, `title-keyboard.test.ts`.

- [ ] **Step 1: Failing tests** (real editor, jsdom):
  - Build with `pageTitle: { holder }`. Write blocks `['Body']` and the title `'T'`. Then run `holder.remove()`. Put the caret at offset 0 of the first block and dispatch Backspace through the block's keydown path, the way the existing Backspace-join test does (find it with `grep -n "Backspace" test/unit/components/modules/pageTitle/*.ts`). Expect: the title is still `'T'` and the first block still exists.
  - Same setup with ArrowUp on the first line of the first block: the selection does not move into the title element.
  - `blok.title.mount(null)` after `holder.remove()`: the header is back in the wrapper before the redactor, and the Backspace join works again.
  - `mount(null)` before ready is buffered.
- [ ] **Step 2: Run.** Expect the Backspace and ArrowUp cases to FAIL. That proves the defect. If they pass, stop and record that the defect is not real; leave `isEnabled` as it is, and keep only the `mount(null)` part.
- [ ] **Step 3: Implement.**
  - `isEnabled`: `this.dom !== null && this.dom.header.isConnected`.
  - `mount(holder: HTMLElement | string | null)`: `null` calls `placeInitially(header, null)`, which inserts the header before the redactor.
  - Update `src/blok.ts` and `types/api/title.d.ts` (`mount(holder: HTMLElement | string | null): void`, documented as "null: back above the first block").
- [ ] **Step 4: Run** `yarn test test/unit/components/modules/pageTitle/`. Then grep the other `isEnabled` users (`grep -rn "PageTitle.*isEnabled\|isEnabled" src/components/modules/keyboardNavigation.ts src/components/modules/caret.ts src/components/modules/find`) and run their tests.
- [ ] **Step 5: Commit** `fix(page-title): a title outside the page takes no keyboard joins; mount(null) restores it`.

### Task 4: Final gate

- [ ] `yarn lint` on changed files only. Then `yarn test` on every test file that imports a changed module (`grep -rln` the changed symbols across `test/`; see the run-only-related-tests rule).
- [ ] `git pull --ff-only`, `git push`, `git status` clean against origin.
- [ ] Hand-off: none of this is BREAKING (see Global Constraints). The release-note line is in the overview.
