import { describe, expectTypeOf, it } from 'vitest';

import type { DATABASE_DATA } from '../../../../src/shared/tool-descriptions/database';

import type { DatabaseViewConfig } from '../../../../src/shared/database/types';

// Checked by tsc: a view key the agent schema lacks makes every agent write to that view fail.
type SchemaViewKeys = keyof typeof DATABASE_DATA.properties.views.items.properties;
// The same for one entry of a view's properties list: an agent sends the whole list back, so a missing key is dropped.
type SchemaPropertySettingKeys = keyof typeof DATABASE_DATA.properties.views.items.properties.properties.items.properties;
type PropertySettingKeys = keyof NonNullable<DatabaseViewConfig['properties']>[number];

describe('database view schema', () => {
  it('lists every saved view key', () => {
    expectTypeOf<Exclude<keyof DatabaseViewConfig, SchemaViewKeys>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<SchemaViewKeys, keyof DatabaseViewConfig>>().toEqualTypeOf<never>();
  });

  it('lists every saved view property setting key', () => {
    expectTypeOf<Exclude<PropertySettingKeys, SchemaPropertySettingKeys>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<SchemaPropertySettingKeys, PropertySettingKeys>>().toEqualTypeOf<never>();
  });
});
