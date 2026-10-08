# Page title in the framework adapters (plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React, Vue and Angular apps can place Blok's page title with a component, and their `pageTitle` callbacks stay live across re-renders.

**Architecture:**
- Each adapter gets a title component (`BlokTitle` in React and Vue, `<blok-title>` in Angular). It renders an empty host element and calls `editor.title.mount(host)` once the editor is ready. On unmount it calls `editor.title.mount(null)` (plan 1b Task 3).
- Following `BlokContent`, the component takes the editor as an explicit prop or input (decision D4).
- Each adapter wraps `pageTitle.onChange` / `onIconChange` in live wrappers, the same way it already wraps top-level handlers.

**Overview and decisions:** `2026-10-08-page-title-followups-overview.md` (D4, D5, D6).

**Order:** After plan 1b Task 3 (`mount(null)`, detached-header fix). Independent of plan 2.

## Changes from the design spec

- **The spec said "mounted through the editor context". No such context reaches a sibling of the editor:**
  - React provides `BlokInstanceContext` only around `BlockPortalHost` inside `BlokContent` (`packages/react/src/BlokContent.tsx:104-108`).
  - `BlokProvider` (`provide-blok.tsx`) carries config defaults, not the instance.
  - Vue provides the instance only to `BlokContent`'s subtree (`packages/vue/src/BlokContent.ts:48-51`).
  - Angular provides it only on block element injectors (`packages/angular/src/block-portal-registry.ts:140`).
  
  So the component takes an `editor` prop (D4). The exported `useBlokInstance` (React and Vue `index.ts`) and `injectBlokInstance` / `BLOK_EDITOR_INSTANCE` (Angular) resolve only under `BlokContent` or a block injector. Do not use them here.
- **How a `BlokEditor` user gets the instance for `editor`:**
  - React: a state setter as the ref, `const [ed, setEd] = useState<Blok | null>(null); <BlokEditor ref={setEd} />`. `BlokEditor.tsx:137` hands the instance through `useImperativeHandle(ref, () => editor, [editor])`, so the setter gets `null` on recreate and unmount.
  - Never use `useBlokHandle().current`. It is a plain `useRef` getter (`useBlokHandle.ts:81-96`), so it never re-renders when the editor becomes ready.
  - Vue: the `instance` computed that `BlokEditor` exposes (`BlokEditor.ts:294`).
  - Angular: `[editor]="ed.instance()"` (the computed signal at `blok-editor.component.ts:458`).
  - A `title` slot or prop on `BlokEditor` would save this wiring. It is out of scope here; offer it in the hand-off if the docs example reads awkwardly.
- **`<BlokTitle>` does not switch the title on (D5).** Core builds the header only in `prepare()`, when `pageTitle` is set (`src/components/modules/pageTitle/index.ts:60-110`). `mount` does nothing when it is off (`:190-199`). In dev builds the component warns when `editor.title` has no header. Check this through a public signal; if there is none, the warning is skipped and the docs say it instead.
- **`pageTitle` callbacks freeze today:**
  - React spreads the config once into `new Blok` (`packages/react/src/useBlok.ts:360`). Only top-level handlers get live wrappers (`:314-372`).
  - Core captures the callbacks once (`src/components/utils/title-config.ts:22-23`).
  - So `pageTitle={{ onChange }}` keeps the first closure, which breaks the published promise that callback identity is live (`packages/react/types/index.d.ts:39-44`).
  - Vue (construct `useBlok.ts:295`, snapshot `:237`) and Angular (`[config]`, `blok-editor.component.ts:470`) read config once too.
  
  Fixed in Task 2.

## Global Constraints

- `pageTitle` is already in each adapter's key list:
  - React `config-keys.ts:65` (exhaustiveness guard at `:72-73`);
  - Vue `config-keys.ts:65` and the `BlokEditor.ts:118` prop;
  - Angular through `[config]`.
  
  It came in c0dad933 with no test. Task 1 adds the tests.
- `pageTitle` is in `BlokMountOptions`, not `BlokState`, so `reactive-config-contract-law.test.ts` does not fire. Changing `pageTitle` after mount does not rebuild the header; runtime changes go through `editor.title`.
- **Laws that fire:**
  - `adapter-imports-law.test.ts`: no relative `from '..` in `packages/*/src`.
  - `published-types-no-src-refs.test.ts`: also scans `packages/*/types`.
  - The type drift checks: `test/unit/types/react-types-typecheck.ts` and `test/unit/vue/types-typecheck.ts`, which use `AssertEqual`.
  - The export tests: `packages/react/test/exports.test.ts`, `test/unit/vue/exports.test.ts`, `test/unit/angular/exports.test.ts`.
  - `react-fixture-import-map-law.test.ts`, only if a new bare import is added.
- Angular: classic `@Input` decorators only. The `unit-angular` project uses Analog JIT (`vitest.config.ts:54-91`). `build-angular.mjs:69` stages every file in `packages/angular/src`.
- **After destroy, `editor.title` is gone.** Teardown runs synchronously, deletes instance fields and sets a null prototype (`src/blok.ts:123-130`, called at `:567, :682, :727`). Cleanup must never call a destroyed editor's `title`.
  - React and Vue: check `getHolder(editor) !== undefined`. Both call `removeHolder` before every `destroy()` (React `useBlok.ts:260, 404, 893`; Vue `useBlok.ts:250`).
  - Angular has no holder map: check `typeof editor.title?.mount === 'function'`.
  - `BlokContent`'s cleanup never touches the editor, so it is not a precedent for this.
- **React StrictMode reuses the same editor across the remount** (`useBlok.ts:248-256`). A mount effect that runs twice just moves the header again.
- **`pageTitle` stays read-once.** `api-data.ts:4042` lists the props that stay reactive after mount, and `api-data.reactive-config.test.ts` checks it. Do not add `pageTitle` there. Say in its docs that later changes go through `editor.title`.

## Review Focus

1. **Unmount while the editor lives** (React conditional render). The header goes back above the first block, and Backspace at the start of the first block still joins only when the header is connected.
2. **Editor recreated** (React `deps` change destroys synchronously, `useBlok.ts:259-272`). There is one header in the host afterwards, and no TypeError from cleanup on the destroyed editor.
3. **Live callbacks.** Re-render with a new `onChange` closure, type in the title, and only the new closure fires.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/useBlok.ts` | live `pageTitle` callback wrappers |
| `packages/vue/src/useBlok.ts` | same |
| `packages/angular/src/blok-editor.component.ts` | same, for `[config].pageTitle` |
| `packages/react/src/BlokTitle.tsx` | new |
| `packages/vue/src/BlokTitle.ts` | new |
| `packages/angular/src/blok-title.component.ts` | new |
| `packages/{react,vue,angular}/src/index.ts` | export |
| `packages/react/types/index.d.ts`, `packages/vue/types/index.d.ts` | hand-written declarations |
| `test/unit/react/blokeditor-page-title.test.tsx`, `test/unit/react/BlokTitle.test.tsx` | new |
| `test/unit/vue/blok-title.test.ts`, `test/unit/vue/blokeditor-page-title.test.ts` | new |
| `test/unit/angular/blok-title.test.ts`, `test/unit/angular/blokeditor-page-title.test.ts` | new |
| `test/unit/architecture/page-title-adapter-parity-law.test.ts` | new, modelled on `toolbar-anchor-ref-parity-law.test.ts` |
| `test/playwright/tests/{react,vue,angular}-adapter.spec.ts` + `test/playwright/fixtures/*-test.html` | e2e |
| `docs/src/components/api/api-data.ts` (`blok-editor` section around `:4011`, next to `BlokContent` `:4056`), `en.json`, `ru.json`, the three package READMEs | docs |

---

### Task 1: `pageTitle` forwarding is tested in all three adapters

**Files:** `test/unit/react/blokeditor-page-title.test.tsx` (copy the setup of `blokeditor-tab-sync-props.test.tsx`), plus its Vue and Angular twins.

- [ ] **Step 1: Write tests.** Pass `pageTitle: { placeholder: 'Untitled' }`. After ready, the header testid `page-header-title` exists with `data-placeholder="Untitled"`. Pass `data: { title: 'T', blocks: [] }` and expect `editor.title.get() === 'T'`.
- [ ] **Step 2: Run** each file. Forwarding exists today, so these may pass straight away. That is fine: this task pins existing behaviour, it is not a fix. Record which ones passed on the first run. If one FAILS, that adapter does not forward. Fix it in this task, and note it in the commit.
- [ ] **Step 3: Commit** `test(adapters): pin pageTitle forwarding`.

### Task 2: Live `pageTitle` callbacks

**Files:** `packages/react/src/useBlok.ts`, `packages/vue/src/useBlok.ts`, `packages/angular/src/blok-editor.component.ts`, the three Task 1 test files.

- [ ] **Step 1: Failing test** (React): render `BlokEditor` with `pageTitle={{ onChange: a }}`, then re-render with `pageTitle={{ onChange: b }}`. Call `editor.title.set('x')`. Expect `b` called once and `a` not called. Write the same for `onIconChange`, and the Vue and Angular twins.
- [ ] **Step 2: Run.** Expect FAIL (`a` fires).
- [ ] **Step 3: Implement.** Following `handlerWrappers` (`useBlok.ts:314-372`): whenever `currentConfig.pageTitle` is truthy, pass `{ ...(typeof pageTitle === 'object' ? pageTitle : {}), onChange: wrapper, onIconChange: wrapper }`. Each wrapper reads the latest `pageTitle` at call time and calls its callback if there is one.
  - Always attach both wrappers. Core reads these callbacks only with optional chaining (`pageTitle/index.ts:133, 347, 375`), so their presence means nothing. Unlike top-level handlers, there is no channel to push a presence flip after mount. An app that mounts with `pageTitle: true` and later passes `onChange` must still be heard. Add that case to Step 1.
  - Vue: read `mergedConfig().pageTitle` (`vue/useBlok.ts:132` re-reads `toValue(config)`; `BlokEditor` passes a getter, `BlokEditor.ts:240`). A plain object passed to `useBlok` stays a snapshot; document that.
  - Angular: read through `escapeHatchConfig()` (`blok-editor.component.ts:414-416`, defaults merged with `[config]`). Re-enter the zone with `ngZone.run`, as the existing wrappers do (`:356, :379`). The editor is built in `runOutsideAngular` (`blok-content.directive.ts:167`), so without it no change detection runs. Add a test that a bound template value updates after a title `onChange`.
- [ ] **Step 4: Run** (PASS). Then run `test/unit/react/useBlok*.test.ts*` and `test/unit/react/BlokEditor.test.tsx`, and the Vue and Angular `useBlok` / `BlokEditor` tests.
- [ ] **Step 5: Commit** `fix(adapters): pageTitle callbacks follow the latest render`.

### Task 3: React `<BlokTitle editor={editor} />`

**Files:** `packages/react/src/BlokTitle.tsx`, `packages/react/src/index.ts`, `packages/react/types/index.d.ts`, `test/unit/types/react-types-typecheck.ts`, `packages/react/test/exports.test.ts`, `test/unit/react/BlokTitle.test.tsx`.

- [ ] **Step 1: Failing tests** in `BlokTitle.test.tsx`:
  - (a) `editor={null}` renders an empty div and throws nothing;
  - (b) once the editor is ready, the header is inside the div;
  - (c) StrictMode: still exactly one header in the div;
  - (d) unmount `BlokTitle` while the editor lives: the header is back in the editor wrapper, before the redactor. Hypothesis to settle here: `useLayoutEffect` may be needed so the header is never detached for a frame between the div's removal and `mount(null)`;
  - (h) the documented wiring works: `<BlokEditor ref={setEd} />` + `<BlokTitle editor={ed} />`, with `ed` from `useState`;
  - (e) recreate the editor (change `deps`): the header from the new editor is in the div, and nothing throws from cleanup on the old one;
  - (f) extra div props (`className`, `id`) pass through;
  - (g) children are not rendered (the div is Blok-owned, like `BlockChildren`, `createReactBlock.tsx:755-780`).
- [ ] **Step 2: Run** `yarn test test/unit/react/BlokTitle.test.tsx`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.** `forwardRef` div. Effect keyed on `[editor]`: `editor.title.mount(div)`. Cleanup: `if (getHolder(editor) !== undefined) editor.title.mount(null)` (the liveness check in Global Constraints).
- [ ] **Step 4:**
  - Export it from `index.ts`.
  - Declare `export declare const BlokTitle: React.ForwardRefExoticComponent<BlokTitleProps & React.RefAttributes<HTMLDivElement>>` in `types/index.d.ts`, with `BlokTitleProps = { editor: Blok | null } & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>`.
  - Add the `AssertEqual` in `react-types-typecheck.ts` and the export assertion.
- [ ] **Step 5: Run** the new test, the type check (`yarn tsc` scoped per the typecheck file's header), and `packages/react/vitest.config.ts` for `exports.test.ts`.
- [ ] **Step 6: Commit** `feat(react): BlokTitle places the page title`.

### Task 4: Vue `BlokTitle`

Same tests and steps as Task 3, in `packages/vue/src/BlokTitle.ts`, `test/unit/vue/blok-title.test.ts`, `packages/vue/types/index.d.ts`, `test/unit/vue/types-typecheck.ts` and `test/unit/vue/exports.test.ts`. Mount in `onMounted` and in a `watch` on `editor`. Unmount in `onBeforeUnmount`. Commit `feat(vue): BlokTitle places the page title`.

### Task 5: Angular `<blok-title [editor]>`

Same tests, in `packages/angular/src/blok-title.component.ts` (standalone, classic `@Input()`, mount in `ngOnChanges`/`ngAfterViewInit`, `mount(null)` in `ngOnDestroy`), `test/unit/angular/blok-title.test.ts` and `test/unit/angular/exports.test.ts`. Commit `feat(angular): blok-title places the page title`.

### Task 6: Parity law

**Files:** `test/unit/architecture/page-title-adapter-parity-law.test.ts`.

- [ ] Model it on `toolbar-anchor-ref-parity-law.test.ts`. Each adapter's `index.ts` exports a title component. Each one's source calls `title.mount(` and `title.mount(null)`.
- [ ] Mutation-check it: delete the `mount(null)` call in one adapter, run it, and watch it fail. Restore the call.
- [ ] Commit `test(architecture): every adapter places the page title the same way`.

### Task 7: E2E in the three adapter fixtures

**Files:** `test/playwright/tests/{react,vue,angular}-adapter.spec.ts`, `test/playwright/fixtures/{react,vue,angular}-test.html`.

- [ ] Write the spec first. The fixture renders `<BlokTitle>` in a host above a sibling "metadata" div, above the editor.
  - The Angular fixture app is not in the HTML: `angular-test.html:43` imports a gitignored `vendor/angular/app.mjs`, built from the inline `APP_SOURCE` in `scripts/build-angular-vendor.mjs:32, 168` and checked by `test/playwright/build-freshness.ts:21`. Edit that script.
  - Title shows inside the host.
  - Typing fires the fixture's `onChange` log.
  - ArrowDown at the end of the title lands in the first block across the gap.
  - Toggling the component off puts the title above the first block.
- [ ] Run `yarn e2e test/playwright/tests/react-adapter.spec.ts -g "title"` and the same for Vue and Angular. Watch it fail, extend the fixtures, then watch it pass.
- [ ] Commit `test(e2e): page title in the React, Vue and Angular fixtures`.

### Task 8: Docs and final gate

- [ ] `docs/src/components/api/api-data.ts`:
  - a `BlokTitle` entry next to `BlokContent` (`:4056`);
  - a `pageTitle` row in the `blok-editor` props table.
  
  Mirror it in `en.json` and `ru.json` with the same block shape (`docs/CLAUDE.md`). Run `docs/src/i18n/reference-prose.test.ts`, `docs/src/components/api/api-data.ru-coverage.test.ts`, then `node docs/scripts/update-lastmod-ledger.mjs`.
- [ ] Package READMEs: a short `BlokTitle` example in each.
- [ ] Scoped lint and the tests above. `git pull --ff-only`, `git push`, clean status.
- [ ] Hand-off: additive, not BREAKING. `BlokTitle` and the `title` API are newer than `v1.16.1`.
