# Collaboration Activity, Client Half — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish when each person in a collaborative document was last active, hand the host one participant list to draw from, and delete the avatar stack Blok draws in the corner.

**Architecture:** Each browser adds one absolute timestamp to the awareness state it already broadcasts. The receiving editor clamps it against its own clock and reports it on the existing `collaboration:status` event, which now carries `participants` (one entry per person) instead of `peers` (one entry per connection). The corner stack goes away and the playground grows its own, driven by that event.

**Tech Stack:** TypeScript, Yjs (`yjs`, `y-protocols/awareness`), Vitest, CSS in `src/styles/`.

**Spec:** `docs/plans/2026-09-08-collaboration-activity-design.md`

**This is plan 1 of 2.** It is the client half (spec part A, plus the payload and the stack removal) and it ships on its own. Plan 2 is the server half (spec part B: frames 105 and 106, and the host observer). Until plan 2 lands, `participants[].userId` is always `null` and entries key by `clientId` — the merge code is written here and simply has nothing to merge yet.

## Global Constraints

- Blok is a published library. `types/*.d.ts` is the hand-authored public type surface, and no file under `types/` may import from a module resolving into `src/`.
- No `any`, no `@ts-ignore`, no non-null `!` in tests. Use type guards.
- `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`.
- Every value read off the awareness wire is untrusted input from another browser. Type-check it before use.
- Lint only the files you changed. Run only the test files you touched while iterating. The full `yarn lint` and `yarn test` are the final gate.
- `docs/plans/` is in `.gitignore` but its files are tracked. Stage this plan and any doc under it with `git add -f`.
- Another session may hold uncommitted work in this tree. Stage the exact paths each task lists. Never `git add -A`, never `git add` a file you did not edit, never `git stash`.
- Push to `main` directly. This repo is trunk-based; no branch, no PR.
- Documentation copy lives in `docs/src/i18n/en.json` and `docs/src/i18n/ru.json`. English prose on a `/ru` page is a defect, so any string touched in one is touched in both.
- Task 2 is BREAKING. Its commit subject carries `BREAKING` and its body a `BREAKING CHANGE:` block.

---

### Task 1: Publish and read back the activity timestamp

Each browser stamps when its user last did something. Entering the document counts, so the stamp is written by `start()` before any input happens.

**Files:**
- Modify: `src/components/modules/collaboration/presence.ts` (`PresenceOptions`, a new `publishActivity`, the `start()` body)
- Modify: `src/components/modules/collaboration/presence.ts` (a new exported `readActiveAt`)
- Test: `test/unit/components/modules/collaboration/presence.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - awareness field `activeAt: number`, written beside the existing `user`, `blockId` and `caret` fields.
  - `export const readActiveAt = (value: unknown, now: number): number | null` in `presence.ts`. Returns `null` for anything that is not a finite number, for a value more than `MAX_ACTIVE_AGE_MS` older than `now`, and clamps a value greater than `now` down to `now`.
  - `export const MAX_ACTIVE_AGE_MS = 86_400_000` in `presence.ts`.

- [ ] **Step 1: Write the failing tests for `readActiveAt`**

Add to `test/unit/components/modules/collaboration/presence.test.ts`. Import `readActiveAt` and `MAX_ACTIVE_AGE_MS` from `../../../../../src/components/modules/collaboration/presence` alongside the existing imports.

```ts
describe('readActiveAt', () => {
  const now = 1_700_000_000_000;

  it('keeps a plausible stamp as it is', () => {
    expect(readActiveAt(now - 5_000, now)).toBe(now - 5_000);
  });

  // Two browsers do not agree on the time. A peer whose clock runs fast would
  // otherwise report activity that has not happened yet, and every "was this
  // within five minutes" test against it would answer yes forever.
  it('clamps a stamp from the future down to now', () => {
    expect(readActiveAt(now + 60_000, now)).toBe(now);
  });

  it('drops a stamp older than the age cap', () => {
    expect(readActiveAt(now - MAX_ACTIVE_AGE_MS - 1, now)).toBeNull();
    expect(readActiveAt(now - MAX_ACTIVE_AGE_MS + 1, now)).toBe(now - MAX_ACTIVE_AGE_MS + 1);
  });

  it('drops anything that is not a finite number', () => {
    expect(readActiveAt('1700000000000', now)).toBeNull();
    expect(readActiveAt(Number.NaN, now)).toBeNull();
    expect(readActiveAt(Number.POSITIVE_INFINITY, now)).toBeNull();
    expect(readActiveAt(undefined, now)).toBeNull();
    expect(readActiveAt(null, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test test/unit/components/modules/collaboration/presence.test.ts -t readActiveAt`
Expected: FAIL, `readActiveAt is not a function` (or a TypeScript error that the export does not exist).

- [ ] **Step 3: Implement `readActiveAt`**

Add to `src/components/modules/collaboration/presence.ts`, next to `isPresenceColor`:

```ts
/**
 * Oldest activity stamp worth reporting. Past this the number says nothing
 * useful about a live session and is far more likely to be a peer whose clock
 * is wrong than a person who really has been idle for a day.
 */
export const MAX_ACTIVE_AGE_MS = 86_400_000;

/**
 * One peer's `activeAt`, made safe against their clock and against a hostile
 * value.
 *
 * Clamped rather than rejected on the future side: a browser a minute ahead is
 * ordinary, and dropping its stamp would report an active person as one who
 * published nothing. Dropped outright on the old side, where a wrong clock and
 * a genuinely stale value are indistinguishable and neither is worth drawing.
 * @param value - the raw field off the awareness wire
 * @param now - the receiver's own clock
 */
export const readActiveAt = (value: unknown, now: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (value > now) {
    return now;
  }

  return now - value > MAX_ACTIVE_AGE_MS ? null : value;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/presence.test.ts -t readActiveAt`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing tests for publishing**

Add to the same file, inside the existing `describe` that uses the `setup` helper:

```ts
it('stamps activity when the session starts, so opening the document counts', () => {
  vi.setSystemTime(new Date(1_700_000_000_000));

  const { seam, presence } = setup();

  presence.start();

  expect(seam.fields.activeAt).toBe(1_700_000_000_000);
});

it('moves the stamp forward as the caret moves', () => {
  vi.setSystemTime(new Date(1_700_000_000_000));

  const { seam, target, presence } = setup();

  presence.start();
  vi.setSystemTime(new Date(1_700_000_005_000));
  moveCaret(target);
  vi.advanceTimersByTime(200);

  expect(seam.fields.activeAt).toBe(1_700_000_005_000);
});

// The caret publisher runs every 100ms and skips an unchanged value. A stamp
// that moved every pass would defeat that dedupe and put a fresh awareness
// frame on the wire for every keystroke, for a number nobody reads at that
// resolution.
it('does not rewrite the stamp more than once a second', () => {
  vi.setSystemTime(new Date(1_700_000_000_000));

  const { seam, target, presence } = setup();

  presence.start();
  const writes = seam.writeCount('activeAt');

  vi.setSystemTime(new Date(1_700_000_000_300));
  moveCaret(target);
  vi.advanceTimersByTime(200);

  expect(seam.writeCount('activeAt')).toBe(writes);
});
```

`FakeAwareness` in this file already records writes. If it does not expose `fields` and `writeCount`, add them:

```ts
  /** Last value written per field, so a test can read the published state. */
  public readonly fields: Record<string, unknown> = {};
  private readonly writes: Record<string, number> = {};

  public writeCount(field: string): number {
    return this.writes[field] ?? 0;
  }
```

and increment both inside its `setAwarenessField`.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `yarn test test/unit/components/modules/collaboration/presence.test.ts -t "stamps activity"`
Expected: FAIL, `seam.fields.activeAt` is `undefined`.

- [ ] **Step 7: Implement publishing**

In `src/components/modules/collaboration/presence.ts`, add the resolution constant next to `DEFAULT_THROTTLE_MS`:

```ts
/**
 * Coarsest step the activity stamp moves in. The caret publisher fires ten
 * times a second and skips an unchanged value; a stamp written at that rate
 * would make every pass a wire frame, for a number consumers compare against a
 * five-minute threshold.
 */
const ACTIVITY_RESOLUTION_MS = 1000;
```

Add `publishedActiveAt` to the presence `state` object (`publishedActiveAt: undefined as number | undefined`), and add the publisher beside `publishUser`:

```ts
  /**
   * Say when this user last did something. Written on `start()` too, so
   * opening the document is itself activity rather than a blank until the
   * first keystroke.
   */
  const publishActivity = (): void => {
    const now = Date.now();

    if (state.publishedActiveAt !== undefined && now - state.publishedActiveAt < ACTIVITY_RESOLUTION_MS) {
      return;
    }

    state.publishedActiveAt = now;
    yjs.setAwarenessField('activeAt', now);
  };
```

In `start()`, reset `state.publishedActiveAt = undefined` beside the other two resets, call `publishActivity()` after `publishUser()`, and call it inside the throttled `publish` closure beside `publishBlockId()` and `publishCaret()`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/presence.test.ts`
Expected: PASS, whole file green.

- [ ] **Step 9: Lint and commit**

```bash
yarn lint --fix src/components/modules/collaboration/presence.ts test/unit/components/modules/collaboration/presence.test.ts
git add src/components/modules/collaboration/presence.ts test/unit/components/modules/collaboration/presence.test.ts
git commit -m "feat(collab): publish when each peer was last active"
git push
```

---

### Task 2: Replace `peers` with `participants`

One entry per person instead of one per connection, carrying the activity stamp. BREAKING: `peers` and `CollaborationPeer` shipped in v1.13.0.

**Files:**
- Modify: `types/events/editor-events.ts` (delete `CollaborationPeer`, add `CollaborationParticipant`, swap the `peers` member of `CollaborationStatusChangedPayload`)
- Modify: `src/components/events/CollaborationStatusChanged.ts` (the re-export list)
- Modify: `src/components/modules/collaboration/index.ts` (`toPeer` at line 146 becomes `toParticipant`; `emitStatus` gains the merge)
- Modify: `docs/src/components/api/api-data.ts:1629-1634` (the runnable sample)
- Modify: `docs/src/i18n/en.json` and `docs/src/i18n/ru.json` (every string naming `peers`)
- Test: `test/unit/components/events/CollaborationStatusChanged.test.ts`
- Test: `test/unit/components/modules/collaboration/participants.test.ts` (create)

**Interfaces:**
- Consumes: `readActiveAt` and `MAX_ACTIVE_AGE_MS` from Task 1.
- Produces:
  - `export interface CollaborationParticipant` with `userId: string | null`, `present: boolean`, `self: boolean`, `clientIds: number[]`, `lastActiveAt: number | null`, `blockId: string | null`, and `user: { name: string; color: string; glyph: string | null; label: string | null }`.
  - `CollaborationStatusChangedPayload.participants: CollaborationParticipant[]`. `peers` is gone.
  - `export const buildParticipants = (states: DrawableState[], localClientId: number | null, identities: Map<number, string>, translate: ((key: string) => string) | undefined, now: number): CollaborationParticipant[]` in a new `src/components/modules/collaboration/participants.ts`. `identities` is empty until plan 2 supplies frame 106.

**`states` must include the local client.** `selectDrawableStates` filters the reader out, because the renderer must never draw the reader's own caret. The participant list is the opposite: the spec says `self` is included, and every product that draws this list draws the reader. `emitStatus` therefore appends the local awareness state to the drawable ones before calling this. Miss that and `self` is dead code that can never be true.

- [ ] **Step 1: Write the failing tests for the merge**

Create `test/unit/components/modules/collaboration/participants.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildParticipants } from '../../../../../src/components/modules/collaboration/participants';
import type { DrawableState } from '../../../../../src/components/modules/collaboration/presence';

const NOW = 1_700_000_000_000;

const state = (clientId: number, fields: Record<string, unknown>): DrawableState =>
  ({ clientId, state: { user: {}, ...fields } }) as DrawableState;

describe('buildParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports one connection as one present participant', () => {
    const [participant] = buildParticipants(
      [state(7, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1', activeAt: NOW - 1000 })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(participant.clientIds).toEqual([7]);
    expect(participant.present).toBe(true);
    expect(participant.self).toBe(false);
    expect(participant.userId).toBeNull();
    expect(participant.lastActiveAt).toBe(NOW - 1000);
    expect(participant.blockId).toBe('block-1');
    expect(participant.user.name).toBe('Ada');
  });

  // Two tabs of one signed-in person are one person. Keyed by clientId they
  // would be two rows, and a host drawing faces would show the same photo twice.
  it('collapses two client ids that share a verified identity', () => {
    const [participant, ...rest] = buildParticipants(
      [
        state(7, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1', activeAt: NOW - 9000 }),
        state(9, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-2', activeAt: NOW - 1000 }),
      ],
      42,
      new Map([[7, 'u_7'], [9, 'u_7']]),
      undefined,
      NOW
    );

    expect(rest).toHaveLength(0);
    expect(participant.userId).toBe('u_7');
    expect(participant.clientIds).toEqual([7, 9]);
    expect(participant.lastActiveAt).toBe(NOW - 1000);
    expect(participant.blockId).toBe('block-2');
  });

  // Two tabs can stamp the identical millisecond, so the winner cannot be left
  // to whichever the awareness map happened to yield first.
  it('breaks an exact activity tie on the lowest client id', () => {
    const [participant] = buildParticipants(
      [
        state(9, { user: {}, blockId: 'block-9', activeAt: NOW }),
        state(7, { user: {}, blockId: 'block-7', activeAt: NOW }),
      ],
      42,
      new Map([[7, 'u_7'], [9, 'u_7']]),
      undefined,
      NOW
    );

    expect(participant.blockId).toBe('block-7');
  });

  it('clamps a stamp from the future and drops one past the age cap', () => {
    const [ahead, ancient] = buildParticipants(
      [
        state(7, { user: {}, activeAt: NOW + 60_000 }),
        state(9, { user: {}, activeAt: NOW - 86_400_001 }),
      ],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(ahead.lastActiveAt).toBe(NOW);
    expect(ancient.lastActiveAt).toBeNull();
  });

  it('refuses a verified id longer than 128 characters rather than truncating it', () => {
    const [participant] = buildParticipants(
      [state(7, { user: {} })],
      42,
      new Map([[7, 'u'.repeat(129)]]),
      undefined,
      NOW
    );

    expect(participant.userId).toBeNull();
  });

  // The renderer filters the reader out because it must not draw their own
  // caret. This list is the opposite: every product that draws it draws the
  // reader, so `self` has to be reachable.
  it('marks the reader as self when their own state is in the list', () => {
    const rows = buildParticipants(
      [state(7, { user: { name: 'Ada' } }), state(42, { user: { name: 'Me' } })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(rows.filter((row) => row.self).map((row) => row.clientIds)).toEqual([[42]]);
  });

  // A nameless person is drawn as a silhouette, and the assignment has to match
  // what every other browser computes or the same person wears two faces.
  it('gives a nameless participant a silhouette and a localized label', () => {
    const [named, nameless] = buildParticipants(
      [state(7, { user: { name: 'Ada' } }), state(9, { user: {} })],
      42,
      new Map(),
      (key) => `t:${key}`,
      NOW
    );

    expect(named.user.glyph).toBeNull();
    expect(named.user.label).toBeNull();
    expect(nameless.user.glyph).not.toBeNull();
    expect(nameless.user.label).toBe(`t:presence.anonymous.${nameless.user.glyph ?? ''}`);
  });

  it('leaves the label null when no translator was supplied', () => {
    const [nameless] = buildParticipants([state(9, { user: {} })], 42, new Map(), undefined, NOW);

    expect(nameless.user.glyph).not.toBeNull();
    expect(nameless.user.label).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test test/unit/components/modules/collaboration/participants.test.ts`
Expected: FAIL, cannot resolve `../participants`.

- [ ] **Step 3: Implement `buildParticipants`**

Create `src/components/modules/collaboration/participants.ts`:

```ts
import type { CollaborationParticipant } from '../../../../types/events/editor-events';

import { ANONYMOUS_LABEL_KEYS, assignAnonymousGlyphs } from './anonymous-identity';
import { readActiveAt, type DrawableState } from './presence';

/**
 * Longest verified id carried. Refused rather than truncated: a truncated id
 * is a different id that can collide with a real one, and a silent collision
 * merges two people into one row.
 */
const MAX_USER_ID_LENGTH = 128;

/** Longest name drawn, matching what the renderer already caps at. */
const MAX_NAME_LENGTH = 32;

const readName = (value: unknown): string =>
  typeof value !== 'string'
    ? ''
    : Array.from(value.trim().slice(0, 2 * MAX_NAME_LENGTH)).slice(0, MAX_NAME_LENGTH).join('');

/**
 * Turn the drawable awareness states into one row per person.
 *
 * The join key is the verified id when the room supplied one and the client id
 * otherwise, so two tabs of one signed-in person collapse while two anonymous
 * connections stay apart. `identities` is empty until the server half ships;
 * every row then keys on its own client id, which is exactly the behaviour the
 * old per-connection `peers` list had.
 * @param states - the drawable states PLUS this editor's own, so `self` exists
 * @param localClientId - this editor's own id, marked `self`
 * @param identities - client id to verified actor id, from the room
 * @param translate - localizes an anonymous label; omit and the label stays null
 * @param now - the receiver's clock, for the activity clamp
 */
export const buildParticipants = (
  states: DrawableState[],
  localClientId: number | null,
  identities: Map<number, string>,
  translate: ((key: string) => string) | undefined,
  now: number
): CollaborationParticipant[] => {
  const rows = new Map<string, CollaborationParticipant>();

  // One pass over every nameless client, so the assignment matches what each
  // other browser computes for the same room. Per-row assignment would give the
  // same person a different face in each tab.
  const glyphs = assignAnonymousGlyphs(
    states.filter((entry) => readName(entry.state.user.name) === '').map((entry) => entry.clientId)
  );

  for (const entry of states) {
    const raw = identities.get(entry.clientId);
    const userId = raw !== undefined && raw.length <= MAX_USER_ID_LENGTH ? raw : null;
    const key = userId ?? `client:${entry.clientId}`;
    const activeAt = readActiveAt(entry.state.activeAt, now);
    const blockId = typeof entry.state.blockId === 'string' ? entry.state.blockId : null;
    const existing = rows.get(key);

    if (existing === undefined) {
      const name = readName(entry.state.user.name);
      const glyph = name === '' ? glyphs.get(entry.clientId) ?? null : null;

      rows.set(key, {
        userId,
        present: true,
        self: entry.clientId === localClientId,
        clientIds: [entry.clientId],
        lastActiveAt: activeAt,
        blockId,
        user: {
          name,
          color: typeof entry.state.user.color === 'string' ? entry.state.user.color : '',
          glyph,
          // A label in the wrong language is worse than none, so a host that
          // wired no translator gets the silhouette and no phrase.
          label: glyph === null || translate === undefined ? null : translate(ANONYMOUS_LABEL_KEYS[glyph]),
        },
      });

      continue;
    }

    existing.clientIds.push(entry.clientId);
    existing.self = existing.self || entry.clientId === localClientId;

    // A tie goes to the lower client id, the same rule the glyph assignment
    // uses, because two tabs can stamp the identical millisecond.
    const wins = activeAt !== null &&
      (existing.lastActiveAt === null ||
        activeAt > existing.lastActiveAt ||
        (activeAt === existing.lastActiveAt && entry.clientId < Math.min(...existing.clientIds)));

    if (wins) {
      existing.lastActiveAt = activeAt;
      existing.blockId = blockId;
    }
  }

  return [...rows.values()].map((row) => ({ ...row, clientIds: [...row.clientIds].sort((a, b) => a - b) }));
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/participants.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Swap the published type**

In `types/events/editor-events.ts`, delete `CollaborationPeer` and add in its place:

```ts
/**
 * One person visible in the shared session, as surfaced to the host.
 *
 * One entry per PERSON, not per connection: two browser tabs signed in as the
 * same user collapse into one entry with two `clientIds`. Without a verified
 * identity from the room the two cannot be recognised as one, so each keys on
 * its own client id.
 */
export interface CollaborationParticipant {
  /**
   * Server-verified identity of this person, or null when the room could not
   * verify one. NEVER what the peer claims about itself.
   */
  userId: string | null;

  /** In the document right now. Always true today; Blok reports nobody absent. */
  present: boolean;

  /** This editor's own reader. */
  self: boolean;

  /** Awareness client ids behind this entry, ascending. At least one. */
  clientIds: number[];

  /**
   * When this person last did something, in epoch ms on THIS browser's clock
   * after clamping for the peer's clock. Null when they published none.
   *
   * Blok does not decide who counts as idle and carries no threshold: compare
   * against your own clock with whatever window your product wants.
   */
  lastActiveAt: number | null;

  /**
   * The block this person's caret is in, or null when they have none. For an
   * entry that collapsed two tabs, the block of the more recently active one.
   */
  blockId: string | null;

  /** Display identity. Host-rendered, so treat every field as untrusted text. */
  user: {
    /** Published display name, trimmed and capped. Empty when they published none. */
    name: string;
    /** Cursor and avatar colour. Empty when the peer published none. */
    color: string;
    /** Space silhouette for a nameless participant, else null. */
    glyph: string | null;
    /** Localized anonymous phrase for that silhouette, else null. */
    label: string | null;
  };
}
```

Replace the payload member:

```ts
  /**
   * People in the session, the reader included. Blok reports nobody who has
   * left: presence is ephemeral, and durable activity is the host's own record.
   */
  participants: CollaborationParticipant[];
```

Update `src/components/events/CollaborationStatusChanged.ts` to re-export `CollaborationParticipant` instead of `CollaborationPeer`.

- [ ] **Step 6: Wire it into `emitStatus` and run the whole collaboration suite**

In `src/components/modules/collaboration/index.ts`, delete `toPeer` (line 146) and its import of `CollaborationPeer`, import `buildParticipants` and `hasDrawableIdentity`, add a `private identities = new Map<number, string>()` field, and in `emitStatus` replace `const peers = drawable.map(toPeer);` with:

```ts
    // `selectDrawableStates` drops the reader, because the renderer must never
    // draw the reader's own caret. This list includes them: every product that
    // draws "who is in this document" draws the person reading it.
    const localClientId = this.presence?.localClientId ?? null;
    const local = localClientId === null
      ? undefined
      : this.Blok.YjsManager.getAwarenessStates().get(localClientId);
    const localEntry = local === undefined ? null : { clientId: localClientId, state: local };
    const states = localEntry !== null && hasDrawableIdentity(localEntry)
      ? [...drawable, localEntry]
      : drawable;

    const participants = buildParticipants(
      states,
      localClientId,
      this.identities,
      (key) => this.Blok.I18n.t(key),
      Date.now()
    );
```

and the emitted `peers,` with `participants,`.

Update `test/unit/components/events/CollaborationStatusChanged.test.ts` so its sample payloads use `participants` with the full shape.

Run: `yarn test test/unit/components/modules/collaboration test/unit/components/events/CollaborationStatusChanged.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the docs and both locales**

In `docs/src/components/api/api-data.ts:1629-1634`, change the sample to:

```ts
editor.on('collaboration:status', ({ status, participants }) => {
  console.log(status, participants.map((person) => person.user.name));
});
```

and its comment above to name `participants`.

Then find every doc string that describes the event payload:

```bash
grep -n 'collaboration:status\|\bpeers\b' docs/src/components/api/api-data.ts docs/src/i18n/en.json docs/src/i18n/ru.json
```

Change only the ones describing the PAYLOAD. Leave alone the ones using "peers" to mean the other people in the room, such as the `collaboration.user` and `user.id` prose at `api-data.ts:640` and `:675` — those sentences are still true.

Add the privacy sentence the spec requires, in both locales, to the `collaboration` config description right after the existing note that the display name is published to the room:

- English: `Everyone in the room also sees when you were last active, alongside where your cursor is.`
- Russian: `Все в комнате также видят, когда вы последний раз проявляли активность, вместе с тем, где стоит ваш курсор.`

Run: `yarn --cwd docs test src/components/api src/i18n`
Expected: PASS, including the Russian purity check.

- [ ] **Step 8: Commit**

```bash
yarn lint --fix types/events/editor-events.ts src/components/events/CollaborationStatusChanged.ts src/components/modules/collaboration/index.ts src/components/modules/collaboration/participants.ts
git add types/events/editor-events.ts src/components/events/CollaborationStatusChanged.ts src/components/modules/collaboration/index.ts src/components/modules/collaboration/participants.ts test/unit/components/modules/collaboration/participants.test.ts test/unit/components/events/CollaborationStatusChanged.test.ts docs/src/components/api/api-data.ts docs/src/i18n/en.json docs/src/i18n/ru.json
git commit -m "feat(collab)!: BREAKING report participants with a last-active time

BREAKING CHANGE: \`collaboration:status\` no longer carries \`peers\`. Read
\`participants\` instead: one entry per person rather than per connection,
each with \`lastActiveAt\`, \`clientIds\` and the verified \`userId\`. An entry's
\`clientIds[0]\` is the old \`clientId\`; \`user.name\`, \`user.color\` and
\`blockId\` carry over unchanged. \`CollaborationPeer\` is removed."
git push
```

---

### Task 3: Delete the corner stack and give the playground its own

Blok ships data, not presence UI. The gutter faces and remote carets stay; only the wrapper-mounted stack goes.

**Files:**
- Modify: `src/components/modules/collaboration/presence-renderer.ts` (delete `renderStack`, `stackSignature`, the `stack` and `signature` state fields, `maxAvatars` and its default, `STACK_ATTR`, `AVATAR_ATTR`, `OVERFLOW_ATTR`)
- Modify: `src/styles/presence.css` (delete the stack, avatar and overflow rules; the shared `[data-blok-presence-face], [data-blok-presence-avatar]` rule loses its second selector rather than the whole rule)
- Modify: `test/unit/styles/__snapshots__/main-css-rules.snap.txt` (regenerate)
- Modify: `test/unit/components/modules/collaboration/presence-renderer.test.ts`
- Modify: `index.html` (a host-rendered stack driven by `collaboration:status`)

**Interfaces:**
- Consumes: `participants` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

In `test/unit/components/modules/collaboration/presence-renderer.test.ts`, replace the stack assertions with:

```ts
it('draws no avatar stack, only the gutter face', () => {
  const { host, renderer } = setup();

  renderer.render([{ clientId: 7, state: { user: { name: 'Ada' }, blockId: 'block-1' } }], 42);

  expect(host.querySelector('[data-blok-presence-stack]')).toBeNull();
  expect(host.querySelector('[data-blok-presence-face]')).not.toBeNull();
});
```

The file's own `setup` helper takes a `maxAvatars` option that this task deletes. Remove it from that helper's options type and from every call site in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/presence-renderer.test.ts -t "draws no avatar stack"`
Expected: FAIL, the stack element is found.

- [ ] **Step 3: Delete the stack**

Remove the listed symbols from `presence-renderer.ts` and the listed rules from `presence.css`. Delete every other test in the renderer suite that asserted on the stack.

`stackSignature` holds a raw NUL byte as its join separator, which is why git reports this file as binary. After deleting it, confirm:

```bash
grep -cP '\x00' src/components/modules/collaboration/presence-renderer.ts
git check-attr --all src/components/modules/collaboration/presence-renderer.ts
```

Expected: `0`, and git no longer treats the file as binary.

- [ ] **Step 4: Regenerate the CSS snapshot and run both suites**

Run: `yarn test test/unit/styles/main-css-rules.test.ts -u && yarn test test/unit/components/modules/collaboration/presence-renderer.test.ts test/unit/components/modules/collaboration/presence-css.test.ts`
Expected: PASS. Read the snapshot diff and confirm only the three presence rules changed.

- [ ] **Step 5: Give the playground its own stack**

In `index.html`, after the editor is ready, subscribe and render:

```js
    const presenceStack = document.getElementById('presence-stack');

    blok.on('collaboration:status', ({ participants }) => {
      presenceStack.replaceChildren(
        ...participants
          .filter((person) => !person.self)
          .slice(0, 4)
          .map((person) => {
            const face = document.createElement('span');

            face.className = 'playground-presence-face';
            face.style.background = person.user.color || '#888';
            face.textContent = person.user.name.slice(0, 1).toUpperCase() || '?';
            face.title = person.lastActiveAt === null
              ? person.user.name
              : `${person.user.name} · ${Math.round((Date.now() - person.lastActiveAt) / 1000)}s ago`;

            return face;
          })
      );
    });
```

Add `<div id="presence-stack" class="playground-presence-stack"></div>` beside the existing header controls and the two CSS rules for those classes.

`index.html` may already be dirty from another session. Stage a synthesized blob rather than `git add`:

```bash
SCRATCH=/private/tmp/claude-501/-Users-jackuait-Packages-blok/scratchpad
mkdir -p "$SCRATCH"
git show HEAD:index.html > "$SCRATCH/staged"
# Re-apply ONLY the insertions above to "$SCRATCH/staged", nothing else.
BLOB=$(git hash-object -w "$SCRATCH/staged")
git update-index --cacheinfo 100644 "$BLOB" index.html
git diff --cached -- index.html
```

If `git status` shows `index.html` clean, a plain `git add index.html` is correct instead.

- [ ] **Step 6: Verify in a real browser**

```bash
yarn serve
playwright-cli -s=presence-check open "http://localhost:3303/editor?collab=plancheck&name=Ada"
playwright-cli -s=presence-check2 open "http://localhost:3303/editor?collab=plancheck&name=Grace"
playwright-cli -s=presence-check eval "() => document.querySelectorAll('.playground-presence-face').length"
playwright-cli close-all
```

Expected: `1` from the first session, and no `[data-blok-presence-stack]` anywhere. Close both sessions immediately; while open they appear to anyone else on that document.

- [ ] **Step 7: Final gate and commit**

```bash
yarn lint
yarn test
git add src/components/modules/collaboration/presence-renderer.ts src/styles/presence.css test/unit/components/modules/collaboration/presence-renderer.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "feat(collab): stop drawing the corner presence stack

The host draws its own from the participants list. Gutter faces and remote
carets are untouched. The playground grows a small stack of its own so the dev
page still shows who is present."
git push
```
