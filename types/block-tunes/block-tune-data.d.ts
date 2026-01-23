/**
 * Data for block tunes. Can be any type since block tunes define their own data structure.
 * Using `unknown` instead of `any` for type safety - consumers should narrow the type
 * when working with tune data.
 */
export type BlockTuneData = unknown;
