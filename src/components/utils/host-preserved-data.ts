/**
 * Key of a hidden BlockAPI method that returns `preservedData` the way hosts
 * receive it (segments). Not published: the
 * adapters' `getBlockData` reads it and falls back to `preservedData` when
 * absent. `Symbol.for` because the adapters can be bundled apart from core.
 */
export const HOST_PRESERVED_DATA: unique symbol = Symbol.for('blok.hostPreservedData');
