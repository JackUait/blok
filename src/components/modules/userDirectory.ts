import type { UserInfo } from '../../../types/configs/user-info';
import { Module } from '../__module';

/**
 * How many peer names are kept. Awareness is unauthenticated, so a hostile
 * room member can mint a fresh id on every frame; without a bound that would
 * be an unbounded map fed straight off the wire.
 */
export const LEARNED_NAMES_LIMIT = 200;

/** Matches what presence lets a peer draw on screen. */
const MAX_NAME_LENGTH = 32;

/**
 * The one form of a user id everything here compares against.
 *
 * The document stores ids NUL-stripped (see the serializer), so an id
 * configured with a NUL comes back in a different form than it went in, and an
 * id carrying stray whitespace would key the cache under a string no block ever
 * names. Normalising once removes both mismatches.
 * @param value - a user id from config or off the wire
 * @returns the comparable id, or null when there is none
 */
export const normalizeUserId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\0/gu, '').trim();

  return normalized === '' ? null : normalized;
};

/**
 * Trims a display name and caps it by code points, not UTF-16 units, so a
 * name of emoji is never cut into a lone surrogate.
 * @param value - the candidate name, from config or off the wire
 * @returns the usable name, or null when there is none
 */
const usableName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  return Array.from(trimmed.slice(0, 2 * MAX_NAME_LENGTH)).slice(0, MAX_NAME_LENGTH).join('');
};

/**
 * Answers "who is this user id" for the editor UI.
 *
 * Three sources, cheapest first: the host's own `user` config, names peers
 * published about themselves in a collaborative session, and the host's
 * `resolveUser` callback. The first two answer synchronously, which is what
 * keeps the block settings footer from painting a generic label and swapping
 * it a frame later.
 */
export class UserDirectory extends Module {
  /** Answers from `resolveUser`, so the host is asked once per id. */
  private resolved = new Map<string, UserInfo>();

  /** In-flight `resolveUser` calls, so concurrent askers share one. */
  private pending = new Map<string, Promise<UserInfo | null>>();

  /** Ids the host had no answer for, so it is asked once, not once per open. */
  private unknownToHost = new Set<string>();

  /** Names peers published about themselves. Insertion-ordered, bounded. */
  private learned = new Map<string, string>();

  /** This editor's own display name, from its own config — never off the wire. */
  private selfName: string | null = null;

  /**
   * Records this editor's own display name, for a host that names itself
   * through `collaboration.user` rather than `user.name`.
   * @param name - the display name this editor publishes to a room
   */
  public identify(name: unknown): void {
    this.selfName = usableName(name);
  }

  /**
   * What this directory can say about a user right now, with no async work.
   * @param id - the user id stored on a block
   * @returns the user, or null when nothing is known
   */
  public known(id: string): UserInfo | null {
    const key = normalizeUserId(id);

    if (key === null || this.isDestroyed) {
      return null;
    }

    const hostAnswer = this.resolved.get(key);

    /**
     * Nothing a peer publishes may name the local user: awareness is
     * unauthenticated, so a forged pair would otherwise rename this person in
     * their own footer. Their own config and the host directory still can.
     */
    if (key === normalizeUserId(this.config.user?.id)) {
      const trusted = usableName(this.config.user?.name) ?? this.selfName;

      return trusted !== null ? { name: trusted } : hostAnswer ?? null;
    }

    if (hostAnswer !== undefined) {
      return hostAnswer;
    }

    const learnedName = this.learned.get(key);

    return learnedName !== undefined ? { name: learnedName } : null;
  }

  /**
   * Asks the host's `resolveUser`, once per id, and remembers the answer.
   * A host that has nothing for this id does not erase what presence taught
   * us, so the caller always gets the best name available.
   * @param id - the user id stored on a block
   * @returns the user, or null when nobody can name them
   */
  public async resolve(id: string): Promise<UserInfo | null> {
    const key = normalizeUserId(id);
    const resolveUser = this.config.resolveUser;

    if (key === null || resolveUser === undefined || this.resolved.has(key) || this.unknownToHost.has(key)) {
      return this.known(id);
    }

    // The host cannot improve on a name this editor holds about itself, and
    // asking anyway would paint one name and then swap it for the other.
    if (key === normalizeUserId(this.config.user?.id) && this.known(key) !== null) {
      return this.known(key);
    }

    const inFlight = this.pending.get(key);

    if (inFlight !== undefined) {
      return inFlight;
    }

    // A host callback may throw synchronously, reject, or answer with
    // something that is not a user at all; none of those may reach the caller
    // as a failure, and none may be cached as if the host had answered.
    const request = (async (): Promise<UserInfo | null> => {
      try {
        const answer = await resolveUser(key);
        const name = usableName(answer?.name);

        // The editor can be torn down while the host is still looking; caching
        // an answer nobody will read only keeps the dead editor reachable.
        if (this.isDestroyed) {
          return null;
        }

        if (name === null) {
          this.unknownToHost.add(key);
        } else {
          this.resolved.set(key, { ...answer, name });
        }
      } catch {
        // A failed lookup is not an answer, so the host may be asked again.
      } finally {
        this.pending.delete(key);
      }

      // One precedence rule for both paints: whatever `known` says now.
      return this.known(key);
    })();

    this.pending.set(key, request);

    return request;
  }

  /**
   * Remembers what a peer published about itself in awareness. Both arguments
   * come off the wire, so neither is trusted to be a string.
   * @param id - the peer's attribution id
   * @param name - the peer's display name
   */
  public learn(id: unknown, name: unknown): void {
    const key = normalizeUserId(id);
    const value = usableName(name);

    if (key === null || value === null || key === normalizeUserId(this.config.user?.id)) {
      return;
    }

    // Re-insert so the newest name is also the newest entry for eviction.
    this.learned.delete(key);
    this.learned.set(key, value);

    while (this.learned.size > LEARNED_NAMES_LIMIT) {
      const oldest = this.learned.keys().next();

      if (oldest.done === true) {
        break;
      }

      this.learned.delete(oldest.value);
    }
  }
}
