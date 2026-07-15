// src/vue/blocks-snapshot.ts
//
// The block-tree data types, pure flat-index resolvers, AND the `UseBlocksApi`
// connection contract are framework-agnostic and live in the shared core module
// (`components/utils/blocks-tree`). The Vue `useBlocks` is a thin reactivity
// wrapper over the shared `createBlocksApiForEditor`, so it exposes the IDENTICAL
// surface as the React adapter — this file re-exports those shapes (no Vue-local
// redefinition, so the two adapters cannot drift).
export type {
  BlockNode,
  CaretTarget,
  InsertPosition,
  InsertSpec,
  TreeInsertSpec,
  MoveTarget,
  UseBlocksApi,
} from '@bloklabs/core/adapters';
