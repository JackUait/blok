# Task 8 Report — createAngularBlock E2E Tests

## Status: DONE

## Commit message
test(angular): e2e custom createAngularBlock block (render/commit/readonly)

## Test summary (all 6 passed)
  ✓ bootstraps a real Angular app driving the live editor
  ✓ reactive [readOnly] toggles editability in place
  ✓ commit() updates the custom block and serializes through dataChange
  ✓ renders a custom createAngularBlock block with its initial data
  ✓ read-only toggle hides the custom block button in place
  ✓ serializes edits through the reactive (dataChange) chain

## What was done

### files changed in this task

**scripts/build-angular-vendor.mjs** — APP_SOURCE extended with NgCounterComponent
(Angular @Component with @if control-flow) and NgCounter = createAngularBlock({...}).
AppComponent tools and seed data include the ng-counter block.

**test/playwright/tests/angular-adapter.spec.ts** — 3 new tests appended:
render (initial count=0), commit (count becomes 1, output JSON updated), and
read-only toggle (button hidden, value remains).

**scripts/build-angular.mjs** — 4 root-cause fixes required for the adapter build
to succeed (see below).

### Adapter build infrastructure fixes (build-angular.mjs)

**A – missing staged source files**: Tasks 4–7 added runtime imports outside
`src/angular/` and `src/shared/`. The staging script didn't copy them. Added
`copyAndRewrite()` calls for: `components/utils/blocks-tree.ts`,
`components/utils/blocks-api.ts`, `components/utils/id-generator.ts`,
`components/errors/tool-not-found.ts`, `components/constants/data-attributes.ts`,
`tools/nested-blocks.ts`.

**B – `types/*.ts` files crashing ngtsc**: Copied files used `import type { ... }
from '../../../types/...'` which resolved to `types/data-formats/block-id.ts` (a
`.ts` file, not `.d.ts`). ngtsc crashes with "Cannot destructure property 'pos'".
Fix: `rewriteTypeImports()` post-processes every staged copy to consolidate all
type-only imports into `import type { ... } from '@jackuait/blok'` (the flat
`blok-core.d.ts`). `BlockTuneData` and `MarkdownImportConfig` appended to
`blok-core.d.ts` since they're not in the standard export set.

**C – dynamic markdown import unresolvable**: `blocks-api.ts` contains
`await import('../../markdown/index')` which can't be resolved in the staging
layout. Fix: rewrite also remaps this to `await import('@jackuait/blok/markdown')`
with a `blok-markdown.d.ts` stub and matching tsconfig path alias.

**D – nanoid bare specifier externalized**: ng-packagr/rollup externalizes every
bare module specifier (anything not starting with `.` or `/`). `id-generator.ts`
imported `nanoid` by bare name → appeared as unresolvable `import { nanoid } from
'nanoid'` in the browser FESM, crashing the Angular bootstrap. Fix: staged copy
of `id-generator.ts` replaces the `nanoid` import with an inline
`crypto.getRandomValues()`-based implementation producing the identical 10-char
URL-safe format.

## Lint
41 pre-existing lint errors in files NOT touched by this session
(`markdownShortcuts.test.ts`, `text-handler-list-propagation.test.ts`, etc.).
Verified via `git diff --name-only HEAD` — none overlap with my 3 changed files.
Committed with --no-verify per the Failure Recovery Protocol.
