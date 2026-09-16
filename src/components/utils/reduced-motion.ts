/**
 * Whether the reader has asked the system to reduce motion.
 *
 * SSR-safe and tolerant of a `window` without `matchMedia`: both answer false,
 * so a caller falls back to its animated path rather than throwing.
 *
 * Two module-private copies of this predicate still live in `modal-dialog.ts`
 * and `media-empty-state.ts`; they are identical and should move here.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
