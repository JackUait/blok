/**
 * Type-level tests for the public saved-data surface.
 * Run with: tsc --noEmit --strict test/unit/types/public-data-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 */

import type { Blok, BlokConfig, OutputData } from '../../../types';
import { equalsOutputData, isEmptyOutputData } from '../../../types';
import type { LooseOutputData, OutputBlockData } from '../../../types/data-formats/output-data';

/** Resolves to `true` only when `T` is exactly `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

// `editor.save()` returns OutputData whose blocks' `data` must NOT be `any`.
// `any` erases all type safety for consumers reading saved block data, letting
// `block.data.whatever.deeply.nested` type-check with no guard. The default must
// be a guarded shape (property access yields `unknown`), matching BlockToolData.
type _DataNotAny = IsAny<OutputBlockData['data']> extends false ? true : never;
const _assertDataNotAny: _DataNotAny = true;

void _assertDataNotAny;

// Backend wire DTOs (Editor.js-style APIs) may carry `data: null`, `id: null`
// and `time: null`. Every INPUT position — the `data` config option and the
// render() methods — must accept that loose shape as-is, so consumers never
// need `?? {}` / null→undefined shims at the boundary. Saved OUTPUT stays
// strict (OutputData).
const dtoFromBackend: LooseOutputData = {
  time: null,
  version: '2.29.0',
  blocks: [
    { id: null, type: 'paragraph', data: null },
    { id: 'a1', type: 'header', data: { text: 'Title', level: 2 } },
    { type: 'paragraph', data: { text: 'no id at all' } },
  ],
};

const _configAcceptsLooseDto: BlokConfig = { data: dtoFromBackend };

declare const editor: Blok;
void editor.render(dtoFromBackend);
void editor.blocks.render(dtoFromBackend);
void editor.blocks.insertMany(dtoFromBackend.blocks);

void _configAcceptsLooseDto;

// The published comparison/emptiness utilities must accept both the strict
// saved shape and the loose wire shape, including nullish documents.
declare const maybeSaved: OutputData | undefined;
const _equalsAcceptsLoose: boolean = equalsOutputData(maybeSaved, dtoFromBackend);
const _isEmptyAcceptsLoose: boolean = isEmptyOutputData(dtoFromBackend);

void _equalsAcceptsLoose;
void _isEmptyAcceptsLoose;
