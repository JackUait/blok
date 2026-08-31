/**
 * Presence — local awareness upkeep (Phase 3, task C3).
 *
 * What this file pins is the LOCAL half: what a client publishes about itself,
 * how often, and how it learns which awareness client id is its own. The DOM
 * half lives in presence-renderer.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRESENCE_PALETTE,
  createPresence,
  isPresenceColor,
  presenceColorFor,
  type Presence,
  type PresenceSeam,
  type PresenceState,
} from '../../../../../src/components/modules/collaboration/presence';
import type { PresenceRenderer } from '../../../../../src/components/modules/collaboration/presence-renderer';
import type { AwarenessChange } from '../../../../../src/components/modules/yjs/types';

/**
 * A stand-in for the awareness seam with y-protocols' observable semantics:
 * the local client is seeded with `{}` at construction, and every local write
 * emits a `change` with origin `'local'`.
 */
class FakeAwareness implements PresenceSeam {
  public readonly states = new Map<number, Record<string, unknown>>();

  public readonly writes: Array<{ field: string; value: unknown }> = [];

  private readonly listeners = new Set<(changes: AwarenessChange, origin: unknown) => void>();

  public constructor(public readonly clientId = 42) {
    this.states.set(clientId, {});
  }

  public setAwarenessField(field: string, value: unknown): void {
    this.writes.push({ field, value });
    this.states.set(this.clientId, { ...this.states.get(this.clientId), [field]: value });
    this.emit({ added: [], updated: [this.clientId], removed: [] }, 'local');
  }

  public getAwarenessStates(): Map<number, Record<string, unknown>> {
    return new Map(this.states);
  }

  public onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /** A peer joins. */
  public join(clientId: number, state: Record<string, unknown>): void {
    this.states.set(clientId, state);
    this.emit({ added: [clientId], updated: [], removed: [] }, 'remote');
  }

  /**
   * Every remote state goes at once — what `clearRemoteAwarenessStates` does on
   * a disconnect. y-protocols tags that removal `'local'`, which is exactly the
   * trap a "skip local-origin events" filter would fall into.
   */
  public dropRemotes(): void {
    const removed = Array.from(this.states.keys()).filter((id) => id !== this.clientId);

    removed.forEach((id) => this.states.delete(id));
    this.emit({ added: [], updated: [], removed }, 'local');
  }

  public localState(): Record<string, unknown> {
    return this.states.get(this.clientId) ?? {};
  }

  private emit(changes: AwarenessChange, origin: unknown): void {
    Array.from(this.listeners).forEach((listener) => listener(changes, origin));
  }
}

const fakeRenderer = (): PresenceRenderer & {
  renders: Array<{ states: PresenceState[]; localClientId: number | null }>;
  cleared: number;
} => {
  const renders: Array<{ states: PresenceState[]; localClientId: number | null }> = [];
  const state = { cleared: 0 };

  return {
    render: (states, localClientId) => {
      renders.push({ states, localClientId });
    },
    clear: () => {
      state.cleared += 1;
    },
    renders,
    get cleared(): number {
      return state.cleared;
    },
  };
};

const started: Presence[] = [];

interface SetupOptions {
  clientId?: number;
  user?: { name?: string; color?: string };
  blockId?: string | null;
}

const setup = (options: SetupOptions = {}) => {
  const seam = new FakeAwareness(options.clientId ?? 42);
  const renderer = fakeRenderer();
  const target = new EventTarget();
  const caret = { blockId: options.blockId === undefined ? 'block-1' : options.blockId };

  const presence = createPresence({
    yjs: seam,
    user: options.user,
    currentBlockId: () => caret.blockId,
    eventTarget: target,
    renderer,
  });

  started.push(presence);

  return { seam, renderer, target, caret, presence };
};

/** A caret move the browser would report. */
const moveCaret = (target: EventTarget): void => {
  target.dispatchEvent(new Event('selectionchange'));
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
        user: { name: 'Ada', color: presenceColorFor(42) },
      });
    });

    it('publishes the block alone when the host configured no user', () => {
      const { seam, presence } = setup();

      presence.start();

      expect(seam.localState()).toEqual({ blockId: 'block-1' });
      expect(seam.writes.map((write) => write.field)).toEqual(['blockId']);
    });

    it('publishes a null block when the caret is nowhere', () => {
      const { seam, presence } = setup({ blockId: null, user: { name: 'Ada' } });

      presence.start();

      expect(seam.localState().blockId).toBeNull();
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
    it('hands over every state, plus which one is local', () => {
      const { seam, renderer, presence } = setup({ user: { name: 'Ada' } });

      presence.start();
      seam.join(99, { user: { name: 'Grace' }, blockId: 'block-2' });

      const last = renderer.renders.at(-1);

      expect(last?.localClientId).toBe(42);
      expect(last?.states.map((entry) => entry.clientId).sort()).toEqual([42, 99]);
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
      seam.dropRemotes();

      expect(renderer.renders.at(-1)?.states.map((entry) => entry.clientId)).toEqual([42]);
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
});
