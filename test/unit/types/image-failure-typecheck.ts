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

const _failure: ImageFailure = { blockId: 'b', tool: 'image', kind: 'load', retry: () => undefined, scrollTo: () => undefined };

import type { NotifierAction, NotifierOptions } from '../../../types/configs/notifier';
import type { MediaFailureInput } from '../../../types/api/media';

assert<Equal<NotifierOptions['detail'], string | undefined>>();
assert<Equal<NotifierOptions['thumbnails'], (string | null)[] | undefined>>();
assert<Equal<NotifierAction['primary'], boolean | undefined>>();
assert<Equal<NotifierAction['busyOnClick'], boolean | undefined>>();
assert<Equal<MediaFailureInput['preview'], string | undefined>>();
assert<Equal<Parameters<API['media']['clearFailure']>[1], { recovered?: boolean } | undefined>>();
