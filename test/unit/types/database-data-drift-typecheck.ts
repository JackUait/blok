/**
 * The published DatabaseData must carry every key the tool saves.
 * Run with: tsc --noEmit --strict --skipLibCheck --ignoreConfig test/unit/types/database-data-drift-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 */

import type { DatabaseData as PublishedDatabaseData } from '../../../types/tools/database';
import type { DatabaseData as SourceDatabaseData } from '../../../src/tools/database/types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assert = <T extends true>(): T | undefined => undefined;

// Both extend Record<string, unknown>, so `keyof` is `string | number` on both sides and hides drift.
type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };

assert<Equal<keyof Known<PublishedDatabaseData>, keyof Known<SourceDatabaseData>>>();
assert<Equal<PublishedDatabaseData['title'], SourceDatabaseData['title']>>();
