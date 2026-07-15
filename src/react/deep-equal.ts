/**
 * Re-export of the framework-agnostic deep equality used to dedupe reactive
 * `data` updates. The implementation now lives in `src/shared/deep-equal.ts`
 * (shared with the Angular adapter); this module is kept for back-compat with
 * existing `./deep-equal` importers in the React adapter.
 */
export { deepEqual } from '@blok/core/adapters';
