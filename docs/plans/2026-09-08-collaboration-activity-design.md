# Collaboration activity: who is here, who was here, and when they were last active

Date: 2026-09-08

**Supersedes** `docs/superpowers/specs/2026-09-06-collaboration-participants-design.md`
and its 50-task plan `docs/superpowers/plans/2026-09-06-collaboration-participants.md`
(0 tasks executed). That spec keyed everything on the client-published
`config.user.id` and stored history in a CRDT ledger. Both decisions were
reversed in the 2026-09-08 session; see Decisions below.

## Problem

A host wants to show when a person was last active in a document. Three states,
in the host's words:

- Just opened the document: active.
- Editing right now: active.
- Nothing for five minutes or more: no longer active.

Blok can answer none of that today.

- `collaboration:status` carries `peers`, and a peer entry has no timestamp of
  any kind.
- Awareness state carries `user`, `blockId` and `caret`. Nothing else. The
  y-protocols `meta.lastUpdated` map is liveness, not activity: a client
  re-announces itself roughly every 15 seconds purely to avoid the 30-second
  prune, whether or not anybody touched the keyboard.
- Presence is ephemeral. A person who left the document has no awareness entry,
  so no client-side mechanism can ever report them.
- The server's operation journal already records `ActorId` and `CommittedAt`
  per committed operation, so "when did this person last EDIT" is already
  known server-side. "When did this person last OPEN or READ" is not recorded
  anywhere.

Separately, the editor draws a presence avatar stack in the top-right corner of
the wrapper that the host cannot turn off, restyle, or put a photo in.

## Decisions taken with the user

1. **Scope includes people who have left.** Not only the people connected right
   now. This is what forces server-side storage into the design.
2. **Identity is the server-verified `ActorId` only.** Never the client-published
   `config.user.id`. This follows the direction of `1b978e52`, which stopped
   trusting unverified names.
3. **Blok notifies, the host stores.** Blok gains no durable storage of its own
   and no retention policy. The host receives activity events and decides where
   they live, how long they are kept, and who may see them.
4. **Activity means edits plus an explicit signal.** A dedicated lightweight
   frame, not an inference from presence traffic and not connection liveness
   alone. A reader who never edits must still count as active, and a tab left
   open overnight must not.
5. **Blok ships data, not UI.** No built-in rendering of activity. The corner
   stack goes away and the host draws whatever it wants.
6. **Publishing activity to peers is acceptable.** Documented, not gated behind
   a flag.
7. **`peers` is replaced outright by `participants`.** The type shipped in
   v1.13.0, and the author states nobody is on that release yet. The concern
   was raised and the call was reaffirmed; the commit still carries a
   `BREAKING` label and a migration line, because a released type is a released
   type and anyone who pinned 1.13.0 deserves to read it in the notes.

## Design

Two halves. They are independently shippable and share no code.

- **A. Live activity in the room.** Client-only, one awareness field, one
  payload field.
- **B. Durable activity for everyone.** One client frame, one server frame, one
  host-implemented observer.

### A1. `activeAt` on the awareness wire

`presence.ts` publishes a new top-level awareness field beside `user`,
`blockId` and `caret`:

```
activeAt: number   // epoch ms, the publishing browser's own clock
```

Written in `start()`, so entering the document is itself activity, and
refreshed by the existing throttled publisher that already rides
`selectionchange` and `focusin`.

**The stamp moves at most once a second.** That publisher fires ten times a
second and skips a value that did not change. A stamp rewritten on every pass
would defeat that skip and put an awareness frame on the wire for every
keystroke, for a number consumers compare against a multi-minute threshold.

**Why an absolute timestamp and not a relative age.** y-protocols re-announces
the unchanged local state about every 15 seconds so the room does not prune the
client. That re-announcement does not call our publish functions, so a relative
age would be re-broadcast stale and would need a republish timer of its own. An
absolute stamp stays true across any number of re-announcements.

**Clock skew is handled on receipt, not on the wire.** In `toPeer` only, which
is the payload path. `readPeer` in the renderer is left alone: nothing Blok
draws consumes `activeAt`, so the renderer never reads it.

- A stamp in the future is clamped to the receiver's `Date.now()`.
- A stamp more than 24 hours old, or not a finite number, is dropped to `null`.

That is enough for a five-minute threshold on NTP-synced machines. Blok does
not attempt clock synchronisation.

### A2. `lastActiveAt` in the published payload

Each present participant carries:

```ts
/**
 * When this participant last did something in the document, in epoch ms on
 * THIS browser's clock after skew clamping. Null when they published none.
 */
lastActiveAt: number | null;
```

Blok does not compute an idle boolean and does not carry a threshold. The host
compares against its own clock. A threshold in the payload would freeze the
five-minute rule into the public contract for every consumer.

### B1. Frame 105: the activity signal (client to server)

A new outer message type in Blok's own namespace:

```
const MESSAGE_ACTIVITY = 105;
```

Body: **empty**. The frame says one thing, "the person on this connection did
something", and the server supplies the identity and the time. A reason byte
was considered and rejected: adding one later is a second protocol bump, and no
consumer of the observer has been shown to need it.

**Forward compatibility is already guaranteed, verified in both codebases.**
`src/components/modules/collaboration/sync-wire.ts` returns
`{ type: 'unknown', messageType }` for an unrecognised outer type, and
`SyncWire.TryDecode` on the server returns `UnknownFrame` with no error, which
`CollabRoom.ReceiveLocked` drops through `default: break;` without counting it
malformed and without closing the member. An old server ignores frame 105; an
old client ignores frame 106. No protocol version bump, no negotiation change.

**Client cadence.** At most once per 60 seconds per connection, plus one
immediately after the handshake completes. Triggered by the same events that
already move `activeAt`: input, caret movement, focus. The 60-second floor is
independent of the 100 ms presence throttle.

**Wiring.** `presence.ts` is created before the provider exists, so it cannot
hold a provider reference. `PresenceOptions` gains:

```ts
/** Called when the local user did something, already rate-limited. */
onActivity?: () => void;
```

`collaboration/index.ts` passes a closure that reads `this.provider` lazily and
calls a new `provider.sendActivity()`, which is a no-op before the socket is
open. The rate limit lives in `presence.ts` next to the existing throttle.

### B2. Frame 106: verified identities (server to client)

Present participants and departed participants must be one list keyed the same
way, or a host shows the same person twice. The join key has to be the verified
`ActorId`, and the client cannot know it: awareness carries only what a peer
claims about itself.

The server cannot stamp the id into awareness either. `RelayAwarenessLocked`
re-encodes the outer envelope but treats the y-protocols payload as opaque, and
reaching inside it to inject a field is exactly the interpretation that plan
decision 11 forbids.

So the mapping travels on its own:

```
const MESSAGE_IDENTITIES = 106;   // server to client only
// JSON body: { "identities": [ { "clientId": 123, "actorId": "u_7" }, ... ] }
```

The server already holds this mapping. `awarenessOwners` keys an awareness
client id to the `CollabMembership` that owns it, and `ICollabMember.ActorId`
is derived at the handshake from the ticket's user claim or the signed-in
principal, never from anything the client sends.

Rules:

- Entries are emitted only for clients whose owner has a non-null `ActorId`.
  An unauthenticated connection appears in the room with no verified identity,
  exactly as it does today.
- A joining member receives the full map as its first frame 106. The room
  receives a delta afterwards: the entries added or removed when a member
  joins, a member leaves, or `RecordAwarenessOwnersLocked` binds a new client
  id.
- Capped at the same `MaxAwarenessClients` bound the awareness relay uses,
  which defaults to 256.
- `SyncWire.SizeHint` gains a case for the frame. Its `_ => JsonPayloadBytes`
  default assumes a fixed-shape frame near 192 bytes, and a 256-entry map is an
  order of magnitude past that. `SizeHint` is only a buffer pre-allocation hint
  and not a cap, so the current default would cost a copy rather than fail, but
  the case belongs there anyway.
- A client merges the mapping into its participant list. A `clientId` with no
  entry keeps `userId: null`.

**The merge is lazy, and that is deliberate.** Awareness states arrive on their
own schedule, through the `QueryAwareness` reply and through relayed frames, so
a client will routinely see a peer's state before the identities frame that
names them. The first `emitStatus` after joining may therefore report
`userId: null` for a peer who does have a verified identity, and a later emit
flips them to their `ActorId` when the map lands. A host that keys a DOM list on
`userId` will see that entry re-key once.

Holding the first emit until a 106 arrives was considered and rejected: an old
server never sends one, so the wait would need a timeout, and the timeout would
be a second source of the same flicker with worse latency. This is the same
eventual-consistency behaviour awareness itself has. It is written down here so
that it is not later mistaken for a bug and "fixed".

**Confirmed on review: the frame is in.** The alternative was to let the host
join live presence to its own stored history by the client-claimed id, which any
peer can forge, or by no key at all. Showing one person as one row is the point
of the feature, so the join key has to be one the server vouches for.

### B3. The host observer

Registered like every other host service, matching
`UseCollabOperationStore`:

```csharp
builder.UseCollabActivityObserver<MyObserver>();
// AddSingleton<ICollabActivityObserver, MyObserver>()
```

```csharp
public interface ICollabActivityObserver
{
  ValueTask RecordAsync(
      string documentId,
      string actorId,
      DateTimeOffset at,
      CollabActivityKind kind,
      CancellationToken cancellationToken = default);
}

public enum CollabActivityKind { Joined, Active, Edited, Left }
```

**Contract.**

- `at` is the server's clock. A client-supplied time is never used.
- `actorId` comes from `membership.Member.ActorId`. **A connection with a null
  `ActorId` produces no call at all**, of any kind. An unknown author stays
  unknown rather than getting a fabricated key, which is the same rule the
  operation journal already applies.
- The room calls members inside its lane and must never block there. The
  observer is therefore invoked **outside the room lock, fire-and-forget on the
  task pool**. A faulted task is logged through the room's existing `log`
  callback and never touches the session, mirroring how a throwing
  `collaboration:status` listener is handled on the client.
- Deduplication: at most one call per 60 seconds per `(documentId, actorId)`
  pair for `Active` and `Edited`. `Joined` and `Left` are never suppressed —
  they are the boundaries of a session and a host may want to store them as
  such.
- A `Left` on a connection the server never saw activity from is still
  reported. "Opened the document and read for two minutes" is a real data
  point, and suppressing it would lose exactly the case the user asked for.
- No observer registered: the server does not decode frame 105 past its header
  and makes no calls. The feature costs nothing when unused.

### B4. The published payload

`CollaborationStatusChangedPayload.peers` is **replaced** by `participants`. One
list, not two: a parallel array overlapping `peers` would make the host merge
two sources for the same person.

```ts
participants: Array<{
  /** Verified ActorId from frame 106, or null when the room could not verify one. */
  userId: string | null;
  /** In the document right now. */
  present: boolean;
  /** This editor's own reader. */
  self: boolean;
  /** Awareness client ids; two tabs of one person collapse into one entry. */
  clientIds: number[];
  /** Epoch ms after skew clamping, or null when none was published. */
  lastActiveAt: number | null;
  /**
   * The block this person's caret is in, carried over from `peers[].blockId`
   * so the released information is not lost. For an entry that collapsed two
   * tabs, the block of the more recently active one; on an exact tie, the
   * lowest `clientId`, the same tie-break `assignAnonymousGlyphs` uses. Two
   * tabs can publish the identical millisecond, so the rule cannot be left
   * to map order.
   */
  blockId: string | null;
  user: {
    /** Published display name, trimmed and capped at 32 code points. Empty when none. */
    name: string;
    /** Resolved hex colour, never empty. */
    color: string;
    /** Space silhouette for a present, nameless participant; else null. */
    glyph: string | null;
    /** Localized anonymous phrase for that silhouette; else null. */
    label: string | null;
  };
}>
```

`participants` lists the people in the room. It does **not** list departed
people: Blok does not store them, the host does. The host merges its own
records into this list by `userId`.

Merge rule inside the list: key by `userId` when it is a string, otherwise by
`clientId`, so two tabs signed in as the same person collapse into one entry
whose `lastActiveAt` is the newer of the two.

`self` is included. Every product that draws this list draws the reader.

Caps unchanged: `MAX_PEERS` 50 and `PRESENCE_SCAN_LIMIT` 1000 still bound the
awareness walk. A `userId` longer than 128 characters is refused rather than
truncated, because a truncated id collides with a real one.

Emission rides the existing `emitStatus`, which already fires on every
awareness change. A frame 106 becomes a second trigger.

`CollaborationPeer` is deleted along with `peers`. See Breaking change below.

### B5. Removing the corner stack

Deleted from `presence-renderer.ts`: `renderStack`, `stackSignature`, the
`stack` and `signature` render-state fields, the `maxAvatars` option and its
default, and the `STACK_ATTR` / `AVATAR_ATTR` / `OVERFLOW_ATTR` constants.
`buildAvatar` stays; the gutter layer uses it.

Deleted from `presence.css`: the `[data-blok-presence-stack]`,
`[data-blok-presence-avatar]` and `[data-blok-presence-overflow]` rules.

Gutter faces and remote carets are untouched. `data-attributes.ts` is untouched:
the presence attributes are local constants in the presence files and were never
in the published map, so `scripts/generate-data-attributes-dts.mjs` does not run.

**The NUL byte was real and it shipped.** `stackSignature` held a raw NUL as its
join separator, so git treated `presence-renderer.ts` as binary and reading it
at a tag needs `git show -a`. Measured: v1.13.0 carries it; it was gone by
`1b978e52`, before this plan began, so there is nothing to clean up here. An
earlier note in this file said the byte was never there after `ad3d522f` — that
was a bad measurement and is retracted.

The playground gains a small host-rendered stack driven by
`collaboration:status`, so the dev page keeps showing who is present.

## Breaking change and the compatible route

`CollaborationPeer` and `peers` shipped in **v1.13.0**, confirmed with
`git show v1.13.0:types/events/editor-events.ts`. CLAUDE.md's "a surface that
never shipped" exemption therefore does not apply, and replacing them is
BREAKING.

The author states nobody is on v1.13.0 yet, and chose replacement over an
additive `participants` beside a deprecated `peers`. That is the decision this
spec implements. It still ships labelled:

- **Old:** `collaboration:status` carried `peers: CollaborationPeer[]`, present
  peers only, entries keyed by `clientId`, no timestamps.
- **New:** it carries `participants`, one entry per person rather than per
  connection, keyed by the verified `userId` where there is one, each with
  `lastActiveAt`.
- **Migration:** read `participants` instead of `peers`. An entry's
  `clientIds[0]` is the old `clientId`, and `user.name`, `user.color` and
  `blockId` all carry over unchanged. No field is lost.
- The commit subject carries `BREAKING` and the body a `BREAKING CHANGE:` block
  saying the above.

Removing the corner stack is a visible behaviour change for anyone who styled
`[data-blok-presence-stack]`. It is not a typed surface and not in the published
attribute map, but it belongs in the same release note.

Removing the corner stack is still a visible behaviour change for anyone who
styled `[data-blok-presence-stack]`. It is not a typed surface and not in the
published attribute map, but it should be called out in the release notes.

The gutter strip stays `aria-hidden`, so adopting `participants` is now the
only accessible presence surface Blok offers. A host that draws its own
stack from this data is responsible for labelling it, or a screen-reader user
has no way to learn who else is in the document.

## Privacy

`activeAt` is new disclosure. Before this change, a peer could see where your
caret was; after it, a peer can also see when you last touched the document.
The user accepted this without a flag. It must be stated plainly in the
collaboration documentation, next to the existing note that presence is visible
to everyone in the room.

The durable half discloses nothing on its own: Blok stores nothing and shows
nothing. Retention, access control, and whether to record activity at all are
the host's decisions, expressed by registering the observer or not.

## Testing

TDD, red first.

Client, Vitest:

1. `activeAt` is published on `start()` and refreshed by the caret publisher.
2. A future `activeAt` is clamped to now; one older than 24 hours, and a
   non-finite one, become `null`.
3. `participants` reports a present peer with `lastActiveAt` and carries over
   the `blockId` the old `peers` entry had; `peers` is gone from the payload.
4. Two client ids carrying the same verified `userId` collapse into one entry
   with two `clientIds` and the newer `lastActiveAt`.
5. Frame 105 is sent once after the handshake and at most once per 60 seconds
   under continuous typing.
6. An unknown outer message type is still ignored, both directions.
7. No `[data-blok-presence-stack]` mounts on a collaboration editor, while a
   gutter face and a caret still do.

Server, .NET:

8. A frame 105 from a member with a non-null `ActorId` calls the observer with
   that id and the server's clock; the frame's contents never supply either.
9. A frame 105 from a member with a null `ActorId` calls nothing.
10. `Active` and `Edited` are deduplicated to one call per minute per
    `(document, actor)`; `Joined` and `Left` are not.
11. A member that joins, reads and leaves without editing produces `Joined` and
    `Left`.
12. A throwing observer is logged and does not close the session or stall the
    room lane.
13. Frame 106 lists only clients whose owner has a verified `ActorId`, and is
    re-broadcast when a member leaves.
14. With no observer registered, a frame 105 changes nothing observable.

E2E: two clients, one idles past the threshold, and a host-rendered stack in the
playground reflects it.

## Out of scope

- Any built-in UI for activity. Blok ships data.
- Retention, deletion, or access control for stored activity.
- Clock synchronisation between browsers.
- Framework adapter work. No config key is added and no adapter re-declares the
  event payload.
- Changing `resolveUser` or the block-level `lastEditedAt` / `lastEditedBy`
  fields.

## Closed on review

1. **Frame 106 ships.** Without a server-vouched join key, one person can appear
   as two rows, and a forged id can attach a stranger to somebody's history.
2. **The two 60-second floors stay constants, not configuration.** One on the
   client for frame 105, one on the server for observer deduplication. They make
   a recorded time accurate to about a minute, which is a fifth of the
   five-minute threshold the feature was asked for. A constant is cheap to
   change later; a configuration key is public surface forever. Revisit only if
   a host asks for a threshold far from five minutes.
