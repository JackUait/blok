/**
 * Type-level conformance test for the published React adapter surface.
 * Run via `tsc --noEmit` (part of `yarn lint:types`). NOT executed — only compiled.
 *
 * Each assertion forces a compile error if the published `types/react.d.ts`
 * drifts from the source implementation in `src/react`.
 */
import type {
  UseBlokConfig as PublishedUseBlokConfig,
  BlokContentProps as PublishedBlokContentProps,
  BlokEditorProps as PublishedBlokEditorProps,
  BlockNode as PublishedBlockNode,
  InsertPosition as PublishedInsertPosition,
  InsertSpec as PublishedInsertSpec,
  MoveTarget as PublishedMoveTarget,
  UseBlocksApi as PublishedUseBlocksApi,
} from '../../../types/react';
import type { UseBlokConfig as SourceUseBlokConfig } from '../../../src/react/types';
import type { BlokEditorProps as SourceBlokEditorProps } from '../../../src/react/BlokEditor';
import type { BlokContentProps as SourceBlokContentProps } from '../../../src/react/types';
import type {
  BlockNode as SourceBlockNode,
  InsertPosition as SourceInsertPosition,
  InsertSpec as SourceInsertSpec,
  MoveTarget as SourceMoveTarget,
  UseBlocksApi as SourceUseBlocksApi,
} from '../../../src/react/blocks-snapshot';

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
// from the source of truth in src/react/blocks-snapshot.ts.
const _blockNode: AssertExact<PublishedBlockNode, SourceBlockNode> = true;
const _insertPosition: AssertEqual<PublishedInsertPosition, SourceInsertPosition> = true;
const _insertSpec: AssertExact<PublishedInsertSpec, SourceInsertSpec> = true;
const _moveTarget: AssertEqual<PublishedMoveTarget, SourceMoveTarget> = true;
const _useBlocksApi: AssertExact<PublishedUseBlocksApi, SourceUseBlocksApi> = true;

void _useBlokConfig;
void _contentProps;
void _editorProps;
void _blockNode;
void _insertPosition;
void _insertSpec;
void _moveTarget;
void _useBlocksApi;
