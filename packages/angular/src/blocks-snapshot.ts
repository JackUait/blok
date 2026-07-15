// packages/angular/src/blocks-snapshot.ts
//
// The block-tree data types AND the `UseBlocksApi` connection contract are
// framework-agnostic and live in the shared core module. The Angular
// `injectBlocks` is a thin reactivity wrapper over the shared
// `createBlocksApiForEditor`, so it exposes the IDENTICAL surface as the React
// and Vue adapters — this file re-exports those shapes (no Angular-local
// redefinition, so the adapters cannot drift).
export type {
  BlockNode,
  CaretTarget,
  InsertPosition,
  InsertSpec,
  TreeInsertSpec,
  MoveTarget,
  UseBlocksApi,
} from '@bloklabs/core/adapters';
