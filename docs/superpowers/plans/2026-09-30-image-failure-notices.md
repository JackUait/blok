# Image Failure Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toast with Retry/Show when an image fails, a grouped toast on save, a leave banner through `blok.confirmLeave()`, a browser leave dialog for unsaved uploads, and an `onImageFailure` host callback.

**Architecture:** Tools report failures through a new tool API `api.media`. A new core module `MediaFailures` keeps a registry, shows toasts through the existing notifier (extended with `actions`), holds a `beforeunload` listener for upload failures, runs `confirmLeave()` and its banner, and fires `onImageFailure`. The Saver pings it after each real save. Only the image tool is wired.

**Tech Stack:** TypeScript, Vitest (jsdom), Playwright, Tailwind class strings (`twJoin`), Blok's flat-key i18n.

**Spec:** `docs/superpowers/specs/2026-09-29-image-failure-notices-design.md`

## Global Constraints

- Saved data does not change for any failure kind.
- Every file under `types/` is hand-written. No `../src/` imports (`test/unit/architecture/published-types-no-src-refs.test.ts`).
- All surfaces are additive. No `BREAKING` label (approved in the spec).
- Blok i18n has no plural forms. Multi-count strings use the "Label: {count}" shape.
- Never put a URL or any host string into a notifier `message`: `alert()` writes `message` with `innerHTML`.
- A toast with `actions` never auto-dismisses. It closes by "×", Escape, or a replacing toast.
- The notifier shows one toast at a time. A new `show()` replaces the current one. This is how an open failure toast gets "updated".
- Unit test rules (CLAUDE.md): no `any` / `@ts-ignore` / `!`; `vi.clearAllMocks()` in `beforeEach`; `vi.restoreAllMocks()` in `afterEach`.
- E2E: no CSS class selectors. Use roles, text, or `data-blok-testid`.
- While iterating, run only the tests and lint for the files you touched. `yarn lint` / `yarn test` are only for the final task.
- Comments: short. Only record what silently breaks if changed.
- New `data-blok-testid` values are plain strings (not `DATA_ATTR` keys), so `scripts/generate-data-attributes-dts.mjs` is not needed.

## Review Focus

1. **Autosave repeating toasts.** A host with `persistence` autosaves often. A failure must toast once on `save`, not on every save. → Task 4 test "save toast fires once per failure across two saves".
2. **Block deleted while failed.** Deleting a failed image block (or `blocks.clear()`, which does NOT emit `block-removed`) must drop it from the counts, the banner, and the leave dialog. → Task 4 test on `block-removed` + Task 7 test that `removed()` calls `clearFailure`.
3. **Host callback throws.** A throwing `onImageFailure` must not break save or leave. Blok's own UI still shows. → Task 4 and Task 6 tests.
4. **Many failures at once.** A document with 4 dead links must show ONE toast, not four swaps. → Task 4 coalescing test with fake timers.
5. **Double `confirmLeave()`.** A router firing the guard twice must get the same promise and one banner. → Task 6 test.

---

## File map

| File | Responsibility |
|---|---|
| `types/configs/notifier.d.ts` (modify) | `NotifierAction`, `actions?`, `dismissText?` |
| `src/components/utils/notifier/draw.ts` (modify) | Draw action buttons + "×" on `alert` |
| `src/components/utils/notifier/index.ts` (modify) | Sticky lifecycle when `actions` exist |
| `src/components/modules/api/notifier.ts` (modify) | Fill `dismissText` from i18n |
| `types/api/media.d.ts` (new) | `Media` tool API, `MediaFailureReport` |
| `types/api/index.d.ts`, `types/index.d.ts` (modify) | Export + `API.media` + `Blok.confirmLeave` |
| `types/configs/blok-config.d.ts` (modify) | `onImageFailure`, `ImageFailureReport`, `ImageFailure` |
| `src/components/i18n/locales/*.json` (modify) | New `imageFailure.*` keys |
| `types/message-keys.d.ts` (regenerated) | Key union |
| `src/components/modules/mediaFailures.ts` (new) | Registry, toasts, callback, unload guard, `confirmLeave` |
| `src/components/utils/leave-banner.ts` (new) | Banner DOM + keyboard |
| `src/components/modules/api/media.ts` (new) | `api.media` methods → `MediaFailures` |
| `src/components/modules/index.ts`, `src/types-internal/blok-modules.d.ts`, `src/components/modules/api/index.ts` (modify) | Register modules |
| `src/components/modules/saver.ts` (modify) | Call `MediaFailures.onSave()` after a real save |
| `src/blok.ts` (modify) | `confirmLeave` shorthand |
| `src/tools/image/index.ts` (modify) | Report / clear |
| `packages/react/src/config-keys.ts`, `packages/react/src/useBlokHandle.ts`, `packages/vue/src/config-keys.ts`, `packages/vue/src/BlokEditor.ts`, `packages/angular/src/blok-editor.component.ts` (modify) | Adapters |
| `test/playwright/tests/tools/image-failure-notices.spec.ts` (new) | E2E |

---

### Task 1: Notifier action buttons

**Files:**
- Modify: `types/configs/notifier.d.ts`
- Modify: `src/components/utils/notifier/draw.ts` (`alert`, ~line 212)
- Modify: `src/components/utils/notifier/index.ts` (`show` ~258, `appendNotify` ~240, `startToastLifecycle` ~150-234)
- Modify: `src/components/modules/api/notifier.ts` (`show` ~51-82)
- Test: `test/unit/components/utils/notifier-draw.test.ts`, `test/unit/components/utils/notifier-show.test.ts`, `test/unit/components/modules/api/notifier.test.ts`

**Interfaces:**
- Produces: `NotifierAction { label: string; onClick(): void }`, `NotifierOptions.actions?: NotifierAction[]`, `NotifierOptions.dismissText?: string`. Test ids: `notification-action` (each action button), `notification-dismiss` (existing, from `createDismissButton`).

- [ ] **Step 1: Add the types**

In `types/configs/notifier.d.ts`, add above `NotifierOptions`:

```ts
/**
 * A button on an alert toast. A toast with actions stays until closed.
 */
export interface NotifierAction {
  label: string;
  onClick(): void;
}
```

Inside `NotifierOptions` add:

```ts
  /**
   * Buttons on an alert toast. With any, the toast does not expire and shows a close button.
   */
  actions?: NotifierAction[];

  /**
   * Accessible label of the close button shown with `actions`.
   */
  dismissText?: string;
```

- [ ] **Step 2: Write failing draw tests**

Append to `test/unit/components/utils/notifier-draw.test.ts` (reuse its existing imports of `alert`):

```ts
describe('alert with actions', () => {
  it('renders one button per action and runs its handler', () => {
    const onRetry = vi.fn();
    const notify = alert({ message: 'Image failed to load', actions: [ { label: 'Retry', onClick: onRetry }, { label: 'Show', onClick: vi.fn() } ] });
    const buttons = notify.querySelectorAll<HTMLButtonElement>('[data-blok-testid="notification-action"]');

    expect(Array.from(buttons, (b) => b.textContent)).toEqual([ 'Retry', 'Show' ]);
    buttons[0].click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('adds a labelled close button only when actions exist', () => {
    const withActions = alert({ message: 'm', dismissText: 'Close', actions: [ { label: 'Retry', onClick: vi.fn() } ] });
    const plain = alert({ message: 'm' });

    expect(withActions.querySelector('[data-blok-testid="notification-dismiss"]')?.getAttribute('aria-label')).toBe('Close');
    expect(plain.querySelector('[data-blok-testid="notification-dismiss"]')).toBeNull();
  });

  it('sets action text with textContent, not HTML', () => {
    const notify = alert({ message: 'm', actions: [ { label: '<b>x</b>', onClick: vi.fn() } ] });

    expect(notify.querySelector('[data-blok-testid="notification-action"] b')).toBeNull();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `yarn test test/unit/components/utils/notifier-draw.test.ts`
Expected: the 3 new tests fail (no `notification-action` elements).

- [ ] **Step 4: Implement in `alert`**

In `draw.ts`, `alert()`, after `notify.appendChild(messageWrapper);` and before `return notify;`:

```ts
  if (options.actions !== undefined && options.actions.length > 0) {
    const btns = document.createElement('div');

    btns.className = CSS.btnsWrapper;
    options.actions.forEach((action) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = twJoin(CSS.btn, CSS.okBtn);
      button.setAttribute('data-blok-testid', 'notification-action');
      button.textContent = action.label;
      button.addEventListener('click', () => action.onClick());
      btns.appendChild(button);
    });
    messageWrapper.appendChild(btns);
    // Dispatches the same Escape the dismissal layer listens for, so the "×" and Escape share one close path.
    notify.appendChild(createDismissButton(() => notify.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), options.dismissText ?? 'Close'));
  }
```

Check `twJoin` is imported in `draw.ts` (it is used by `CSS`). **Before keeping the Escape-dispatch line**, read `startToastLifecycle` in `index.ts` (~150-234) and `registerLayer`. If the layer's Escape listens on `document` rather than bubbling from the element, replace the dispatch with the lifecycle's own `dismiss`: export a `WeakMap<HTMLElement, () => void>` named `toastDismissers` from `draw.ts` (next to `toastCleanups`). Set it in `startToastLifecycle`, and call `toastDismissers.get(notify)?.()` from the "×" handler. Pick whichever the code supports. Step 7's test proves it either way.

- [ ] **Step 5: Run draw tests, expect PASS**

Run: `yarn test test/unit/components/utils/notifier-draw.test.ts`

- [ ] **Step 6: Write failing show tests**

Append to `test/unit/components/utils/notifier-show.test.ts` (it already uses fake timers and imports `show`). If the file mocks `./draw`, put these tests in a new file `test/unit/components/utils/notifier-show-actions.test.ts` that does NOT mock draw, copying that file's `beforeEach`/`afterEach` (fake timers, DOM reset):

```ts
it('keeps a toast with actions past the default time', () => {
  show({ message: 'failed', actions: [ { label: 'Retry', onClick: () => undefined } ] });
  vi.advanceTimersByTime(60_000);

  expect(document.querySelector('[data-blok-testid^="notification"]')?.className).not.toContain('animate-notify-slide-out');
});

it('closes a toast with actions from its close button', () => {
  show({ message: 'failed', actions: [ { label: 'Retry', onClick: () => undefined } ] });
  document.querySelector<HTMLButtonElement>('[data-blok-testid="notification-dismiss"]')?.click();

  expect(document.querySelector('[data-blok-testid^="notification"]')?.getAttribute('data-state')).toBe('closed');
});
```

Keep the existing test at ~line 180 ("does not render an in-pill dismiss button"). It covers the no-actions toast and must stay green.

- [ ] **Step 7: Run, expect FAIL** (the first test fails: the toast expires at 8 s)

Run: `yarn test test/unit/components/utils/notifier-show.test.ts` (or the new file)

- [ ] **Step 8: Make the lifecycle sticky**

In `index.ts`:
- `show()`: `const sticky = options.actions !== undefined && options.actions.length > 0;`. Pass `sticky` into every `appendNotify(...)` call as a new last argument.
- `appendNotify(wrapper, notify, position, time, autoDismiss, sticky)`: pass `sticky` to `startToastLifecycle(wrapper, notify, position, time, sticky)`.
- `startToastLifecycle`: when `sticky` is true, do NOT create the pausable timer, and skip any hover/focus pause/resume that touches it. Keep everything else: open state, top layer, `registerLayer` for Escape, `toastCleanups` registration. Do NOT pass `Infinity` as `time`: `setTimeout` treats values above 2^31-1 ms as ~1 ms and the toast would vanish at once.

- [ ] **Step 9: Run notifier tests, expect PASS**

Run: `yarn test test/unit/components/utils/notifier-show.test.ts test/unit/components/utils/notifier-draw.test.ts` (run each file separately if multi-path skips files, per memory "gates that lie").

- [ ] **Step 10: `dismissText` from i18n — failing test**

In `test/unit/components/modules/api/notifier.test.ts`, following its pattern (`new NotifierAPI(makeConfig(undefined))`, `api.state = { I18n: { t } } as unknown as BlokModules`), spy on the built-in notifier's `show` the same way the file already does for confirm labels, and add:

```ts
it('fills the close label for toasts with actions', () => {
  api.methods.show({ message: 'm', actions: [ { label: 'Retry', onClick: vi.fn() } ] });

  expect(builtInShow).toHaveBeenCalledWith(expect.objectContaining({ dismissText: 'notifier.dismiss' }), expect.anything());
});
```

(`t` in the existing test returns the key; adjust `'notifier.dismiss'` to whatever the file's `t` returns.)

- [ ] **Step 11: Run, expect FAIL. Implement.** In `NotifierAPI.show`, in the built-in branch, next to the confirm/prompt label filling:

```ts
    if (options.actions !== undefined && options.dismissText === undefined) {
      options = { ...options, dismissText: this.Blok.I18n.t('notifier.dismiss') };
    }
```

(Adapt to how `show` already builds its options object; do not mutate the caller's object.)

- [ ] **Step 12: Run the three notifier test files + `notifier.mutants.test.ts` + `test/unit/components/modules/api/notifier.mutants.test.ts`, expect PASS.** Lint changed files: `yarn eslint types/configs/notifier.d.ts src/components/utils/notifier/draw.ts src/components/utils/notifier/index.ts src/components/modules/api/notifier.ts`.

- [ ] **Step 13: Commit**

```bash
git add types/configs/notifier.d.ts src/components/utils/notifier/draw.ts src/components/utils/notifier/index.ts src/components/modules/api/notifier.ts test/unit/components/utils/notifier-*.test.ts test/unit/components/modules/api/notifier.test.ts
git commit -m "feat(notifier): action buttons on alert toasts"
```

---

### Task 2: Public types for `api.media`, `onImageFailure`, `confirmLeave`

**Files:**
- Create: `types/api/media.d.ts`
- Modify: `types/api/index.d.ts` (export), `types/index.d.ts` (`API` interface ~219-253, `Blok` class ~540-646), `types/configs/blok-config.d.ts` (next to `onError` ~1029)
- Test: `test/unit/architecture/published-types-no-src-refs.test.ts`, `test/unit/architecture/blok-class-api-parity-law.test.ts` (existing), plus a type test below

**Interfaces:**
- Produces (exact names later tasks use):

```ts
// types/api/media.d.ts
export type MediaFailureKind = 'upload' | 'load';

export interface MediaFailureInput {
  blockId: string;
  tool: string;
  kind: MediaFailureKind;
  url?: string;
  retry(): void;
}

export interface Media {
  reportFailure(failure: MediaFailureInput): void;
  clearFailure(blockId: string): void;
  confirmLeave(): Promise<boolean>;
}
```

```ts
// types/configs/blok-config.d.ts
export interface ImageFailure {
  blockId: string;
  tool: string;
  kind: 'upload' | 'load';
  url?: string;
  retry(): void;
  scrollTo(): void;
}
export interface ImageFailureReport {
  reason: 'fail' | 'save' | 'leave';
  failures: ImageFailure[];
}
// in BlokConfig:
onImageFailure?(report: ImageFailureReport): boolean | void;
```

```ts
// types/index.d.ts, Blok class
public confirmLeave(): Promise<boolean>;
```

- [ ] **Step 1: Failing type test.** Create `test/unit/types/image-failure-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { API, BlokConfig, ImageFailureReport } from '../../../types';

describe('image failure public types', () => {
  it('exposes api.media and onImageFailure', () => {
    expectTypeOf<API['media']['reportFailure']>().parameter(0).toHaveProperty('kind').toEqualTypeOf<'upload' | 'load'>();
    expectTypeOf<API['media']['confirmLeave']>().returns.toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<NonNullable<BlokConfig['onImageFailure']>>().parameter(0).toEqualTypeOf<ImageFailureReport>();
  });
});
```

Check how other unit tests import from `types/` (grep `from '../../../types'` in `test/unit`) and match the path style.

- [ ] **Step 2: Run, expect FAIL** — `yarn test test/unit/types/image-failure-types.test.ts` (with typecheck if the project's vitest runs `expectTypeOf` via tsc. If it doesn't typecheck, also run `yarn tsc --noEmit -p tsconfig.json`. Memory: tsc needs an 8 GB heap: `NODE_OPTIONS=--max-old-space-size=8192`).

- [ ] **Step 3: Write the types** exactly as in Interfaces, each member with a one-line JSDoc matching neighbours. Export `ImageFailure`, `ImageFailureReport` from wherever `BlokConfig` is re-exported in `types/index.d.ts` (follow how `BlokErrorContext` is exported). Add `export * from './media';` (or the file's named-export style) in `types/api/index.d.ts`. Add `media: Media;` to `API` next to `notifier`. Add `confirmLeave()` to the `Blok` class next to `save()`.

- [ ] **Step 4: Run** the new type test, `published-types-no-src-refs.test.ts`, and `blok-class-api-parity-law.test.ts`. Expect PASS. (The parity law will fail until Task 5 exposes `media` at runtime only if it checks runtime. Read its failure: if it needs the runtime, leave it for Task 5 and note it in the commit.)

- [ ] **Step 5: Commit** — `git commit -m "feat(types): api.media, onImageFailure, confirmLeave"` (add only the files above).

---

### Task 3: Strings in every locale

**Files:** `src/components/i18n/locales/*.json` (69 files), `types/message-keys.d.ts` (regenerated)

**Interfaces:**
- Produces keys used by Tasks 4 and 6 (English values):

| Key | en |
|---|---|
| `imageFailure.uploadFailed` | `Image failed to upload` |
| `imageFailure.loadFailed` | `Image failed to load` |
| `imageFailure.failedMany` | `Images failed: {count}` |
| `imageFailure.notSaved` | `Won't be saved: {count}` |
| `imageFailure.notDisplayed` | `Won't display: {count}` |
| `imageFailure.bannerTitle` | `Some images have problems` |
| `imageFailure.retry` | `Retry` |
| `imageFailure.show` | `Show` |
| `imageFailure.stay` | `Stay` |
| `imageFailure.leaveAnyway` | `Leave anyway` |

- [ ] **Step 1:** Run `yarn test test/unit/components/i18n/untranslated-strings.test.ts` to confirm green before changes.
- [ ] **Step 2:** Add the keys to `en.json` next to the `notifier.*` keys. Run the same test. Expected: FAIL on missing keys in other locales. This is the failing test for this task.
- [ ] **Step 3:** Invoke the `blok-translations` skill and translate all 10 keys into every locale. Keep `{count}` verbatim.
- [ ] **Step 4:** `node scripts/generate-message-keys-dts.mjs`.
- [ ] **Step 5:** Run `untranslated-strings.test.ts`, `duplicate-keys.test.ts`, `locale-file-layout.test.ts`, `published-types-no-src-refs.test.ts`, and `yarn i18n:check`. Expect PASS.
- [ ] **Step 6:** Commit `feat(i18n): image failure notice strings in every locale`.

---

### Task 4: `MediaFailures` core module — registry, fail/save toasts, callback, unload guard

**Files:**
- Create: `src/components/modules/mediaFailures.ts`
- Create: `src/components/modules/api/media.ts`
- Modify: `src/components/modules/index.ts` (add both, `MediaFailures` before `Saver` so it is destroyed earlier; `MediaAPI` next to `NotifierAPI`)
- Modify: `src/types-internal/blok-modules.d.ts`
- Modify: `src/components/modules/api/index.ts` (`media: this.Blok.MediaAPI.methods`)
- Test: `test/unit/components/modules/mediaFailures.test.ts`

**Interfaces:**
- Consumes: `NotifierAction` (Task 1); `MediaFailureInput`, `ImageFailure`, `ImageFailureReport` (Task 2); `imageFailure.*` keys (Task 3); `this.Blok.NotifierAPI.show(options)`, `this.Blok.BlocksAPI.scrollToBlock(id)`, `this.Blok.ReadOnly.isEnabled`, `this.Blok.I18n.t(key, vars)`; bus event `BlockChanged` with `payload.event.type === BlockRemovedMutationType` and `payload.event.detail.target.id`.
- Produces: `MediaFailures.report(input: MediaFailureInput): void`, `MediaFailures.clear(blockId: string): void`, `MediaFailures.onSave(): void`, `MediaFailures.confirmLeave(): Promise<boolean>` (Task 6 fills it), `MediaFailures.list(): ImageFailure[]`. Constant `COALESCE_MS = 300`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/components/modules/mediaFailures.test.ts`. Build the module like `test/unit/components/modules/api/notifier.test.ts` builds `NotifierAPI`: construct with `{ config, eventsDispatcher }` and set `.state` to a stub `BlokModules`. Use the real `EventsDispatcher` (grep its import in `saver.test.ts`) so `BlockChanged` can be emitted.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaFailures } from '../../../../src/components/modules/mediaFailures';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { BlockChanged } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { NotifierOptions } from '../../../../types/configs/notifier';

const setup = (config: Partial<BlokConfig> = {}, readOnly = false) => {
  const eventsDispatcher = new EventsDispatcher();
  const show = vi.fn<(o: NotifierOptions) => void>();
  const scrollToBlock = vi.fn<(id: string) => void>();
  const module = new MediaFailures({ config: config as BlokConfig, eventsDispatcher });

  module.state = {
    NotifierAPI: { show },
    BlocksAPI: { scrollToBlock },
    ReadOnly: { isEnabled: readOnly },
    I18n: { t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${String(vars.count)}` : key) },
  } as unknown as BlokModules;

  return { module, eventsDispatcher, show, scrollToBlock };
};

const input = (blockId: string, kind: 'upload' | 'load' = 'load', retry = vi.fn()) => ({ blockId, tool: 'image', kind, url: `https://x.test/${blockId}.png`, retry });

describe('MediaFailures', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('groups failures that arrive together into one toast', () => {
    const { module, show } = setup();

    module.report(input('a'));
    module.report(input('b'));
    module.report(input('c'));
    vi.advanceTimersByTime(300);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].message).toBe('imageFailure.failedMany:3');
  });

  it('names the kind for a single failure', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    vi.advanceTimersByTime(300);

    expect(show.mock.calls[0][0].message).toBe('imageFailure.uploadFailed');
  });

  it('Retry retries every failure and Show scrolls to the first', () => {
    const { module, show, scrollToBlock } = setup();
    const retryA = vi.fn();
    const retryB = vi.fn();

    module.report(input('a', 'load', retryA));
    module.report(input('b', 'load', retryB));
    vi.advanceTimersByTime(300);
    const [ retry, showBtn ] = show.mock.calls[0][0].actions ?? [];

    retry.onClick();
    showBtn.onClick();

    expect(retryA).toHaveBeenCalledTimes(1);
    expect(retryB).toHaveBeenCalledTimes(1);
    expect(scrollToBlock).toHaveBeenCalledWith('a');
  });

  it('does not toast a failure cleared before the window ends', () => {
    const { module, show } = setup();

    module.report(input('a'));
    module.clear('a');
    vi.advanceTimersByTime(300);

    expect(show).not.toHaveBeenCalled();
  });

  it('drops a failure when its block is removed', () => {
    const { module, eventsDispatcher } = setup();

    module.report(input('a'));
    eventsDispatcher.emit(BlockChanged, { event: new CustomEvent('block-removed', { detail: { target: { id: 'a' }, index: 0 } }) } as never);

    expect(module.list()).toEqual([]);
  });

  it('save toast fires once per failure across two saves', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    module.report(input('b', 'load'));
    vi.advanceTimersByTime(300);
    show.mockClear();
    module.onSave();
    module.onSave();

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].message).toBe('imageFailure.notSaved:1 · imageFailure.notDisplayed:1');
  });

  it('reports on save again after the failure recovers and fails again', () => {
    const { module, show } = setup();

    module.report(input('a', 'upload'));
    module.onSave();
    module.clear('a');
    module.report(input('a', 'upload'));
    show.mockClear();
    module.onSave();

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('skips the save toast in read-only mode', () => {
    const { module, show } = setup({}, true);

    module.report(input('a'));
    vi.advanceTimersByTime(300);
    show.mockClear();
    module.onSave();

    expect(show).not.toHaveBeenCalled();
  });

  it('lets onImageFailure take over when it returns false', () => {
    const onImageFailure = vi.fn(() => false);
    const { module, show } = setup({ onImageFailure });

    module.report(input('a'));
    vi.advanceTimersByTime(300);

    expect(onImageFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'fail', failures: [ expect.objectContaining({ blockId: 'a', kind: 'load' }) ] }));
    expect(show).not.toHaveBeenCalled();
  });

  it('still shows its toast when onImageFailure throws', () => {
    const { module, show } = setup({ onImageFailure: () => { throw new Error('host bug'); } });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    module.report(input('a'));
    vi.advanceTimersByTime(300);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('holds beforeunload only while upload failures exist', () => {
    const { module } = setup();
    const unload = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };

    module.report(input('l', 'load'));
    expect(unload()).toBe(false);
    module.report(input('u', 'upload'));
    expect(unload()).toBe(true);
    module.clear('u');
    expect(unload()).toBe(false);
  });

  it('never holds beforeunload in read-only mode', () => {
    const { module } = setup({}, true);
    const e = new Event('beforeunload', { cancelable: true });

    module.report(input('u', 'upload'));
    window.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });

  it('releases the unload listener on destroy', () => {
    const { module } = setup();
    const e = new Event('beforeunload', { cancelable: true });

    module.report(input('u', 'upload'));
    module.destroy();
    window.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(false);
  });
});
```

Adjust import paths/names to the real ones: `EventsDispatcher` location, `BlockChanged` export, and how a `block-removed` `BlockMutationEvent` is built (grep `BlockRemovedMutationType` in `test/unit` for an existing builder and use it instead of the `CustomEvent` above if one exists).

- [ ] **Step 2: Run, expect FAIL** (module not found): `yarn test test/unit/components/modules/mediaFailures.test.ts`

- [ ] **Step 3: Implement `src/components/modules/mediaFailures.ts`**

```ts
import Module from '../__module';
import type { ModuleConfig } from '../../types-internal/module-config';
import { BlockChanged } from '../events';
import { BlockRemovedMutationType } from '../../../types/events/block/BlockRemoved';
import { log } from '../utils/logger';
import type { MediaFailureInput } from '../../../types/api/media';
import type { ImageFailure, ImageFailureReport } from '../../../types';

type Reason = ImageFailureReport['reason'];

interface Entry extends MediaFailureInput {
  reported: Set<Reason>;
}

// Long enough to catch images on one page that exhaust their reloads together.
export const COALESCE_MS = 300;

const holdLeave = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
};

export class MediaFailures extends Module {
  private readonly entries = new Map<string, Entry>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private holdingLeave = false;

  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });
    // blocks.clear()/render() skip this event; tools clear through removed() instead.
    this.eventsDispatcher.on(BlockChanged, ({ event }) => {
      if (event.type === BlockRemovedMutationType) {
        this.clear(event.detail.target.id);
      }
    });
  }

  public report(input: MediaFailureInput): void {
    if (this.isDestroyed) {
      return;
    }
    this.entries.set(input.blockId, { ...input, reported: new Set() });
    this.syncLeaveHold();
    this.flushTimer ??= setTimeout(() => this.flushFail(), COALESCE_MS);
  }

  public clear(blockId: string): void {
    if (this.entries.delete(blockId)) {
      this.syncLeaveHold();
    }
  }

  public list(): ImageFailure[] {
    return [ ...this.entries.values() ].map((entry) => this.toPublic(entry));
  }

  public onSave(): void {
    if (this.isDestroyed || this.Blok.ReadOnly.isEnabled || !this.takeUnreported('save')) {
      return;
    }
    const all = [ ...this.entries.values() ];
    const lost = all.filter((e) => e.kind === 'upload').length;
    const broken = all.length - lost;
    const parts = [
      lost > 0 ? this.Blok.I18n.t('imageFailure.notSaved', { count: lost }) : null,
      broken > 0 ? this.Blok.I18n.t('imageFailure.notDisplayed', { count: broken }) : null,
    ].filter((p): p is string => p !== null);

    this.notify('save', parts.join(' · '));
  }

  public async confirmLeave(): Promise<boolean> {
    return true; // Task 6
  }

  public destroy(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.entries.clear();
    this.syncLeaveHold();
  }

  private flushFail(): void {
    this.flushTimer = null;
    if (this.isDestroyed || !this.takeUnreported('fail')) {
      return;
    }
    const all = [ ...this.entries.values() ];
    const message = all.length === 1
      ? this.Blok.I18n.t(all[0].kind === 'upload' ? 'imageFailure.uploadFailed' : 'imageFailure.loadFailed')
      : this.Blok.I18n.t('imageFailure.failedMany', { count: all.length });

    this.notify('fail', message);
  }

  /** Marks every entry reported for `reason`; true when at least one was new. */
  private takeUnreported(reason: Reason): boolean {
    const fresh = [ ...this.entries.values() ].filter((e) => !e.reported.has(reason));

    fresh.forEach((e) => e.reported.add(reason));

    return fresh.length > 0;
  }

  private notify(reason: Reason, message: string): void {
    if (this.askHost(reason) === false) {
      return;
    }
    this.Blok.NotifierAPI.show({
      message,
      style: 'error',
      actions: [
        { label: this.Blok.I18n.t('imageFailure.retry'), onClick: () => this.retryAll() },
        { label: this.Blok.I18n.t('imageFailure.show'), onClick: () => this.showFirst() },
      ],
    });
  }

  /** @returns the host's return value, or undefined when it threw */
  private askHost(reason: Reason): boolean | void {
    const handler = this.config.onImageFailure;

    if (handler === undefined) {
      return undefined;
    }
    try {
      return handler({ reason, failures: this.list() });
    } catch (thrown: unknown) {
      log('`onImageFailure` threw. Blok showed its own notice instead.', 'warn', thrown);

      return undefined;
    }
  }

  private retryAll(): void {
    [ ...this.entries.values() ].forEach((e) => e.retry());
  }

  private showFirst(): void {
    const first = this.entries.keys().next();

    if (first.done !== true) {
      this.Blok.BlocksAPI.scrollToBlock(first.value);
    }
  }

  private toPublic(entry: Entry): ImageFailure {
    return {
      blockId: entry.blockId,
      tool: entry.tool,
      kind: entry.kind,
      url: entry.url,
      retry: () => entry.retry(),
      scrollTo: () => this.Blok.BlocksAPI.scrollToBlock(entry.blockId),
    };
  }

  private syncLeaveHold(): void {
    const should = !this.isDestroyed
      && !this.Blok.ReadOnly?.isEnabled
      && [ ...this.entries.values() ].some((e) => e.kind === 'upload');

    if (should === this.holdingLeave) {
      return;
    }
    this.holdingLeave = should;
    if (should) {
      window.addEventListener('beforeunload', holdLeave);
    } else {
      window.removeEventListener('beforeunload', holdLeave);
    }
  }
}
```

Fix up to real names while implementing (read each and do not guess):
- the `Module` default/named export in `src/components/__module.ts`
- the `ModuleConfig` import path
- `BlockChanged`'s export
- the `log` signature
- the `NotifierAPI` public method: if `NotifierAPI` exposes only `methods.show`, call `this.Blok.NotifierAPI.methods.show(...)`, and change the test stub to `NotifierAPI: { methods: { show } }`.

`destroy()` runs `syncLeaveHold()` with `isDestroyed` already true (teardown marks first; see `blok.ts:62-112`), so it removes the listener. `this.Blok.ReadOnly?.` guards the constructor-time case where `this.Blok` is still `{}`.

Also, when the editor goes from read-only to editable, the hold must re-check. Subscribe to the read-only toggle if the bus emits one. Grep `ReadOnlyToggled` or similar in `src/components/events/index.ts`. If it exists, call `this.syncLeaveHold()` on it. If not, leave it: a failure is only reported in edit mode for uploads anyway.

- [ ] **Step 4: Implement `src/components/modules/api/media.ts`**

```ts
import Module from '../../__module';
import type { Media } from '../../../../types/api/media';

export class MediaAPI extends Module {
  public get methods(): Media {
    return {
      reportFailure: (failure) => this.Blok.MediaFailures.report(failure),
      clearFailure: (blockId) => this.Blok.MediaFailures.clear(blockId),
      confirmLeave: () => this.Blok.MediaFailures.confirmLeave(),
    };
  }
}
```

Register `MediaFailures` and `MediaAPI` in `modules/index.ts` and `blok-modules.d.ts`. Add `media: this.Blok.MediaAPI.methods` to `api/index.ts`.

- [ ] **Step 5: Run the new test file, expect PASS.** Also run `test/unit/architecture/blok-class-api-parity-law.test.ts` (it now sees `media`) and `test/unit/components/modules/api/*.test.ts` that snapshot `API.methods` keys (grep `notifier:` in `test/unit/components/modules/api/index*.test.ts`) and update expected key lists there.

- [ ] **Step 6: Lint changed files, commit** `feat(core): MediaFailures module and api.media`.

---

### Task 5: Saver calls `onSave` after a real save

**Files:**
- Modify: `src/components/modules/saver.ts` (`startSave` ~152-162; `doSave` success ~352)
- Test: `test/unit/components/modules/saver.test.ts` (existing; follow its factory setup)

**Interfaces:**
- Consumes: `MediaFailures.onSave(): void`.

- [ ] **Step 1: Failing test.** In `saver.test.ts`, add `MediaFailures: { onSave }` to the stub modules the file builds, with `const onSave = vi.fn()`, and:

```ts
it('tells MediaFailures once per real save, not per joined caller', async () => {
  const [ first, joined ] = [ saver.save(), saver.save() ];

  await Promise.all([ first, joined ]);

  expect(onSave).toHaveBeenCalledTimes(1);
});

it('does not tell MediaFailures when the save failed', async () => {
  // Make block.save() reject using the file's existing failing-block helper.
  await saver.save();

  expect(onSave).not.toHaveBeenCalled();
});
```

Build the second test from the file's existing save-failure test (grep `SaveFailed` or `onError` in `saver.test.ts`).

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `doSave`, right before `return this.makeOutput(orderGuardedData, dialect);` (after the destroyed check), add:

```ts
      this.Blok.MediaFailures.onSave();
```

This is inside `doSave`, so joined callers (who get `this.pendingSave`) do not call it again. Internal saves also go through `doSave`. Read lines 118-130 to see who calls `doSave` directly. If internal (non-host) saves call it, move the call into `startSave` / `queueSave` on the resolved output instead, so internal saves never toast. Add a test for that internal path if one exists.

- [ ] **Step 4: Run `saver.test.ts` and `saver.*.test.ts`, expect PASS. Commit** `feat(saver): report failed images after each save`.

---

### Task 6: Leave banner and `confirmLeave()`

**Files:**
- Create: `src/components/utils/leave-banner.ts`
- Modify: `src/components/modules/mediaFailures.ts` (`confirmLeave`, `clear` updates the banner)
- Modify: `src/blok.ts` (shorthands ~675: add `media: { confirmLeave: 'confirmLeave' }`)
- Test: `test/unit/components/utils/leave-banner.test.ts`, `test/unit/components/modules/mediaFailures.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LeaveBannerLabels { title: string; retry: string; show: string; stay: string; leave: string }
export interface LeaveBannerHandlers { onRetry(): void; onShow(): void; onStay(): void; onLeave(): void }
export interface LeaveBanner { update(summary: string): void; close(): void }
export const openLeaveBanner: (summary: string, labels: LeaveBannerLabels, handlers: LeaveBannerHandlers) => LeaveBanner;
```

Test ids: `leave-banner`, `leave-banner-summary`, `leave-banner-retry`, `leave-banner-show`, `leave-banner-stay`, `leave-banner-leave`.

- [ ] **Step 1: Failing banner tests** — `test/unit/components/utils/leave-banner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLeaveBanner } from '../../../../src/components/utils/leave-banner';

const labels = { title: 'Some images have problems', retry: 'Retry', show: 'Show', stay: 'Stay', leave: 'Leave anyway' };
const handlers = () => ({ onRetry: vi.fn(), onShow: vi.fn(), onStay: vi.fn(), onLeave: vi.fn() });
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

describe('openLeaveBanner', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('is an alertdialog named by its title with focus on the first button', () => {
    openLeaveBanner("Won't be saved: 2", labels, handlers());
    const banner = byId('leave-banner');

    expect(banner?.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(banner?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(labels.title);
    expect(document.activeElement).toBe(byId('leave-banner-retry'));
  });

  it('runs the matching handler for each button', () => {
    const h = handlers();

    openLeaveBanner('s', labels, h);
    byId('leave-banner-retry')?.click();
    byId('leave-banner-show')?.click();
    byId('leave-banner-stay')?.click();
    byId('leave-banner-leave')?.click();

    expect([ h.onRetry, h.onShow, h.onStay, h.onLeave ].map((f) => f.mock.calls.length)).toEqual([ 1, 1, 1, 1 ]);
  });

  it('treats Escape as Stay', () => {
    const h = handlers();

    openLeaveBanner('s', labels, h);
    byId('leave-banner')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(h.onStay).toHaveBeenCalledTimes(1);
  });

  it('updates the summary and closes', () => {
    const banner = openLeaveBanner('a', labels, handlers());

    banner.update('b');
    expect(byId('leave-banner-summary')?.textContent).toBe('b');
    banner.close();
    expect(byId('leave-banner')).toBeNull();
  });

  it('restores focus to where it was on close', () => {
    const before = document.createElement('button');

    document.body.appendChild(before);
    before.focus();
    openLeaveBanner('s', labels, handlers()).close();

    expect(document.activeElement).toBe(before);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `leave-banner.ts`.** Reuse the toast look from `CSS` in `src/components/utils/notifier/draw.ts` (export nothing new from there; import `CSS`):

```ts
import { twJoin } from '../utils/tw';
import { CSS } from './notifier/draw';

export interface LeaveBannerLabels { title: string; retry: string; show: string; stay: string; leave: string }
export interface LeaveBannerHandlers { onRetry(): void; onShow(): void; onStay(): void; onLeave(): void }
export interface LeaveBanner { update(summary: string): void; close(): void }

const idState = { count: 0 };

export const openLeaveBanner = (summary: string, labels: LeaveBannerLabels, handlers: LeaveBannerHandlers): LeaveBanner => {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const banner = document.createElement('div');
  const title = document.createElement('div');
  const text = document.createElement('div');
  const btns = document.createElement('div');

  idState.count += 1;
  title.id = `blok-leave-banner-title-${idState.count}`;
  banner.className = twJoin(CSS.notification, 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex-col items-start');
  banner.setAttribute('role', 'alertdialog');
  banner.setAttribute('aria-modal', 'false');
  banner.setAttribute('aria-labelledby', title.id);
  banner.setAttribute('aria-describedby', `${title.id}-summary`);
  banner.setAttribute('data-blok-testid', 'leave-banner');
  title.className = 'font-medium';
  title.textContent = labels.title;
  text.id = `${title.id}-summary`;
  text.setAttribute('data-blok-testid', 'leave-banner-summary');
  text.textContent = summary;
  btns.className = CSS.btnsWrapper;

  const button = (label: string, testId: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');

    b.type = 'button';
    b.className = twJoin(CSS.btn, primary ? CSS.okBtn : CSS.cancelBtn);
    b.setAttribute('data-blok-testid', testId);
    b.textContent = label;
    b.addEventListener('click', onClick);
    btns.appendChild(b);

    return b;
  };

  const first = button(labels.retry, 'leave-banner-retry', true, () => handlers.onRetry());

  button(labels.show, 'leave-banner-show', false, () => handlers.onShow());
  button(labels.stay, 'leave-banner-stay', false, () => handlers.onStay());
  button(labels.leave, 'leave-banner-leave', false, () => handlers.onLeave());
  banner.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handlers.onStay();
    }
  });
  banner.append(title, text, btns);
  document.body.appendChild(banner);
  first.focus();

  return {
    update: (next) => { text.textContent = next; },
    close: () => {
      banner.remove();
      previousFocus?.focus();
    },
  };
};
```

Check the real `twJoin` import path used in `draw.ts` and copy it. Check the classes against `test/unit/styles/tailwind-class-emits-law.test.ts` (run it). Every arbitrary class must emit CSS. Check the body-mount law in memory (`scoped-utility-body-mount-law.md`): if a law test forbids scoped utilities on `document.body` mounts, the notifier wrapper is the precedent to copy. Grep how `prepare_` in `notifier/index.ts` mounts and scopes, and do the same.

- [ ] **Step 4: Run banner tests, expect PASS.**

- [ ] **Step 5: Failing `confirmLeave` tests** — append to `mediaFailures.test.ts`:

```ts
describe('confirmLeave', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
  const click = (id: string) => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`)?.click();

  it('resolves true at once with nothing failed', async () => {
    const { module } = setup();

    await expect(module.confirmLeave()).resolves.toBe(true);
    expect(document.querySelector('[data-blok-testid="leave-banner"]')).toBeNull();
  });

  it('resolves true at once in read-only mode', async () => {
    const { module } = setup({}, true);

    module.report(input('a', 'upload'));
    await expect(module.confirmLeave()).resolves.toBe(true);
  });

  it.each([
    [ 'leave-banner-leave', true ],
    [ 'leave-banner-stay', false ],
    [ 'leave-banner-show', false ],
  ])('%s resolves %s and closes the banner', async (id, expected) => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    const answer = module.confirmLeave();

    click(id);
    await expect(answer).resolves.toBe(expected);
    expect(document.querySelector('[data-blok-testid="leave-banner"]')).toBeNull();
  });

  it('Show scrolls to the first failure', async () => {
    const { module, scrollToBlock } = setup();

    module.report(input('a'));
    const answer = module.confirmLeave();

    click('leave-banner-show');
    await answer;
    expect(scrollToBlock).toHaveBeenCalledWith('a');
  });

  it('Retry keeps the banner and resolves true once everything recovers', async () => {
    const { module } = setup();
    const retry = vi.fn(() => module.clear('a'));

    module.report(input('a', 'upload', retry));
    const answer = module.confirmLeave();

    click('leave-banner-retry');
    await expect(answer).resolves.toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('updates the counts as failures clear', () => {
    const { module } = setup();

    module.report(input('a', 'upload'));
    module.report(input('b', 'upload'));
    void module.confirmLeave();
    module.clear('a');

    expect(document.querySelector('[data-blok-testid="leave-banner-summary"]')?.textContent).toBe('imageFailure.notSaved:1');
  });

  it('returns the same promise and one banner when called twice', () => {
    const { module } = setup();

    module.report(input('a'));
    const first = module.confirmLeave();
    const second = module.confirmLeave();

    expect(second).toBe(first);
    expect(document.querySelectorAll('[data-blok-testid="leave-banner"]')).toHaveLength(1);
  });

  it('resolves true without a banner when the host returns false', async () => {
    const onImageFailure = vi.fn(() => false);
    const { module } = setup({ onImageFailure });

    module.report(input('a'));
    await expect(module.confirmLeave()).resolves.toBe(true);
    expect(onImageFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'leave' }));
    expect(document.querySelector('[data-blok-testid="leave-banner"]')).toBeNull();
  });

  it('shows the banner when the host throws', () => {
    const { module } = setup({ onImageFailure: () => { throw new Error('x'); } });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    module.report(input('a'));
    void module.confirmLeave();

    expect(document.querySelector('[data-blok-testid="leave-banner"]')).not.toBeNull();
  });

  it('resolves true and removes the banner on destroy', async () => {
    const { module } = setup();

    module.report(input('a'));
    const answer = module.confirmLeave();

    module.destroy();
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector('[data-blok-testid="leave-banner"]')).toBeNull();
  });
});
```

`confirmLeave` is called synchronously in these tests (no fake timers are needed). The outer `beforeEach` turns fake timers on. That's harmless here.

- [ ] **Step 6: Run, expect FAIL.**

- [ ] **Step 7: Implement in `MediaFailures`.** Add fields and replace the stub:

```ts
  private leave: { promise: Promise<boolean>; settle(answer: boolean): void; banner: LeaveBanner } | null = null;

  public confirmLeave(): Promise<boolean> {
    if (this.leave !== null) {
      return this.leave.promise;
    }
    if (this.isDestroyed || this.Blok.ReadOnly.isEnabled || this.entries.size === 0 || this.askHost('leave') === false) {
      return Promise.resolve(true);
    }
    let resolve: (answer: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    const t = (key: MessageKey): string => this.Blok.I18n.t(key);
    const banner = openLeaveBanner(this.summary(), {
      title: t('imageFailure.bannerTitle'),
      retry: t('imageFailure.retry'),
      show: t('imageFailure.show'),
      stay: t('imageFailure.stay'),
      leave: t('imageFailure.leaveAnyway'),
    }, {
      onRetry: () => this.retryAll(),
      onShow: () => { this.settleLeave(false); this.showFirst(); },
      onStay: () => this.settleLeave(false),
      onLeave: () => this.settleLeave(true),
    });

    this.leave = { promise, settle: resolve, banner };

    return promise;
  }

  private settleLeave(answer: boolean): void {
    const leave = this.leave;

    if (leave === null) {
      return;
    }
    this.leave = null;
    leave.banner.close();
    leave.settle(answer);
  }

  /** "Won't be saved: n · Won't display: m" with zero parts left out. */
  private summary(): string {
    const all = [ ...this.entries.values() ];
    const lost = all.filter((e) => e.kind === 'upload').length;
    const broken = all.length - lost;

    return [
      lost > 0 ? this.Blok.I18n.t('imageFailure.notSaved', { count: lost }) : null,
      broken > 0 ? this.Blok.I18n.t('imageFailure.notDisplayed', { count: broken }) : null,
    ].filter((p): p is string => p !== null).join(' · ');
  }
```

- Use `summary()` in `onSave` too (replace the inline copy from Task 4).
- In `clear()`, after a successful delete, run: `if (this.leave !== null) { this.entries.size === 0 ? this.settleLeave(true) : this.leave.banner.update(this.summary()); }`.
- In `destroy()`, call `this.settleLeave(true)` first.
- Import `openLeaveBanner`, `LeaveBanner` and the `MessageKey` type. Use the name `types/message-keys.d.ts` exports.
- `confirmLeave` no longer needs `async`.

- [ ] **Step 8: Run `mediaFailures.test.ts` + `leave-banner.test.ts`, expect PASS.**

- [ ] **Step 9: Blok shorthand — failing test.** Add to the existing Blok class unit test that covers shorthands (grep `save: 'save'` or `blok.save` in `test/unit/blok*.test.ts`):

```ts
it('exposes confirmLeave on the instance', () => {
  expect(blok.confirmLeave).toBe(apiMethods.media.confirmLeave);
});
```

Match the variable names that file uses for the instance and the API methods stub. Add `media: { confirmLeave: vi.fn() }` to its API stub.

- [ ] **Step 10: Run, expect FAIL. Add `media: { confirmLeave: 'confirmLeave' }` to the `shorthands` object in `src/blok.ts`. Run, expect PASS.** Also run `blok-class-api-parity-law.test.ts`.

- [ ] **Step 11: Lint, commit** `feat(core): confirmLeave banner for failed images`.

---

### Task 7: Image tool reports and clears

**Files:**
- Modify: `src/tools/image/index.ts` — `applyError` (~561), `applyBrokenImage` (~585), `retryBrokenImage` (~640), `renderRendered` load handler (~987), `removed()` (~843), `destroy()` (~853), the replace path
- Test: `test/unit/tools/image/index.test.ts`

**Interfaces:**
- Consumes: `api.media.reportFailure(MediaFailureInput)`, `api.media.clearFailure(blockId)`.

- [ ] **Step 1: Extend the mock API.** In `index.test.ts`, `createMockApi`, add:

```ts
  media: { reportFailure: vi.fn(), clearFailure: vi.fn() },
```

Keep a handle to it so tests can read calls: change `createOptions` to accept an `api` or return the one it made (follow the file's style).

- [ ] **Step 2: Failing tests.** Next to the existing broken-image tests (~1268-1330) and upload-error tests, reusing how those tests drive `img` errors and uploader rejections:

```ts
describe('failure reporting', () => {
  it('reports a load failure after reloads run out', () => {
    // Drive the image to broken exactly like the existing "shows the source-offline error" test.
    expect(api.media.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'b1', tool: 'image', kind: 'load', url: BROKEN_URL }));
  });

  it('reports an upload failure with a retry that re-runs the upload', async () => {
    // uploader.uploadByFile rejects once, then resolves.
    const [ call ] = vi.mocked(api.media.reportFailure).mock.calls;

    expect(call[0].kind).toBe('upload');
    call[0].retry();
    await flush();
    expect(uploadByFile).toHaveBeenCalledTimes(2);
  });

  it('does not report when onUploadError dismisses the error', () => {
    // config.onUploadError returns false.
    expect(api.media.reportFailure).not.toHaveBeenCalled();
  });

  it('clears when the image finally loads', () => {
    // Broken, then retryBrokenImage, then dispatch 'load' on the new <img>.
    expect(api.media.clearFailure).toHaveBeenCalledWith('b1');
  });

  it('clears when the block is removed', () => {
    tool.removed();
    expect(api.media.clearFailure).toHaveBeenCalledWith('b1');
  });

  it('clears when the image is replaced by a new upload', () => {
    // Broken, then a successful uploadByFile of a new file.
    expect(api.media.clearFailure).toHaveBeenCalledWith('b1');
  });
});
```

Each comment line stands for setup code the implementer copies from the neighbouring existing test named in it. Write it out in full. The assertion lines are fixed. `flush` = the file's existing promise-flush helper.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement.**
- In `applyError`, after `this.renderState();`:
  ```ts
  if (outcome.kind === 'message') {
    this.api.media.reportFailure({ blockId: this.block.id, tool: 'image', kind: 'upload', url: source.url, retry: () => this.retryLastSource() });
  } else {
    this.api.media.clearFailure(this.block.id);
  }
  ```
- In `applyBrokenImage`, after `this.renderState();`:
  ```ts
  this.api.media.reportFailure({ blockId: this.block.id, tool: 'image', kind: 'load', url: this.data.url, retry: () => this.retryBrokenImage() });
  ```
- In the `renderRendered` `load` listener, add `this.api.media.clearFailure(this.block.id);`. This covers "retry recovered" and "replaced and loaded".
- In `removed()`, add `this.api.media.clearFailure(this.block.id);`. `destroy()` runs only on editor teardown, where `MediaFailures.destroy()` clears everything, so leave it alone.
- A successful upload always ends in `renderRendered` → `load`. Confirm this by reading `uploadFile`/`uploadUrl` success paths. If a success path sets `state = 'RENDERED'` without a new `<img>` load (e.g. same URL), also clear there.
- Custom hosts may pass an `api` without `media` only in tests. Real `api` always has it after Task 4, so no optional chaining.

- [ ] **Step 5: Run `test/unit/tools/image/index.test.ts`, `index.mutants.test.ts`, `error-state.test.ts`, expect PASS.** Other image test files that build an api stub (grep `createMockApi` / `i18n: { t:` under `test/unit/tools/image`) may now throw on `api.media`. Run them all: `yarn test test/unit/tools/image`. Add the `media` stub where they fail.
- [ ] **Step 6: Lint, commit** `feat(image): report failed images to core`.

---

### Task 8: Adapters

**Files:**
- `packages/react/src/config-keys.ts` (`USE_BLOK_CONFIG_KEYS`, next to `'onError'` ~35)
- `packages/react/src/useBlokHandle.ts` (interface ~46, impl ~112)
- `packages/vue/src/config-keys.ts` (~52), `packages/vue/src/BlokEditor.ts` (prop ~77, `expose` ~261)
- `packages/angular/src/blok-editor.component.ts` (`@Input()` ~149, forwarding ~529, public method next to other editor methods)
- Tests: the drift guards run by `test/unit/react/*`, `test/unit/vue/*`, the Angular adapter tests (grep `onError` in `test/unit` and `packages/*/test` to find each adapter's config-key test)

**Interfaces:**
- Produces: React handle `confirmLeave(): Promise<boolean>` (resolves `true` with no instance); Vue exposed `confirmLeave`; Angular `confirmLeave(): Promise<boolean>`.

- [ ] **Step 1:** Run each adapter's config-key drift test. Some check `BlokConfig` keys against the list at compile time. After Task 2 they should FAIL now because `onImageFailure` is missing. If one is already failing, that is the failing test. If none fail, write one per adapter mirroring the existing `onError` assertion, e.g. `expect(USE_BLOK_CONFIG_KEYS).toContain('onImageFailure')`.
- [ ] **Step 2:** Add `onImageFailure` to the React and Vue key lists, the Vue prop (copy the `onError` prop shape), and the Angular `@Input() onImageFailure?: BlokConfig['onImageFailure'];` forwarded exactly like `onError` at ~529.
- [ ] **Step 3: `confirmLeave` failing tests.** In the React handle test (grep `useBlokHandle` in tests):
  ```ts
  it('confirmLeave forwards to the instance and resolves true without one', async () => {
    // With an instance whose confirmLeave resolves false:
    await expect(handle.confirmLeave()).resolves.toBe(false);
    // Before mount (instanceRef null):
    await expect(emptyHandle.confirmLeave()).resolves.toBe(true);
  });
  ```
  Write the same pair for the Vue `expose` and the Angular component using each file's existing `save` test as the template.
- [ ] **Step 4: Implement.** React: add `confirmLeave(): Promise<boolean>;` to the handle interface and `confirmLeave: (): Promise<boolean> => instanceRef.current !== null ? instanceRef.current.confirmLeave() : Promise.resolve(true),`. Vue: `confirmLeave: () => editor.value?.confirmLeave() ?? Promise.resolve(true)` in `expose`. Angular: `confirmLeave(): Promise<boolean> { return this.instance()?.confirmLeave() ?? Promise.resolve(true); }`.
- [ ] **Step 5:** Run the adapter tests you touched plus `test/unit/architecture/*parity*`. Expect PASS. Lint changed files. Commit `feat(adapters): onImageFailure and confirmLeave`.

---

### Task 9: End-to-end

**Files:** Create `test/playwright/tests/tools/image-failure-notices.spec.ts`

- [ ] **Step 1: Write the spec.** Copy `createBlok`, `ensureBlokBundleBuilt`, `gotoTestPage`, `resetBlok`, `HOLDER_ID` usage from `test/playwright/tests/tools/image.spec.ts`. Serve images with `page.route` like `image-format-variants.spec.ts:169-176`, using `test/playwright/fixtures/image/photo.jpg`.

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// + helpers exactly as image.spec.ts imports them

const photo = readFileSync(path.resolve(__dirname, '../../fixtures/image/photo.jpg'));

test.describe('image failure notices', () => {
  test.beforeAll(async () => { await ensureBlokBundleBuilt(); });
  test.beforeEach(async ({ page }) => { await gotoTestPage(page); });

  test('a dead image toasts after its reloads; Show scrolls, Retry recovers', async ({ page }) => {
    let serve = false;

    await page.route('https://media.test/**', (route) => serve
      ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: photo })
      : route.fulfill({ status: 404, body: '' }));
    await createBlok(page, { blocks: [
      ...Array.from({ length: 30 }, (_, i) => ({ type: 'paragraph', data: { text: `p${i}` } })),
      { id: 'img1', type: 'image', data: { url: 'https://media.test/a.jpg' } },
    ] });

    const toast = page.getByTestId('notification-error');

    await expect(toast).toContainText('Image failed to load', { timeout: 20_000 });
    await toast.getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('[data-blok-id="img1"]')).toBeInViewport();

    serve = true;
    await toast.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-blok-id="img1"] img')).toHaveJSProperty('complete', true);
    await expect.poll(() => page.evaluate(() => window.blokInstance?.confirmLeave())).toBe(true);
  });

  test('saving with a failed upload shows the save toast', async ({ page }) => {
    await createBlok(page); // image tool configured with an uploader whose uploadByFile rejects — see image.spec.ts uploader setup
    // Pick a file via the image block's file input (copy from image.spec.ts upload test).
    await page.evaluate(() => window.blokInstance?.save());

    await expect(page.getByTestId('notification-error')).toContainText("Won't be saved: 1");
  });

  test('confirmLeave shows the banner and each button answers', async ({ page }) => {
    await page.route('https://media.test/**', (route) => route.fulfill({ status: 404, body: '' }));
    await createBlok(page, { blocks: [ { type: 'image', data: { url: 'https://media.test/a.jpg' } } ] });
    await expect(page.getByTestId('notification-error')).toBeVisible({ timeout: 20_000 });

    for (const [ name, expected ] of [ [ 'Stay', false ], [ 'Leave anyway', true ] ] as const) {
      const answer = page.evaluate(() => window.blokInstance?.confirmLeave());
      const banner = page.getByRole('alertdialog', { name: 'Some images have problems' });

      await expect(banner).toContainText("Won't display: 1");
      await banner.getByRole('button', { name }).click();
      expect(await answer).toBe(expected);
      await expect(banner).toBeHidden();
    }
  });
});
```

- Replace `[data-blok-id="img1"]` with the real block-id attribute. Check `DATA_ATTR` for the holder id attribute (it's a data attribute, not a class, so it is allowed).
- The "Show" locator check `toBeInViewport` needs the 30 paragraphs above to push the image off-screen.
- The 20 s timeout covers 5 automatic reloads. Read `handleImgLoadFailure` for the per-attempt delay and set the timeout to that total plus a margin.

- [ ] **Step 2: Run** `yarn e2e test/playwright/tests/tools/image-failure-notices.spec.ts`. Expect PASS (the feature is built by now). To prove the spec checks something, temporarily comment out the `reportFailure` call in `applyBrokenImage`, re-run, see test 1 and test 3 FAIL, then restore it.
- [ ] **Step 3: Commit** `test(image): e2e for failure toasts and the leave banner`.

---

### Task 10: Final gates and push

- [ ] Run `yarn lint` and `yarn test`. Memory says the full suite takes >10 min and the user prefers related tests. CLAUDE.md makes the full run the final gate. Run the full unit suite once in the background and read its summary. Run e2e only for `test/playwright/tests/tools/image*.spec.ts` and `test/playwright/tests/api/notifier.spec.ts`.
- [ ] If anything fails, follow CLAUDE.md "Failure Recovery Protocol": `git diff --name-only origin/main` → own failures fixed by subagents per category; pre-existing ones logged.
- [ ] `git pull --rebase` then `git push`. `git status` must show "up to date with origin".
- [ ] Tell the user: new visible behaviour (toasts appear where there were none before), the opt-out `onImageFailure: () => false`, and that a KB/adapter version bump is theirs to decide.
