import type { API } from '../../../types';

import { logLabeled } from './logger';

/**
 * i18n key for the toast shown when a "turn into" did not happen.
 */
const CONVERT_FAILED_MESSAGE_KEY = 'blockSettings.convertFailed';

/**
 * The slice of the public API a refusal report needs. Core modules pass
 * `Blok.API.methods`; a block tool passes its own `api`.
 */
export type ConvertRefusalReporter = Pick<API, 'notifier' | 'i18n'>;

/**
 * Run a "turn into" and turn a refusal into `null` instead of a rejection.
 *
 * `BlockManager.convert()` REJECTS rather than writing a stale snapshot back
 * over a peer's keystrokes, so a refusal is a normal outcome of a shared
 * document, not a crash. Every UI entry point goes through here for two
 * reasons:
 *
 * - No caller that fires a conversion and forgets the promise (`void
 *   handler()`, or a popover invoking an async `onActivate` inside a
 *   SYNCHRONOUS try/catch that cannot catch it) leaves an unhandled rejection
 *   behind, or skips the cleanup that follows the await.
 * - The user is told. A silent no-op is indistinguishable from a broken
 *   editor, so the refusal gets the same kind of toast a failed "copy link to
 *   block" produces; the console gets the real error.
 * @param reporter - notifier + i18n to report a refusal through
 * @param run - starts the conversion
 * @returns what the conversion produced, or null when it was refused
 */
export const runConvert = async <T>(
  reporter: ConvertRefusalReporter,
  run: () => Promise<T>
): Promise<T | null> => {
  try {
    return await run();
  } catch (error) {
    logLabeled('A block conversion did not happen', 'warn', error);

    reporter.notifier.show({
      message: reporter.i18n.t(CONVERT_FAILED_MESSAGE_KEY),
      style: 'error',
      time: 4000,
    });

    return null;
  }
};
