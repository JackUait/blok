/**
 * BlockManager module barrel export
 */

export { BlockManager } from './blockManager';

// Re-export sub-modules for external use if needed
export { BlockRepository } from './repository';
export { BlockFactory } from './factory';
export { BlockHierarchy } from './hierarchy';
export { BlockYjsSync } from './yjs-sync';
export { BlockOperations } from './operations';

// Export types
export type { BlockFactoryDependencies } from './factory';
export type { BlockOperationsDependencies } from './operations';
export type { BlockYjsSyncDependencies, SyncHandlers } from './yjs-sync';
export type {
  ComposeBlockOptions,
  InsertBlockOptions,
  UpdateBlockOptions,
  ConvertBlockOptions,
  BlockOperationResult,
  BlockMutationEventDetailWithoutTarget,
  BlocksStore,
} from './types';
