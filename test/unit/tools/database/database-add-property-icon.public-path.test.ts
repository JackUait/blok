import { findByRole, fireEvent } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok } from '../../../../types';

let instance: Blok | undefined;
let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (): Promise<void> => {
  const database: DatabaseData = {
    title: 'Add property',
    schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
    views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'table',
  };

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
    data: { blocks: [{ id: 'db', type: 'database', data: database, content: [] }] },
    onReady: (ready) => { editor = ready; },
  });
  await instance.isReady;
  if (holder === undefined) throw new Error('Missing editor holder');
  await findByRole(holder, 'columnheader', { name: 'Name' });
};

// notion-motion.md Round 44 §3: the header "+" name box's "Select icon" sets the new property's icon.
describe('Select icon in the header "+" menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    instance?.destroy();
    instance = undefined;
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves the picked emoji as the new property\'s icon', async () => {
    await mount();
    const plus = holder?.querySelector<HTMLElement>('[data-blok-database-table-add-property]');

    if (plus === null || plus === undefined) throw new Error('Missing add-property button');
    fireEvent.click(plus);
    const icon = document.querySelector<HTMLElement>('[data-blok-database-property-type-icon-button]');

    if (icon === null) throw new Error('Missing Select icon');
    icon.click();
    const emoji = await vi.waitFor(() => {
      const button = document.querySelector<HTMLElement>('[data-blok-emoji-picker] [data-emoji-grid] button[data-emoji-native]');
      const native = button?.querySelector('[data-emoji-glyph]')?.textContent ?? '';

      if (button === null || native === '') throw new Error('grid not ready');

      return { button, native };
    }, { timeout: 5000 });

    emoji.button.click();
    document.querySelector<HTMLElement>('[data-blok-database-property-type-option="number"]')?.click();
    if (editor === undefined) throw new Error('Missing ready editor');
    const block = (await editor.save()).blocks.find((saved) => saved.id === 'db');
    const added = (block?.data as DatabaseData).schema.find((property) => property.type === 'number');

    expect(added?.icon).toBe(emoji.native);
  });
});
