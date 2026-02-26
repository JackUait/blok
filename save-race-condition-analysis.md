# Save Race Condition — Deep Analysis

## Problem Statement

Article content is sometimes permanently lost after a user saves an article. This document traces the root causes through both the **knowledgebase** consumer code and the **@jackuait/blok** editor internals, evaluates existing safeguards, and proposes fixes at both layers.

---

## Architecture: How Save Works

```
User clicks Save
       │
       ▼
handleSaveDraftClick()                    [ArticleHeaderEditorMode.tsx]
       │
       ▼
await flushEditorContent()                [editorStore.ts — Zustand]
       │
       ├── saveFn exists? ──yes──► saveFn() ──► editorInstance.current?.saver?.save()
       │                                                    │
       │                                                    ▼
       │                                          Blok Saver.save()
       │                                          reads BlockManager.blocks
       │                                          calls block.save() on each
       │                                          sanitizes, validates, returns OutputData
       │
       └── saveFn null? ──► return currentContent (last auto-saved snapshot)
       │
       ▼
buildArticleData(freshContent)            [ArticleHeaderEditorMode.tsx]
       │
       │   content = freshContent ?? body ?? editorContent
       │                    │          │           │
       │                    │          │           └── Zustand store (closure-captured)
       │                    │          └── react-hook-form getValues()
       │                    └── from flushContent result
       │
       │   Falls back to articleDataRef.current if all null
       │
       ▼
PATCH /api/content/{id}                   [update.ts → ContentController]
       │
       ▼
ContentService.Update()                   [ContentService.cs]
       │
       ├── IsEmptyBlokDocument(contentJson)?
       │   └── yes + existing non-empty ──► BadRequestException (blocked)
       │
       └── article.Update(contentJson)    [Article.cs]
            └── SetContentIfNotNull()
```

---

## Frontend: 5-Layer Defense Chain

The save flow has multiple fallback layers that prevent null/empty content from reaching the API:

| Layer | Location | What it does | Cleared by editor cleanup? |
|-------|----------|--------------|---------------------------|
| 1. `canSave` button guard | `ArticleHeaderEditorMode.tsx` render | Disables Save when `blocks.length === 0` | N/A (reactive) |
| 2. `freshContent` from `flushContent()` | `editorStore.ts` | Calls `saver.save()` for a fresh DOM snapshot | No (Promise in-flight) |
| 3. `body` from react-hook-form | `buildArticleData()` via `getValues()` | Last value set by `onChange → setValue()` | **No** — cleanup never calls `setValue(Body, null)` |
| 4. `editorContent` from Zustand | `buildArticleData()` closure | Snapshot from last React render | **No** — closure is frozen |
| 5. `articleDataRef.current` | `buildArticleData()` backstop | Last successfully-built article data | **Never cleared** |

### Why the frontend fallback chain is robust

- **Editor cleanup** (`Editor.tsx` lines 246–261) sets `editorInstance.current = null` and `setCurrentContent(null)`, but it **never** calls `setValue(ArticleFormFields.Body, null)`. The react-hook-form field retains the last good content.
- After `await flushEditorContent()` resolves, `buildArticleData()` executes **synchronously** with no yield points — React cannot interleave a render, so closure-captured `editorContent` remains valid.
- The `isMountedRef.current` guard on `onChange` prevents new fire-and-forget saves after cleanup starts (though already-in-flight ones can still complete).

---

## Race Scenarios Traced

### Scenario A: Save before editor is ready

| Step | Value |
|------|-------|
| `saveFn` | `null` (registration effect hasn't fired — depends on `isEditorReady`) |
| `flushContent()` returns | `currentContent` = `null` |
| `buildArticleData(null)` | `content = null ?? body ?? editorContent` → **`body`** (original article content from form `reset()`) |
| **API receives** | Original article JSON (last saved version) |
| **Data loss?** | **None** |

### Scenario B: Save during `blocks.render()` mid-flight

| Step | Value |
|------|-------|
| `saveFn` | Registered (editor is ready) |
| `saver.save()` | Reads `BlockManager.blocks` — but `blocks.render()` called `clear()` first |
| Between `clear()` and `insertMany()` | Blocks array is **empty** |
| `saver.save()` returns | `{blocks: []}` |
| **API receives** | `'{"blocks":[]}'` |
| **Backend guard catches?** | **Yes** — `IsEmptyBlokDocument` returns `true` → `BadRequestException` |
| **Data loss?** | **Prevented by backend guard** |

This is the **primary mechanism** that produces empty content during normal editor lifecycle.

### Scenario C: Concurrent onChange + Save button click

| Step | Value |
|------|-------|
| `saver.save()` (from Save) | Fresh DOM snapshot at call time |
| `saver.save()` (from onChange) | Also reads the same DOM — no interference (read-only serialization) |
| **API receives** | Latest DOM state |
| **Data loss?** | **None** — `saver.save()` always gets a fresh snapshot |

### Scenario D: Editor unmount during save

| Step | Value |
|------|-------|
| Cleanup runs | `editorInstance.current = null`, `setCurrentContent(null)` |
| `saveFn` closure | Reads `editorInstance.current` at call time → `null` → returns `null` |
| `buildArticleData(null)` | `content = null ?? body ?? editorContent` → **`body`** (from react-hook-form, not cleared) |
| **API receives** | Last onChange snapshot |
| **Data loss?** | **Minimal** — at most a few keystrokes since last onChange |

### Scenario D (worst case): In-flight onChange clears form

| Step | Value |
|------|-------|
| onChange IIFE was past `isMountedRef` check | It continues after cleanup |
| `editorInstance.current` is null | `saver.save()` returns `undefined` |
| `setValue(Body, undefined)` | Clears the form field |
| `buildArticleData(null)` | `content = null ?? undefined ?? editorContent` → **`editorContent`** (closure from last render) |
| **API receives** | Pre-cleanup Zustand content |
| **Data loss?** | **None** — closure holds valid data |

---

## Blok Internals Analysis

Source: `@jackuait/blok@0.6.0-beta.14` extracted from Yarn PnP cache.

### The `blocks.render()` lifecycle

```
BlocksAPI.render(data)
    │
    ├── ModificationsObserver.disable()
    │
    ├── await BlockManager.clear()          ◄── blocks array becomes EMPTY
    │       └── Yjs transaction: remove all block IDs
    │       └── DOM cleanup: remove all block elements
    │
    │   ┌─── MICROTASK BOUNDARY ─── saver.save() CAN INTERLEAVE HERE ───┐
    │                                                                     │
    ├── await Renderer.render(data.blocks)                                │
    │       ├── blocks.map(composeBlock)    (synchronous)                 │
    │       ├── BlockManager.insertMany()   (synchronous) ◄── blocks repopulated
    │       └── requestIdleCallback()       (waits for browser idle, 2s timeout)
    │
    └── ModificationsObserver.enable()
```

**The vulnerable window** is between `clear()` completing and `insertMany()` running inside `Renderer.render()`. Any external `saver.save()` call at this point reads an empty `BlockManager.blocks`.

### Saver concurrency

`Saver.save()` has **no mutex, lock, queue, or pending-save tracking**. Each call independently:
1. Reads `BlockManager.blocks`
2. Maps each block to `this.getSavedData(block)` (calls `block.save()` which reads DOM)
3. `Promise.all(chainData)` — all blocks save in parallel
4. Sanitizes and calls `makeOutput()`

Multiple concurrent calls run fully in parallel. The `lastSaveError` field is shared and can be cleared by a later call while an earlier one is in-flight.

### Destruction behavior

After `destroy()`:
- All module instances have `.destroy()` called
- All event listeners removed
- **All properties deleted from the Blok instance**
- `Object.setPrototypeOf(this, null)` — instance becomes a bare object

If external code calls `saver.save()` after destruction:
- `this.Blok.BlockManager` throws (property doesn't exist)
- Internal `Saver.save()` catches → returns `undefined`
- `SaverAPI.save()` converts to thrown error → **unhandled promise rejection** in consumer

### Empty document handling

Two-layer approach already works correctly:

1. **Fast path** (`Saver.save()`): `blocks.length === 1 && blocks[0].isEmpty && blocks[0].tool.isDefault` → returns `{blocks: []}`
2. **Validation layer** (`Paragraph.validate()`): `savedData.text.trim() === ''` with `preserveBlank: false` → block marked invalid → `makeOutput()` skips it

Multiple empty paragraphs are filtered by layer 2 → output is `{blocks: []}`. No changes needed.

---

## Fixes: Three Issues in Blok

### Fix 1: Save-during-render guard (HIGH priority)

**Problem**: `saver.save()` can read empty `BlockManager.blocks` during `blocks.render()` lifecycle.

**Solution**: Add a `pendingRender` promise to the Renderer. `BlocksAPI.render()` and `renderFromHTML()` set it **before** `clear()` and release it in `finally`. `Saver.save()` awaits `pendingRender` before proceeding.

| File | Change |
|------|--------|
| `src/components/modules/renderer.ts` | Add `renderingPromise` field + `pendingRender` getter |
| `src/components/modules/api/blocks.ts` | Wrap `render()` / `renderFromHTML()` with the lock |
| `src/components/modules/saver.ts` | Guard: `if (Renderer.pendingRender) await Renderer.pendingRender` |

No deadlock risk — `requestIdleCallback` has a 2000ms timeout; `BlockManager.clear()` is bounded.

### Fix 2: Concurrent `saver.save()` deduplication (MEDIUM priority)

**Problem**: Multiple fire-and-forget `saver.save()` calls (from `onChange` + Save button) overlap, wasting work and racing on `lastSaveError`.

**Solution**: Promise deduplication in `Saver.save()`:

```typescript
private pendingSave: Promise<OutputData | undefined> | null = null;

public async save(): Promise<OutputData | undefined> {
    if (this.pendingSave) return this.pendingSave;
    this.pendingSave = this.doSave();
    try { return await this.pendingSave; }
    finally { this.pendingSave = null; }
}

private async doSave(): Promise<OutputData | undefined> {
    // ... existing save() body
}
```

Queuing was considered and rejected — it doubles latency and `onChange` already triggers fresh saves for new keystrokes.

### Fix 3: Destruction guard (MEDIUM priority)

**Problem**: `saver.save()` on a destroyed editor throws unhandled errors.

**Solution**:
- Add `isDestroyed` flag to `Module` base class
- Mark all modules before `destroy()` runs
- `Saver.save()` checks `isDestroyed` before start and after `Promise.all`
- New `EditorDestroyedError` class for typed catch

**Consumer change** (Editor.tsx): wrap `saver.save()` calls in try/catch, ignore `EditorDestroyedError`.

### Fix 4: Empty-paragraph detection — NO changes needed

The existing two-layer approach (fast path + Paragraph.validate) already collapses all-empty-paragraph documents to `{blocks: []}`. The `&nbsp;`-only edge case is arguably correct (intentional non-breaking space).

---

## Backend Guard Assessment

The `IsEmptyBlokDocument` guard in `ContentService.cs` catches `{blocks: []}` and structurally invalid JSON. It is **defense-in-depth** — it does not fix the Blok race condition itself, but it prevents the most dangerous outcome (empty content overwriting real content).

| What it catches | What it doesn't catch |
|-----------------|----------------------|
| `{blocks: []}` — empty blocks array | Partial content (some blocks missing from mid-render save) |
| `null`, whitespace, non-object JSON | Stale content from fallback layers |
| Missing `blocks` key, non-array `blocks` | Single empty paragraph `{blocks: [{type:"paragraph",data:{text:""}}]}` |
| Unparseable JSON | — |

The single-empty-paragraph gap is not exploitable in practice because Blok's internal Saver collapses it to `{blocks: []}` via the fast path, and `Paragraph.validate()` filters it in the validation layer. The backend guard catches the result.

---

## Summary

| Issue | Severity | Root cause location | Fix location | Status |
|-------|----------|---------------------|--------------|--------|
| Empty content during `blocks.render()` | **HIGH** | Blok `BlocksAPI.render()` | Blok: render lock in Saver | Needs Blok release |
| Concurrent `saver.save()` overlap | MEDIUM | Blok `Saver.save()` | Blok: promise deduplication | Needs Blok release |
| Unhandled rejection on destroyed editor | MEDIUM | Blok `destroy()` + `Saver` | Blok: destruction guard + Consumer: try/catch | Needs Blok release + Editor.tsx update |
| `BadRequestException` returns 500 | **Confirmed bug** | Backend error handlers | Backend: filter + middleware | **Fixed** (B1) |
| Empty overwrite guard missing | **Confirmed gap** | Backend `ContentService` | Backend: `IsEmptyBlokDocument` | **Fixed** (R1, defense-in-depth) |
| No content versioning | Design gap | Both | Future: optimistic concurrency | Not addressed |

### What's already fixed (this branch)

- **B1**: `BadRequestException` → 400 in both `ErrorsHandlingFilter` and `ErrorHandlingModule`
- **R1**: `IsEmptyBlokDocument` hardened to treat invalid/corrupt JSON as empty → prevents overwrite

### What needs a Blok release

Fixes #1–#3 above. The backend R1 guard remains valuable as defense-in-depth even after these Blok fixes.
