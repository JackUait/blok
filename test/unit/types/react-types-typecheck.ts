/**
 * Type-level conformance test for the published React adapter surface.
 * Run via `tsc --noEmit` (part of `yarn lint:types`). NOT executed — only compiled.
 *
 * Each assertion forces a compile error if the published `packages/react/types/index.d.ts`
 * drifts from the source implementation in `packages/react/src`.
 */
import type {
  UseBlokConfig as PublishedUseBlokConfig,
  BlokContentProps as PublishedBlokContentProps,
  BlokEditorProps as PublishedBlokEditorProps,
  BlockNode as PublishedBlockNode,
  CaretTarget as PublishedCaretTarget,
  InsertPosition as PublishedInsertPosition,
  InsertSpec as PublishedInsertSpec,
  TreeInsertSpec as PublishedTreeInsertSpec,
  MoveTarget as PublishedMoveTarget,
  UseBlocksApi as PublishedUseBlocksApi,
} from '../../../packages/react/types/index';
import type { UseBlokConfig as SourceUseBlokConfig } from '../../../packages/react/src/types';
import type { BlokEditorProps as SourceBlokEditorProps } from '../../../packages/react/src/BlokEditor';
import type { BlokContentProps as SourceBlokContentProps } from '../../../packages/react/src/types';
import type {
  BlockNode as SourceBlockNode,
  CaretTarget as SourceCaretTarget,
  InsertPosition as SourceInsertPosition,
  InsertSpec as SourceInsertSpec,
  TreeInsertSpec as SourceTreeInsertSpec,
  MoveTarget as SourceMoveTarget,
  UseBlocksApi as SourceUseBlocksApi,
} from '../../../packages/react/src/blocks-snapshot';

/** Compile error unless A and B are mutually assignable. */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/**
 * Compile error unless A and B are mutually assignable AND expose the exact same
 * key set. The key-set check is what catches a *missing optional* property
 * (e.g. an omitted `focus?:`), which plain assignability silently tolerates
 * because optional props stay mutually assignable.
 */
type AssertExact<A, B> = AssertEqual<A, B> extends true
  ? AssertEqual<keyof A, keyof B>
  : never;

const _useBlokConfig: AssertEqual<PublishedUseBlokConfig, SourceUseBlokConfig> = true;
const _contentProps: AssertEqual<PublishedBlokContentProps, SourceBlokContentProps> = true;
const _editorProps: AssertEqual<PublishedBlokEditorProps, SourceBlokEditorProps> = true;

// useBlocks block-creation surface — the published declarations must not drift
// from the source of truth in packages/react/src/blocks-snapshot.ts.
const _blockNode: AssertExact<PublishedBlockNode, SourceBlockNode> = true;
// CaretTarget is otherwise only reachable indirectly (InsertSpec.caret /
// convert options); assert it directly so a missing-optional drift on the caret
// shape itself is caught, not just on the fields that embed it.
const _caretTarget: AssertExact<PublishedCaretTarget, SourceCaretTarget> = true;
const _insertPosition: AssertEqual<PublishedInsertPosition, SourceInsertPosition> = true;
const _insertSpec: AssertExact<PublishedInsertSpec, SourceInsertSpec> = true;
const _treeInsertSpec: AssertExact<PublishedTreeInsertSpec, SourceTreeInsertSpec> = true;
const _moveTarget: AssertEqual<PublishedMoveTarget, SourceMoveTarget> = true;
const _useBlocksApi: AssertExact<PublishedUseBlocksApi, SourceUseBlocksApi> = true;

void _useBlokConfig;
void _contentProps;
void _editorProps;
void _blockNode;
void _caretTarget;
void _insertPosition;
void _insertSpec;
void _treeInsertSpec;
void _moveTarget;
void _useBlocksApi;
