import { loadEmojiData } from './emoji-data';
import { loadEmojiLocale } from './emoji-locale';

/**
 * Warm the caches the picker blocks on when it opens.
 *
 * The emoji dataset is two lazy chunks: the grid (~99KB, ~23KB brotli) and the
 * search keywords (~71KB, ~15KB brotli). Fetching them at click time is nearly
 * the whole of a slow first open: on a throttled 4G profile a cold open
 * measured ~500ms, versus ~50ms once this had run. The
 * loaders are module-cached, so calling this on hover/focus of the trigger
 * moves the transfer off the open path — and repeat calls are free.
 *
 * Fire-and-forget: a warm-up that fails must stay silent and let `open()` retry.
 * @param locale - active editor locale, whose emoji annotations are warmed too
 */
export function prefetchEmojiPickerData(locale: string): void {
  void loadEmojiData().catch(() => undefined);

  if (locale !== 'en') {
    void loadEmojiLocale(locale).catch(() => undefined);
  }
}
