/**
 * A paste event a tool dispatches to finish the user's paste (the table hands
 * the content around a pasted grid to the editor's paste handling). It is
 * part of that gesture, not a new one, and the tool waits for it to settle.
 */
const continuations = new WeakMap<Event, Promise<void> | null>();

/**
 * Mark a paste event as the continuation of the current paste gesture.
 * @param event - the paste event about to be dispatched
 */
export const markPasteContinuation = (event: Event): void => {
  continuations.set(event, null);
};

/**
 * @param event - a paste event
 * @returns whether the event continues the current paste gesture
 */
export const isPasteContinuation = (event: Event): boolean => continuations.has(event);

/**
 * Record the paste handling of a marked event. Unmarked events are ignored.
 * @param event - the paste event being handled
 * @param handling - resolves when the paste has landed
 */
export const recordPasteHandling = (event: Event, handling: Promise<void>): void => {
  if (continuations.has(event)) {
    continuations.set(event, handling);
  }
};

/**
 * @param event - a marked paste event, after its dispatch
 * @returns resolves when its paste has landed, at once when nothing handled it
 */
export const pasteContinuationSettled = (event: Event): Promise<void> =>
  continuations.get(event) ?? Promise.resolve();
