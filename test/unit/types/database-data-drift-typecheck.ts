/**
 * The published DatabaseData must carry every key the tool saves.
 * Run with: tsc --noEmit --strict --skipLibCheck --ignoreConfig test/unit/types/database-data-drift-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 */

import type { DatabaseData as PublishedDatabaseData } from '../../../types/tools/database';
import type { DatabaseData as SourceDatabaseData } from '../../../src/tools/database/types';
import type { DatabaseAdapter as PublishedAdapter, DatabaseViewConfig as PublishedView } from '../../../types/tools/database';
import type { DatabaseAdapter as SourceAdapter, DatabaseViewConfig as SourceView } from '../../../src/tools/database/types';
import type {
  PropertyDefinition as PublishedProperty,
  PropertyValue as PublishedValue,
  PropertyType as PublishedType,
  DatabaseRow as PublishedRow,
  DatabaseRowData as PublishedRowData,
  DatabaseConfig as PublishedConfig,
} from '../../../types/tools/database';
import type {
  PropertyDefinition as SourceProperty,
  PropertyValue as SourceValue,
  PropertyType as SourceType,
  DatabaseRow as SourceRow,
  DatabaseRowData as SourceRowData,
  DatabaseConfig as SourceConfig,
} from '../../../src/tools/database/types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assert = <T extends true>(): T | undefined => undefined;

// Both extend Record<string, unknown>, so `keyof` is `string | number` on both sides and hides drift.
type Known<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };

assert<Equal<keyof Known<PublishedDatabaseData>, keyof Known<SourceDatabaseData>>>();
assert<Equal<PublishedDatabaseData['title'], SourceDatabaseData['title']>>();

// Every view field, and the adapter's view writes, carry the same shape on both sides.
assert<Equal<PublishedView, SourceView>>();
assert<Equal<Parameters<PublishedAdapter['createView']>[0], Parameters<SourceAdapter['createView']>[0]>>();
assert<Equal<Parameters<PublishedAdapter['updateView']>[0], Parameters<SourceAdapter['updateView']>[0]>>();

// The property system: types, settings, values, row metadata and the people lever.
assert<Equal<PublishedType, SourceType>>();
assert<Equal<PublishedProperty, SourceProperty>>();
assert<Equal<PublishedValue, SourceValue>>();
assert<Equal<PublishedRow, SourceRow>>();
assert<Equal<keyof Known<PublishedRowData>, keyof Known<SourceRowData>>>();
assert<Equal<PublishedConfig, SourceConfig>>();
