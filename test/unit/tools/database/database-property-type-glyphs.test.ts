import { describe, expect, it } from 'vitest';
import * as icons from '../../../../src/components/icons';
import { propertyTypeMeta } from '../../../../src/tools/database/database-property-types';
import type { PropertyType } from '../../../../src/tools/database/types';

// Notion's type glyphs, read from its "Select type" menu and column headers
// (feel/findings-table T04, T21; shots 02-notion-addprop-menu, 13-notion-header-ctx).
const NOTION_GLYPHS: Array<[PropertyType, string]> = [
  ['title', 'IconLetterCase'],
  ['text', 'IconTextLines'],
  ['richText', 'IconTextLines'],
  ['number', 'IconHash'],
  ['select', 'IconSelectCircle'],
  ['multiSelect', 'IconListBulleted'],
  ['status', 'IconStatusCircle'],
  ['date', 'IconCalendar'],
  ['person', 'IconPeople'],
  ['files', 'IconPaperclip'],
  ['checkbox', 'IconCheckboxFilled'],
  ['url', 'IconLink'],
  ['phone', 'IconPhone'],
  ['email', 'IconAt'],
];

const iconByName = (name: string): string | undefined =>
  Object.entries(icons).find(([key]) => key === name)?.[1] as string | undefined;

describe('property type glyphs follow Notion', () => {
  it.each(NOTION_GLYPHS)('%s shows %s', (type, name) => {
    const icon = iconByName(name);

    expect(icon, `${name} is exported`).toBeDefined();
    expect(propertyTypeMeta(type).icon).toBe(icon);
  });

  it('gives title and text different glyphs', () => {
    expect(propertyTypeMeta('title').icon).not.toBe(propertyTypeMeta('text').icon);
  });
});
