/**
 * Presence — local awareness upkeep (Phase 3, task C3).
 *
 * What this file pins is the LOCAL half: what a client publishes about itself,
 * how often, and how it learns which awareness client id is its own. The DOM
 * half lives in presence-renderer.test.ts.
 */
import * as encoding from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_PEERS,
  PRESENCE_PALETTE,
  PRESENCE_SCAN_LIMIT,
  createPresence,
  isPresenceColor,
  presenceColorFor,
  type Presence,
  type PresenceSeam,
  type PresenceState,
} from '../../../../../src/components/modules/collaboration/presence';
import type { CaretPosition } from '../../../../../src/components/modules/collaboration/caret-position';
import type { PresenceRenderer } from '../../../../../src/components/modules/collaboration/presence-renderer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { AwarenessChange } from '../../../../../src/components/modules/yjs/types';

/**
 * A stand-in for the awareness seam with y-protocols' observable semantics:
 * the local client is seeded with `{}` at construction, and every local write
 * emits `change` then `update`, both with origin `'local'`.
 *
 * The equality filter is modelled, not simplified away: y-protocols emits
 * `change` only when the new local state DIFFERS from the previous one
 * (awareness.js:127-134), while `update` goes out either way. That asymmetry is
 * the whole of the lineage-reset latch bug, so a fake that always emits
 * `change` would make the regression untestable.
 */
class FakeAwareness implements PresenceSeam {
  public readonly states = new Map<number, Record<string, unknown>>();

  public readonly writes: Array<{ field: string; value: unknown }> = [];

  public readonly emissions = { change: 0, update: 0 };

  private readonly changeListeners = new Set<(changes: AwarenessChange, origin: unknown) => void>();

  private readonly updateListeners = new Set<(changes: AwarenessChange, origin: unknown) => void>();

  public constructor(public clientId = 42) {
    this.states.set(clientId, {});
  }

  public setAwarenessField(field: string, value: unknown): void {
    const previous = this.states.get(this.clientId);
    const next = { ...previous, [field]: value };

    this.writes.push({ field, value });
    this.states.set(this.clientId, next);

    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    const delta = { added: [], updated: [this.clientId], removed: [] };

    if (changed) {
      this.emissions.change += 1;
      this.emit(this.changeListeners, delta, 'local');
    }

    this.emissions.update += 1;
    this.emit(this.updateListeners, delta, 'local');
  }

  public getAwarenessStates(): Map<number, Record<string, unknown>> {
    return new Map(this.states);
  }

  public onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    this.changeListeners.add(callback);

    return () => {
      this.changeListeners.delete(callback);
    };
  }

  public onAwarenessUpdate(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    this.updateListeners.add(callback);

    return () => {
      this.updateListeners.delete(callback);
    };
  }

  /** A peer joins. */
  public join(clientId: number, state: Record<string, unknown>): void {
    this.states.set(clientId, state);
    this.emissions.change += 1;
    this.emit(this.changeListeners, { added: [clientId], updated: [], removed: [] }, 'remote');
  }

  /**
   * Every remote state goes at once — what `clearRemoteAwarenessStates` does on
   * a disconnect. y-protocols tags that removal `'local'`, which is exactly the
   * trap a "skip local-origin events" filter would fall into.
   */
  public dropRemotes(): void {
    const removed = Array.from(this.states.keys()).filter((id) => id !== this.clientId);

    removed.forEach((id) => this.states.delete(id));
    this.emissions.change += 1;
    this.emit(this.changeListeners, { added: [], updated: [], removed }, 'local');
  }

  /**
   * What `DocumentStore.resetForRelineage` leaves behind: a brand new Awareness
   * bound to a NEW client id, carrying the old local state restored onto it.
   * @param clientId - the client id the new Awareness bound
   */
  public reset(clientId: number): void {
    const restored = this.states.get(this.clientId) ?? {};

    this.states.clear();
    this.clientId = clientId;
    this.states.set(clientId, restored);
  }

  public localState(): Record<string, unknown> {
    return this.states.get(this.clientId) ?? {};
  }

  private emit(
    listeners: Set<(changes: AwarenessChange, origin: unknown) => void>,
    changes: AwarenessChange,
    origin: unknown
  ): void {
    Array.from(listeners).forEach((listener) => listener(changes, origin));
  }
}

const fakeRenderer = (): PresenceRenderer & {
  renders: Array<{ states: PresenceState[]; localClientId: number | null }>;
  cleared: number;
  repositioned: number;
} => {
  const renders: Array<{ states: PresenceState[]; localClientId: number | null }> = [];
  const state = { cleared: 0, repositioned: 0 };

  return {
    render: (states, localClientId) => {
      renders.push({ states, localClientId });
    },
    reposition: () => {
      state.repositioned += 1;
    },
    clear: () => {
      state.cleared += 1;
    },
    renders,
    get cleared(): number {
      return state.cleared;
    },
    get repositioned(): number {
      return state.repositioned;
    },
  };
};

const started: Presence[] = [];

/**
 * A real Map that counts how many entries a walk pulled out of it, so the cost
 * of a pass can be asserted exactly instead of timed (a ms budget would flake).
 */
const countingMap = (): { states: Map<number, Record<string, unknown>>; scanned: () => number } => {
  const states = new Map<number, Record<string, unknown>>();
  const iterate = states[Symbol.iterator].bind(states);
  const counter = { count: 0 };

  Object.defineProperty(states, Symbol.iterator, {
    value: function* (): Generator<[number, Record<string, unknown>]> {
      for (const entry of iterate()) {
        counter.count += 1;

        yield entry;
      }
    },
  });

  return { states, scanned: () => counter.count };
};

/** Identity-less states, as a peer that fabricates client ids would publish. */
const fabricate = (states: Map<number, Record<string, unknown>>, from: number, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    states.set(from + index, {});
  }
};

/** The local client id used by `setupWith`, kept clear of any fabricated id. */
const HOSTILE_LOCAL_ID = 1_000_001;

/**
 * Presence over an awareness map supplied whole — for the cases about how much
 * of that map one pass is allowed to touch.
 * @param states - the map `getAwarenessStates` hands back, uncopied
 */
const setupWith = (states: Map<number, Record<string, unknown>>) => {
  const renderer = fakeRenderer();
  const listeners = new Set<(changes: AwarenessChange, origin: unknown) => void>();
  const seam: PresenceSeam = {
    setAwarenessField: (field, value) => {
      states.set(HOSTILE_LOCAL_ID, { ...states.get(HOSTILE_LOCAL_ID), [field]: value });
      Array.from(listeners).forEach((listener) => {
        listener({ added: [], updated: [HOSTILE_LOCAL_ID], removed: [] }, 'local');
      });
    },
    getAwarenessStates: () => states,
    onAwarenessChange: (callback) => {
      listeners.add(callback);

      return () => {
        listeners.delete(callback);
      };
    },
    onAwarenessUpdate: () => () => undefined,
  };

  const presence = createPresence({
    yjs: seam,
    user: { name: 'Ada' },
    currentBlockId: () => 'block-1',
    eventTarget: new EventTarget(),
    renderer,
  });

  started.push(presence);

  return {
    presence,
    renderer,
    /** One remote peer changed — the event that re-walks the map. */
    notifyRemote: () => {
      Array.from(listeners).forEach((listener) => {
        listener({ added: [], updated: [12_345], removed: [] }, 'remote');
      });
    },
  };
};

interface SetupOptions {
  clientId?: number;
  user?: { name?: string; color?: string };
  blockId?: string | null;
  position?: CaretPosition | null;
}

const setup = (options: SetupOptions = {}) => {
  const seam = new FakeAwareness(options.clientId ?? 42);
  const renderer = fakeRenderer();
  const target = new EventTarget();
  const caret = {
    blockId: options.blockId === undefined ? 'block-1' : options.blockId,
    position: options.position ?? null,
  };

  const presence = createPresence({
    yjs: seam,
    user: options.user,
    currentBlockId: () => caret.blockId,
    currentCaret: () => caret.position,
    eventTarget: target,
    renderer,
  });

  started.push(presence);

  return { seam, renderer, target, caret, presence };
};

/** A caret position as `readCaretPosition` would report it. */
const at = (blockId: string, head: number, anchor = head): CaretPosition => ({
  blockId,
  inputIndex: 0,
  anchor,
  head,
});

/** A caret move the browser would report. */
const moveCaret = (target: EventTarget): void => {
  target.dispatchEvent(new Event('selectionchange'));
};

/**
 * One awareness frame naming `clientId` at `clock`, encoded the way
 * y-protocols reads it — what any pass-holder can put on the wire, since the
 * server relays awareness after reading only the client count.
 * @param clientId - the client whose state the frame claims to carry
 * @param clock - a clock high enough to beat the genuine one
 * @param state - the state the frame plants
 */
const forgedAwarenessFrame = (clientId: number, clock: number, state: Record<string, unknown>): Uint8Array => {
  const encoder = encoding.createEncoder();

  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify(state));

  return encoding.toUint8Array(encoder);
};

describe('presence — local awareness upkeep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    started.splice(0).forEach((presence) => presence.stop());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('what it publishes', () => {
    it('publishes the display identity and the current block', () => {
      const { seam, presence } = setup({ user: { name: 'Ada' } });

      presence.start();

      expect(seam.localState()).toEqual({
        blockId: 'block-1',
        caret: null,
        user: { name: 'Ada', color: presenceColorFor(42) },
      });
    });

    it('publishes an identity with no name when the host configured no user', () => {
      const { seam, presence } = setup();

      presence.start();

      // `user` is optional in the published config, so this IS the default
      // configuration. Publishing nothing about ourselves made a default room a
      // place where everybody is present and nobody sees anyone — so the
      // identity goes out either way, carrying the assigned colour and no name.
      expect(seam.localState()).toEqual({
        blockId: 'block-1',
        caret: null,
        user: { color: presenceColorFor(42) },
      });
      expect(seam.writes.map((write) => write.field)).toEqual(['blockId', 'caret', 'user']);
    });

    it('publishes a null block when the caret is nowhere', () => {
      const { seam, presence } = setup({ blockId: null, user: { name: 'Ada' } });

      presence.start();

      expect(seam.localState().blockId).toBeNull();
    });
  });

  describe('what it publishes about the caret', () => {
    it('publishes the caret position as its own field', () => {
      const { seam, presence } = setup({ position: at('block-1', 4, 2) });

      presence.start();

      expect(seam.localState().caret).toEqual({
        blockId: 'block-1',
        inputIndex: 0,
        anchor: 2,
        head: 4,
      });
    });

    it('keeps publishing the block id, which already-deployed clients draw from', () => {
      const { seam, presence } = setup({ position: at('block-1', 4) });

      presence.start();

      // The caret field carries its own blockId, so nothing HERE reads this one
      // any more. It stays on the wire because a client from before carets
      // shipped still outlines the block from it.
      expect(seam.localState().blockId).toBe('block-1');
    });

    it('republishes a moved caret without rewriting the block id', () => {
      const { seam, target, caret, presence } = setup({ position: at('block-1', 4) });

      presence.start();
      seam.writes.length = 0;

      caret.position = at('block-1', 5);
      moveCaret(target);
      vi.advanceTimersByTime(200);

      // Typing inside one block must not put the unchanged block id back on the
      // wire: every field write bumps the awareness clock and costs a frame.
      expect(seam.writes.map((write) => write.field)).toEqual(['caret']);
      expect(seam.localState().caret).toMatchObject({ head: 5 });
    });

    it('writes nothing at all when the caret has not moved', () => {
      const { seam, target, presence } = setup({ position: at('block-1', 4) });

      presence.start();
      seam.writes.length = 0;

      moveCaret(target);
      vi.advanceTimersByTime(200);

      // `selectionchange` fires on every keystroke, so an unchanged position
      // reaching the wire would be a frame per keypress for nothing.
      expect(seam.writes).toEqual([]);
    });

    it('compares the whole position, not just the offset', () => {
      const { seam, target, caret, presence } = setup({ position: at('block-1', 4) });

      presence.start();
      seam.writes.length = 0;

      // Same offsets, a different field of the same block — a table moving
      // between two cells that happen to share a caret offset.
      caret.position = { blockId: 'block-1', inputIndex: 1, anchor: 4, head: 4 };
      moveCaret(target);
      vi.advanceTimersByTime(200);

      expect(seam.localState().caret).toMatchObject({ inputIndex: 1 });
    });

    it('re-measures the remote carets when the local caret moves', () => {
      const { renderer, target, presence } = setup({ position: at('block-1', 4) });

      presence.start();

      const before = renderer.repositioned;

      moveCaret(target);
      vi.advanceTimersByTime(200);

      // Local typing reflows the line every remote caret in this block points
      // into, and nothing on the wire announces that — the peers did not move,
      // the text under them did.
      expect(renderer.repositioned).toBeGreaterThan(before);
    });

    it('clears a published caret when it moves somewhere it cannot name', () => {
      const { seam, target, caret, presence } = setup({ position: at('block-1', 4) });

      presence.start();

      caret.position = null;
      moveCaret(target);
      vi.advanceTimersByTime(200);

      // Leaving the last position published would strand a peer's caret in a
      // block they walked out of.
      expect(seam.localState().caret).toBeNull();
    });
  });

  describe('the local client id', () => {
    it('is latched from the first local-origin change', () => {
      const { presence } = setup({ clientId: 7, user: { name: 'Ada' } });

      expect(presence.localClientId).toBeNull();

      presence.start();

      expect(presence.localClientId).toBe(7);
    });

    it('keys the default colour, so it never changes mid-session', () => {
      const first = setup({ clientId: 7, user: { name: 'Ada' } });
      const second = setup({ clientId: 7, user: { name: 'Ada' } });

      first.presence.start();
      second.presence.start();

      const colorOf = (seam: FakeAwareness): unknown =>
        (seam.localState().user as { color?: unknown }).color;

      expect(colorOf(first.seam)).toBe(colorOf(second.seam));
      expect(PRESENCE_PALETTE).toContain(colorOf(first.seam));
    });

    it('gives different clients different colours across the palette', () => {
      const colors = new Set(
        Array.from({ length: PRESENCE_PALETTE.length }, (_unused, index) => presenceColorFor(index))
      );

      expect(colors.size).toBe(PRESENCE_PALETTE.length);
    });

    /**
     * A lineage reset hands `start()` a new Awareness carrying the OLD local
     * state. Republishing it changes nothing, so y-protocols emits no `change`
     * at all — and a latch that waits for one never re-arms, leaving the local
     * user drawn as a peer to themselves.
     */
    it('re-latches after a lineage reset restored an identical state', () => {
      const { seam, presence } = setup({ clientId: 7, user: { name: 'Ada', color: '#0b6e99' } });

      presence.start();

      expect(presence.localClientId).toBe(7);

      presence.stop();
      seam.reset(9);

      const changesBefore = seam.emissions.change;

      presence.start();

      // Every republished field matches what the reset restored, so not one
      // `change` is emitted the whole way through `start()`.
      expect(seam.emissions.change).toBe(changesBefore);
      expect(presence.localClientId).toBe(9);
    });

    it('never draws the local user as a peer after that reset', () => {
      const { seam, renderer, presence } = setup({ clientId: 7, user: { name: 'Ada', color: '#0b6e99' } });

      presence.start();
      presence.stop();
      seam.reset(9);
      presence.start();

      const last = renderer.renders.at(-1);

      expect(last?.localClientId).toBe(9);
      expect(last?.states.map((entry) => entry.clientId)).not.toContain(9);
    });
  });

  describe('the configured colour', () => {
    it('is used when it is a plain hex colour', () => {
      const { seam, presence } = setup({ user: { name: 'Ada', color: '#AABBCC' } });

      presence.start();

      expect((seam.localState().user as { color: string }).color).toBe('#AABBCC');
    });

    it.each([
      'red; background: url(javascript:alert(1))',
      '#fff);--blok-presence-color:url(x',
      '#12345',
      'expression(alert(1))',
      'var(--anything)',
    ])('is refused when it is not one (%s), so nothing hostile is broadcast', (color) => {
      const { seam, presence } = setup({ user: { name: 'Ada', color } });

      presence.start();

      expect(isPresenceColor(color)).toBe(false);
      expect((seam.localState().user as { color: string }).color).toBe(presenceColorFor(42));
    });
  });

  describe('the caret listener', () => {
    it('follows the caret to another block', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      caret.blockId = 'block-2';
      moveCaret(target);

      expect(seam.localState().blockId).toBe('block-2');
    });

    it('throttles: many caret moves in one window publish once', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();

      const before = seam.writes.length;

      ['a', 'b', 'c', 'd'].forEach((suffix) => {
        caret.blockId = `block-${suffix}`;
        moveCaret(target);
      });

      expect(seam.writes.length - before).toBe(1);

      vi.advanceTimersByTime(200);

      expect(seam.writes.length - before).toBe(2);
      expect(seam.localState().blockId).toBe('block-d');
    });

    it('writes nothing when the caret stays in the same block', () => {
      const { seam, target, presence } = setup({ user: { name: 'Ada' } });

      presence.start();

      const before = seam.writes.length;

      moveCaret(target);
      vi.advanceTimersByTime(500);

      expect(seam.writes.length).toBe(before);
    });

    it('publishes on focus as well as on selection', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      caret.blockId = 'block-9';
      target.dispatchEvent(new Event('focusin'));

      expect(seam.localState().blockId).toBe('block-9');
    });
  });

  describe('the renderer feed', () => {
    it('hands over the peers to draw, plus which client id is local', () => {
      const { seam, renderer, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      seam.join(99, { user: { name: 'Grace' }, blockId: 'block-2' });

      const last = renderer.renders.at(-1);

      expect(last?.localClientId).toBe(42);
      expect(last?.states.map((entry) => entry.clientId)).toEqual([99]);
    });

    it('does not repaint for a purely local caret move', () => {
      const { renderer, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();

      const before = renderer.renders.length;

      caret.blockId = 'block-2';
      moveCaret(target);

      expect(renderer.renders.length).toBe(before);
    });

    it('repaints when a disconnect drops every peer, even though that is tagged local', () => {
      const { seam, renderer, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      seam.join(99, { user: { name: 'Grace' }, blockId: 'block-2' });

      const before = renderer.renders.length;

      seam.dropRemotes();

      expect(renderer.renders.length).toBe(before + 1);
      expect(renderer.renders.at(-1)?.states).toEqual([]);
    });

    /**
     * One hostile client can plant tens of thousands of fabricated ids, and
     * every awareness change re-walks the map. The walk is bounded — and it
     * selects DRAWABLE peers as it goes, so junk fills the scan budget, never
     * the peer budget: a real collaborator behind a wall of it still arrives.
     */
    it('walks a bounded slice of a fabricated awareness map', () => {
      const { states, scanned } = countingMap();

      fabricate(states, 1, 200);
      states.set(99_000, { user: { name: 'Grace' }, blockId: 'block-2' });
      fabricate(states, 10_000, 5000);

      const { renderer, presence, notifyRemote } = setupWith(states);

      presence.start();

      const before = scanned();

      notifyRemote();

      const walked = scanned() - before;

      // The junk ahead of Grace eats the SCAN budget, never the PEER budget —
      // a cap that counted junk as a peer would be the eclipse it exists to
      // prevent.
      expect(renderer.renders.at(-1)?.states.map((entry) => entry.clientId)).toEqual([99_000]);
      expect(walked).toBeGreaterThan(0);
      expect(walked).toBeLessThanOrEqual(PRESENCE_SCAN_LIMIT);
    });

    it('hands over no more peers than the peer cap', () => {
      const states = new Map<number, Record<string, unknown>>();

      for (let index = 0; index < MAX_PEERS * 4; index += 1) {
        states.set(index + 1, { user: { name: `Peer ${index}` }, blockId: `block-${index}` });
      }

      const { renderer, presence, notifyRemote } = setupWith(states);

      presence.start();
      notifyRemote();

      expect(renderer.renders.at(-1)?.states).toHaveLength(MAX_PEERS);
    });

    it('never stops publishing because the renderer draws nothing', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      caret.blockId = 'block-2';
      moveCaret(target);

      // A read-only viewer with `hideControls` renders no presence UI at all;
      // the state it broadcasts is identical, which is what puts it in
      // everybody else's avatar stack.
      expect(seam.localState()).toEqual({
        blockId: 'block-2',
        caret: null,
        user: { name: 'Ada', color: presenceColorFor(42) },
      });
    });
  });

  describe('stop', () => {
    it('clears the rendered presence immediately', () => {
      const { seam, renderer, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      seam.join(99, { user: { name: 'Grace' }, blockId: 'block-2' });
      presence.stop();

      expect(renderer.cleared).toBe(1);
    });

    it('stops publishing — including the throttle call already in flight', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      caret.blockId = 'block-2';
      moveCaret(target);
      caret.blockId = 'block-3';
      moveCaret(target);

      const before = seam.writes.length;

      presence.stop();
      vi.advanceTimersByTime(1000);
      caret.blockId = 'block-4';
      moveCaret(target);
      vi.advanceTimersByTime(1000);

      expect(seam.writes.length).toBe(before);
    });

    it('unsubscribes from awareness', () => {
      const { seam, renderer, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      presence.stop();

      const before = renderer.renders.length;

      seam.join(99, { user: { name: 'Grace' }, blockId: 'block-2' });

      expect(renderer.renders.length).toBe(before);
    });

    it('forgets the local client id, so a replaced awareness re-latches it', () => {
      const { presence } = setup({ clientId: 7, user: { name: 'Ada' } });

      presence.start();
      presence.stop();

      expect(presence.localClientId).toBeNull();
    });

    it('is idempotent, and a second start reattaches', () => {
      const { seam, target, caret, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      presence.stop();
      presence.stop();
      presence.start();

      caret.blockId = 'block-2';
      moveCaret(target);

      expect(seam.localState().blockId).toBe('block-2');
    });
  });

  /**
   * y-protocols guards only the REMOVAL of the local state against remote
   * frames. A frame naming this client's id with a higher clock replaces the
   * local state outright, and every later local write spreads that state back
   * onto the wire under this client's real id. Real stores here, not the fake:
   * the overwrite is y-protocols' own behaviour.
   */
  describe('a peer overwriting the local state', () => {
    const stores: DocumentStore[] = [];

    const realStore = (): DocumentStore => {
      const store = new DocumentStore(new YBlockSerializer());

      store.enableAwareness();
      stores.push(store);

      return store;
    };

    afterEach(() => {
      stores.splice(0).forEach((store) => store.destroy());
    });

    it('republishes the configured identity, block and caret, and wins on the wire', () => {
      const victim = realStore();
      const observer = realStore();
      const presence = createPresence({
        yjs: victim,
        user: { name: 'Ada', color: '#0b6e99' },
        currentBlockId: () => 'block-1',
        currentCaret: () => at('block-1', 4),
        eventTarget: new EventTarget(),
      });

      started.push(presence);
      presence.start();

      const victimId = presence.localClientId;

      if (victimId === null) {
        throw new Error('the local client id was never latched');
      }

      observer.applyAwarenessUpdate(victim.encodeAwarenessUpdate([victimId]), 'remote');

      const forged = forgedAwarenessFrame(victimId, 1000, {
        user: { name: 'HOSTILE', color: '#000000' },
        blockId: 'block-9',
        caret: null,
      });

      // The attack lands on every peer first — that is the whole reason the
      // republish has to be louder than the forgery.
      observer.applyAwarenessUpdate(forged, 'remote');

      expect(observer.getAwarenessStates().get(victimId)).toMatchObject({ user: { name: 'HOSTILE' } });

      victim.applyAwarenessUpdate(forged, 'remote');

      expect(victim.getAwarenessStates().get(victimId)).toMatchObject({
        user: { name: 'Ada', color: '#0b6e99' },
        blockId: 'block-1',
        caret: { blockId: 'block-1', head: 4 },
      });

      observer.applyAwarenessUpdate(victim.encodeAwarenessUpdate([victimId]), 'remote');

      expect(observer.getAwarenessStates().get(victimId)).toMatchObject({
        user: { name: 'Ada', color: '#0b6e99' },
        blockId: 'block-1',
        caret: { blockId: 'block-1', head: 4 },
      });
    });
  });
});
