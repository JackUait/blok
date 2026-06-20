/**
 * Type-level tests for the public saved-data surface.
 * Run with: tsc --noEmit --strict test/unit/types/public-data-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 */

import type { OutputBlockData } from '../../../types/data-formats/output-data';

/** Resolves to `true` only when `T` is exactly `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

// `editor.save()` returns OutputData whose blocks' `data` must NOT be `any`.
// `any` erases all type safety for consumers reading saved block data, letting
// `block.data.whatever.deeply.nested` type-check with no guard. The default must
// be a guarded shape (property access yields `unknown`), matching BlockToolData.
type _DataNotAny = IsAny<OutputBlockData['data']> extends false ? true : never;
const _assertDataNotAny: _DataNotAny = true;

void _assertDataNotAny;
