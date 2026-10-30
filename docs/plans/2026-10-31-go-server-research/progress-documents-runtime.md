# Progress: documents-runtime lane

Branch `go/documents-runtime`. Ledger: `documents-runtime.md`. Read this first in the next round.

## Shared oracles added

| Fixture | Read by | Proves |
|---|---|---|
| `test/unit/server-conformance/fixtures/documents/looks-like-a-document.json` | xunit `LooksLikeADocumentFixtureTests`, Go `blokdocs` | D5, and D27's "non-document" half |
| `test/unit/server-conformance/fixtures/documents/host.json` | xunit `HostEnvelopeFixtureTests`, Go `blokdocs` | D10-D29: exact request bytes, href calls, result shape, error kind/reason/param/message |

`host.json` expectations are captured from C#: `BLOK_CAPTURE_HOST_FIXTURE=1 dotnet test Blok.Server.Tests --filter FullyQualifiedName~HostEnvelopeFixtureTests.CapturesTheFixtureWhenAsked`. A normal run compares, so a stale fixture fails C# too.

## C# bugs fixed (failing xunit first)

1. `BlokDocuments.LooksLikeADocument` threw on a repeated key (`ArgumentException`) and on a lone-surrogate key (`InvalidOperationException`), though it promises never to throw. `ValidateAsync` inherited it. Now it parses with `JsonDocument` and `AllowDuplicateProperties = false` and answers `false` for both.
   - Why refuse repeats instead of taking the last: Jint, once the bundle is loaded, reads `{"blocks":1,"blocks":[]}` as `blocks = 1` (`JSON.stringify` of the parsed object printed `{"blocks":1,"blocks":1}`), while node and plain Jint keep the last. Probe: `scratchpad/dr2/jint4.fsx`. A fresh Jint engine without the bundle keeps the last (`jint3.fsx`, `jint5.fsx`, `jint6.fsx`); the trigger inside the bundle is UNVERIFIED.
2. Envelope ops (plain text, texts, pageIndex, remap, with-pages, with-title) threw a raw `InvalidOperationException` on a document with a lone-surrogate escape: `JsonNode.Parse` accepts it and `ToJsonString` fails. Now `InvalidDocument`, like bad JSON. Bare ops (`ToHtml`, `ToMarkdown(doc)`) still pass the text to JS unchanged.

Probe output (`dotnet fsi`, .NET 10.0.400), verbatim:

```
dup blocks -> THROWS ArgumentException: An item with the same key has already been added. Key: blocks (Parameter 'key')
dup other -> THROWS ArgumentException: An item with the same key has already been added. Key: a (Parameter 'key')
lone key -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
lone value -> true
deep 70 -> THROWS JsonReaderException: The maximum configured depth of 64 has been exceeded. Cannot read next JSON array. LineNumber: 0 | BytePositionInLine: 73.
deser lone -> THROWS JsonException: The JSON value could not be converted to System.String. Path: $[0] | LineNumber: 0 | BytePositionInLine: 9.
tojson lone -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
tojson dup -> "{"x":1,"x":2}"
nest tojson dup -> "{"document":{"x":1,"x":2}}"
nest tojson lone -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
```

```
dup root -> THROWS JsonException: Duplicate property 'blocks' encountered during deserialization.
dup escaped -> THROWS JsonException: Duplicate property 'blocks' encountered during deserialization.
dup nested -> THROWS JsonException: Duplicate property 'a' encountered during deserialization.
lone key -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
```
(`JsonDocument.Parse` with `AllowDuplicateProperties = false`.) `new ArgumentException("msg", "texts").Message` is `msg (Parameter 'texts')`.

## Decisions

- Envelope ops refuse JSON nested past 64 (`JsonNode.Parse` default depth) with `InvalidDocument` and never call the runtime; bare ops hand it to JS. Pinned in `host.json`. Go uses `jsjson.ParseNode` with `MaxDepth` 0 (64), not `jsjson.Parse` (512).
- Map key order (`pages`, `blockIds`, `pageIds`) is not part of the contract: the bundle reads `pages` through `hasOwn` (`src/view/server-runtime.ts` `parsePagesRequest`) and `findRemapProblems` walks the document (`src/view/page-document-remap.ts:220`). Go writes keys in UTF-16 order; `host.json` maps are authored in that order, so C# and Go send the same bytes.
