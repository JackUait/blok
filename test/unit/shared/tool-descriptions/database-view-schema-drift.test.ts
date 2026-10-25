import { describe, expectTypeOf, it } from 'vitest';

import type { DATABASE_DATA } from '../../../../src/shared/tool-descriptions/database';

import type { DatabaseViewConfig } from '../../../../src/shared/database/types';

// Checked by tsc: a view key the agent schema lacks makes every agent write to that view fail.
type SchemaViewKeys = keyof typeof DATABASE_DATA.properties.views.items.properties;

describe('database view schema', () => {
  it('lists every saved view key', () => {
    expectTypeOf<Exclude<keyof DatabaseViewConfig, SchemaViewKeys>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<SchemaViewKeys, keyof DatabaseViewConfig>>().toEqualTypeOf<never>();
  });
});
