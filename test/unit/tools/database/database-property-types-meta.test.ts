import { describe, expect, it } from 'vitest';
import { propertyTypeMeta } from '../../../../src/tools/database/database-property-types';
import type { PropertyType } from '../../../../src/tools/database/types';

describe('propertyTypeMeta', () => {
  it.each(['__proto__', 'constructor', 'toString', 'fromANewerClient'])(
    'falls back to the text meta for an unknown type %s',
    (type) => {
      expect(propertyTypeMeta(type as PropertyType)).toBe(propertyTypeMeta('text'));
    }
  );
});
