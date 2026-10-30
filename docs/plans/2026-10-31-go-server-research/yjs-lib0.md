# Go parity research: yjs-lib0 (managed Yjs engine + lib0 codec)

Scope: `packages/server/dotnet/Blok.Server/Yjs/**` (42 files, 6145 raw lines, 3967 code lines; counted with `wc -l` and `grep -cvE '^\s*(//|$)|^\s*///'`). Tests: `Blok.Server.Tests/Yjs/**` (18 test files, 4320 lines, plus 1433 lines of harness).

All paths below are relative to `packages/server/dotnet/` unless they start with `test/` or `scripts/`.

## 0. Facts that shape the whole port

- **No black-box oracle covers this area.** Only two things read `test/unit/server-conformance/fixtures/yjs-engine/`:
  - the TS freshness test (`yjs-engine-fixtures.freshness.test.ts`), which regenerates the fixtures and compares the bytes;
  - the C# in-process tests, through `Blok.Server.Tests/Yjs/YjsEngineFixtures.cs`.
  - Found with `grep -ln yjs-engine test/unit/server-conformance/*.ts`, which returned only the freshness test.
  - `sync-contract.test.ts` checks the engine only indirectly: stock clients have to converge through the server.
- **There is no `fixtures/lib0-parity` directory.** `test/unit/server-conformance/lib0-parity.test.ts` tests the TS `Encoder` and `simpleDiffString` against the real lib0 (lines 1-16). It is not an oracle for a server language.
- **The engine is `internal`.** Its consumer seam is `Collab/` (`CollabRoom`, `CollabHistoryReplay`, `YDocConverter`, `RichText*`). Calls counted by grep:
  - `doc.GetMap` ×15, `doc.GetArray` ×5, `doc.Transact` ×3, `doc.UpdateEmitted` ×2, `doc.ApplyUpdate` / `EncodeStateAsUpdate` / `EncodeStateVector` ×1 each;
  - `UpdateInspector.Inspect` ×2;
  - `JsJson.Stringify` ×11, `JsJson.Parse` ×3, `JsJson.KeyOrder` ×2;
  - `Lib0Reader`, `Lib0Writer` and `AnyCodec` are used directly at `Collab/YDocConverter.cs:688-697`.
  - So lib0 must be its own Go package that collab can import.
- **The engine has no env var, flag, route or startup refusal.** `grep -rn 'Environment\|AppContext\|IConfiguration' Blok.Server/Yjs` returned no config reads. Every "limit" and "refusal" row below is a decoder or runtime rule.
- The old Go tree (`git ls-tree -r ad5782d7^ packages/server`) has no yjs or lib0 code, so this is a fresh port. Its module path was `github.com/JackUait/blok/packages/server` (`git show ad5782d7^:packages/server/go.mod`).

Proposed Go layout (module `github.com/JackUait/blok/packages/server`):

| Go package | Holds |
|---|---|
| `internal/lib0` | reader, writer, Any codec, Any value model (`Object`, `Array`, `Undefined`, `BigInt`), JS string helpers |
| `internal/jsjson` | JS `JSON.stringify` / `JSON.parse` / key order (also used by collab) |
| `internal/yjs` | ids, structs, contents, store, delete set, decoder, encoder, integrator, pending normalizer, doc, types, text |
| `internal/yjs/yjstest` | fixture loader, scenario runner, JSON renderer, Node replay (test-only) |

## 1. Parity ledger

Oracle shorthand:
- **F:** = file under `test/unit/server-conformance/fixtures/yjs-engine/`; the C# test that drives it is in brackets.
- **C#T:** = an in-process C# unit test only (the Go port must re-implement it).
- **NODE** = the test pipes bytes through `scripts/replay-yjs-update.mjs` (real yjs 13.6.33, `manifest.json` `versions`).
- **NONE** = nothing pins Go == C# today. Section 3 proposes a fixture for each.

### 1a. lib0 primitives

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| L1 | varuint read | Yjs/Lib0Reader.cs:48-72 | LEB128, at most 8 bytes, refuses any value above 2^53-1. | F:varint.json `varuint` (19 cases) [Lib0CodecTests.ReadsEveryVarUintGolden]; F:negative.json `varuint-over-2pow53` [UpdateV1DecoderTests.RejectsEveryNegativeGolden]; C#T RejectsVarUintPast2Pow53 | internal/lib0/reader.go |
| L2 | varuint write | Yjs/Lib0Writer.cs:36-45 | LEB128, low 7 bits first. | F:varint.json [WritesEveryVarUintGolden] | internal/lib0/writer.go |
| L3 | varint read | Yjs/Lib0Reader.cs:79-118 | Sign in bit 0x40 of the first byte, 6 bits then 7 per byte. Returns a double so -0 survives. Capped at 8 bytes and 2^53-1. | F:varint.json `varint` (22 cases, one `{"$num":"-0"}`) [ReadsEveryVarIntGolden, NegativeZeroRoundTrips] | internal/lib0/reader.go |
| L4 | varint write | Yjs/Lib0Writer.cs:51-76 | Refuses a non-integer or a magnitude above 2^53-1 (ArgumentOutOfRange). -0 writes 0x40. | F:varint.json [WritesEveryVarIntGolden] | internal/lib0/writer.go |
| L5 | varstring read (strict UTF-8) | Yjs/Lib0Reader.cs:25-27,120-133 | Length-prefixed UTF-8. Invalid UTF-8 is a format error. | F:negative.json `invalid-utf8-key`; C#T RejectsInvalidUtf8, RejectsTruncatedVarString, RoundTripsANulBearingString | internal/lib0/reader.go (`utf8.Valid`) |
| L6 | varstring write (substituting) | Yjs/Lib0Writer.cs:17-26,78-87 | A lone surrogate is written as U+FFFD (EF BF BD), like TextEncoder. | C#T WritesALoneSurrogateAsTheReplacementCharacter | internal/lib0/writer.go (input is UTF-16 units, see T2) |
| L7 | varbytes | Yjs/Lib0Reader.cs:135-147, Lib0Writer.cs:89-94 | Length-prefixed bytes. A length past the buffer is refused before any slice. | F:negative.json `truncated-varstring` | internal/lib0 |
| L8 | float32/float64 big-endian | Yjs/Lib0Reader.cs:149-157, Lib0Writer.cs:96-106 | IEEE floats, big-endian. | C#T ReadsFloatsBigEndian; F:any.json `float32-half`, `float64-third` | internal/lib0 (`binary.BigEndian`, `math.Float32bits`) |
| L9 | bigint64 big-endian | Yjs/Lib0Reader.cs:159-162, Lib0Writer.cs:108-112 | Reads int64 into a BigInteger. Writes `(long)value`, which throws OverflowException past int64. | F:any.json `bigint-1`, `bigint-negative` | internal/lib0 (`int64`) |
| L10 | Lib0FormatException | Yjs/Lib0FormatException.cs:7 | One error type for every malformed or truncated input. | F:negative.json (all 8) | internal/lib0 `var ErrFormat` + wrapped `*FormatError` |
| L11 | Any tags 116..127 | Yjs/AnyCodec.cs:22-33,42-63 | Decodes Any by tag. An unknown tag is a format error. | F:any.json 35 cases [AnyCodecTests.ReadsEveryAnyGolden] | internal/lib0/any.go |
| L12 | Any write dispatch | Yjs/AnyCodec.cs:65-136 | Writes by value kind. null→126, YUndefined→127, any other type throws. | F:any.json 34 non-`decodeOnly` cases [WritesEveryAnyGolden] | internal/lib0/any.go |
| L13 | Number tag choice | Yjs/AnyCodec.cs:139-168 | Integer with abs ≤ 2^31-1 → tag 125 varint. Else float32 if it round-trips (Infinity included) → 124. Else 123. | F:any.json `int-2pow31-minus-1`, `pos-2pow31`, `neg-2pow31`, `float32-half`, `float64-third`, `infinity`; C#T TwoPow31WritesFloat32, InfinityWritesFloat32, NegativeZeroWritesTheSignBit | internal/lib0/any.go |
| L14 | NaN bits | Yjs/AnyCodec.cs:38-40,141-147 | NaN is always written as 0x7FF8000000000000. | F:any.json `nan` [NanWritesFloat64] | internal/lib0/any.go (explicit bits, see T3) |
| L15 | Any object order | Yjs/AnyObject.cs:20-33 | Keeps insertion order. A repeated key overwrites the value and keeps its first position. | F:any.json `object-order`; C#T ObjectKeysKeepInsertionOrder | internal/lib0/values.go (ordered `*Object`) |
| L16 | Any `undefined` | Yjs/YUndefined.cs:4-16 | A singleton, distinct from null. | F:any.json `undefined`, `object-undefined-member`; C#T UndefinedInsideAnObjectRoundTrips | internal/lib0/values.go |
| L17 | Any decode depth cap | Yjs/AnyCodec.cs:20,198-213 | Refuses nesting past 4096 levels, AND refuses earlier if the CLR stack probe fails. | C#T NestedDepthPast4096Rejects (256 passes, 4097 fails) | internal/lib0/any.go (counter only, see T9) |
| L18 | Any write stack guard | Yjs/AnyCodec.cs:69-73 | Write refuses when the stack is nearly full. | NONE | internal/lib0/any.go (depth counter) |

### 1b. JS JSON

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| J1 | Stringify | Yjs/JsJson.cs:17-29,85-154 | JSON.stringify over engine values. `undefined` at the top level throws. An undefined object member is skipped and an undefined array item becomes `null`. byte[] and BigInteger throw. | C#T YTextFormattingTests.StringifyTreatsUndefinedAndNonFiniteLikeJavaScript, StringifyRefusesValuesWithNoJsonForm; scenarios `formatted-text-*` engineWrites bytes | internal/jsjson/stringify.go |
| J2 | Number::toString | Yjs/JsJson.cs:160-216 | Shortest round-trip digits, plain notation for exponents -7<n≤21, `1e+21` style otherwise. Non-finite → `null`, -0 → `0`. | C#T StringifyTreatsUndefinedAndNonFiniteLikeJavaScript (YTextFormattingTests) | internal/jsjson/number.go (port it; do NOT use `strconv` 'g', see T5) |
| J3 | QuoteJSONString | Yjs/JsJson.cs:223-280 | Escapes `"` `\`, the 5 short escapes, other chars <0x20 as `\u00xx`, and a lone surrogate as `\udxxx`. Writes everything else raw. | C#T StringifyEscapesStringsLikeJavaScript | internal/jsjson/quote.go (UTF-16 input) |
| J4 | KeyOrder | Yjs/JsJson.cs:53-83 | Array-index keys (canonical uint < 2^32-1) first, ascending, then the rest in insertion order. | C#T StringifyOrdersKeysLikeJavaScript; scenario `formatted-text-link-key-order` | internal/jsjson/keyorder.go |
| J5 | Parse | Yjs/JsJson.cs:37-47,282-422 | Validates with JsonDocument (depth 512), then hand-reads: every number is a double, a duplicate key keeps its first place and last value, and a `\udxxx` escape stays a lone surrogate. | C#T ParseReadsJsonLikeJavaScript | internal/jsjson/parse.go |
| J6 | Raw JSON validation depth | Yjs/Content/YContent.cs:17-25,136-147 | A JSON payload in refs 2/5/6 must parse at depth ≤512. Depth 513 is refused (probed, §5). | C#T RawJsonAcceptedAtDecodeCanBeReadBack (depth 100 only) | internal/yjs/content.go (hand depth check, see T6) |
| J7 | Raw JSON acceptance set | Yjs/Content/YContent.cs:112-147 | Accepts a lone-surrogate escape, duplicate keys, `1e999`, deep nesting and `"undefined"`. Refuses non-JSON. | C#T UpdateV1DecoderTests.AcceptsEveryRawJsonPayloadABrowserAccepts (5 InlineData), RefusesRawJsonContentNoYjsPeerCanParse | internal/yjs/content.go |

### 1c. Content kinds (info & 0x1F)

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| C1 | Content dispatch 1..9 | Yjs/Content/YContent.cs:92-110 | Picks the reader by the low 5 bits. Anything else is a format error. | F:negative.json `unknown-content-ref-11`; F:structs.json (refs per case) [UpdateV1DecoderTests.DecodesEveryStructsGolden] | internal/yjs/content.go |
| C2 | ReadLength cap | Yjs/Content/YContent.cs:154-162 | A count or length above int.MaxValue is a format error. | C#T RefusesWireValuesNoEncoderWrites ("past int.MaxValue") | internal/yjs/content.go (cap at 2^31-1 to match) |
| C3 | ContentDeleted (1) | Yjs/Content/ContentDeleted.cs:7-53 | Tombstone with a length. On integrate it adds itself to the txn delete set and marks the item deleted. | F:structs.json `scalar-delete-content-deleted` | internal/yjs/content_deleted.go |
| C4 | ContentJson (2) | Yjs/Content/ContentJson.cs:11-80 | Keeps raw strings verbatim. `"undefined"` is a sentinel that skips validation and reads as undefined. | C#T EveryHandBuiltContentRefSurvivesAWriteBack (ref 2 is in no fixture, per UpdateV1DecoderTests.cs:200-203) | internal/yjs/content_json.go |
| C5 | ContentBinary (3) | Yjs/Content/ContentBinary.cs:7-26 | One opaque byte array, length 1, copied out of the buffer. | F:structs.json `binary-and-uint8array-leaf` | internal/yjs/content_binary.go |
| C6 | ContentString (4) | Yjs/Content/ContentString.cs:8-51 | Length is in UTF-16 code units. `GetContent` yields one unit per tick. Splitting a surrogate pair turns both halves into U+FFFD. Writing at an offset writes the tail. | F:structs.json `text-astral`; C#T StructStoreTests.ContentStringSpliceReplacesASplitSurrogatePairWithReplacementCharacters, YDocWriteTests.TextSplitsOnSurrogatePairsLikeYjs, PendingRetentionTests.ADiffStartingInsideAnAstralCharacterStillEncodes | internal/yjs/content_string.go (`[]uint16`, see T2) |
| C7 | ContentEmbed (5) | Yjs/Content/ContentEmbed.cs:9-29 | Raw JSON kept for writing, parsed only on read. | F:structs.json `text-insert-format-embed`; C#T ToDeltaReadsANullEmbed | internal/yjs/content_embed.go |
| C8 | ContentFormat (6) | Yjs/Content/ContentFormat.cs:7-58 | Key + raw JSON, not countable, value parsed once per item (identity matters). `Local` keeps the caller's own object. | F:structs.json `text-insert-format-embed`; scenarios `formatted-text-equal-links-cleanup` | internal/yjs/content_format.go |
| C9 | ContentType (7) | Yjs/Content/ContentType.cs:9-244 | Type ref 0..6. Refs 3 and 5 carry a name. A ref >6 is a format error. | F:structs.json `map-nested-ymap`, `map-nested-yarray`, `xml-fragment-element-text`; C#T StructStoreTests.CreateTypeCoversEveryTypeRef, RefusesWireValuesNoEncoderWrites | internal/yjs/content_type.go |
| C10 | Nested-type delete cascade | Yjs/Content/ContentType.cs:86-106,192-214 | Deletes the whole subtree with an explicit stack. Already-deleted older children are only queued for merging. | F:scenarios.json `cascade-delete-grid`, `cascade-delete-grid-no-gc` [IntegrationTests.DeletingABlockCascadesIntoNestedTypesAndMatchesYjsDeleteSet]; C#T DeepDocumentTests (10 000 levels) | internal/yjs/content_type.go |
| C11 | Nested-type GC | Yjs/Content/ContentType.cs:113-138,217-228 | A collected subtree becomes YGc structs; map chains are walked LEFT from each head. | F:structs.json `gc-struct`, `gc-false-deleted-subtree`; C#T IntegrationTests.ContentGcReplacesDeletedContentAndSubtrees, DeepDocumentTests.CollectingADeeplyNestedChainDoesNotRecursePerLevel | internal/yjs/content_type.go |
| C12 | ContentAny (8) | Yjs/Content/ContentAny.cs:7-58 | A run of Any values, one tick each. | F:structs.json `map-set-any`, `array-run-of-strings`, `number-edges` | internal/yjs/content_any.go |
| C13 | ContentDoc (9) | Yjs/Content/ContentDoc.cs:9-61 | Guid + Any options. null/undefined options are a format error. Read gives back an opaque YSubdoc. | C#T RefusesWireValuesNoEncoderWrites (2 cases), EveryHandBuiltContentRefSurvivesAWriteBack | internal/yjs/content_doc.go |
| C14 | Content.Copy for re-apply | Yjs/Content/YContent.cs:86-89; Integrator.cs:191-196 | Mutable contents are copied so the same DecodedUpdate can be applied again. | C#T IntegrationTests.DuplicateDeliveryIsIdempotent | internal/yjs (copy on `toRuntime`) |

### 1d. Update v1 wire format

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| W1 | Decode: groups | Yjs/UpdateV1Decoder.cs:32-74 | Reads `groups{count, client, clock, structs}` then the delete set. A struct count is never preallocated. | F:structs.json (23) [DecodesEveryStructsGolden]; collab fixtures [DecodesEveryCollabFixture]; F:yrs-compat.json [DecodesEveryYrsEncodedFixture] | internal/yjs/decode.go |
| W2 | Refuse duplicate client group | Yjs/UpdateV1Decoder.cs:46-50 | A client listed twice is a format error (yjs keeps the last one). | F:negative.json `client-listed-twice` (`yjsAccepts`) | internal/yjs/decode.go |
| W3 | Refuse trailing bytes | Yjs/UpdateV1Decoder.cs:67-71 | Bytes after the delete set are a format error, which is also how a v2 update is refused. | F:negative.json `trailing-garbage-after-delete-set`, `v2-update` | internal/yjs/decode.go |
| W4 | No v2 sniff; `00 00` is valid | Yjs/UpdateV1Decoder.cs:14-16 | The empty v1 update decodes fine. | C#T YjsEngineHarnessTests.NodeReplayAppliesAnEmptyUpdateAndReportsNoPending (NODE) | internal/yjs/decode.go |
| W5 | GC (0) and Skip (10) structs | Yjs/UpdateV1Decoder.cs:81-95 | Info 0 → GC with a length. Info 10 → Skip with a RAW varuint length. | F:structs.json `gc-struct`, `skip-struct`; C#T SkipLengthIsARawVarUint | internal/yjs/decode.go |
| W6 | Item header | Yjs/UpdateV1Decoder.cs:98-147 | Origin bit 0x80, rightOrigin 0x40. Parent and parentSub are present only when neither origin is. | C#T ParentIsAbsentWhenAnOriginBitIsSet; F:negative.json `parentsub-bit-without-parent` | internal/yjs/decode.go |
| W7 | Parent info must be 0/1 | Yjs/UpdateV1Decoder.cs:110-126 | 1 is a root name, 0 is a parent id, anything else is a format error. | C#T RefusesWireValuesNoEncoderWrites | internal/yjs/decode.go |
| W8 | Raw info byte kept | Yjs/DecodedUpdate.cs:10-30; YItem.cs:42-48,86 | Keeps the parentSub bit even when an origin hides the bytes, so decode→encode stays byte-identical. | C#T DecodeThenWriteIsByteIdentical, EncoderTests.DecodeThenReencodeIsByteIdenticalWithoutMerging | internal/yjs/item.go `wireParentSubBit` |
| W9 | Group order preserved | Yjs/DecodedUpdate.cs:49-54 | Structs are enumerated in the update's own client-group order, which relies on .NET Dictionary insertion order. | C#T DecodeThenWriteIsByteIdentical (its private ReEncode iterates `Structs`) | internal/yjs/decoded.go (slice of groups, see T1) |
| W10 | ContainsNul | Yjs/DecodedUpdate.cs:67-146 | Reports NUL in root names, parentSubs, text, format keys/JSON, embeds, JSON, type names, guids, Any leaves and keys. It never refuses. | F:any.json `string-nul`, `object-nul-key`; F:structs.json `nul-key-and-value`; C#T ContainsNulSeesKeysValuesAndParentSub, UpdateInspectorTests.OkForTheNulCanaryAndReportsNul | internal/yjs/decoded.go |
| W11 | MaxNestingDepth | Yjs/DecodedUpdate.cs:148-219 | Deepest Any nesting in ContentAny and ContentDoc only. Raw JSON is not measured. | C#T UpdateInspectorTests.TooDeepPastTheCap | internal/yjs/decoded.go |
| W12 | UpdateInspector verdicts | Yjs/UpdateInspector.cs:3-50 | Ok / Malformed(reason) / TooDeep (depth > 256 by default). Decodes once and hands the result to the doc. | F:negative.json [UpdateInspectorTests.MalformedForEveryNegative]; collab fixtures [OkForEveryCollabFixture] | internal/yjs/inspect.go |
| W13 | Delete set read | Yjs/DeleteSet.cs:27-60 | A zero-range client is dropped. A client listed twice APPENDS (unlike struct groups). | C#T DeleteSetSortsMergesAndWritesClientsDescending; F:scenarios.json `delete-set-only-update` | internal/yjs/deleteset.go |
| W14 | Delete set write | Yjs/DeleteSet.cs:62-81 | Clients in descending id order, each range's clock written absolutely. | C#T DeleteSetSortsMergesAndWritesClientsDescending | internal/yjs/deleteset.go |
| W15 | SortAndMerge | Yjs/DeleteSet.cs:173-208 | Sorts by clock and folds touching or overlapping ranges in place. | C#T DeleteSetTests.AddThenSortAndMergeFoldsTouchingRanges | internal/yjs/deleteset.go |
| W16 | State vector decode | Yjs/StateVector.cs:24-49 | Refuses a duplicate client and trailing bytes. | C#T StateVectorTests.DecodeRefusesTrailingBytes, StateVectorDecodeRoundTrips | internal/yjs/statevector.go |
| W17 | State vector encode | Yjs/StateVector.cs:51-64 | Clients in descending id order. The empty vector is `00`. | F:scenarios.json `expect.sv`, fuzz `expect.sv` [EncoderTests.EncodedStateVectorMatchesEveryScenarioGolden]; C#T StateVectorEncodesClientsDescending, EmptyStateVectorIsOneZeroByte | internal/yjs/statevector.go |
| W18 | Item write | Yjs/YItem.cs:74-109 | At an offset the origin is re-pointed to the tick before. Parent and parentSub are written only when there is no origin. | F:scenarios.json engineWrites bytes [EveryScenarioMatchesTheYjsOracle]; C#T ContentWritesOnlyTheTailAtAnOffset | internal/yjs/item.go |
| W19 | Parent write forms | Yjs/YItem.cs:433-464 | A resolved root writes its name, a nested type writes its item id, and a parked item writes the wire spelling as it arrived. | C#T EncoderTests.PendingWithGapsEncodesSkipsReadableByYjs (NODE) | internal/yjs/item.go |
| W20 | GC / Skip write | Yjs/YGc.cs:13-19, YSkip.cs:16-22 | `0, len-offset` / `10, len-offset`. | F:structs.json `gc-struct`, `skip-struct` | internal/yjs/structs.go |
| W21 | WriteRuns | Yjs/UpdateV1Encoder.cs:67-85 | Per run: count, client, clock (first struct's clock plus its offset), then the structs. | C#T EncoderTests (all) | internal/yjs/encode.go |

### 1e. Store, integration, pending

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| S1 | GetState / GetStateVector | Yjs/StructStore.cs:25-50 | Next clock per client. Parked structs are excluded. | C#T StructStoreTests.GetStateIsZeroForAnUnknownClient; F:scenarios `expect.sv` | internal/yjs/store.go |
| S2 | FindIndex | Yjs/StructStore.cs:58-88 | Bisects a contiguous run. A missing clock is an engine error (InvalidOperation). | C#T FindLocatesAStructByAnyClockInsideIt | internal/yjs/store.go |
| S3 | Clean start / clean end | Yjs/StructStore.cs:94-134 | Splits the covering item. A GC is returned whole. | C#T CleanStartSplitsAnItemAndKeepsLastIdArithmetic, CleanEndNeverSplitsAGc | internal/yjs/store.go |
| S4 | AddStruct contiguity | Yjs/StructStore.cs:172-195 | A client's first struct may start at any clock. A later gap is refused, and no empty list is ever left behind. | C#T AddStructRejectsAClockGap, AddStructNeverLeavesAnEmptyClientList | internal/yjs/store.go |
| S5 | SplitAt | Yjs/YItem.cs:503-549 | Cuts an item. The right half takes origin `clock-1` and becomes the map head when it is the last one. | C#T SplitRepointsTheMapHeadWhenSplittingTheLastValue; F:structs.json `array-run-split-by-insert` | internal/yjs/item.go |
| S6 | GetMissing (3 checks) | Yjs/YItem.cs:121-198 | Checks origin, rightOrigin and parent against state, the same client included (stricter than yjs). It mutates only once all three pass. A GC neighbour drops the parent. | C#T HostileUpdateTests.AnUnreachableSameClientDependencyParksInsteadOfThrowing (Theory, 4 InlineData) | internal/yjs/item.go |
| S7 | YATA integrate | Yjs/YItem.cs:205-287 | Trims the offset, runs the conflict scan, links in, replaces the map head (the left value dies), keeps Length, then content integrate, then deletes if the parent is deleted. | F:scenarios.json `concurrent-*` [ConcurrentMapSetOnSameKeyResolvesLikeYjs, ConcurrentArrayInsertAtSamePositionFollowsYata]; F:fuzz/ 50 seeds [FuzzCorpusTests.EverySeedMatchesTheYjsOracleAtEveryStep] | internal/yjs/item.go |
| S8 | Conflict scan | Yjs/YItem.cs:383-426 | yjs cases 1 and 2. Ties break by lower client id. | same as S7 | internal/yjs/item.go |
| S9 | Item delete | Yjs/YItem.cs:294-335 | Adjusts the parent's Length BEFORE marking deleted, then records the range. | F:scenarios `delete-*` | internal/yjs/item.go |
| S10 | Item GC | Yjs/YItem.cs:342-375 | A live item is refused. Inside a collected parent it becomes YGc, else its content becomes a tombstone. | C#T ContentGcReplacesDeletedContentAndSubtrees | internal/yjs/item.go |
| S11 | Integrator stack machine | Yjs/Integrator.cs:57-164 | Walks clients highest id first, follows dependencies across clients, parks only real absences. | F:scenarios `out-of-order-delivery`, `pending-delete-set`, `engine-writes-while-pending` [OutOfOrderDeliveryRetainsPendingThenConverges, PendingRetriesWhenTheDependencyArrives, SameClientGapParksTheTail] | internal/yjs/integrator.go |
| S12 | Duplicate run drop | Yjs/Integrator.cs:130-137 | A run whose offset ≥ length is silently dropped. | F:scenarios `duplicate-delivery` [DuplicateDeliveryIsIdempotent] | internal/yjs/integrator.go |
| S13 | Park drops Skips | Yjs/Integrator.cs:235-272 | Parks the stack plus each client's unread tail, minus Skips. | C#T PendingRetentionTests.AParkedSkipDoesNotSwallowContentThatArrivesLater | internal/yjs/integrator.go |
| S14 | Delete set apply | Yjs/DeleteSet.cs:105-167 | Splits both edges. A range past the state parks whole; a range straddling it parks only the tail. | C#T DeleteSetTests.DeleteRangeSplitsBothEdgesAndParksTheUnappliableTail, AWholeRangePastTheStateIsParked | internal/yjs/deleteset.go |
| S15 | ApplyDecoded + retry | Yjs/YDoc.cs:383-451 | Merges new rests into pending, applies the new and the parked delete sets, then retries the parked structs inside the SAME transaction. | F:scenarios pending cases; C#T PendingRetriesWhenTheDependencyArrives | internal/yjs/doc_apply.go |
| S16 | MergeParked | Yjs/YDoc.cs:458-493 | Union per client by clock. Drops a struct only when one kept before it covers it fully. | C#T ParkedCoverageTests.AnArrivalThatWidensOverlappingParkedRunsIsAChange | internal/yjs/doc_apply.go |
| S17 | Pending in diffs | Yjs/PendingNormalizer.cs:30-184 | AllRuns folds parked structs after the integrated tail: holes become Skips, overlaps are written at an offset, one group per client, descending. | C#T EncoderTests.PendingWithGapsEncodesSkipsReadableByYjs (NODE: readable only) | internal/yjs/pending.go. Byte parity: NONE (P1) |
| S18 | Oversized Skip split | Yjs/PendingNormalizer.cs:156-170 | A gap larger than int.MaxValue is written as several consecutive Skips. | C#T PendingRetentionTests.AGapWiderThanAnIntIsWrittenAsSeveralSkips | internal/yjs/pending.go |
| S19 | StoreRuns start clocks | Yjs/PendingNormalizer.cs:86-132 | Two passes, like writeClientsStructs: a known client from its clock, an unknown client from 0, a level client left out. | C#T DiffAgainstAPeerVectorIsAcceptedByYjs (NODE) | internal/yjs/pending.go |

### 1f. Document API (the collab seam)

| # | Feature | C# location | What it does | Oracle | Go target |
|---|---|---|---|---|---|
| D1 | `new YDoc(clientId?)` | Yjs/YDoc.cs:16-20,204-207 | Pinned or random uint32 client id. | scenario runner pins `docs[engine]` (ScenarioSupport.cs:663) | internal/yjs/doc.go `NewDoc(opts)` (`crypto/rand`) |
| D2 | `Gc` option | Yjs/YDoc.cs:44 | Content GC, default true. | F:scenarios `gc` flag (`cascade-delete-grid-no-gc`) | internal/yjs/doc.go |
| D3 | ClientId re-mint | Yjs/YDoc.cs:622-626 | A remote txn that advances our own client id mints a new id. | C#T IntegrationTests.RemoteAdvanceOfTheLocalClockRegeneratesTheClientId | internal/yjs/doc.go. Re-mint condition is pinned only by C#T, so proposed: NONE (P1 records ClientId changes) |
| D4 | AdoptClientId | Yjs/YDoc.cs:36-39 | Writes from now on under a given id (used after a state load). | NONE | internal/yjs/doc.go |
| D5 | Get / GetMap / GetArray / GetText | Yjs/YDoc.cs:63-91,560-604 | Creates an untyped placeholder on first mention and upgrades it in place, re-pointing list and map-chain parents. A different kind throws with yjs's own message. | F:structs/scenarios `roots` (renderer materialises roots) | internal/yjs/doc.go |
| D6 | EncodeStateVector | Yjs/YDoc.cs:93-96 | Integrated state only. | F:`expect.sv` everywhere | internal/yjs/doc.go |
| D7 | EncodeStateAsUpdate(sv) | Yjs/YDoc.cs:107-118,179-202 | Diff + parked structs + the WHOLE delete history + parked deletes. An empty span means "seen nothing". | C#T DiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJson (NODE, JSON only) | internal/yjs/doc.go. Byte parity: NONE (P1) |
| D8 | ApplyUpdate(bytes) | Yjs/YDoc.cs:125-139 | Malformed input → `Malformed` + reason, doc untouched. | C#T MalformedBytesReportMalformedAndLeaveTheDocUntouched | internal/yjs/doc.go |
| D9 | ApplyUpdate(decoded) | Yjs/YDoc.cs:142-162 | One remote txn per update. | all scenario/fuzz `deliver` steps | internal/yjs/doc.go |
| D10 | ApplyResult.Changed | Yjs/ApplyResult.cs:10-47; YDoc.cs:298-375 | True when the update integrated a struct, deleted something new, or grew the parked union (structs union + deletes union, added). | C#T ParkedCoverageTests (3) | internal/yjs/result.go. Cross-language: NONE (P1) |
| D11 | ApplyResult.PendingRemains / HasPending | Yjs/YDoc.cs:47 | Health signal: parked structs or deletes exist. | F:`expect.hasPending` (scenarios, fuzz, structs) | internal/yjs/doc.go |
| D12 | Transact + nesting | Yjs/YDoc.cs:170-173,230-262 | Local txn. A nested call joins the open one and returns null. Only the outermost emits. | C#T YDocWriteTests.OneTransactionEmitsOneUpdateReadableByYjs, NoChangeEmitsNothing | internal/yjs/doc.go `Transact(func(*Txn)) []byte` |
| D13 | Cleanup / emit | Yjs/YDoc.cs:612-636; UpdateV1Encoder.cs:18-38 | SortAndMerge, after state, GC, re-mint, encode, raise `UpdateEmitted(update, local)`. Null when nothing moved. | F:engineWrites bytes; C#T ApplyEmitsTheAppliedChangeOnly, NothingChangedEmitsNothing | internal/yjs/doc.go (callback slice; see T12) |
| D14 | YUpdateEvent.Local | Yjs/YUpdateEvent.cs:8; YTransaction.cs:28-32 | False for a remote apply, even inside a local txn. | NONE | internal/yjs/doc.go |
| D15 | CollectDeleted | Yjs/YDoc.cs:642-666 | Walks the txn's delete ranges backwards and collects deleted, non-Keep items. | F:structs `gc-struct`; C#T ContentGcReplacesDeletedContentAndSubtrees | internal/yjs/doc.go |
| D16 | MapSet / Map.Set | Yjs/YAbstractType.cs:111-119,299-310; YMap.cs:72-76 | One tick per value. undefined is allowed. byte[] → ContentBinary, a type → ContentType. | F:scenarios `map.set` engineWrites; C#T SetPacksEveryPrimitiveAsAnyOfLengthOne, SetAdmitsUndefined | internal/yjs/map.go |
| D17 | Map.Remove / Clear | Yjs/YMap.cs:79-96 | Deletes the head. Absent or already-deleted keys are a no-op. | F:scenarios `map.delete` | internal/yjs/map.go |
| D18 | Map.TryGet / Keys / Count | Yjs/YMap.cs:45-69 | Last element of the head's content. A slot with no value reads undefined, not a throw. | C#T MapTryGetReadsTheLastValueOfTheHeadAndSkipsDeleted, HostileUpdateTests.AMapKeyWithNoValueReadsAsUndefined | internal/yjs/map.go (ordered keys, T1) |
| D19 | Array.Insert packing | Yjs/YAbstractType.cs:136-234 | Consecutive Anys make one item. byte[] or a type flushes the run. undefined and BigInt are refused. | F:scenarios `array.insert`; C#T InsertPacksConsecutiveAnysIntoOneItem, InsertOfATypeFlushesBothSides, InsertRejectsUndefinedAndBigIntLikeYjs | internal/yjs/array.go |
| D20 | Array.Delete | Yjs/YAbstractType.cs:240-292 | Splits at both ends. Running past the end throws. | C#T DeleteFromArraySplitsARun | internal/yjs/array.go |
| D21 | Array.Get / Enumerate / Count | Yjs/YArray.cs:30-73 | Live countable values, splatted per tick. | C#T ArrayEnumerateSkipsDeletedAndNonCountable | internal/yjs/array.go |
| D22 | Prelim types | Yjs/YMap.cs:25-43,98-108; YArray.cs:20-24,92-98; YTextBase.cs:212-243 | Seeded at construction and written when their item integrates. A text queues its writes. | C#T PrelimMapIntegratesWithItsParent, QueuedWritesAreCheckedWhenMade; scenario `formatted-text-prelim-queue` | internal/yjs/{map,array,text}.go |
| D23 | RequireAttached | Yjs/YAbstractType.cs:72-79 | Writing to a detached Map or Array throws. | C#T AttachedTextNeedsATransaction | internal/yjs/types.go |
| D24 | Text.Insert / InsertEmbed / Format / Delete | Yjs/YTextBase.cs:48-144,328-541 | Line-for-line yjs. Null attrs inherit on insert but mean "none" on embed. Marks go in JS key order. | F:scenarios `text.*` engineWrites bytes; C#T FormattedWritesReadBackInYjs (NODE) | internal/yjs/text.go |
| D25 | CleanupFormattingGap | Yjs/YTextBase.cs:550-616 | Deletes stranded marks, comparing with `===`. The after-txn format cleanup is NOT ported. | F:scenarios `formatted-text-remote-cleanup` (`diverges`/`noCleanup` oracle) | internal/yjs/text.go |
| D26 | ToDelta / ToString | Yjs/YTextBase.cs:37-40,151-210 | Runs with marks in force. Every mark ends a run. A `ychange` mark is dropped at the next string. | C#T ToDeltaReadsAPeersFormatsAndEmbeds, TextToStringSkipsFormatsAndEmbeds | internal/yjs/text.go |
| D27 | EqualAttrs / StrictEquals | Yjs/YTextBase.cs:640-673 | `===`: scalars by value (NaN ≠ NaN, -0 == 0), objects by identity, equalFlat one level deep. | scenario `formatted-text-equal-links-cleanup` | internal/yjs/text.go (pointer identity, T7) |
| D28 | Xml types | Yjs/YXmlTypes.cs:7-38 | Placeholders that integrate and re-encode. XmlText is a text, not a YText. | F:structs.json `xml-fragment-element-text` | internal/yjs/xml.go |

### 1g. Limits (one place)

| # | Limit | C# location | Value | Oracle | Go target |
|---|---|---|---|---|---|
| X1 | varuint/varint max | Lib0Reader.cs:17,22-23 | 2^53-1, 8 bytes each | F:varint.json, negative.json | internal/lib0 |
| X2 | Any decode depth | AnyCodec.cs:20,200 | 4096 levels (4097 refused). Earlier refusal possible via stack probe. | C#T NestedDepthPast4096Rejects | internal/lib0 |
| X3 | Raw JSON depth | YContent.cs:25 | 512 ok, 513 refused (probed §5) | C#T depth 100 only. Boundary: NONE | internal/yjs |
| X4 | Inspector depth | UpdateInspector.cs:25 | 256 (Any/ContentDoc only) | C#T TooDeepPastTheCap | internal/yjs |
| X5 | Lengths / counts | YContent.cs:154-162 | ≤ int.MaxValue | C#T RefusesWireValuesNoEncoderWrites | internal/yjs |
| X6 | Skip span | PendingNormalizer.cs:165 | ≤ int.MaxValue per Skip | C#T AGapWiderThanAnIntIsWrittenAsSeveralSkips | internal/yjs |

## 2. How Go consumes the same fixtures

C# loader (`Blok.Server.Tests/Yjs/YjsEngineFixtures.cs:14-108`):
- walks up from `AppContext.BaseDirectory` (at most 12 levels) to the directory holding `packages/server/dotnet/Blok.Server.slnx`;
- joins `test/unit/server-conformance/fixtures/yjs-engine`;
- reads files with `JsonNode.Parse`;
- reads `cases` arrays;
- reads `manifest.json` `files[].path`.
- The fuzz seeds are enumerated by `fuzz/seed-*.json` in Ordinal order (`ScenarioSupport.cs:72-80`).
- The csproj copies no yjs-engine file. Only `tickets.json` and two version-history files are linked (`Blok.Server.Tests.csproj:29-36`).

Go equivalent, `internal/yjs/yjstest/fixtures.go`:
1. `go test` runs with cwd = the package directory. Walk up with `os.Getwd()` until `packages/server/go.mod` exists one level below, or until `test/unit/server-conformance` exists. Join the same relative root. Allow an env override such as `BLOK_REPO_ROOT` for CI sandboxes.
2. Port `LoaderFindsEveryManifestedFile` (`YjsEngineHarnessTests.cs:14-23`): every manifest path exists and parses. Also add the manifest's `bytes`/`sha256` check, which C# does not do (it only checks that each file exists and parses).
3. Decode case files with `json.Decoder` + `UseNumber()` into an **order-preserving** node tree built from `Decoder.Token()`. A plain `map[string]any` loses key order. The any.json `object-order` case (`{"b":1,"a":2}`) must encode back byte-for-byte, and the `$u8`, `$bigint`, `$num`, `$undefined` sentinel objects must be recognised before generic objects.
4. Lone surrogates in fixture JSON: `grep -oiE '\\ud[89a-f][0-9a-f]{2}'` over every fixture finds only PAIRED escapes, all in `yrs-compat.json` (e.g. `😀`). So `encoding/json` string decoding is safe for today's files. The loader should still fail loudly on a lone `\udXXX`, because `encoding/json` silently turns it into U+FFFD (probed, §5).
5. Bytes are standard base64 (`update`, `bytes`, `sv`, `noCleanupUpdate`).
6. Sentinel vocabulary (from `scripts/yjs-engine-render.mjs:22-70` and `JsonRenderer.cs:53-124`):
   - `{"$num":"NaN"|"-0"|"Infinity"|"-Infinity"}`
   - `{"$undefined":true}`
   - `{"$bigint":"<decimal>"}`
   - `{"$u8":"<base64>"}`
   - `{"$text":<delta>}`
   - `{"$xml":"<string>"}`
7. Scenario runner, ported from `ScenarioSupport.cs:648-849`:
   - The doc is created with `docs[engine]` as its client id and `gc` from the case.
   - Step kinds: `op` (applied when `deliver` contains the engine), `deliver` (`update` or `updateOf` an earlier id), `engineWrites` (engine runs `op` and its bytes must EQUAL the yjs mirror `update`, or `noCleanupUpdate` in `segments` cases), `expect`.
   - Op names: `map.set`, `map.delete`, `array.insert`, `array.delete`, `text.insert`, `text.format`, `text.embed`, `text.delete`, `yjs.cleanup` (counted with a node one-liner over scenarios.json).
   - `expect` fields: `sv` (bytes equal), `hasPending`, `json` (canonical compare; `diverges` means it must NOT equal; `segments` merges text runs first), `noCleanup` {sv, json}, `jsonSha256`.
   - Port the `Checks` counter: a run that checks nothing must fail.
8. `jsonSha256` = sha256 hex of `JSON.stringify(canonicalize(value))` (`scripts/generate-yjs-engine-fixtures.mjs:99-118`). Go must sort keys by **UTF-16 code units**, not by bytes (T4), and must write numbers with JS Number::toString (J2). C#'s port of this is `ScenarioSupport.cs:409-500`.
9. NodeReplay (`NodeReplay.cs`): spawn `node scripts/replay-yjs-update.mjs`, write `{"roots":{...},"updates":[b64...],"stateVectorFor":b64|null}` to stdin, read `{"json","sv","hasPending","diff"}` from stdout, with a 30 s timeout (`NodeReplay.cs:21`). These tests need it:
   - `YjsEngineHarnessTests.NodeReplayAppliesAnEmptyUpdateAndReportsNoPending`
   - `EncoderTests`: `DiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJson`, `DiffAgainstAPeerVectorIsAcceptedByYjs`, `PendingWithGapsEncodesSkipsReadableByYjs`, `TransactionEmitsOneUpdateThatReplaysIntoYjs`, `ForeignTextEmbedsAndFormatsSurviveTheOracle`
   - `YDocWriteTests`: `OneTransactionEmitsOneUpdateReadableByYjs`, `TextRoundTripsThroughNode`
   - `YTextFormattingTests.FormattedWritesReadBackInYjs`
   - The Go CI job needs node + `yarn` deps, as the .NET job already has (`NodeReplay.cs:14-16`).
10. `yrs-compat.json` (20 cases: `name`, `update`, `canonical`): its export oracle is the collab converter (`YrsCompatCorpusTests.CapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJson`). The collab ledger owns that. This area only needs the decode side (`DecodesEveryYrsEncodedFixture`, `ReplaysEveryYrsEncodedFixture`).

## 3. Proposed new shared fixtures (for the NONE rows)

The yjs fixtures prove that output is "readable by yjs". They do not prove Go bytes == C# bytes, and the room compares bytes directly (`StateVector.cs:6-8`). The proposal is a C#-captured golden set, built the same way `yrs-compat.json` was captured from YDotNet. Both languages run it.

| Id | Fixture | Captured by | Covers rows |
|---|---|---|---|
| P1 | `fixtures/yjs-engine/csharp-capture.json` (outside the manifest, like yrs-compat) | A C# test tool replays every scenario and fuzz seed. After each step it records: `sv`, `fullState = EncodeStateAsUpdate()`, `diffAgainstEachPeer`, the emitted update bytes, `ApplyResult {outcome, pendingRemains, changed}`, and whether ClientId changed. | S17, S19, D3, D7, D10, D14 |
| P2 | `negative.json` gains `limits` cases | generator | JSON depth 512/513 (X3), Any depth 4096/4097 (X2), length 2^31-1 / 2^31 (X5), Skip > int.MaxValue (S18) |
| P3 | `fixtures/yjs-engine/jsjson.json` | generator, from real `JSON.stringify` / `JSON.parse` | J1-J5: number formatting table (1e21, 1e-7, 5e-324, 2^53, -0), escape table (all controls, lone surrogates), key order with array-index keys, duplicate keys, `\ud800` parse → stringify round trip |
| P4 | Add to P1: an `adoptClientId` step kind | C# tool | D4 |
| P5 | Add to P1: an apply-inside-a-local-txn case | C# tool | D14 |
| P6 | A Go/C# Any write-stack test is not needed | n/a | L18 (Go uses a depth counter; mark as an equivalent, intentional difference) |

Refusal reason TEXT is not part of parity: CollabRoom only logs it (`Collab/CollabRoom.cs:2364-2368`). Parity is the refusal kind (the negative.json `reason` slug).

## 4. C# unit tests needing Go equivalents

| File | Facts | Theories | InlineData | Notes |
|---|---|---|---|---|
| Lib0CodecTests.cs | 7 | 4 | 0 | varint.json goldens |
| AnyCodecTests.cs | 7 | 2 | 0 | any.json goldens |
| UpdateV1DecoderTests.cs | 9 | 6 | 5 | structs, negative, yrs, collab fixtures |
| UpdateInspectorTests.cs | 2 | 2 | 0 | negative + collab fixtures |
| StateVectorTests.cs | 3 | 2 | 0 | scenarios sv |
| DeleteSetTests.cs | 3 | 0 | 0 | |
| StructStoreTests.cs | 12 | 0 | 0 | |
| IntegrationTests.cs | 11 | 3 | 0 | scenarios, structs, yrs |
| EncoderTests.cs | 5 | 4 | 0 | NODE |
| YDocWriteTests.cs | 12 | 1 | 7 | NODE |
| YTextFormattingTests.cs | 11 | 1 | 20 | NODE |
| HostileUpdateTests.cs | 1 | 2 | 4 | |
| PendingRetentionTests.cs | 3 | 0 | 0 | |
| ParkedCoverageTests.cs | 3 | 0 | 0 | |
| DeepDocumentTests.cs | 3 | 0 | 0 | 10 000 levels |
| FuzzCorpusTests.cs | 1 | 1 | 0 | 50 seeds |
| YjsEngineHarnessTests.cs | 2 | 0 | 0 | loader + NODE |
| YrsCompatCorpusTests.cs | 2 | 0 | 0 | depends on the collab converter |
| **Total** | **97** | **28** | **36** | counted with `grep -c '\[Fact'`, `'\[Theory'`, `InlineData` |

Harness to port: `ScenarioSupport.cs` 849, `JsonRenderer.cs` 339, `NodeReplay.cs` 136, `YjsEngineFixtures.cs` 109 (1433 raw lines).

## 5. Probes (run this session)

**Probe 1: Go reads the fixture format.** Source: `/private/tmp/claude-501/-Users-jackuait-Packages-blok/1972ea3d-88af-4e14-951b-0edd9367e8e3/scratchpad/yjs-lib0/probe/main.go`. It is a Go port of `Lib0Reader.ReadVarUint`/`ReadVarInt`. Command: `go run . <repo>/test/unit/server-conformance/fixtures/yjs-engine`. Output:

```
map-set-any: 16 bytes groups=1 structs=1 client=1000 clock=0 info=0x28 contentRef=8
map-nested-ymap: 23 bytes groups=1 structs=2 client=1000 clock=0 info=0x27 contentRef=7
map-nested-yarray: 23 bytes groups=1 structs=2 client=1000 clock=0 info=0x27 contentRef=7
varuint goldens ok=19 sentinel=0 total=19
varint sentinel value {
        "$num": "-0"
      } bytes QA== -> got -0 signbit=true err=<nil>
varint goldens ok=21 sentinel=1 total=22
```

What this shows:
- client 1000 is `manifest.json` `clientIds.A`;
- info 0x28 = parentSub bit + ref 8 (ContentAny), which matches structs.json `map-set-any`'s `decoded` (`content.ref: 8`, `parentSub: "k"`);
- all 41 varint goldens decode, -0 included.

**Probe 2: Go stdlib differences.** Source: `.../scratchpad/yjs-lib0/jsonprobe/main.go` and `u_test.go`. Output (abridged, values exact):

```
json.Valid("\ud800") = true ; json.Valid({"a":1,"a":2}) = true ; json.Valid(1e999) = true
json.Valid(depth-512) = true ; json.Valid(depth-513) = true ; json.Valid(depth-10001) = false
Unmarshal lone surrogate -> "�" (bytes ef bf bd)
FormatFloat 1e21: 1e+21  1e-7: 1e-07  123456789012345680000: 1.2345678901234568e+20
Go NaN bits 7ff8000000000001
sort.Strings (UTF-8 byte order): ["～" "😀"]   UTF-16 units: emoji [d83d de00], fullwidth [ff5e]
utf8.Valid CESU surrogate ED A0 80: false ; overlong C0 80: false ; NUL: true
utf16.Decode lone high -> 61 ef bf bd
```

**Probe 3: .NET behaviour.** Source: `.../scratchpad/yjs-lib0/csprobe/probe.cs`, run with `dotnet run probe.cs`. Output:

```
JsonDocument depth 512: ok
JsonDocument depth 513: JsonReaderException
JsonDocument {"a":1,"a":2}: ok; JsonNode: ok -> {"a":1,"a":2}
JsonDocument "\ud800": ok; JsonNode: InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
JsonDocument 1e999: ok; JsonNode: ok -> 1e999
NaN bits fff8000000000000
```

## 6. Traps (a port would get these wrong silently)

| # | Trap | Evidence | What Go must do |
|---|---|---|---|
| T1 | **C# relies on Dictionary insertion order; Go maps iterate at random.** The decoded group order (the re-encode is byte-identical only because of it), map keys (`YMap.Keys`, the export order the collab converter sees), the GetTyped re-point and DeleteSet client order all depend on it. | DecodedUpdate.cs:49-54 ("Nothing is ever removed from the dictionary, which is what keeps its enumeration in the update's own order"); YMap.cs:45-46; YDoc.cs:582-590; DeleteSet.cs:16,111 | Ordered slices plus an index map. Never `range` over a Go map where order can reach bytes or exports. |
| T2 | **Text is UTF-16, Go strings are UTF-8.** Clock lengths are UTF-16 units. A split pair becomes U+FFFD on both halves. A diff can start inside an astral char, and that half must write EF BF BD. | ContentString.cs:4-6,12,25-40; Lib0Writer.cs:17-26; C#T ADiffStartingInsideAnAstralCharacterStillEncodes; probe 2 (`utf16.Decode` gives EF BF BD) | Store ContentString as `[]uint16`. Encode with `utf16.Decode` → UTF-8. Read with strict `utf8.Valid` (probe 2: it rejects CESU and overlong, accepts NUL). |
| T3 | **NaN bits.** Go `math.NaN()` = 0x7FF8000000000001 and .NET `double.NaN` = 0xFFF8000000000000. yjs writes 0x7FF8000000000000. | probes 2 and 3; AnyCodec.cs:38-40 | Write the constant bits for any NaN. |
| T4 | **Key sort order for the sha256 oracle.** JS `sort()` and C# `StringComparer.Ordinal` compare UTF-16 units. Go `sort.Strings` compares bytes, so U+FF5E and an emoji swap. | generate-yjs-engine-fixtures.mjs:107; ScenarioSupport.cs:427; probe 2 | Compare by `utf16.Encode([]rune(s))`. |
| T5 | **Number formatting.** `strconv` 'g' gives `1e-07` and `1.2345678901234568e+20`, where JS gives `1e-7` and `123456789012345680000`. | probe 2; JsJson.cs:160-216 | Port FormatNumber using `strconv.FormatFloat(v,'e',-1,64)` digits, then apply JS placement. |
| T6 | **JSON depth.** C# refuses raw JSON at depth 513, but Go `json.Valid` accepts it (and only refuses past 10000). Refusing differently means one server persists a struct the other drops. | probes 2 and 3; YContent.cs:25 | Run a depth-counting validator with max 512 before (or instead of) `json.Valid`. |
| T7 | **`===` identity.** CleanupFormattingGap and EqualAttrs compare objects by reference, and a ContentFormat value is parsed ONCE per item. | ContentFormat.cs:23-40; YTextBase.cs:640-660 | `*lib0.Object` / `*lib0.Array` pointers; cache the parsed value on the content. Never deep-compare there. |
| T8 | **Lone-surrogate strings in JSON values.** JsJson.Parse keeps `\ud800` as a lone UTF-16 unit and Stringify writes it back as `\ud800`. A Go `string` from `encoding/json` turns it into U+FFFD, so the bytes change on re-stringify. | JsJson.cs:31-36,408-411,262-268; probe 2 | JS string values in Go = UTF-16 (`[]uint16`) or WTF-8. Decide once, in `internal/lib0`. |
| T9 | **The Any depth refusal is environment-dependent in C#.** `TryEnsureSufficientExecutionStack` may refuse below 4096, and the comment says 4096 frames do not fit in 1 MB. Only 256 (pass) and 4097 (fail) are pinned. | AnyCodec.cs:15-20,206-210; AnyCodecTests.cs:135-147 | Go: a counter at 4096 exactly. Record it as a known benign difference, or pin C# with P2. UNVERIFIED where C# actually stops. |
| T10 | **Strictness beyond yjs.** Refusals real yjs does not make: duplicate client groups (struct section only), trailing bytes, parent info ∉ {0,1}, type ref >6, length > int.MaxValue, null/undefined subdoc options, non-JSON refs 2/5/6. But a delete-set client listed twice APPENDS and zero-range clients are dropped. | UpdateV1Decoder.cs:7-12,46-50,67-71; DeleteSet.cs:37-47; ContentDoc.cs:48-57; negative.json `yjsAccepts` | Copy exactly, including the asymmetry. |
| T11 | **The same-client dependency check is stricter than yjs.** Origin, rightOrigin and parent are checked against store state even for the item's own client, so dishonest bytes park instead of throwing mid-integration. | YItem.cs:126-147; HostileUpdateTests.cs:17-35 | Keep all three checks. Mutate only after they pass. |
| T12 | **An engine exception mid-apply is caught by the room.** `ApplyRemoteLocked` catches `Exception` after `ApplyUpdate(decoded)`, and the doc may already be half-changed. `InvalidOperationException` is thrown from FindIndex, AddStruct and the parent checks. | Collab/CollabRoom.cs:2360-2384; StructStore.cs:86-87,189-191; YItem.cs:236-241 | Go: return `error` from Apply, plus `recover()` at the room boundary. Never let a panic kill the process (C# relies on the CLR turning these into exceptions). |
| T13 | **Changed must never be a false FALSE.** The parked measure is two unions, ADDED. A length sum or a reference test both gave false FALSEs, and a false FALSE means the update is applied but neither journalled nor relayed. | ApplyResult.cs:35-44; YDoc.cs:264-342 | Port `ParkedCoverage` exactly; test it with P1. |
| T14 | **Parked Skips must be dropped** both when parking and when building diffs. Keeping one makes later real content for those clocks look like a duplicate. | Integrator.cs:249-260; PendingNormalizer.cs:186-200 | Copy both filters. |
| T15 | **A Skip larger than int.MaxValue** is split into several Skips, never refused. Refusing it once broke every sync answer for a room's life. | PendingNormalizer.cs:156-170 | Copy. |
| T16 | **Unstable sort ties.** `List.Sort` in `MergeParked` and `ParkedByClient` can order two parked structs with the same clock differently, and `MergeParked` keeps or drops by that order. | YDoc.cs:473-487; PendingNormalizer.cs:217 | UNVERIFIED whether equal-clock parked structs can exist. Go: `slices.SortStableFunc`. If P1 shows a byte difference, add a length tiebreak in BOTH languages. |
| T17 | **JsonNode vs JsonDocument mismatch: a C# latent defect.** `ContentJson.GetContent` and `ContentEmbed.GetContent` read with `JsonNode`, which throws on a lone-surrogate payload that the decoder accepted. Probe 3: `InvalidOperationException ... missing low surrogate` on read. `ToDelta` uses `JsJson.Parse` and is safe. | ContentJson.cs:26-33; ContentEmbed.cs:20-23; YContent.cs:119-124; probe 3 | Needs a user decision: fix C# (use JsJson.Parse), or have Go reproduce the throw. Recommend fixing C# first, with a shared case in P3. |
| T18 | **The parentSub bit without bytes.** An origin suppresses the parentSub bytes but yjs still sets the bit. SplitAt does not copy `WireParentSubBit`, which is harmless because the right half always has an origin and its ParentSub is inherited. | YItem.cs:86,513-526; DecodedUpdate.cs:13-19 | Keep a separate `wireParentSubBit`. Rebuild the bit as `ParentSub != nil || wireBit`. |
| T19 | **Ordered-map semantics differ by structure.** AnyObject: a re-add keeps the first position. OrderedDictionary for current attributes: Remove then set moves the key to the END (JS Map). The KeyOrder indexes-first rule is applied only in `InsertAttributes` and `Stringify`. | AnyObject.cs:20-33; YTextBase.cs:459,622-633; JsJson.cs:110 | Two ordered-map types, or one with explicit semantics per call site. |
| T20 | **BigInt is decode-only.** List insert refuses it, and `MapContent` accepts only null/bool/double/string/object/array/undefined/byte[]/type, so a BigInt reaches the doc only from a peer. Re-encoding uses `(long)`, which throws past int64. | YAbstractType.cs:213,299-310; Lib0Writer.cs:110; manifest `bigintNote` | Go: `lib0.BigInt int64`. JSON export uses the `$bigint` sentinel. |
| T21 | **Client id width.** C# mints a uint32 but stores a ulong, and reads 53-bit ids off the wire. | YDoc.cs:29,204-207; YId.cs:5-7 | `uint64` ids, `uint32` mint. |
| T22 | **Float32 tag.** 2^31 and Infinity write as float32 (tag 124) because they round-trip. `-2^31` too (it is outside the varint range of ±(2^31-1)). | AnyCodec.cs:149-163; any.json `pos-2pow31`, `neg-2pow31`; probe 2 (`float64(float32(2^31))==2^31`) | `float64(float32(x)) == x`, with NaN handled first. |
| T23 | **Nested-type cascade and GC use explicit stacks** (10 000-level test). Go's stack grows, but a recursion still costs per level. | ContentType.cs:86-138; DeepDocumentTests.cs:16-19 | Keep explicit stacks so behaviour and memory match. |
| T24 | **The decoder clock sum is unchecked.** `clock += read.Length` can pass 2^53 without a refusal. | UpdateV1Decoder.cs:56-60 | Go `uint64` matches. Do not add a refusal unless C# adds it too (parity). |

## 7. Go LOC estimate (ESTIMATE, not measured)

Ratio: Go ≈ 1.25 × C# code lines (the `grep -cvE` count above, no comments or blanks). The extra comes from explicit error returns, ordered-map helpers and UTF-16 handling. Comments are on top.

| Go file | From C# (code LOC) | Est. Go LOC |
|---|---|---|
| lib0/reader.go | Lib0Reader 127 | 160 |
| lib0/writer.go | Lib0Writer 82 | 100 |
| lib0/any.go | AnyCodec 157 | 200 |
| lib0/values.go | AnyObject 38 + AnyArray 20 + YUndefined 12 + ordered map | 120 |
| lib0/utf16.go | (new: JS string helpers, T2/T8) | 80 |
| jsjson/*.go | JsJson 307 | 400 |
| yjs/content*.go | YContent 74 + 9 contents 261 + ContentType 153 | 610 |
| yjs/decode.go + decoded.go + inspect.go | Decoder 109 + DecodedUpdate 155 + Inspector 34 | 375 |
| yjs/deleteset.go | 139 | 175 |
| yjs/statevector.go | 57 | 70 |
| yjs/store.go | 118 | 150 |
| yjs/item.go + structs.go | YItem 366 + YGc/YSkip/YStruct/YId 42 | 510 |
| yjs/integrator.go | 199 | 250 |
| yjs/pending.go | 138 | 175 |
| yjs/encode.go | 64 | 80 |
| yjs/doc.go + doc_apply.go + result.go | YDoc 409 + ApplyResult 8 + YUpdateEvent 2 + YTransaction 16 | 545 |
| yjs/types.go + map.go + array.go + xml.go | YAbstractType 219 + YMap 67 + YArray 66 + Xml 23 | 470 |
| yjs/text.go | YTextBase 494 + YText 12 | 635 |
| **prod total** | 3967 | **≈5100** |
| yjstest/ (loader, runner, renderer, node replay) | 1433 raw | ≈1500 |
| *_test.go (port of 18 files) | 4320 raw | ≈4500 |
