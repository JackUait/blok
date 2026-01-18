import type { BlokModules } from '../../../../types-internal/blok-modules';

/**
 * Base class for all BlockEvent composers.
 * Provides access to the Blok module system.
 */
export abstract class BlockEventComposer {
  constructor(protected readonly Blok: BlokModules) {}
}
