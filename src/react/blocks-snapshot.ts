// src/react/blocks-snapshot.ts
//
// The block-tree connection types and pure resolution helpers are
// framework-agnostic and now live in a shared core module so the React, Vue,
// and Angular adapters — and core's own per-block `BlockAPI` — resolve flat
// insert/move indices through ONE battle-tested implementation (the parity
// requirement: author once, reuse everywhere). This file re-exports them so
// existing React imports (`./blocks-snapshot`) keep working unchanged.
export {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  parentMap,
  isDescendantOf,
} from '../components/utils/blocks-tree';

export type {
  BlockNode,
  CaretTarget,
  InsertPosition,
  InsertSpec,
  TreeInsertSpec,
  MoveTarget,
  BlocksReader,
  IndexReader,
  UseBlocksApi,
} from '../components/utils/blocks-tree';
