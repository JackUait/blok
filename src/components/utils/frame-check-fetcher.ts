import type { BlokConfig } from '../../../types';

type CheckEmbed = NonNullable<NonNullable<BlokConfig['linkPaste']>['checkEmbed']>;
type Verdict = Awaited<ReturnType<CheckEmbed>>['verdict'];

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(['allowed', 'blocked', 'insecure', 'unknown']);

const isVerdict = (value: unknown): value is Verdict => typeof value === 'string' && VERDICTS.has(value);

export interface FrameCheckOptions {
  /** The server's `/frame-check` URL. */
  endpoint: string;
  /** Sent with each request; a function mints a fresh access pass each time. */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
}

/**
 * A `linkPaste.checkEmbed` that asks Blok's server: `GET <endpoint>?url=<url>`,
 * answering `{ verdict, link, oembed }`. Only `verdict` is used. Any failure
 * answers `unknown`, which lets the embed go ahead.
 */
export function createFrameCheck(options: FrameCheckOptions): CheckEmbed {
  return async (url) => {
    try {
      const headers = typeof options.headers === 'function' ? await options.headers() : options.headers;
      const response = await fetch(`${options.endpoint}?url=${encodeURIComponent(url)}`, { headers });

      if (!response.ok) {
        return { verdict: 'unknown' };
      }

      const body: unknown = await response.json();
      const verdict = typeof body === 'object' && body !== null && 'verdict' in body ? body.verdict : undefined;

      return { verdict: isVerdict(verdict) ? verdict : 'unknown' };
    } catch {
      return { verdict: 'unknown' };
    }
  };
}
