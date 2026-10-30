# Completeness critique of the Go parity ledgers

Date: 2026-10-31. Checked the six ledgers in this folder against the tree. No tracked file was edited.

Method:
- All six ledgers were joined into one text file. Each file was searched for by basename (`grep -F`), then by bare class name (`grep -w`).
- C# list: `git ls-files packages/server/dotnet | grep '\.cs$'`, without `/bin/`, `/obj/` and `.Tests/`. That gives 142 files.
- Conformance list: `git ls-files test/unit/server-conformance`. That gives 326 files.
- A fixture file counts as covered when a ledger names its folder with a glob. Examples: `T/fixtures/collab/<32 cases>` (`input.json` → `canonical*.json`) and `fixtures/collab/page-*` (collab X1/X3), and `fuzz/seed-*.json` (yjs-lib0 line 2090 of the joined text).

## 1. Orphans: C# files no ledger names

10 of 142 files are never named, by file or by class:

| File | Lines | What it holds | Is the behaviour covered anyway? |
|---|---|---|---|
| `Blok.Server.AspNetCore/BlokServerBuilder.cs` | 22 | The public `BlokServerBuilder` class, which the `Use*` hooks extend | Only its extensions are cited (http-host L10/L13, collab T7). The builder type itself is public API and has no row. |
| `Blok.Server/Collab/CollabWorkingSetLaw.cs` | 98 | `GuardAsync`, `DecodeOrAbsent`, `EnsureWriteDoesNotLowerEpoch`, `EnsureResetRaisesEpoch`, with exact messages | Partly. collab P4r says "Epoch guards", and the package list names "law". The refusal messages and the reset rule (strictly greater epoch) have no row. |
| `Blok.Server/Collab/ICollabDocConverter.cs` | 68 | The converter seam, plus `CollabTransientException` | Partly. The Transient → Overloaded mapping is in collab M18. The interface and the exception have no row. |
| `Blok.Server/Collab/ICollabMember.cs` | 81 | The member interface | No row. |
| `Blok.Server/Collab/ICollabWorkingSetStore.cs` | 86 | `CollabWorkingSet` record, `CollabWorkingSetStoreException`, store interface | Partly, through the store rows P4r and P2r. The exception has no row. |
| `Blok.Server/Collab/RichTextInput.cs` | 99 | `RichTextHtml`, `RichTextHtmlSlot`, and the `Refusing`/`Collecting`/`Converting` modes | **No row.** It decides whether rich-text HTML input is refused, collected or converted. This is a behaviour gap, not just a missing type. |
| `Blok.Server/Metadata/UnfurlMetadata.cs` | 8 | The unfurl result record | The parser rows (M*) cover its fields indirectly. |
| `Blok.Server/Properties/AssemblyInfo.cs` | 5 | `InternalsVisibleTo` for AspNetCore and the two test assemblies | No Go equivalent is needed. It does matter for package layout: Go `internal/` has to give the same visibility. |
| `Blok.Server/Storage/ForeignBlobUrlException.cs` | 4 | The exception thrown for a foreign blob URL | Behaviour is covered: http-host D3 has "foreign URL → 404". The type has no row. |
| `Blok.Server/Storage/S3BlobStoreOptions.cs` | 14 | The S3 options record | No row lists its fields. Check them against the S3 flag and env rows. |

3 more files are named only in the yjs-lib0 size-estimate table and have no behaviour row:
- `Yjs/AnyArray.cs` (28 lines)
- `Yjs/YStruct.cs` (18)
- `Yjs/YText.cs` (15)

They are small. `YText` is mentioned in prose, and `YStruct` is the base type for structs.

## 2. Orphans: server-conformance files no ledger names

| File | Kind |
|---|---|
| `test/unit/server-conformance/collab-fixtures-parser-parity.test.ts` | Test. It checks that the parse5 node parser and the DOM parser agree on rich-field HTML in the collab fixtures. This bears on the collab rich-text blocker. |
| `test/unit/server-conformance/sync-frames.freshness.test.ts` | Test. It guards `sync-frames.json`, which collab F1-F4 cite, but the freshness guard is never named. |
| `test/unit/server-conformance/http-client.ts` | Harness helper that no ledger names. |
| `test/unit/server-conformance/fixtures/metadata/error.html` | Fixture. http-host M2 names `metadata/precedence.html` only. |

No other file is an orphan. The 32 collab case folders, including every `canonical.segments.json`, `page.json` and `page-canonical.json`, are covered by the folder globs above. So are the 50 `yjs-engine/fuzz/seed-*.json` files.

## 3. Spot-check of 13 ledger rows

The rows were picked with `awk 'BEGIN{srand(31)} rand()<0.04'` over rows that cite file:line. I added R1, D6 and D4 because they share files with the picked rows. Each cited range was read with `sed -n`.

| Ledger / row | Citation | Result |
|---|---|---|
| agent S6 | `BlokAgentExecutor.cs:130-175` | Correct. The page count comes from `agentPagesNeeded`. There is a `ThrowIfCancellationRequested` before each `CreateAsync`. |
| agent H7 | `RoomAgentHistory.cs:53-68,148-156` | **Claim correct, citation incomplete.** The row says `Add` prunes, but `Add` is at `:119-131` (Prune at `:123`, LastUsed at `:131`), which is not cited. The claim that `Replayed` (`:74`) and `Forget` (`:107`) do not prune is correct: `Prune()` is called only at `:57` and `:123`. |
| collab E7 | `A/EditEndpoint.cs:137-228` | Correct. The status codes and messages match. |
| collab P14r | `S/LocalCollabOperationStore.cs:100`; `A/CollabOperationStoreSource.cs:34` | Correct. `DefaultMaxUpdateBytes = 1 << 20`. |
| delivery-ci N3 | `bin/blok-server.mjs:107-162` | **Path wrong.** Content and lines are correct, but `bin/blok-server.mjs` does not exist at the repo root (`git ls-files` finds 0). The real file is `packages/server/bin/blok-server.mjs`, and the ledger's key gives no such prefix. N1 and N2 have the same problem. |
| documents-runtime D14 | `BlokDocumentConverter.cs:94-120` | Correct. The message text matches exactly. |
| documents-runtime D29 | `BlokDocumentConverter.cs:511-529` | Correct. |
| documents-runtime D4 | `BlokDocuments.cs:22,35` | Correct. |
| http-host R16 | `:88-96` (guard); `Route.cs:170` | **File name wrong.** No file `Route.cs` exists (`git ls-files` finds none), and the ledger key (lines 8-14) does not define it. The line is in `Asp/BlokServerEndpointRouteBuilderExtensions.cs:170` (`Guard(handler, method != "GET")`). The guard lines (`BlokServerRequestGuard.cs:88-96`) are correct. |
| http-host R1, D6 | `Route.cs:76-77,238-251`, `Route.cs:87-91` | **Same wrong alias.** The line numbers are correct in `BlokServerEndpointRouteBuilderExtensions.cs`. |
| http-host S1 | `Srv/Storage/BlobKey.cs:7-17` | Correct. |
| yjs-lib0 W2 | `Yjs/UpdateV1Decoder.cs:46-50` | Correct. The message reads "client {client} is listed twice". |
| yjs-lib0 W17 | `Yjs/StateVector.cs:51-64` | Correct. The order is `OrderByDescending` and the vector starts with the count. |

So no row states wrong behaviour. Three citations are wrong or incomplete: the undefined `Route.cs` alias in http-host, the unprefixed `bin/blok-server.mjs` in delivery-ci, and the missing `Add` range in agent H7.

## 4. Probe claims: is the output recorded, and does it reproduce?

### yjs-lib0 fixture decode (Probe 1)
- **Recorded.** yjs-lib0.md §5 gives the command and the full output.
- **Reproduced.** I ran `go run . test/unit/server-conformance/fixtures/yjs-engine` in `scratchpad/yjs-lib0/probe`. The output matched byte for byte: `map-set-any: 16 bytes groups=1 structs=1 client=1000 clock=0 info=0x28 contentRef=8`, `varuint goldens ok=19 … total=19`, `varint goldens ok=21 sentinel=1 total=22`.
- The "41 varint goldens" in the summary is 19 + 22. The -0 sentinel decodes with `signbit=true`.

### documents-runtime goja
| Claim | Recorded? | Re-run this session |
|---|---|---|
| 46/46 identical across node:vm, goja and Jint | Yes, in `out-{node,goja,jint}.json` (46 results each) | `node diff.mjs out-node.json out-goja.json` and `node diff.mjs out-goja.json out-jint.json` both print `46/46 identical (errors compared by name)`. |
| "The three error cases agree on `error.name`, but the messages differ" | Yes | **Overstated.** Only `err.notjson` has different messages. `err.noblocks` ("Document input requires a `blocks` array.") and `err.unknownop` ("Unsupported Blok runtime operation: nope") are the same text in all three engines. |
| Load: goja compile 138.9, run 11.0, next runtime 7.6 ms; Jint 2,335 and 537 ms; node 40.9 ms | Yes, as JSON fields | `compileMs 138.931`, `runMs 11.002`, `secondRuntimeMs 7.628`, Jint `loadMs 2335.485` and `secondMs 536.7557`, node `loadMs 40.89`. Match. |
| Large docs: bigurl.md 1,249 vs 236 ms; big.fromMarkdown 3,880 vs 2,090; pageIndex 6,784 | Yes, per-case `ms` | They match the JSON. |
| The interrupt works inside try/catch and after await | Only as prose. No output file. | `./limits interrupt`: deadline hit at 206, 201.1 and 200.7 ms. Reproduces. |
| Backtracking regex overshoot: 7,301 ms for n=24, 11,014 ms for n=26, 15,221 ms with `u` | Only as prose | **The numbers do not reproduce. The conclusion does.** The re-run gave 3,574.5 ms for n=24, 7,052.1 ms for n=26 and 13,808.6 ms for n=26 with `u`. Both runs are single samples, and both overshoot a 200 ms deadline. The timeout is still not a hard bound, but the exact figures are noise. |
| Stack: StackOverflowError cannot be caught; depth 9000 reuses; depth 1e6 without a limit takes 28 s and 462 MiB | Only as prose | The re-run shows the catch did not run and the reuse worked. Depth 1e6 took 23,416.8 ms with 371 MiB heapInuse. Same shape; the numbers differ. Note that 462 MiB is labelled "peak RSS" in prose, while the probe prints heapInuse. |
| Lone surrogate String() gives U+FFFD, JSON.stringify keeps it; six globals undefined; a pending promise never settles | Only as prose | Reproduced: `"a�b"`, `"\"a\\ud83db\""`, six `undefined`, `state=0`. |
| A pool of 4 handles 64 concurrent calls with 0 wrong and no race report; nested outline under limit 10000 | Only as prose | `go run -race ./cmd/pool` prints `64 concurrent calls on 4 runtimes: 0 wrong` with no race report, and nested.text/nested.md convert with `err=<nil>`. Reproduces. |
| Sticky regex table (goja quadratic; `/a/yu` 103,306 ms at 80k) | Only as prose | **Not re-run** because of its cost. No output was saved. |
| Allocation watchdog stopped at 146 ms / 64 MiB; `grown+=grown` gives RangeError at n=62 | Only as prose | **Not re-run.** No output was saved. |
| Jint Intl, stack RangeError, Jint sticky | Only as prose (`cs/`, `jint/`) | **Not re-run.** |

### Other ledgers (spot level)
- agent T1 (`len=105`) was re-run with `dotnet fsi probe.fsx`. It printed `{"t":"🚀<a>&'+é","n":1,…} len=105`. The length is correct. **But the ledger quotes the output as `"🚀<a>&'+é"`, which is the unescaped input, not what was printed.** The recorded output is mis-transcribed, and it hides the very escaping the trap is about.
- agent T3 (`15.0 -> false`) and collab T2/T16 (digest probe) record their output inline. I did not re-run them.
- delivery-ci F6/F7/F10 quote their error text inline (`unknown revision`, `no matching files found`, `(devel)`). I did not re-run them.

## 5. Summary

- **Real coverage gaps:**
  - `RichTextInput.cs` (refuse, collect or convert rich-text input).
  - `CollabWorkingSetLaw.cs` (the epoch refusal messages and the strict-raise rule on reset).
  - The `ICollabMember`/`ICollabDocConverter`/`ICollabWorkingSetStore` seams.
  - `collab-fixtures-parser-parity.test.ts` and `sync-frames.freshness.test.ts`.
  - `fixtures/metadata/error.html`.
- **Citations to fix:**
  - The `Route.cs` alias in http-host (R1, R16, D6 and other rows that use it).
  - The `bin/blok-server.mjs` prefix in delivery-ci (N1-N3).
  - The `Add` line range in agent H7.
- **Probe records to fix:**
  - documents-runtime: say that only 1 of 3 error messages differs. Label the regex and stack timings as single samples that vary about 2x. Save the raw output of `limits sticky`, `limits alloc*` and the Jint probes, because none is on disk.
  - agent T1: quote the escaped output that was actually printed.
