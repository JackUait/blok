# Agent-control execution progress

Approved execution: subagent-driven, 2026-10-08.
Baseline commit: `f4c94c9c`.

This file records reviewed implementation, not planned work. All implementation stays on `main`; no branches or worktrees.

## Current status

- Preflight reports exist for all five plans. Checks not established by the scan remain explicit task-local prerequisites.
- Initial command/manifest types, schema validator, placement, and capability scanner have approved independent reviews, passing scoped tests/lint, and a clean full compiler gate. Their explicit-path commits are recorded below. No public agent runtime is wired yet.
- The schema pin, shared sanitizer/schema extractions, deep-sanitize walk, marker layer, manifest, canonical action context, command names/errors, built-in sanitizer factories, effective contract, public manifest exports, shared runtime, and shared IDs are committed. The EOF-only shared-ID follow-up is committed. The public conversion sanitation regression (01/22) is reviewed, verified, and committed with its BREAKING migration note. The core command envelope and paragraph description are reviewed and committed. Snapshot, provider renderers, and pure table normalization remain in test-first execution.
- Independent implementers own disjoint files. Only the controller stages and commits. Shared memory-heavy checks run sequentially.
- Twenty-three tasks are reviewed and committed. Other tasks remain active or pending; final full-project lint/tests and integrated API verification have not run.
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

## Release obligation

The approved `blocks.convert` change sanitizes supplied overrides with the target tool's effective rules before writing them. Hosts that relied on preserving unlisted markup must declare permitted markup in that tool's sanitizer. Do not rely on conversion to store executable HTML. This needs a BREAKING release note; the user chooses the version bump.

Final full-project tests/lint, integrated runtime verification, broad review, and synchronized push remain pending.
