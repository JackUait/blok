import type { CollaborationStatusChangedPayload } from '../../../types/events/editor-events';
import { MAX_PEERS } from '../../components/modules/collaboration/presence';
import type { LayoutDraft } from '../tabs/draft';

/** How old a draft made without collaboration gets before any editor that loads it deletes it. */
export const LAYOUT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a collaborator's draft must go without its maker in the room
 * before an editor deletes it. The room withdraws presence the moment a
 * socket drops, so a blip reads as leaving; a reconnect waits up to 30s
 * (provider BACKOFF_CAP_MS), presence renews every 15s and expires after
 * 30s. Ten minutes is twenty capped retries: a maker gone that long has
 * left, and one that Applies later still gets its tabs back (Apply re-makes
 * a deleted layout block).
 */
export const LAYOUT_MAKER_ABSENCE_MS = 10 * 60_000;

interface Presence {
  present: ReadonlySet<number>;
  complete: boolean;
  since: number;
}

/** One editor's drafting: outlives a database tool that a replay rebuilds. */
export class LayoutDraftSession {
  /** Tabs and tabs blocks this editor drafted: not hidden here. */
  public readonly made = new Set<string>();
  /** This editor's own awareness ids, as the last status named them. */
  private self: number[] = [];
  /** Who is connected; null while not connected. */
  private presence: Presence | null = null;
  /** When each client id was last in the room, on this editor's clock. */
  private readonly lastSeen = new Map<number, number>();
  /** When this editor first saw each draft block, on its own clock: the maker's `at` may be skewed. */
  private readonly firstSeen = new Map<string, number>();

  public get connected(): boolean {
    return this.presence !== null;
  }

  public notePresence(status: CollaborationStatusChangedPayload, now: number): void {
    const participants = Array.isArray(status.participants) ? status.participants : [];
    const self = participants.find((participant) => participant.self);

    if (self !== undefined) this.self = [...self.clientIds];
    if (status.status !== 'connected') {
      this.presence = null;

      return;
    }
    const ids = new Set(participants.flatMap((participant) => participant.clientIds));

    ids.forEach((id) => this.lastSeen.set(id, now));
    this.presence = {
      present: ids,
      // The status lists at most MAX_PEERS other CONNECTIONS plus this one; rows fold a person's tabs.
      complete: ids.size < MAX_PEERS + 1,
      since: this.presence?.since ?? now,
    };
  }

  public newDraft(now: number): LayoutDraft {
    return { at: now, by: [...this.self] };
  }

  /**
   * Whether no one can still Apply or Discard the draft `blockId` holds. One
   * made under collaboration goes only once its maker has been out of a
   * complete room list for the whole absence window, counted on this
   * editor's clock from the latest of: connecting, last seeing the maker,
   * first seeing the draft. One made without it goes past the age bound.
   */
  public isAbandoned(blockId: string, draft: LayoutDraft, now: number): boolean {
    if (draft.by.length === 0) return now - draft.at > LAYOUT_DRAFT_TTL_MS;
    const seen = this.firstSeen.get(blockId) ?? now;

    this.firstSeen.set(blockId, seen);
    const presence = this.presence;

    if (presence === null || !presence.complete || draft.by.some((id) => presence.present.has(id))) return false;
    const absentSince = Math.max(presence.since, seen, ...draft.by.map((id) => this.lastSeen.get(id) ?? 0));

    return now - absentSince > LAYOUT_MAKER_ABSENCE_MS;
  }
}

const sessions = new WeakMap<WeakKey, LayoutDraftSession>();

/** The session of the editor `key` names (its wrapper). */
export const layoutDraftSession = (key: WeakKey): LayoutDraftSession => {
  const known = sessions.get(key) ?? new LayoutDraftSession();

  sessions.set(key, known);

  return known;
};
