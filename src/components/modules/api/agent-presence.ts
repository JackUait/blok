import type { ChangedSet, TextRangeRef } from '../../../../types/agent';
import type { AgentIdentity } from '../../../../types/api';
import { highlightBlockArrival } from '../../utils/highlight-block-arrival';
import { createAgentMarkerLayer } from '../collaboration/agent-marker-layer';
import { placeAgent, type AgentTarget } from '../collaboration/agent-placement';
import { agentColorFor, capPresenceName, isPresenceColor } from '../collaboration/presence';
import { createCaretLayer } from '../collaboration/presence-carets';

/** Negative, so it never collides with a Yjs awareness client id. */
export const AGENT_CLIENT_ID = -1;

export interface AgentCursorField {
  actorId: string;
  name: string;
  color?: string;
  blockId: string;
  field?: string;
  start?: number;
  end?: number;
}

export interface AgentPresenceOptions {
  host: HTMLElement;
  resolveHolder(blockId: string): HTMLElement | null;
  resolveInputs(blockId: string): HTMLElement[];
  inputIndexFor(blockId: string, field: string): number | null;
  isHidden(): boolean;
  publish(cursor: AgentCursorField | null): void;
  scrollTo(blockId: string): void;
}

export interface AgentPresence {
  start(agent: AgentIdentity, options: { follow: boolean }): void;
  /** `draw: false` still publishes the cursor and follows, but draws no caret, marker or pulse here. */
  show(result: { changed: ChangedSet; lastRange?: TextRangeRef }, showOptions?: { draw?: boolean }): void;
  stop(): void;
}

/** highlightBlockArrival forces a reflow per call, so a huge batch must not pulse every holder. */
export const MAX_PULSES = 50;

const pulse = (changed: ChangedSet, resolveHolder: (id: string) => HTMLElement | null): void => {
  // Ids with no holder do not use up the cap.
  [...new Set([...changed.created, ...changed.updated, ...changed.moved])]
    .map(resolveHolder)
    .filter((holder): holder is HTMLElement => holder !== null)
    .slice(0, MAX_PULSES)
    .forEach(highlightBlockArrival);
};

/** User intent only. `scroll` is not here: the follow scroll fires it too. */
const INTENT_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

const cursorFor = (agent: { id: string; name: string; color: string }, target: AgentTarget): AgentCursorField => ({
  actorId: agent.id,
  name: agent.name,
  color: agent.color,
  blockId: target.blockId,
  ...(typeof target.field === 'string' ? { field: target.field } : {}),
  ...(typeof target.start === 'number' && typeof target.end === 'number' ? { start: target.start, end: target.end } : {}),
});

const lastOf = (ids: string[]): string | undefined => ids[ids.length - 1];

/** lastRange when the batch wrote text, else the last created, moved or updated block. */
const targetOf = (result: { changed: ChangedSet; lastRange?: TextRangeRef }): AgentTarget | null => {
  if (result.lastRange !== undefined) {
    const { blockId, field, start, end } = result.lastRange;

    return { blockId, field, start, end };
  }

  const blockId = lastOf(result.changed.created) ?? lastOf(result.changed.moved) ?? lastOf(result.changed.updated);

  return blockId === undefined ? null : { blockId };
};

/**
 * The in-app agent, drawn for the person at this editor: one caret or one
 * block-level marker. Separate from the collaboration renderer, which never
 * draws this client and keeps its own layers.
 * @param options - DOM lookups, the hide gate, and the publish/scroll seams
 */
export function createAgentPresence(options: AgentPresenceOptions): AgentPresence {
  const carets = createCaretLayer({ resolveHolder: options.resolveHolder, resolveInputs: options.resolveInputs });
  const markers = createAgentMarkerLayer({ resolveHolder: options.resolveHolder });
  const state: {
    agent: { id: string; name: string; color: string } | null;
    reflow: ResizeObserver | null;
    onInput: (() => void) | null;
    following: boolean;
    stopFollowing: (() => void) | null;
    published: boolean;
  } = { agent: null, reflow: null, onInput: null, following: false, stopFollowing: null, published: false };

  const follow = (): void => {
    const stop = (): void => {
      state.following = false;
    };

    state.following = true;
    INTENT_EVENTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));
    state.stopFollowing = (): void => {
      INTENT_EVENTS.forEach((type) => window.removeEventListener(type, stop, { capture: true }));
    };
  };

  const unfollow = (): void => {
    state.following = false;
    state.stopFollowing?.();
    state.stopFollowing = null;
  };

  // Single-player has no collaboration renderer to tell the caret layer to re-measure.
  const watch = (): void => {
    if (state.reflow === null && typeof ResizeObserver !== 'undefined') {
      state.reflow = new ResizeObserver(() => carets.reposition());
      state.reflow.observe(options.host);
    }

    if (state.onInput === null) {
      state.onInput = (): void => carets.reposition();
      options.host.addEventListener('input', state.onInput);
    }
  };

  const unwatch = (): void => {
    state.reflow?.disconnect();
    state.reflow = null;

    if (state.onInput !== null) {
      options.host.removeEventListener('input', state.onInput);
      state.onInput = null;
    }
  };

  const draw = (agent: { name: string; color: string }, target: AgentTarget): void => {
    if (options.isHidden()) {
      carets.clear();
      markers.clear();

      return;
    }

    const placement = placeAgent(target, options);

    if (placement.kind === 'caret') {
      markers.render([]);
      carets.render([{ clientId: AGENT_CLIENT_ID, name: agent.name, color: agent.color, caret: placement.caret }]);

      return;
    }

    carets.render([]);
    markers.render([{ key: AGENT_CLIENT_ID, blockId: placement.blockId, name: agent.name, color: agent.color }]);
  };

  return {
    start(agent: AgentIdentity, startOptions: { follow: boolean }): void {
      unfollow();
      state.agent = {
        id: agent.id,
        name: capPresenceName(agent.name),
        color: isPresenceColor(agent.color) ? agent.color : agentColorFor(agent.id),
      };
      watch();

      if (startOptions.follow) {
        follow();
      }
    },

    show(result, showOptions = {}): void {
      const agent = state.agent;
      const local = showOptions.draw !== false;

      if (agent === null) {
        return;
      }

      if (local) {
        pulse(result.changed, options.resolveHolder);
      }

      const target = targetOf(result);

      if (target === null) {
        return;
      }

      options.publish(cursorFor(agent, target));
      state.published = true;
      if (local) {
        draw(agent, target);
      }

      if (state.following) {
        options.scrollTo(target.blockId);
      }
    },

    stop(): void {
      unfollow();
      if (state.published) {
        options.publish(null);
        state.published = false;
      }
      state.agent = null;
      carets.clear();
      markers.clear();
      unwatch();
    },
  };
}
