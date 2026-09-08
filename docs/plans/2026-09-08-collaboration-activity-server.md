# Collaboration Activity, Server Half — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who was active in a document and when, keyed on the identity the server verified, so a host can answer "when was this person last here" even for people who have left.

**Architecture:** Two new sync message types. Type 106 is an empty client-to-server activity signal; the server supplies the identity and the time. Type 107 is a server-to-client map from awareness client id to verified actor id, which lets the client key live presence the same way the host keys its own records. A new optional host interface receives four kinds of activity event; Blok stores nothing itself.

**Tech Stack:** C# (.NET, `packages/server/dotnet`), TypeScript, Vitest, xUnit.

**Spec:** `docs/plans/2026-09-08-collaboration-activity-design.md`

**This is plan 2 of 2.** Plan 1 (`docs/plans/2026-09-08-collaboration-activity-client.md`) shipped the client half: the `activeAt` awareness field, the `participants` payload, and the removal of the corner avatar stack. It left one deliberate seam: `identities` is declared at `collaboration/index.ts:375` and read at `:1428`, and nothing writes it. This plan supplies the only writer.

## Global Constraints

- **Message type 105 is NOT free and must not be taken.** `scripts/generate-sync-frames.mjs:79` reserves it as `MESSAGE_UNKNOWN_OUTER`, the sentinel generating the conformance fixture that proves an unknown outer type decodes to `UnknownFrame` and is never counted malformed. That guarantee is what makes both new types safe against old peers. Use **106 for activity** and **107 for identities**; both were measured free.
- `ICollabActivityObserver` lives in `packages/server/dotnet/Blok.Server/Collab/`, beside `ICollabOperationStore`. `Blok.Server.csproj` has no ASP.NET reference and the dependency runs one way, so only the `Use…<T>` registration extension may live in `Blok.Server.AspNetCore`.
- Methods suffixed `Locked` assume the room's lane is held and must never re-enter it (`CollabRoom.cs:66`). The lane is a `SemaphoreSlim(1,1)` at `:96`.
- Every value read off the wire is untrusted. The server takes the actor from `membership.Member.ActorId`, never from a frame.
- No `any`, no `@ts-ignore`, no non-null `!` in TypeScript tests. `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`.
- Comments are short and plain and only record what silently breaks if changed.
- Trunk-based: commit to `main`, no branch, no PR. Another session commits concurrently, so stage exact paths, never `git add -A`, never `git stash`.
- `docs/plans/` is gitignored but tracked; stage with `git add -f`.
- **Gates in this environment.** `yarn lint` invokes bare `eslint`, which does not resolve, and exits 127 having linted nothing; use `NODE_OPTIONS=--max-old-space-size=8192 npx eslint --fix --concurrency=off <paths>`. Full-repo ESLint runs out of memory and is not available. `tsc --noEmit` needs the same 8GB heap. Passing several paths to one `vitest run` silently runs a subset, so check the reported file count against what you passed. Any command outliving 120 seconds is auto-backgrounded, so pass an explicit `timeout` of 600000 rather than backgrounding and waiting.
- .NET tests run as `dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release`. Under local load `dotnet test` exits 137 with empty output; that is saturation, not failure. Assert timeouts, never sub-second completion.

---

### Task 1: Both message types on both wires, and the shared fixture

One protocol change, defined once and proven identical in TypeScript and C#. No behaviour yet: this task only teaches both codecs to encode and decode the two frames.

**Files:**
- Modify: `src/components/modules/collaboration/sync-wire.ts` (constants near :29-37, the `encode` switch :82-131, the `decode` switch :138-203)
- Modify: `src/components/modules/collaboration/types.ts` (`SyncWireFrame` union, near :350-386)
- Modify: `packages/server/dotnet/Blok.Server/Collab/SyncWire.cs` (constants :91-99, `Encode` :128-186, `TryDecode` :222-300, `SizeHint` :192-206)
- Modify: `scripts/generate-sync-frames.mjs` (add fixtures for both new types; leave `MESSAGE_UNKNOWN_OUTER = 105` alone)
- Regenerate: `test/unit/server-conformance/fixtures/sync-frames.json`
- Test: `test/unit/components/modules/collaboration/sync-wire.test.ts` (the hardcoded type lists at :125 and :433)
- Test: `packages/server/dotnet/Blok.Server.Tests/…/SyncWireFramingTests.cs` (fixture-driven, so new fixtures auto-cover it)

**Interfaces:**
- Produces, TypeScript: `SyncWireFrame` gains `{ type: 'activity' }` and `{ type: 'identities'; identities: Array<{ clientId: number; actorId: string }> }`.
- Produces, C#: `internal sealed record ActivityFrame : SyncWireMessage;` and `internal sealed record IdentitiesFrame(IReadOnlyList<AwarenessIdentity> Identities) : SyncWireMessage;` with `internal readonly record struct AwarenessIdentity(ulong ClientId, string ActorId);`
- Produces: `MessageActivity = 106`, `MessageIdentities = 107` on both sides.

- [ ] **Step 1: Write the failing TypeScript codec tests**

In `sync-wire.test.ts`, add a round trip for each type. The activity frame is payload-less, so copy the shape of the existing `queryAwareness` case:

```ts
it('round-trips the activity frame, which carries no payload', () => {
  const bytes = encode({ type: 'activity' })

  expect(decode(bytes)).toEqual({ type: 'activity' })
  // One outer varuint and nothing else: the server reads identity and time from
  // the connection, so the frame has nothing to carry.
  expect(bytes).toHaveLength(1)
})

it('round-trips an identities frame', () => {
  const frame = {
    type: 'identities' as const,
    identities: [{ clientId: 7, actorId: 'u_7' }, { clientId: 9, actorId: 'u_9' }],
  }

  expect(decode(encode(frame))).toEqual(frame)
})

// The payload is a JSON ARRAY, which every existing decoder in this file
// rejects. A decoder that accepted an object here would silently report an
// empty room.
it('refuses an identities payload that is not an array of pairs', () => {
  const bad = ['{"identities":{}}', '{"identities":[{"clientId":7}]}', '{"identities":[{"clientId":"7","actorId":"u"}]}', '[]']

  bad.forEach((json) => {
    expect(decode(identitiesFrameCarrying(json)).type).toBe('malformed')
  })
})
```

Write `identitiesFrameCarrying` next to the file's existing frame builders, encoding outer type 107 followed by the JSON as var-bytes.

- [ ] **Step 2: Run them and watch them fail**

Run: `yarn test test/unit/components/modules/collaboration/sync-wire.test.ts`
Expected: FAIL, the encoder throws on the unknown frame type.

- [ ] **Step 3: Implement the TypeScript codec**

Add `const MESSAGE_ACTIVITY = 106` and `const MESSAGE_IDENTITIES = 107` beside the existing constants. In `encode`, `case 'activity':` writes only `writeVarUint(encoder, MESSAGE_ACTIVITY)`, mirroring `queryAwareness` at :96-98. In `decode`, `case MESSAGE_ACTIVITY:` is `requireEnd(decoder) ?? { type: 'activity' }`, mirroring :161.

`MESSAGE_IDENTITIES` needs a decoder of its own. Do not reach for `decodeControl`: it assumes a flat object and rejects arrays at :295. Read the var-bytes, decode strict UTF-8, `JSON.parse`, then check that the value is an object with exactly the key `identities`, that its value is an array, and that every element is an object with exactly `clientId` (a finite non-negative integer) and `actorId` (a non-empty string). Anything else is `malformed(...)`.

- [ ] **Step 4: Extend the two hardcoded type lists**

`sync-wire.test.ts:125` and `:433` enumerate known types. Add both new names, then run the file again and expect PASS.

- [ ] **Step 5: Write the failing C# side and implement it**

Add `MessageActivity = 106` and `MessageIdentities = 107` at `SyncWire.cs:91-99`, the two records, the `Encode` arms, and the `TryDecode` cases. Give `SizeHint` its own arm for `IdentitiesFrame`: the `_ => JsonPayloadBytes` default assumes 192 bytes and a 256-entry frame is an order of magnitude past that, so size it from the entry count the way `OperationFrame` sizes from its update at `:201`.

The identities decoder hand-rolls `Utf8JsonReader` like the v1 family at `:864-1028`; `HasKeySetViolation` at `:1320-1334` is for flat v2 objects and does not apply to an array.

- [ ] **Step 6: Regenerate the shared fixture and run both suites**

Add positive fixtures for both types and a negative one for a malformed identities array to `scripts/generate-sync-frames.mjs`. Leave `MESSAGE_UNKNOWN_OUTER = 105` and its fixture untouched.

```bash
node scripts/generate-sync-frames.mjs
yarn test test/unit/components/modules/collaboration/sync-wire.test.ts
dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release
```

There is no drift test on that fixture, so regeneration is a step you must remember, not one the suite will remind you of.

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/collaboration/sync-wire.ts src/components/modules/collaboration/types.ts packages/server/dotnet/Blok.Server/Collab/SyncWire.cs scripts/generate-sync-frames.mjs test/unit/server-conformance/fixtures/sync-frames.json test/unit/components/modules/collaboration/sync-wire.test.ts
git commit -m "feat(collab): teach both wires the activity and identities frames"
git pull --rebase && git push
```

---

### Task 2: The client sends the activity frame

**Files:**
- Modify: `src/components/modules/collaboration/provider.ts` (a new `sendActivity`, beside `announceDeparture` at :379-393; add it to the returned object at :1476-1525)
- Modify: `src/components/modules/collaboration/types.ts` (the `CollabProvider` interface, :350-386)
- Modify: `src/components/modules/collaboration/presence.ts` (`PresenceOptions` :41-64, the throttled publisher in `start()` :503-513)
- Modify: `src/components/modules/collaboration/index.ts` (the `createPresence` call at :737)
- Test: `test/unit/components/modules/collaboration/presence.test.ts`
- Test: `test/unit/components/modules/collaboration/provider.test.ts`

**Interfaces:**
- Produces: `provider.sendActivity(): void`, a no-op unless the socket is open and the session is ready.
- Produces: `PresenceOptions.onActivity?: () => void`, already rate-limited to at most once per 60 seconds by presence.

- [ ] **Step 1: Write the failing presence test**

The 60-second gate belongs in `presence.ts`, next to the existing throttle. Do NOT reuse `ACTIVITY_RESOLUTION_MS` or `publishedActiveAt` (`presence.ts:84`, `:280`): that is a one-second gate on an awareness field, a different mechanism at a different cadence.

```ts
it('signals activity once on start and then at most once a minute', () => {
  vi.setSystemTime(new Date(1_700_000_000_000));

  const onActivity = vi.fn();
  const { target, presence } = setup({ onActivity });

  presence.start();
  expect(onActivity).toHaveBeenCalledTimes(1);

  vi.setSystemTime(new Date(1_700_000_030_000));
  moveCaret(target);
  vi.advanceTimersByTime(200);
  expect(onActivity).toHaveBeenCalledTimes(1);

  vi.setSystemTime(new Date(1_700_000_061_000));
  moveCaret(target);
  vi.advanceTimersByTime(200);
  expect(onActivity).toHaveBeenCalledTimes(2);
});
```

Add `onActivity` to the test file's `SetupOptions` and pass it through `setup`.

- [ ] **Step 2: Run it, watch it fail, then implement**

`publishActivity` already runs on `start()` and inside the throttled publisher. Add the 60-second gate beside it and call `options.onActivity?.()` when the gate opens. **`publishBlockId()` must stay first in `start()`** (`presence.ts:492-499`): its synchronous local-origin update is what latches `localClientId`, which `publishUser`'s default colour depends on. Put the activity call after `publishUser()`.

- [ ] **Step 3: Write the failing provider test**

Using `createHarness()` from `provider.test.ts:32-186`, assert that `sendActivity()` puts one type-106 frame on the socket once the session is ready, and puts nothing on the wire before that or after a disconnect. Decode the captured bytes with the real `decode`, not by byte comparison.

- [ ] **Step 4: Implement and wire**

Add `sendActivity` beside `announceDeparture` (`provider.ts:379-393`), gated on `state.socket === null || state.phase !== 'ready'`. Export it on the returned object and the interface. In `index.ts`, pass `onActivity: () => this.provider?.sendActivity()` to `createPresence` — a lazy closure, because `createPresence` runs at `:737` and `createCollabProvider` only at `:769`.

Send one immediately after the handshake completes as well, so a reader who opens the document and never touches the keyboard is still recorded.

- [ ] **Step 5: Run, lint, commit**

```bash
yarn test test/unit/components/modules/collaboration/presence.test.ts
yarn test test/unit/components/modules/collaboration/provider.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx eslint --fix --concurrency=off src/components/modules/collaboration test/unit/components/modules/collaboration
git add src/components/modules/collaboration/provider.ts src/components/modules/collaboration/types.ts src/components/modules/collaboration/presence.ts src/components/modules/collaboration/index.ts test/unit/components/modules/collaboration/presence.test.ts test/unit/components/modules/collaboration/provider.test.ts
git commit -m "feat(collab): signal activity to the sync service once a minute"
```

---

### Task 3: The host observer

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Collab/ICollabActivityObserver.cs`
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs` (constructor :178-202; join :281-283; leave :326-329; commit funnel `AppendCommittedLocked` :1723; receive switch :1477-1497)
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs` (:329-350, the `new CollabRoom(...)` at :343)
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs` (:165, the manager factory)
- Modify: `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerBuilderExtensions.cs` (a `UseCollabActivityObserver<T>` mirroring `UseCollabOperationStore<T>` at :50-59)
- Test: `packages/server/dotnet/Blok.Server.Tests/…/CollabRoomTests.cs`

**Interfaces:**
- Produces:

```csharp
public enum CollabActivityKind { Joined, Active, Edited, Left }

public interface ICollabActivityObserver
{
  ValueTask RecordAsync(
      string documentId,
      string actorId,
      DateTimeOffset at,
      CollabActivityKind kind,
      CancellationToken cancellationToken = default);
}
```

- [ ] **Step 1: Write the failing room tests**

`CollabRoomTests.cs` reaches rooms through `CollabRoomManager.JoinAsync`, and `FakeMember` lives at `CollabRoomTestSupport.cs:644-663`. Add a `RecordingActivityObserver` beside it and a `CreateActivityManager()` helper mirroring `CreateJournalManager()` at `:4411-4431`. Cover:

1. A member with a non-null `ActorId` joining produces exactly one `Joined`.
2. A member whose `ActorId` is null produces NOTHING, of any kind, ever.
3. An activity frame produces `Active` with the room's document id and the server's clock, and the frame's contents supply neither.
4. `Active` and `Edited` are deduplicated to at most one call per minute per document-and-actor pair; `Joined` and `Left` are never suppressed.
5. A member that joins, reads and leaves without editing produces `Joined` then `Left`.
6. An observer whose `RecordAsync` throws does not close the room and does not stall the lane: a later frame from the same member is still processed.
7. With no observer registered, an activity frame changes nothing observable.

- [ ] **Step 2: Implement the interface and the safe call**

**There is no precedent for this in the server and it must be designed, not copied.** `ICollabMember`'s "never block, never throw" is documented only and unenforced (`ICollabMember.cs:37-41`), and `ICollabOperationStore` failures are deliberately fatal — `FailCommitLocked` closes the room (`CollabRoom.cs:1730-1747`). An activity observer is best-effort and must never do that.

Dispatch off the lane, fire and forget, in the shape of the checkpoint `Post(...)` at `CollabRoom.cs:1783`, wrapping the call in try/catch and reporting a failure through the room's existing `log` callback. Never await it while the lane is held.

- [ ] **Step 3: Place the four call sites**

- Joined: in `JoinAsync`, right after `members.Add(membership); UpdateEvictionLocked();` (`:281-283`).
- Left: inside `if (members.Remove(membership))` in `LeaveAsync` (`:326-329`), beside `WithdrawAwarenessLocked`.
- Edited: inside `AppendCommittedLocked` (`:1723`). This is the single funnel: it is called from `:474` (HTTP edit), `:1698` (v2 socket) and `:1878` (v1), and its signature already carries `string? actorId` and a `CollabOperationSource`. One hook covers every producer.
- Active: a new `case ActivityFrame:` in `ReceiveLocked`'s switch (`:1477-1497`), beside `AwarenessFrame`.

A null `ActorId` produces no call at all, of any kind. An unknown author stays unknown rather than getting a fabricated key, the same rule the operation journal already applies.

- [ ] **Step 4: Thread it through DI and register it**

Add a nullable `ICollabActivityObserver?` parameter to the `CollabRoom` constructor and to `CollabRoomManager`, following `ICollabOperationStore`'s three nullable hops: the manager factory at `BlokServerServiceCollectionExtensions.cs:165` resolves it with `GetService<T>()`, `RoomFor` passes it to `new CollabRoom(...)` at `CollabRoomManager.cs:343`. Add `UseCollabActivityObserver<T>` as `RemoveAll<ICollabActivityObserver>()` + `AddSingleton<ICollabActivityObserver, T>()` with `where T : class, ICollabActivityObserver`.

- [ ] **Step 5: Run and commit**

```bash
dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release
```

If it exits 137 with empty output, the machine is saturated; wait and re-run rather than treating it as a failure.

---

### Task 4: The server broadcasts verified identities

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs` (`RecordAwarenessOwnersLocked` :1950-1979, `WithdrawAwarenessLocked` :1994-2013, `JoinAsync` :281-283, `LeaveAsync` :326-329)
- Test: `packages/server/dotnet/Blok.Server.Tests/…/CollabRoomTests.cs`

**Interfaces:**
- Consumes: `IdentitiesFrame` from Task 1.
- Produces: nothing other tasks import; Task 5 consumes the frame off the wire.

- [ ] **Step 1: Write the failing tests**

1. A joining member receives the full map as a frame, listing only clients whose owner has a non-null `ActorId`.
2. A member with no verified identity appears in no entry, while still being in the room.
3. When `RecordAwarenessOwnersLocked` binds a new client id, the room receives a delta naming it.
4. When a member leaves, the room receives a delta removing every client id that member owned.
5. The frame never exceeds `MaxAwarenessClients` (256, `CollabRoomOptions.cs:38`) entries.

- [ ] **Step 2: Implement**

`awarenessOwners` (`CollabRoom.cs:105`) already maps an awareness client id to the membership that owns it, and `ICollabMember.ActorId` is the verified identity. Build the frame from those two. Send the full map to one member with the private `Send(membership, frame)` (`:2044-2053`), and deltas to the room with `BroadcastLocked(frame, except)` (`:2033-2041`) — note `except: null` includes the sender.

Do not touch the awareness payload itself. Plan decision 11 says presence is relayed verbatim and never interpreted, and this frame exists precisely so that rule can stand.

---

### Task 5: The client merges identities, and the parked naming rule

**Files:**
- Modify: `src/components/modules/collaboration/provider.ts` (`handleFrame` switch :1049-1093)
- Modify: `src/components/modules/collaboration/types.ts` (`CollabProviderOptions`, :280-347)
- Modify: `src/components/modules/collaboration/index.ts` (the `identities` field :375, the provider options at :769, `emitStatus` :1388-1449)
- Modify: `src/components/modules/collaboration/participants.ts` (the naming rule only)
- Test: `test/unit/components/modules/collaboration/sync-first-load.test.ts`
- Test: `test/unit/components/modules/collaboration/participants.test.ts`

**Interfaces:**
- Consumes: `provider.sendActivity` from Task 2 is unrelated here; this task consumes the inbound `identities` frame from Task 1 and the broadcast from Task 4.
- Produces: `participants[].userId` is finally non-null.

- [ ] **Step 1: Write the failing integration test**

In `sync-first-load.test.ts`, deliver an identities frame and assert the reported `participants` entry carries the verified `userId`, and that two client ids sharing one actor id collapse into a single entry with both ids. `buildParticipants` already implements that grouping (`participants.ts:93-94`) and must not be changed for it.

- [ ] **Step 2: Implement the merge**

Add `onVerifiedIdentities` to `CollabProviderOptions`, mirroring `onOperationAcknowledged` (`types.ts:346`, wired at `index.ts:786-788`). `handleFrame`'s switch is exhaustive by design, so adding the frame variant in Task 1 already forces the new case to exist. In `index.ts`, replace the map's contents and call `emitStatus()`.

**The merge is lazy and the first emit after joining may report `userId: null` for a peer who has one.** Awareness states and the identities frame arrive on their own schedules. Write a test that pins this rather than letting a later reader "fix" it.

- [ ] **Step 3: Fix the parked naming rule**

Plan 1 parked a defect that only becomes reachable now. `buildParticipants` takes identity fields from the row's lowest `clientId`, so a person whose lowest-id tab published no name is drawn as a silhouette even though a higher-id tab of theirs published one. Change the rule to prefer a member that published a name, breaking ties on the lowest `clientId`, and keep the existing tie-break for `lastActiveAt` and `blockId` as it is. Add a test with a nameless low id and a named high id.

- [ ] **Step 4: Run the gates and commit**

Run the touched suites, then the full unit suite and `tsc --noEmit` with the 8GB heap. Check the reported file count against the paths you passed.

---

## Out of scope

- Retention, deletion, or access control for stored activity. The host owns all three.
- Any Blok-side storage or UI for activity.
- Changing `participants` beyond `userId` becoming non-null and the naming rule above.
- Framework adapter work: no config key is added.
