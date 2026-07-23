import type { API, OutputData } from '../../../types';

/**
 * Serializes the editor and delivers the full {@link OutputData} to the
 * consumer's `config.onSubmit` handler — the "Enter-to-send" gesture. The Enter
 * key handling is synchronous, so this fires the serialization and returns
 * immediately; the caller has already `preventDefault()`-ed and suppressed the
 * default block split/create, so a chat-style consumer gets the current document
 * without wiring `saver.save()` into `onEnter` by hand.
 * @param save - the editor's serializer (`Saver.save`)
 * @param api - blok.js api passed to the handler
 * @param onSubmit - the consumer's `config.onSubmit` handler
 */
export function deliverOnSubmit(
  save: () => Promise<OutputData | undefined>,
  api: API,
  onSubmit: (data: OutputData, api: API) => void
): void {
  void save()
    .then((data) => {
      if (data !== undefined) {
        onSubmit(data, api);
      }
    })
    .catch(() => {
      /**
       * Serialization failed — the Saver already surfaces the error via its own
       * `onError` channel, so swallow here to avoid an unhandled rejection.
       */
    });
}
