/**
 * Type-level tests for BlokBlockDataMap + isBlockType.
 * Run with: tsc --noEmit --strict test/unit/types/block-data-map-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 *
 * ROOT CAUSE this guards (#10): saved `block.data` is `Record<string, unknown>`
 * with no link from a block's `type` to its data shape, so every read site
 * re-implements a `block.type === 'x'` check and hand-casts `data as XData`.
 * `BlokBlockDataMap` is the augmentable type→data registry and `isBlockType`
 * is the single guard that narrows `block.data` off it.
 */

import { blocksOfType, isBlockType } from '../../../types/tools-entry';
import type { BlokBlockDataMap } from '../../../types/tools-entry';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';

declare const block: OutputBlockData;

// The guard narrows `data` to the built-in tool's mapped shape — no cast.
if (isBlockType(block, 'header')) {
  const level: number = block.data.level;
  void level;
}

// The collection helper narrows every result's `data` off the registry too —
// no `data as HeaderData` cast, and it is null-tolerant at the call site.
declare const doc: OutputData | null | undefined;
const headers = blocksOfType(doc, 'header');
const firstLevel: number | undefined = headers[0]?.data.level;
void firstLevel;

// @ts-expect-error - 'not-a-tool' is not a BlokBlockDataMap key
void blocksOfType(doc, 'not-a-tool');

if (isBlockType(block, 'table')) {
  // TableData carries `content`; property access is typed, not `unknown`.
  const rows = block.data.content;
  void rows;
}

// A type that is not a registered block must be rejected at the call site.
// @ts-expect-error - 'not-a-tool' is not a BlokBlockDataMap key
void isBlockType(block, 'not-a-tool');

// The built-in map must key by the saved `type` strings, including hyphenated
// and underscore names.
type _AssertBuiltins =
  BlokBlockDataMap['paragraph'] &
  BlokBlockDataMap['header'] &
  BlokBlockDataMap['database-row'] &
  BlokBlockDataMap['column_list'];
declare const _builtins: _AssertBuiltins;
void _builtins;

// The map is augmentable: a consumer registers their own tool's data shape and
// the guard narrows to it.
declare module '../../../types/tools-entry' {
  interface BlokBlockDataMap {
    'my-widget': { widgetId: string };
  }
}
if (isBlockType(block, 'my-widget')) {
  const id: string = block.data.widgetId;
  void id;
}
