import { BlokState } from '../configs/blok-config';

/**
 * The live callback config: every editor handler blok re-reads from the config
 * on each keypress / change batch / render, so it can be swapped or removed
 * without recreating the instance.
 *
 * A key you omit is left exactly as it was. A key present with `undefined`
 * UNSETS the handler — which matters, because for several of these the mere
 * presence of a function is the semantics: an `onSubmit` makes Enter serialize
 * and submit instead of splitting the block, and an `onSave` arms the
 * change-observation pipeline.
 */
export type LiveHandlers = Pick<
  BlokState,
  'onChange' | 'onSave' | 'onEnter' | 'onSubmit' | 'onBeforeRender' | 'onAfterRender'
>;

/**
 * Runtime setter for the editor's live callbacks (the reactive contract half of
 * {@link BlokState}'s handler fields).
 */
export interface Handlers {
  /**
   * Installs, replaces or removes editor callbacks in place — no recreation, so
   * caret, selection, scroll and undo history all survive.
   *
   * Only the keys present on the object are touched; a key whose value is
   * `undefined` unsets that handler. Use it to make callback PRESENCE reactive:
   * `handlers.set({ onSubmit: sendsOnEnter ? submit : undefined })` flips Enter
   * between "submit the document" and blok's default block split.
   * @param handlers - partial map of live handlers to install or unset
   */
  set(handlers: LiveHandlers): void;
}
