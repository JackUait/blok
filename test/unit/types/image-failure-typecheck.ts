/**
 * Type-level tests for the image failure surface.
 * Run with: tsc --noEmit --strict --skipLibCheck test/unit/types/image-failure-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 */

import type { API, Blok, BlokConfig, ImageFailure, ImageFailureReport } from '../../../types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assert = <T extends true>(): T | undefined => undefined;

type Report = Parameters<API['media']['reportFailure']>[0];

assert<Equal<Report['kind'], 'upload' | 'load'>>();
assert<Equal<ReturnType<API['media']['confirmLeave']>, Promise<boolean>>>();
assert<Equal<Parameters<NonNullable<BlokConfig['onImageFailure']>>[0], ImageFailureReport>>();
assert<Equal<ImageFailureReport['reason'], 'fail' | 'save' | 'leave'>>();
assert<Equal<ReturnType<Blok['confirmLeave']>, Promise<boolean>>>();

const failure: ImageFailure = { blockId: 'b', tool: 'image', kind: 'load', retry: () => undefined, scrollTo: () => undefined };

void failure;
