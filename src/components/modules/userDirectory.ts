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
 * Trims a display name and caps it by code points, not UTF-16 units, so a
 * name of emoji is cut on a character boundary.
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

  /** Names peers published about themselves. Insertion-ordered, bounded. */
  private learned = new Map<string, string>();

  /**
   * What this directory can say about a user right now, with no async work.
   * @param id - the user id stored on a block
   * @returns the user, or null when nothing is known
   */
  public known(id: string): UserInfo | null {
    const configured = this.config.user;

    if (configured?.id === id) {
      const name = usableName(configured.name);

      if (name !== null) {
        return { name };
      }
    }

    const hostAnswer = this.resolved.get(id);

    if (hostAnswer !== undefined) {
      return hostAnswer;
    }

    const learnedName = this.learned.get(id);

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
    const resolveUser = this.config.resolveUser;

    if (resolveUser === undefined || this.resolved.has(id)) {
      return this.known(id);
    }

    const inFlight = this.pending.get(id);

    if (inFlight !== undefined) {
      return inFlight;
    }

    // A host callback may throw synchronously, reject, or answer with
    // something that is not a user at all; none of those may reach the caller
    // as a failure, and none may be cached as if the host had answered.
    const request = (async (): Promise<UserInfo | null> => {
      try {
        const answer = await resolveUser(id);
        const name = usableName((answer)?.name);

        if (answer === null || answer === undefined || name === null) {
          return this.known(id);
        }

        const user: UserInfo = { ...answer, name };

        this.resolved.set(id, user);

        return user;
      } catch {
        return this.known(id);
      } finally {
        this.pending.delete(id);
      }
    })();

    this.pending.set(id, request);

    return request;
  }

  /**
   * Remembers what a peer published about itself in awareness. Both arguments
   * come off the wire, so neither is trusted to be a string.
   * @param id - the peer's attribution id
   * @param name - the peer's display name
   */
  public learn(id: unknown, name: unknown): void {
    if (typeof id !== 'string') {
      return;
    }

    const key = id.trim();
    const value = usableName(name);

    if (key === '' || value === null) {
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
