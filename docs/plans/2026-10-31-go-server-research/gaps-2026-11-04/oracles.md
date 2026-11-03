# Go/C# parity proof gaps (oracles)

Scope: the shared oracles that prove Go matches C#:
- the black-box conformance suite (`scripts/test-server-conformance.mjs`);
- the shared fixtures under `test/unit/server-conformance/fixtures`;
- the parity law (`test/unit/architecture/server-go-parity-law.test.ts`).

Method: read-only greps and reads, plus `git log`/`git show`. I edited and ran nothing. Paths are relative to the repo root. "C#" means `packages/server/dotnet/*Tests`. "Go" means `*_test.go` (or a helper a test calls) under `packages/server/go`.

---

## FIXTURE COVERAGE TABLE

Legend:
- ✓ = a test file reads the fixture. Most cells were found by filename in a test file. I checked that the reader walks every case only for these:
  - collab/ export, seed and shape
  - collab-migrations, collab-history, collab-journal
  - yjs-engine readers (decode, integration, capture, scenario, pending)
  - agent scenarios, formula-dates
  - canonical-edit-digest (BB 422 loop)

  For the other ✓ cells, "proven" means "read by both". Whether each reader covers every case was not checked.
- BB = black-box only. A TS conformance suite compares the server's answer to the golden. `http-host-contract.test.ts` compares for every target and writes only when `BLOK_WRITE_FIXTURES=1` and target=csharp (`http-host-contract.test.ts:27-28`, `compareGolden` at `:285-299`). The runner and CI run every SUITE for both csharp and go (see section 2).

| Fixture | C# reader | Go reader | TS reader | Verdict |
|---|---|---|---|---|
| agent-moves.json | ✓ Collab/AgentRoomOpsTests.cs | ✓ internal/collab/convert/agentops_test.go | agent-move-fixture.test.ts | proven |
| agent-page-fields.json | ✓ AgentRoomOpsTests.cs | ✓ agentops_test.go | agent-page-fields-fixture.test.ts | proven |
| agent/host.json | ✓ Agent/AgentHostFixtureTests.cs:23 | ✓ blokagent/host_fixture_test.go:368,412 | – | proven |
| agent/formula-dates.json | ✓ Agent/AgentFormulaDatesFixtureTests.cs:20 | ✓ blokagent/formula_dates_test.go:13 | – | proven |
| canonical-edit-digest.json | ✓ Collab/CanonicalEditDigestCaptureTests.cs | ✓ internal/dotnet/double_test.go:14, convert/editops_test.go | collab-http-contract.test.ts | proven |
| collab-room-constants.json | ✓ CollabRoomConstantsCaptureTests.cs | ✓ room/constants_test.go:11 | – | proven (constants only, see section 3) |
| content-disposition-filenames.json | ✓ AspNetCore.Tests/ContentDispositionFixtureTests.cs | ✓ blokserver/disposition_test.go:13 | – | proven |
| content-types.json | ✓ ContentTypeFixtureTests.cs | ✓ blokserver/contenttypes_test.go:13 | – | proven |
| converter-keys.json | ✓ ConverterKeysFixtureTests.cs | ✓ convert/keys_test.go:13 | server-concurrent-loss*.test.ts | proven |
| frame-check-embedders.json | ✓ FrameCheckEmbedderFixtureTests.cs:19 | ✓ framecheck/embedder_test.go:12 | – | proven |
| frame-check-oembed.json | ✓ FrameCheckOEmbedFixtureTests.cs:24 | ✓ framecheck/oembed_test.go:12 | – | proven |
| frame-check-verdicts.json | ✓ FrameCheckVerdictFixtureTests.cs:20 | ✓ framecheck/verdict_test.go:9 | – | proven |
| frame-check-responses.json | – | – | BB http-host-contract:828 | BB both targets |
| header-timeout.json | – (no unit reader) | ✓ cmd/blok-server/headertimeout_test.go | BB http-host-contract:917 | Go unit + BB. C# is proven only by BB. No stale risk, because BB compares against C# on every csharp run. |
| host-log-lines.json | ✓ Host.Tests/HostCollabLogTests.cs | ✓ cmd/blok-server/collablog_test.go:30 | – | proven |
| http-dates.json | ✓ HttpDateFixtureTests.cs | ✓ internal/dotnet/httpdate_test.go:11 | – | proven |
| local-delete-responses.json | – | – | BB http-host-contract:446 | BB both |
| local-file-responses.json | – | – | BB http-host-contract:326-331 | BB both |
| media-types.json | ✓ MediaTypeFixtureTests.cs | ✓ internal/mediatype/mediatype_test.go:10 | – | proven |
| metadata/*.html (2) | – | – | served by fixture-origin.ts to http-host-contract (:351, :649) | BB input, not a golden |
| options-defaults.json | ✓ OptionsValidateFixtureTests.cs | ✓ blokserver/options_test.go:150 | – | proven |
| options-validate.json | ✓ OptionsValidateFixtureTests.cs | ✓ blokserver/options_test.go:13 | – | proven |
| origin-case-fold.json | – | ✓ internal/dotnet/ordinal_test.go | BB http-host-contract:1025 | Go unit + BB (C# only BB) |
| outbound-encodings.json | – | **no test**. The only Go hit is a comment in internal/outbound/decode.go:15 | BB http-host-contract:639 | BB only. No Go unit test pins it. |
| outbound-header-size.json | – | – | BB http-host-contract:724 | BB both |
| outbound-policy.json | ✓ OutboundPolicyFixtureTests.cs:48 | ✓ internal/outbound/policy_test.go:13 | – | proven |
| outbound-redirect-cap.json | – | – | BB http-host-contract:701 | BB both |
| outbound-request-headers.json | – | – | BB http-host-contract:670 | BB both |
| rich-text-fields.json | ✓ RichTextFieldsTests.cs | ✓ convert/fields_test.go, blokagent/normalize_test.go:447 | rich-text-canonical-fixtures.test.ts | proven |
| rich-text-canonical/{inputs,expected}.json | ✓ RichTextCanonicalTests.cs:15-16 | ✓ convert/richtext_test.go:40-41, normalize_test.go:751-752 | ✓ | proven |
| rich-text-edits/cases.json | ✓ RichTextEditFixtureTests.cs:16 | ✓ convert/richtext_test.go:87 | ✓ | proven |
| routing.json | – (no unit reader) | ✓ internal/route/route_test.go:65 | BB routing-contract.test.ts:43 | Go unit + BB |
| s3-proxy.json | – | – | BB http-host-contract:1132 | BB both |
| sync-frames.json | ✓ SyncWireTests, SyncWireFramingTests:405, CollabRoomTestSupport:1009 | ✓ collab/wire/wire_test.go:12 | sync-frames.freshness + client test | proven |
| sync-wire-decode.json | ✓ SyncWireDecodeFixtureTests.cs:189 | ✓ wire/wire_test.go, wire/fuzz_test.go | – | proven |
| tickets-extended.json | ✓ TicketFixtureTests.cs:77 | ✓ blokserver/ticket/ticket_test.go:14 | – | proven |
| **tickets.json** | ✓ BlokServerRequestGuardTests, Collab/SyncTestSupport, BlokTicketTests, TicketVerifierTests | **none** | BB server-contract, sync-contract, blok-client-contract, protocol-v2-contract, sync-transport-contract | **C# unit reads it, Go unit does not.** Go is proven only through BB. |
| unfurl-html.json | ✓ UnfurlHtmlFixtureTests.cs:23 | ✓ internal/unfurl/parse_test.go:12 | test/unit/html/corpus.ts | proven |
| unfurl-queries.json | – | – | BB http-host-contract:393 | BB both |
| upload-file-names.json | – | – | BB http-host-contract:534 | BB both |
| upload-section-limit.json | – | – | BB http-host-contract:496 | BB both |
| collab/ (32 case dirs + manifest) | ✓ Collab/YDocConverterFixtures.cs. It lists case directories with GetDirectories (:43-50) and reads input, canonical, canonical.segments, update.b64, page, page-canonical (:88-100). Host.Tests/HostCollabTests.cs:1150-1156 reads update.b64 and canonical.json. | ✓ convert/export_test.go reads dirs via ReadDir and manifest.json (:85-110): input, canonical.segments, page, page-canonical, update.b64. Also seed_test.go:72-109, structure_test.go:112, yjs/decode_test.go:276-286. shape_test.go:75-77 leaves out 3 "mutated" cases with a written reason and fails if any is missing. | collab-fixtures.freshness, parser-parity | Proven for segments and page. **`collab/*/canonical.json` (HTML-shape export) has no Go reader.** Unverified whether this is intentional. Go exports the format-2 segment shape, so it may be. |
| collab-disk/codecs.json | ✓ CollabDiskCaptureTests.cs:21 | ✓ journal/codec_test.go:60, files_test.go:67, workingset_test.go:46 | – | proven |
| collab-edits/cases.json (213 cases, incl. 17 `loss-*` + 81 `table-loss-*`) | ✓ YDocConverterEditCaptureTests.cs:24 | ✓ convert/apply_test.go:165,266 | – | proven |
| collab-format1/ (31 case dirs) | ✓ YDocConverterFixtures.Format1CaseNames/LoadFormat1 (:65-81) reads input, canonical, update. Used by YDocConverterMigrationTests, CollabRoomMigrationTests, YDocConverterMigrationCaptureTests:46 | partial: convert/migrate_test.go:51 reads only `update.b64` of the rooms that `collab-migrations/cases.json` names. Go never reads format-1 `canonical.json`/`input.json`. | collab-format1-fixtures.test.ts | Converter migration is proven via the capture. **Room-level migration is unproven** (section 3). |
| collab-hardening/cases.json | ✓ YDocConverterHardeningCaptureTests.cs:25 | ✓ convert/hardening_test.go:56,90 | – | proven |
| collab-history/{timeline,changes,restore-plans}.json | ✓ CollabHistoryCaptureTests.cs:29-41 | ✓ room/history_fixture_test.go:172,212,359 | – | proven (pure functions only) |
| collab-journal/scenarios.json (58 scenarios) | ✓ CollabJournalStoreCaptureTests.cs:24 | ✓ journal/store_scenario_test.go:45 | – | proven |
| collab-migrations/cases.json | ✓ YDocConverterMigrationCaptureTests.cs:22 | ✓ convert/migrate_test.go:43 | – | proven (converter) |
| collab-structure/cases.json | ✓ YDocConverterStructureCaptureTests.cs:20 | ✓ convert/structure_test.go:104 | – | proven |
| documents/looks-like-a-document.json | ✓ LooksLikeADocumentFixtureTests.cs:14 | ✓ blokdocs/looks_test.go:12 | – | proven |
| documents/host.json (98 cases) | ✓ HostEnvelopeFixtureTests.cs:20 | ✓ blokdocs/host_fixture_test.go:228 | – | proven |
| documents/runtime-scripts.json | ✓ Runtime/RuntimeScriptFixtureTests.cs:17 | ✓ jsruntime/scripts_fixture_test.go:27 | – | proven |
| documents/ops.json (397 cases) | ✓ DocumentOpsFixtureTests.cs:20 | ✓ jsruntime/ops_fixture_test.go:97 | documents-ops-fixture.freshness | proven. Go skips big docs only under -short or -race (ops_fixture_test.go:115-116). CI runs neither (ci.yml:326). |
| documents/bundle-smoke.json | – | ✓ jsruntime/runtime_test.go:49 | server-go-runtime-bundle-law.test.ts:144 | Go-only by design. It pins Go's bundled runtime against node:vm, and ops.json covers both engines. Not a gap. |
| dotnet/primitives.json | ✓ DotnetPrimitivesFixtureTests.cs:21 | ✓ internal/dotnet/dotnet_test.go:12 | – | proven |
| jsjson/{js,dotnet}.json | ✓ Yjs/JsJsonFixtureTests.cs:136-243 | ✓ internal/jsjson/jsjson_test.go:146-284 | jsjson-fixtures.freshness | proven |
| text-diff/{cases,grapheme-break}.json | ✓ TextDiffCaptureTests.cs:27-33 | ✓ convert/textdiff_test.go:26,98 (also regenerates its table, :110) | – | proven |
| yjs-engine/ (manifest, any, varint, structs, negative, empty-structs, scenarios, csharp-capture, yrs-compat, fuzz/seed-*.json ×50) | ✓ Yjs/YjsEngineFixtures.cs (manifest), CSharpCaptureTests, YrsCompatCorpusTests, Lib0CodecTests, AnyCodecTests, FuzzCorpusTests | ✓ yjstest/fixtures.go + decode_test.go:202-263, integration_test.go:119-139, capture_test.go:88, scenario_test.go:138-156 (globs fuzz/seed-*), pending_test.go:142, lib0_test.go:60-202 | yjs-engine-fixtures.freshness | proven. The `yrsIntegerTagCases` exemption is the same on both sides (Go decode_test.go:246, C# EncoderTests.cs:17 / UpdateV1DecoderTests.cs:32). |

Outside this folder, `test/fixtures/agent-server-scenarios/*.json` (110 files) is read in full by both sides:
- C# `Agent/AgentServerScenarioTests.cs:52` uses `GetFiles("*.json")`.
- Go `blokagent/scenario_test.go:232` uses `ReadDir`. It has no skip list.

**Fixture-level direct proof gaps (C# reads it, no Go test does):**
1. `tickets.json`. Go has no unit reader, only the black-box suites.
2. `collab/*/canonical.json`. Go has no reader. Unverified whether that is intentional.
3. `collab-format1/*/{canonical,input}.json`. Go reads only `update.b64`, and only through the migration capture.

**Go reads it, C# has no unit reader:** `header-timeout.json`, `origin-case-fold.json`, `routing.json`. All three are also black-box goldens that compare against C# on every csharp run, so there is **no stale-golden risk**.

`outbound-encodings.json` is the reverse case. Go names it only in a comment (`decode.go:15`), so no Go unit test pins the decoder table. Only the black-box suite does.

---

## CSHARP-ONLY CONFORMANCE TESTS

- **No conformance test is gated to C#.** A grep for `BLOK_CONFORMANCE_TARGET|skipIf|runIf|'csharp'|=== 'go'` over `test/unit/server-conformance/*.ts` finds only:
  - `http-host-contract.test.ts:27-28`. `capturing` is true only when `BLOK_WRITE_FIXTURES=1` and target=csharp. In that mode `compareGolden` writes the goldens instead of comparing (`:285-289`). Every other run compares, on both targets. It is a capture switch, not a C#-only test.
  - Each suite's `skipIf(unset('BLOK_CONFORMANCE_SERVER'))` guard. It keeps ordinary `yarn test` runs from driving a server. It does not depend on the target.
  - `server-contract.test.ts:33-35` `ordinaryIt` needs `BLOK_CONFORMANCE_ORDINARY_SERVER`. The runner sets it for every target (`test-server-conformance.mjs:263`), and buildGo builds an ordinary binary (`:188`).
  - `host-cli-contract.test.ts:226-230` `itWithIpv6` is gated on IPv6 loopback availability, not on the target.
  - `journal-interop-contract.test.ts:24` needs both servers. It runs only under `--target interop`, in both directions: `['csharp','go'],['go','csharp']` at `:136-138`.
- **SUITES vs CI.**
  - `SUITES` (`test-server-conformance.mjs:44-57`) has 12 suites. csharp and go both default to all of them (`:73, :89`).
  - CI runs `--target csharp` at `ci.yml:395`, `--target interop` at `:406` and `--target go` at `:547`. None of them passes `--suite` or `-t`.
  - **No suite runs for csharp but not for go.**
- **C#-only static check inside a TS file (not a conformance suite).**
  - `server-concurrent-loss-wave2.test.ts:84-108` reads `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs` and asserts that `RowSimilarity` has an object branch.
  - It has no Go twin. Go implements the object branch in `internal/collab/convert/deepassign.go:449-477`.
  - The behaviour is proven on Go through `collab-edits` cases such as `arrays-pair-elements-by-similarity` and the `loss-*`/`table-loss-*` cases. The source scan itself checks C# only. Low risk.

---

## C# BEHAVIOUR WITH NO GO PROOF

How I searched:
1. Matched every C# `[Fact]/[Theory]` name (1896 total) against Go test identifiers.
2. Checked unmatched clusters with cross-language anchors (strings, constants, function names) in Go tests and in the TS conformance suites.

A name miss alone is not reported as a gap. Each item below names what I checked.

### Confirmed (Go implements it; no Go test, no shared fixture, no conformance test)

1. **Room-level format-1 → format-2 migration.** C# `Blok.Server.Tests/Collab/CollabRoomMigrationTests.cs` has 20 facts (`:33-412`). Examples:
   - `AnyFailedMigrationIsHeldOff` (:94)
   - `AFailedCommitLeavesTheFormat1JournalIntact` (:149)
   - `AFailedReadLeavesTheFormat1JournalIntact` (:170)
   - `AMigrationThatRunsPastTheRuntimesLimitsIsHeldOff` (:199)
   - `ARefusedResetDoesNotLeaveAFormat1RoomServing` (:234)
   - `AFormat1ClientsOperationIsRefusedAfterMigration` (:285)
   - `AJournalInANewerFormatIsRefusedAndKept` (:307)
   - `AFailedWriteLeavesTheFormat1WorkingSetIntact` (:359)
   - `AJournalResetStampsTheCurrentFormat` / `AWorkingSetResetStampsTheCurrentFormat` (:400, :412)

   Go implements all of it in `internal/collab/room/load.go`: 67 (held off), 114 (`migrateWorkingSetLocked`), 167-168 (`migrateJournalLocked`), 375-380 (`requireReadableFormat`), 385-389, 403, 428.

   Go's only migration tests are converter-level:
   - `convert/migrate_test.go:38` `TestMigrateRichTextWritesWhatCSharpWrites`
   - `convert/docconverter_test.go:212`

   A grep for `migrat|migrationFailed|loadHeldOff|requireReadableFormat` in `internal/collab/room/*_test.go` finds nothing. The conformance suites contain no "migrat" either (only `collab-format1-fixtures.test.ts`, which guards the bytes).

2. **Checkpoint policy: PARTIAL.**
   - Go policy code: `internal/collab/room/ops.go:363-397`.
     - Pending-state refusal: :363-367.
     - Fence-lost, out-of-range and invalid-data close the room: :383.
     - `checkpointFailures` / `checkpointFailureLimit`: :387-396.
   - **Proven on Go:** `blokserver/collabstore_test.go:220` `TestAHostStoresCheckpointErrorDecidesBetweenFailAndRetry`.
     - Invalid data, out of range and fence lost each fail the room (503 on the next edit).
     - Any other error is retried (204).
     - It fires at the 64-operation threshold.
     - This covers C# `ACheckpointRefusedByACorruptJournalClosesTheRoom`, `ACheckpointSequenceTheStoreRefusesClosesTheRoom`, `ACheckpointThatLostTheFenceClosesTheRoom` and `ATransientCheckpointFailureKeepsTheRoomAndIsRetried`.
   - **Not proven on Go.** These C# `CollabRoomTests.cs` facts have no anchor:
     - `ARunOfCheckpointFailuresStopsTheRoom`: the failure limit is pinned only as a constant (`room/constants_test.go:36`).
     - `PendingYjsStatePreventsCheckpointAdvancement` / `ACheckpointIsRefusedWhileTheEngineHoldsPendingState`: Go grep for `HasPending` finds no room test.
     - `TheByteThresholdPublishesWhereTheOperationCountWouldNot`.
     - `TheThresholdCountsEveryJournalledWriteNotJustV2Operations`.
     - `AFailedCheckpointCostsAnotherThresholdBeforeItRetries`.
     - `CheckpointThroughNeverExceedsDurableThrough`.
     - `ACheckpointPublishedDuringAnInFlightProjectionStillEarnsOne`.

3. **Host CLI base-zero integer grammar.** These C# `Host.Tests/HostProcessTests.cs` facts have no Go or TS counterpart:
   - `AcceptsTheFrozenBaseZeroIntegerGrammar`
   - `RefusesInvalidOrOverflowingBaseZeroIntegers`
   - `TreatsALeadingZeroMaximumAsOctal` (:683, `--max-upload 040000000`)
   - `TreatsALeadingZeroRateLimitAsOctal`

   Go hand-writes the parser in `cmd/blok-server/args.go:201` (`parseBaseZeroInt64`: 0b/0o/0x and leading-0 octal).

   No Go test calls it or passes a non-decimal value. A grep for `parseBaseZero|040000000|octal|0x` in `cmd/blok-server/*_test.go` finds nothing. The TS suites pass only decimal `--max-upload`/`--rate-limit` values: `0`, `2`, `3`, `-1`, `1x`, `2147483592`, `9223372036854775808`.

4. **Room-level history and version handle.** These C# `CollabRoomTests` facts have no Go anchor:
   - `ACheckpointProjectionWaitsForAVersionReadStillInFlight`
   - `AVersionReadTheSettleGaveUpOnCannotLandOverANewerHandle`
   - `ADrainProjectionWaitsForAVersionReadStillInFlight`
   - `TheVersionIsCapturedAtLoadSoAHostSaveAfterwardsStillRefusesTheWriteBack`
   - `AReloadedJournalRoomStillCarriesTheDocumentVersion`

   Go has the code in `room/load.go:181-215` (`startVersionReadLocked`/`applyVersionLocked`/`settleVersionLocked`) and in `persist.go`. A grep for `versionRead|settleVersion|DocumentVersion` in Go tests finds nothing.

   Only partial BB coverage exists: `sync-contract.test.ts:649` "exports an edited document back to the doc endpoint with the served version".

5. **Headless journal / working-set adoption and quarantine.** These C# `CollabRoomTests` facts have no Go test:
   - `AHeadlessJournalAdoptsTheWorkingSetAndThenDropsIt`
   - `AHeadlessJournalWithAnEmptyWorkingSetSeedsFromTheEndpoint`
   - `AStaleWorkingSetBesideAJournalHeadIsIgnoredAndDropped`
   - `AQuarantinedWorkingCopySurvivesTheJournalTakingOver`
   - `AResetOfAHeadlessDocumentAdoptsAndFlushesTheWorkingSetFirst`
   - `AResetThatCannotRetireTheWorkingCopyIsRefused`

   The Go code is in `room/load.go:277-331` (`tryAdoptWorkingSetLocked`, `dropWorkingSetLocked`). Grep: `headless|adopt` finds no room test, and `quarantin` finds nothing in Go at all.

   BB partly covers it: `journal-interop-contract.test.ts:239` "serves a working set the other wrote without a journal".

### Partial or unverified (Go code exists; Go and TS cover only part of it)

- **History HTTP endpoint** (`AspNetCore.Tests/Collab/HistoryEndpointTests.cs`, 36 facts).
  - Go's `internal/collab/collabhttp` has only `edit_result_test.go` and `retry_test.go`. History is proven on Go through `collab-http-contract.test.ts:315-505, 589-680`.
  - The following have no anchor in either TS or Go tests (unverified beyond that):
    - `RowsThatGrowWhenTheirHtmlIsReadStillKeepToTheByteBudget` (:429). Go has the second cut at `collabhttp/history.go:197`. The TS 4 MiB case (`collab-http-contract:623`) uses plain text, so the HTML-growth path is likely not exercised.
    - `ARestorePinnedToTheNewestListedVersionLandsUntilTheRoomMoves` (:620). Go reads If-Match on restore at `history.go:335`. TS has no restore If-Match case.
    - `AnExportPastTheRuntimesLimitsIsARetryable503` (:753). Go has it at `history.go:417`.
    - `ReadsAskOnlyTheReadGateAndWritesAskBoth` (:838).
  - Go `room/replaced_test.go:58-60` does cover a stale-precondition restore.
- **Room manager lifecycle** (`CollabRoomManagerTests.cs`): 47 of 53 facts have no Go name match. Go `room/retry_test.go`, `join_test.go` and `blokserver/collab_test.go` cover only part of it: purge refusal and tombstone, forbidden on every door, drain, recheck. These have no anchor I could find (unverified):
  - Purge sequencing: `AJournalPurgeFailureKeepsTheGateAndRetriesBeforeWorkingSetDeletion`, `AWorkingSetDeleteFailureKeepsTheJournalTombstoneAndRetries`, `PurgeWaitsForAnInFlightExportButStartsNoFinalExport`.
  - Reset epoch and blob races: `ResetWaitsForAnInFlightBlobWriteInsteadOfRacingIt`, `ResetAbandonsAnInFlightExportInsteadOfLettingItLandAfterwards`.
  - Eviction under outages: `AStoreOutageKeepsTheRoomLoadedUntilTheWorkingSetCatchesUp`, `AnEndpointOutageAtEvictionKeepsTheRoomLoadedUntilTheExportLands`.
- **Room core:** 185 of the 207 `CollabRoomTests.cs` facts have no Go name match. Go `internal/collab/room` has 48 test functions. Much of the sync and awareness path is proven by BB (`sync-contract` 16, `protocol-v2-contract` 14, `sync-transport-contract` 27 tests). The clusters in items 2, 4 and 5 above are the ones I checked and found unproven. The rest of the 185 are **unverified, not confirmed gaps**.

### Database converter classes: partial
- `YDocConverterDatabaseRelationTests` (7 facts) covers relation values merged by the generic identity-array rule. Go implements the rule (`convert/seed.go:600-602`, `deepassign.go:48,184`).
  - The rule is exercised through the id-bearing cases in `collab-edits`: `database-view-lists`, `row-id-table-*`, `ordered-ids-*`.
  - **No fixture case contains `relation`** (grep of collab-edits, collab-hardening and collab/). So the relation-specific concurrent merges are unproven on Go:
    - `TwoPeersRelatingDifferentRowsAtOnceKeepBoth`
    - `AClearAndAnAddMadeAtOnceKeepTheAdd`
- `YDocConverterDatabaseStructureTests` (4 facts) covers `buttonActions` and automation definitions.
  - `buttonActions` is only in the key set (`converter-keys.json`, `convert/keys.go`). No edit or hardening case contains it.
  - The four "two peers add the first X" merges are unproven on Go.
- `YDocConverterDatabaseRowTitleTests` and `YDocConverterViewSettingsTests`: partly covered by the `database-rows` collab case and `database-*` edit cases. These were not checked fact by fact (unverified).

### Not examined (unverified; do NOT read as covered)
I never checked these name-unmatched C# classes with anchors:
- `TableDataLossAuditTests` (8)
- `Documents/TableDocumentDataLossAuditTests` (12). The documents ops fixture may cover it.
- `Yjs/YTextFormattingTests` (12)
- `UploadEndpointTests` (20), `UploadByUrlEndpointTests` (18), `DeleteEndpointTests` (13), `UnfurlEndpointTests` (8). The BB goldens in http-host-contract and server-contract likely cover much of these.
- `LocalBlobStoreTests` (11). Go has `internal/blob/local_test.go`.
- `BlokServerRequestGuardTests` (16). Go has `blokserver/guard_test.go`.
- `BlokServerRegistrationTests` (55), `BlokDocumentsRegistrationTests` (12), `BlokAgentExecutorRegistrationTests` (6). These are mostly ASP.NET DI wiring. Go has `blokserver/library_test.go`.
- `SyncEndpointTests` (48), `SyncHandshakeTests` (35), `SyncSocketMemberTests` (11). BB sync-transport-contract (27) and Go synchttp (~40 tests) overlap heavily. I did not map them fact by fact.
- `EditEndpointTests` (33), `StateEndpointTests` (12), `ResetEndpointTests` (10).
- `S3BlobStoreTests` (30), `S3CollabStoreTests` (12).

### Areas checked and found proven (not gaps)

- Converter: seed, edit, concurrent-loss, table-loss, hardening, migration transform, structure, text diff. All through captures, including the 18 `YDocConverterConcurrentLossTests` facts, which map to the `loss-*` cases in `collab-edits/cases.json`.
- Journal store: 58 scenarios.
- Agent executor and room: 110 shared scenarios plus `agent/host.json`.
- Documents runtime: 397 ops, 98 host envelope cases.
- Yjs engine.
- Outbound policy, frame-check, unfurl parsing.
- Tickets-extended, options, HTTP dates, media types, content types.

---

## POST-10-30 C# COMMITS WITHOUT GO COUNTERPART

`git log --since=2026-10-30 -- packages/server/dotnet` lists 92 commits. I classified each one by whether it touches Go files, Go tests and fixtures (`git show --name-only`).

Commits with no Go file, checked one by one:

| Commit | Subject | Go proof |
|---|---|---|
| 40300fa5 | agent room step gets its lineage before it is shared | ✓ Go `blokagent/room_test.go:63-77` `TestAStepCarriesItsLineageWhenItIsAdded` (comment names the C# twin) |
| eba5e533 | pin when DocumentReplaced fires in C# | ✓ Go test came first: `room/replaced_test.go:25` |
| 6d11ac58 | 422 not 500 for an edit whose text is not valid Unicode | ✓ `canonical-edit-digest.json:406-428` holds lone-surrogate refusals. Go `editops_test.go:49` reads them. BB `collab-http-contract.test.ts:180-187` posts every captured refusal and expects 422 plus the parser's words, on both targets. |
| 01e071b2 | BREAKING: code-page filename* ignored | ✓ `content-disposition-filenames.json:52-54,141` holds windows-1252 / shift_jis / koi8-r, read by Go `disposition_test.go`. The commit body says Go already answered this way. |
| 6859ba7a, d30e8163 | wire JSON content exports as JS reads it (BREAKING) | ✓ `collab-hardening/cases.json` cases `wire-json-as-javascript-reads-it`, `wire-json-drops-only-the-lone-surrogate`, `wire-json-nested-past-the-json-default` (Go `hardening_test.go:54`). Also Go `yjs/decode_test.go:517-541`. |
| be353448 | cap a history changes answer at 4 MiB | Replay cap ✓ via `collab-history/changes.json` cases "the byte budget keeps the newest" and "...drops the oldest past it" (C# `CollabHistoryCaptureTests.cs:188-189`; Go `history_fixture_test.go:210`). Endpoint ✓ BB `collab-http-contract:623`. The **HTML-growth second cut** (`HistoryEndpointTests:429`; Go `collabhttp/history.go:197`) has no Go or TS proof. |
| e54a7d5e | BREAKING: refuse an edit HTML field over 32768 chars | ✓ Go `convert/docconverter_test.go:281` `TestAnEditHTMLFieldPastTheCapIsRefusedAsTooLargeBeforeAnyRead`, plus `:303` |
| 6cc0b525, f06e1af8, 46c790c6, 069ffff6 | conjunct runs, text diff cases | ✓ `text-diff/cases.json` (Go `textdiff_test.go:85`), plus Go `TestALongConjunctRunDiffsInLinearTime` (:141) |
| 3a081c20 | refuse a sync frame string that is not Unicode | ✓ `sync-wire-decode.json` (Go wire_test / fuzz_test) |
| 049efb6f | formula-dates: fail in a zone the fixture lacks | ✓ Go `blokagent/formula_dates_test.go:11-38` does not depend on the host zone. It sets `time.Local` to every zone in the fixture in turn and needs at least two. So it never had the hole C# fixed. |
| 473bed39 | agent executor wire bytes in a shared fixture | ✓ `agent/host.json` (Go `host_fixture_test.go`) |
| 1a2706e2 | unreadable thrown name is Unknown | ✓ `documents/runtime-scripts.json` (Go `scripts_fixture_test.go:27`) |
| 9d4b7385 | BREAKING: shape check never throws; lone surrogate is invalid | ✓ `documents/host.json` + `looks-like-a-document.json` (Go `host_fixture_test.go:228`, `looks_test.go:12`) |
| 1ccc2194, dc22553b, 88296efa | UTF-7 filename*, content types, JsJson | ✓ fixtures read by Go |
| bd60a20c, 2954138e, 8db2d8ca, fcef571f | journal store scenarios | ✓ `collab-journal/scenarios.json` (Go `store_scenario_test.go:45`) |
| 1e4995f1, 9d162d41, 5ed840d5, fa6fb4cf | hardening / edit captures | ✓ Go reads both fixtures |
| 5fdbd7ad | structure capture | ✓ Go `structure_test.go:104` |
| **93827690** | capture the format-1 rich text migration | Converter ✓ (Go `migrate_test.go:43`). **Room-level migration is still unproven** (section 3, item 1). |
| ef1f9e43, 0386d949 | test scheduling; NuGet bump | n/a |

Commits that touch Go non-test files but no Go test (a2a7fb5a, a901c373, f544113e, 746770c9, 4eb0684e, 071e9f87, b67a67d5) each change a fixture that Go reads:
- `frame-check-oembed.json`
- `outbound-policy.json`
- `unfurl-html.json`
- the BB goldens `frame-check-responses.json` and `outbound-*.json`

So they are proven. The one exception is `outbound-encodings.json`, which has no Go unit reader.

**Result: every post-10-30 C# behaviour commit has a Go counterpart.** The exceptions are the HTML-growth history cut (be353448) and the room-level migration lifecycle, whose C# tests predate this window.

---

## PARITY LAW NOTES

`test/unit/architecture/server-go-parity-law.test.ts` (186 lines) enforces only:
- the Go module path and that `cmd/blok-server/main.go` exists (:77-83);
- that `ci.yml` passes `--target csharp`, `go` and `interop` (:85-95);
- exactly one unfiltered `--target go` run (:97-99, using `fullGoRuns` at :39-48);
- that the runner accepts all three targets (:101-103);
- that no goreleaser config is tracked (:107-115);
- mutation checks of the parsers above (:117-184).

It has **no skip or exemption lists**, so it hides nothing. It also does **not** check any of these:
- That every fixture under `fixtures/` has a Go reader, or that the C# and Go readers enumerate the same cases. A new C#-captured fixture without a Go reader would pass. `tickets.json` is in this state today.
- That `go test ./...` and `dotnet test` run in CI. They do run (`ci.yml:326` and `ci.yml:355`), but the law does not pin them.
- That a C# test class has a Go twin.
- That `SUITES` covers every `*-contract.test.ts` in the folder. Today all of them are in `SUITES` or `INTEROP_SUITES`. A new contract file left out of `SUITES` would run in neither target.

CI gating: both Go jobs block a merge.
- `go test` runs in job `server-security` (`ci.yml:257`, step at :326).
- Go conformance runs in job `validate-spec-coverage` (`ci.yml:517`, step at :547).
- Both jobs are in `production-readiness` `needs` (`ci.yml:750-770`). That job fails on any need whose result is not `success` (`:782`).
- There is no `continue-on-error` anywhere in ci.yml. Neither job has a job-level `if:`.

Go-side skips found:
- `cmd/blok-server/main_test.go:83` skips when the C# source is absent, and :369 and :395 skip under `-short`.
- `jsruntime/ops_fixture_test.go:115` skips big documents under `-short` or `-race`.
- `journal/store_test.go:167-253` skips the POSIX-only cases (python3, flock, symlink).

CI's Go run uses neither `-short` nor `-race` (`ci.yml:326`), so the fixture skips do not fire there. C# has no `Skip=` facts. `LocalCollabOperationStoreTests.cs:901` only comments on the lack of `Assert.Skip`.
