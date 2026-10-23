/**
 * The List layout is drawn with the bulleted-list glyph, as Notion's bulletedList (findings-listgallery L15).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IconListBulleted } from '../../../../src/components/icons';
import { VIEW_ICONS } from '../../../../src/tools/database/database-tab-bar';

const source = (file: string): string => readFileSync(resolve(__dirname, '../../../../src/tools/database', file), 'utf8');

describe('List layout glyph', () => {
  it('draws the List tab, linked picker and toolbox entry with the bulleted-list glyph', () => {
    expect(VIEW_ICONS.list).toBe(IconListBulleted);
  });

  it.each([
    ['database-view-popover.ts', /type: 'list', icon: IconListBulleted/],
    ['database-starter-modal.ts', /list: IconListBulleted/],
    ['preview.ts', /tab\(IconListBulleted, 'List view'/],
  ])('%s draws List with the bulleted-list glyph', (file, pattern) => {
    expect(source(file)).toMatch(pattern);
  });
});
