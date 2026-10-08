# Agent-control execution progress

Approved execution: subagent-driven, 2026-10-08.
Baseline commit: `f4c94c9c`.

This file records reviewed implementation, not planned work. All implementation stays on `main`; no branches or worktrees.

## Current status

- Preflight reports exist for all five plans. Checks not established by the scan remain explicit task-local prerequisites.
- Initial command/manifest types, schema validator, placement, and capability scanner have approved independent reviews, passing scoped tests/lint, and a clean full compiler gate. Their explicit-path commits are recorded below. No public agent runtime is wired yet.
- The schema pin, shared sanitizer/schema extractions, deep-sanitize walk, marker layer, manifest, canonical action context, command names/errors, built-in sanitizer factories, effective contract, public manifest exports, shared runtime, and shared IDs are committed. The EOF-only shared-ID follow-up is committed. The public conversion sanitation regression (01/22) is reviewed, verified, and committed with its BREAKING migration note. The core command envelope and paragraph description are reviewed and committed. ID-only headless table normalization is reviewed and committed; full browser/store parity remains deferred. The pure document snapshot is reviewed and committed. Provider renderers, shared placement, rich-text operations, JSON edit application, and Header/List descriptions are reviewed and committed. Further descriptions and planner/runtime work remain in test-first execution.
- Independent implementers own disjoint files. Only the controller stages and commits. Shared memory-heavy checks run sequentially.
- Forty-three tasks are reviewed and committed. Other tasks remain active or pending; final full-project lint/tests and integrated API verification have not run.
- Per-task evidence and independent-review verdicts live under `.superpowers/sdd/<plan-name>/progress.md` during execution.
- Build sequence: reconciliation ledger section 14 (W0–W6). The user's later instruction to use parallel subagents supersedes the single-implementer restriction.

## Execution overrides

- The current commit trailer is `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Tests and lint stay scoped during iteration. Final gates precede any completion claim.
- The default eval threshold remains a drop greater than one trial out of three, with any Markdown-regression failure failing the run.
- Real-model eval calls require the key and budget before execution; infrastructure approval does not supply a key.

## Reviewed tasks

| Plan/task | Change | Commit | Evidence |
| --- | --- | --- | --- |
| 01/1 | Published command contract types | `0b8f18ae` | Semantic RED/GREEN; 139 scoped tests; scoped lint; independent spec/quality review. |
| 02/2 | Schema-profile validator | `f0f4fa06` | 96 scoped tests after review correction; scoped lint; full compiler; spec/quality re-review. |
| 02/3 | Tool description and manifest types | `36fa93eb` | Semantic RED/GREEN; 12 fixture + 122 law tests; scoped lint; full compiler; independent review. |
| 05/1 | Capability scanner foundations | `c0446f6d` | Behavioral RED/GREEN; 16 scoped tests; scoped lint; full compiler; independent review. |
| 03/14 | Agent cursor placement foundation | `0684c621` | Resolver regressions RED/GREEN; 53 tests; scoped lint; full compiler; independent re-review. |
| 02/1 | Published schema byte pin | `185e8e80` | Controlled mutation RED; restored 69 tests GREEN; scoped lint; independent review. |
| 02/8 | Shared inline/block-color sanitizer rules | `ff92a7f2` | 109 scoped tests; lint and full compiler; independent review; fresh built browser import/save/export. |
| 02/4 | Shared rich-text schema helpers | `e55eecd0` | 73 scoped tests; lint and full compiler; independent review; built schema byte hash unchanged. |
| 01/18 | Shared deep-sanitize walk | `a2c6c0dc` | 16 new + 1346 referring tests; lint/compiler; independent review; fresh built nested sanitation. |
| 03/15 | Inert agent marker layer | `3cc33c23` | Marker/presence/CSS gates; lint/compiler; independent re-review; built LTR/RTL/reduced-motion and human-state checks. |
| 02/5 | Validated tool manifest builder | `985c8095` | 59 tests after regression-first correction; lint/compiler; independent spec/quality re-review; built-boundary check. |
| 02/12 | Canonical tool action context and recording fake | `13566625` | 42 tests after regression-first prototype-key correction; public type law; lint/compiler; independent spec/quality re-review; built-boundary check. |
| 01/2 | Core command names and typed failures | `b55f764a` | 59 tests after behavioral RED; lint/compiler; independent spec/quality review and actual-source probes; built-package preservation check. |
| 02/9–11 | Built-in block, inline, and table sanitizer factories | `63468e13` | Independent pre-move pins; behavioral RED/GREEN; 47 suites/1659 passing tests; scoped lint/full compiler; independent source and final-log reviews; fresh built 165-check preservation probe. |
| 02/6 | Effective command contract and availability | `b7f32c61` | Behavioral RED 30 failures; 32 contract + 59 manifest tests; scoped lint/full compiler; independent spec/quality review and actual-source matrix probes. |
| 02/7 | Public manifest and validator exports | `4b0f03cb` | Missing-export RED; 5 boundary tests, public/purity laws, compiler signature parity; independent review; fresh built Node 27/browser 26 checks. |
| 02/14 | Pure IDs and shared table ID helpers | `5edca6bd`, `4ef7c5f8` | Behavioral RED/GREEN; final 5 mint + 24 shared tests; 57 runtime references covered; lint/compiler, independent preservation/log review, built editor 9 checks. EOF-only follow-up independently reviewed; fresh fixtures/compiler and built editor pass. |
| 02/13 | Effective headless tool runtimes | `7362e425` | Behavioral RED 15 failures; final 19 tests with all 25 real adapters; lint/compiler; independent review and helper-type re-review; built export boundary. |
| 01/22 | BREAKING public conversion override sanitation | `ae027271` | Malicious HTML/segment regression RED/GREEN; permitted-markup controls; 26 related unit suites, 39 conversion E2E cases; lint/compiler; independent review; fresh built 13 checks. Normal hooks passed after wrapping the release-note footer. |
| 01/3 | Core command envelope and registry | `798b6139` | Behavioral RED/GREEN; 148 envelope and 314 related tests; scoped lint/full compiler; independent spec/quality review. |
| 02/16 | Paragraph self-description and schema scaffolding | `61315ad6` | Behavioral RED; 151 related tests, exact schema byte pin; lint/compiler; independent review; fresh built Node-view 6/browser-class 11 checks. |
| 02/15 | ID-only headless table normalization | `11dfc71b` | Behavioral RED/GREEN; ragged idempotence regression; 17 normalization +19 runtime tests; lint/compiler; independent re-review; fresh built preservation checks. Full browser/store parity is not claimed. |
| 01/4 | Pure document snapshot | `700370e4` | Behavioral RED/GREEN; nested icon isolation regression; final 59 tests and 207 related tests; scoped lint/full compiler; independent re-review; fresh built Node6/browser11 preservation checks. No public runtime/Jint integration is claimed. |
| 02/17 | Header/List descriptions | `0d222cc9` | Behavioral RED/GREEN; 46 tests and related schema gates; lint/compiler; independent final review; fresh built 17 checks. Saved schema unchanged. |
| 03/2–5 | Provider tool renderer | `05c56c2d` | Phased behavioral RED/GREEN, including reference collision and own-key regressions; 59 + Node 3 tests; Ajv 34 actual-output checks; lint/compiler; independent final review. No authenticated-provider claim. |
| 01/6 | Rich-text range operations | `cd8a55ec` | Behavioral RED/GREEN; 49 new + 151 supporting tests; lint/compiler; independent final review. Public/Jint integration deferred. |
| 01/5 | Shared placement rules | `393fa802` | Behavioral RED/GREEN; 82 + 49 new and 749 additional referring tests; lint/compiler; independent final review; fresh built public placement 22 checks. |
| 01/7 | JSON edit applier | `aed1c89c` | Behavioral RED/GREEN; 49 tests; pair and checkpoint lint/full compiler; independent final review. Planner/executor integration deferred. |
| 01/8 | Planner refs and insertion | `11d78277` | Behavioral RED/GREEN; final 80 insert + 38 state tests; scoped lint/full compiler; independent final review. Public planner/Jint integration remains pending. |
| 02/18–22 | Remaining built-in block descriptions | `11d78277` | 293 new + 684 supporting tests; scoped lint/full compiler; independent scoped reviews; fresh built 139 checks. Native-save and action-runtime parity remain pending. |
| 01/9 | Update, delete and duplicate planners | This checkpoint | Behavioral RED/GREEN; 105 new + 2 boundary + 118 existing tests; scoped lint/stable full compiler; independent source/correction/gate reviews. Public planner/editor/store/Jint parity remains pending. |
| 02/23 | Shared root page-icon schema | This checkpoint | Semantic identity RED/GREEN; seven preserved controls; shared schema bytes unchanged by extraction; scoped lint/compiler and independent review; built icon/title controls. |
| 02/24–24a | Real saved image markup values and schema acceptance | This checkpoint | Validation-first RED/GREEN; 112 schema + 578 referring + 107 model tests; exact pin/digest widening; independent source/pin/gate reviews; built native save and schema controls. |

## Release obligation

The approved `blocks.convert` change sanitizes supplied overrides with the target tool's effective rules before writing them. Hosts that relied on preserving unlisted markup must declare permitted markup in that tool's sanitizer. Do not rely on conversion to store executable HTML. This needs a BREAKING release note; the user chooses the version bump.

Final full-project tests/lint, integrated runtime verification, broad review, and synchronized push remain pending.

Controller current-checkpoint gates: bm42y22me terminal compiler exit0, renderer59+Node3GREEN, actual-output Ajv34pass and22-path scopedlint0. bii13n667 built public editor placement22checks pass/exit0, no source imports. Supporting rich-text/snapshot queue bii2as3gs passed all 151 tests. All five checkpoint groups have final independent signoffs and exact-path commits. Checkpoint push remains pending; no overall completion.

Checkpoint commit: Plan02Task17 0d222cc9 reviewed/verified; seven exact paths, default/schema/native-preservation scope. Current full compiler and owned lint pass; push pending other checkpoint groups.

Checkpoint commit: Plan03Tasks2–5 05c56c2d reviewed/verified; six exact paths. No public AgentAPI wiring or authenticated-provider claim; overall plan and push pending.

Checkpoint commit: Plan01Task6 cd8a55ec reviewed/verified; two exact paths. UTF-16/mark/embed helper scope; public/Jint integration not claimed.

### 2026-10-08 checkpoint compiler recovery

- Frozen descriptor new suites: 293 passed. Descriptor supporting/focused queue `b9woq0tfd` terminated with exit 0; final audit records the exact counts and retained notices.
- Task8 recovered seven-file lint passed. Final-source insertion/state rerun is running as `bzeylgums`; no result is claimed yet.
- Full compiler `bwbudpfgl` failed with TS2769 at `test/unit/tools/page/page-safe-outputs.test.ts:48`. The test is unchanged, but its `$defs.page.properties` now flows through `describePage().data: Schema`, whose property values are unknown.
- Ruling: this is a checkpoint-owned direct type cascade, not a pre-existing failure — verified test/schema/descriptor/declaration chain — treating it as pre-existing would hide a consumer of the extraction change. Task21 owner adds only an object/null guard and retains the exact saved-key assertion; fresh scoped lint, test and full compiler remain required.
- Fresh built-package verification is running as `bw1j3iggt`; existing port-4446 server and `agent-control` browser remain in use. Four prepared probes remain unrun. No checkpoint or overall completion claim.

### 2026-10-08 final-byte tests and built checkpoint evidence

- `bzeylgums` terminated 0: final frozen Task8 files passed 80 insertion and 38 state cases; before/after seven hashes matched. The full log was controller-read.
- `b9woq0tfd` terminated 0: descriptor lint passed; 14 supporting suites passed 560 cases and 11 focused compatibility suites passed 124 cases. Independent audit read all 910 lines. Vite, Storybook and Angular dependency-scan notices remain recorded.
- Fresh build `bw1j3iggt` terminated 0. Built browser probes `br1q0se2x` passed 23/55/28/33 checks (139 total), with no failed checks or console errors. Four console warnings per page and build warnings remain; this verifies descriptors/schema/validator only, not editor seeding, native save, action effects or planner/Jint execution.
- Task21 compiler recovery is exactly four added guard lines in `page-safe-outputs.test.ts`; the assertion and all other bytes are preserved. Updated ownership/hash manifest: scratchpad/checkpoint-final-61.sha256.json. Recovery lint is observed 0; test/compiler terminal results remain pending.
- Peer adapter integration fast-forwarded 4979a321 to a982d607 across 42 paths. Measured overlap with the checkpoint is empty; all 61 checkpoint hashes remain unchanged. Ruling: preserve scoped evidence, but require a stable-HEAD full compiler result if the active compiler's input timing cannot be established — otherwise peer file changes could invalidate a broad current-tree claim.
- Current delivery remains uncommitted and overall implementation remains unfinished. Source handovers for Task9/Task23 are still held.

### 2026-10-08 reviewed checkpoint ready for delivery

- Stable full TypeScript gate `b9yh40v7d` passed with HEAD unchanged at a982d607 before/after and all 61 source/test hashes preserved. The guard recovery also passed scoped lint, all five referencing tests and its compiler run.
- Task8 final review now has SPEC APPROVED and QUALITY APPROVED. Descriptor18–22 static reviews and the combined scoped/build/compiler gate signoff pass, with warnings and published-declaration/runtime/full-suite limits retained.
- The controller is delivering only the reviewed 61 source/test paths and this execution ledger. Remaining planner handlers, surface/runtime/Jint/MCP/eval work and mandatory final full-project gates are not complete. Task9/Task23 source release follows measured delivery, not this readiness note.

### 2026-10-08 checkpoint delivered; next TDD handovers

- 11d78277 pushed successfully. At handover HEAD equaled origin/main and git status was clean. The exact reviewed61 source/test paths plus this ledger were committed with normal hooks and required attribution.
- CoreTask8 and descriptorTasks18–22 are delivered within their reviewed scope. CoreTask9 and descriptorTask23 now receive disjoint test-first ownership. Whole-project final gates and later implementation remain pending.

### 2026-10-08 block-edit and saved-schema checkpoint

- Final Task9 scoped queue passed 225 tests and changed-five-file lint. Schema/reference queue passed 690 tests and changed-six-file lint. The required unchanged markup model suite passed all 107 cases.
- Full compiler and fresh build passed on stable ba6ffddf. Its inventory contained 4099 entries but 4098 distinct hashed paths. Before/after input maps were byte-identical. Twelve checkpoint hashes stayed unchanged.
- Built native Image/schema/icon controls passed 31 checks; layout/media controls passed 55. All 657 dist files stayed unchanged. Each page reported zero console errors and four warnings. Build and source-test warnings remain recorded.
- Independent task source, correction and final scoped gate reviews passed. The controller delivers only twelve source/test/snapshot paths and this ledger. Later planner, executor, browser/store/Jint, MCP and eval work remain unfinished. Overall final full-project gates remain pending.
