/**
 * Marks an Escape press that already closed a Blok layer (a popover), so later
 * Blok handlers on the same press stand down: one Escape closes one layer.
 *
 * Not preventDefault: Blok is published, and hosts and third-party tools read
 * `defaultPrevented`. A WeakSet keeps the mark invisible on the event.
 * Core and tools share one copy of this module (rollup shared chunks, one IIFE).
 */
const consumed = new WeakSet<Event>();

export const markEscapeConsumed = (event: Event): void => {
  consumed.add(event);
};

export const isEscapeConsumed = (event: Event): boolean => consumed.has(event);
