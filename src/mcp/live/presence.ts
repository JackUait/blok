import { createHash } from 'node:crypto';
import { isPresenceColor, presenceColorFor } from '../../components/modules/collaboration/presence';
import type { AgentActor, AgentResult } from '../../../types/agent';
import type { PresenceSink } from './live-session';

export interface PresenceTarget { setAwarenessField(field: string, value: unknown): void; sendActivity(): boolean }
export interface AgentPresenceOptions {
  actor: AgentActor;
  /** The published presence name; defaults to actor.name. Attribution still uses actor.name. */
  name?: string;
  onBehalfOfName?: string;
  now?: () => number;
}

const ACTIVITY_INTERVAL_MS = 60_000;

/** Stable small number from the actor id, so the default color does not change per connection. */
const colorSeed = (id: string): number => createHash('sha256').update(id).digest().readUInt16BE(0);

/**
 * The agent's awareness fields. Never writes `caret`: its `inputIndex` counts
 * DOM inputs, which a headless member does not have.
 */
export class AgentPresence implements PresenceSink {
  private readonly target: PresenceTarget;
  private readonly options: AgentPresenceOptions;
  private readonly now: () => number;
  private readonly color: string;
  private readonly name: string;
  private lastActivity: number | null = null;

  constructor(target: PresenceTarget, options: AgentPresenceOptions) {
    this.target = target;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.name = options.name ?? options.actor.name;
    this.color = isPresenceColor(options.actor.color) ? options.actor.color : presenceColorFor(colorSeed(options.actor.id));
  }

  public announce(): void {
    const { actor, onBehalfOfName } = this.options;

    this.target.setAwarenessField('user', { name: this.name, color: this.color, id: actor.id });
    // A new field, not a change to `user`: old clients read existing fields by name.
    this.target.setAwarenessField('agent', {
      via: 'mcp',
      onBehalfOf: actor.onBehalfOf ?? actor.id,
      ...(onBehalfOfName !== undefined && { onBehalfOfName }),
    });
  }

  public afterBatch(result: AgentResult): void {
    if (!result.ok) {
      return;
    }
    const { created, updated, moved } = result.changed;
    const touched = created.at(-1) ?? updated.at(-1) ?? moved.at(-1);
    const now = this.now();

    this.target.setAwarenessField('activeAt', now);
    if (touched !== undefined) {
      const range = result.lastRange;
      const blockId = range?.blockId ?? touched;

      this.target.setAwarenessField('blockId', blockId);
      this.target.setAwarenessField('agentCursor', {
        actorId: this.options.actor.id,
        name: this.name,
        color: this.color,
        blockId,
        ...(range !== undefined && { field: range.field, start: range.start, end: range.end }),
      });
    }
    // A send on a socket that was not ready does not spend the minute.
    if ((this.lastActivity === null || now - this.lastActivity >= ACTIVITY_INTERVAL_MS) && this.target.sendActivity()) {
      this.lastActivity = now;
    }
  }

  public clear(): void {
    this.target.setAwarenessField('agentCursor', null);
    this.target.setAwarenessField('blockId', null);
  }
}
