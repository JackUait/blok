# Progress: collab-transport lane

Read this first next round. Ledger: `collab.md` (sections 2.H, 2.W, 2.C, 2.F, 7, and the matching rows of 3 and 6).

## Round 1 (2026-11-02)

### DONE
- F1-F11 (SyncWire codec, `internal/collab/wire`). Oracles:
  - `fixtures/sync-frames.json` (`TestEverySyncFrameFixtureRoundTrips`, C# `SyncWireFramingTests`).
  - `fixtures/sync-wire-decode.json` (179 frames, 29 awareness payloads, 2 removals, 23 encodes). C# `SyncWireDecodeFixtureTests` recomputes every answer; Go `TestDecodeMatchesTheCSharpAnswers`, `TestAwarenessWalkMatchesTheCSharpAnswers`, `TestAwarenessRemovalMatchesTheCSharpBytes`, `TestEncodeMatchesTheCSharpAnswers`.
- C# bug fixed (commit af6174d6): `SyncWire.TryDecode` threw `InvalidOperationException` on a type-100 lineage or a type-107 actorId with invalid UTF-8 or a lone-surrogate escape. Now an ill-typed property, dropped like any malformed frame.

### In progress
- Fuzz: `FuzzDecode`, `FuzzJSONReader` (wire), `FuzzReceive` (ws).
- `internal/ws` (RFC 6455 subset): written, unit-tested, not yet committed.

### TODO
- 2.H handshake, 2.W member / connection table / budget, 2.C closes.
- Black-box `sync-transport-contract.test.ts`.
- H33 hand-off: `/sync` outside the request deadline.
