/**
 * Fired when serializing the editor (auto-save or an explicit `save()`) throws.
 * Lets internal modules and adapters observe save failures that would otherwise
 * only be logged.
 */
export const SaveFailed = 'save failed';

/**
 * Payload that will be passed with the event
 */
export interface SaveFailedPayload {
  /**
   * The error raised while saving.
   */
  error: Error;
}
