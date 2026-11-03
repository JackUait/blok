import type { BlokConfig } from '../../../types/configs/blok-config';

/** The host's frame check, `linkPaste.checkEmbed`. */
export type CheckEmbed = NonNullable<NonNullable<BlokConfig['linkPaste']>['checkEmbed']>;

/** How long a paste waits for the check before it goes on with the embed. */
export const CHECK_EMBED_TIMEOUT_MS = 3_000;

/**
 * Whether the host's frame check says this URL should not be embedded.
 *
 * Only an exact `blocked` or `insecure` counts. Anything else (no check, an
 * error, a late or odd answer) means "go on", so a slow or broken backend
 * never blocks a paste. The answer is a UI hint: callers never store it and
 * never let it loosen the embed rules.
 */
export async function embedCheckRefuses(check: CheckEmbed | undefined, url: string): Promise<boolean> {
  if (check === undefined) {
    return false;
  }

  const timer: { id?: ReturnType<typeof setTimeout> } = {};
  const timeout = new Promise<null>((resolve) => {
    timer.id = setTimeout(() => resolve(null), CHECK_EMBED_TIMEOUT_MS);
  });

  try {
    const answer: unknown = await Promise.race([Promise.resolve().then(() => check(url)), timeout]);

    if (typeof answer !== 'object' || answer === null || !('verdict' in answer)) {
      return false;
    }

    return answer.verdict === 'blocked' || answer.verdict === 'insecure';
  } catch {
    return false;
  } finally {
    clearTimeout(timer.id);
  }
}
