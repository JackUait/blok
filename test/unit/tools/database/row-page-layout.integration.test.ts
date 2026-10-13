import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';
import { IconPageLayout } from '../../../../src/components/icons';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; canUndo: () => boolean };
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const doc = (viewOverrides: Record<string, unknown> = {}, titleOverrides: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...titleOverrides }, { id: 'due', name: 'Due', type: 'text', position: 'a1' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...viewOverrides }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Three' }, position: 'a2' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}, readOnly = false): Promise<void> => {
  editor = new Blok({
    holder,
    readOnly,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;
const BUILDER = '[data-blok-interface="database-layout-builder"]';
/** The layout builder mounts on body, outside the holder. */
const b = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(`${BUILDER} ${selector}`);

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const openRow = (rowId: string): Promise<void> =>
  click(q(`[data-row-id="${rowId}"] [data-blok-database-table-open]`));

const drawer = (): HTMLElement | null => q('[data-blok-database-drawer]');

const shownTitle = (): string | undefined => q<HTMLTextAreaElement>('[data-blok-database-drawer-title]')?.value;

const savedTitle = async (): Promise<Record<string, unknown> | undefined> => {
  const saved = await editor?.save();
  const data = saved?.blocks.find((block) => block.id === 'db')?.data as { schema: Array<Record<string, unknown>> } | undefined;

  return data?.schema.find((property) => property.type === 'title');
};

const customizeAction = async (databaseId = 'db'): Promise<HTMLButtonElement | null> => {
  await click(q(`[data-blok-element][data-blok-id="${databaseId}"] [data-blok-testid="database-toolbar-settings"]`));
  await click(document.querySelector('[data-blok-testid="database-settings-more"]'));

  return document.querySelector<HTMLButtonElement>('[data-blok-testid="database-settings-customize-layout"]');
};

const editorSchema = async (): Promise<Array<Record<string, unknown>>> => {
  const saved = await editor?.save();
  const data = saved?.blocks.find((block) => block.id === 'db')?.data as { schema: Array<Record<string, unknown>> } | undefined;

  return data?.schema ?? [];
};

const item = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

describe('row page layout through the database tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('saves a pin applied to all pages on the title property', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    await click(b('[data-blok-database-layout-item-menu][data-property-id="due"]'));
    await click(item('pin'));
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: 'due', place: 'heading' }] });
    expect(q('[data-blok-database-drawer-pins] [data-property-id="due"]')).not.toBeNull();
    expect(drawer()?.isConnected).toBe(true);
  });

  it('adds no undo step for opening Customize layout, and one for Apply', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-cancel]'));

    expect(editor?.history.canUndo()).toBe(false);
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-item-menu][data-property-id="due"]'));
    await click(item('pin'));
    await click(b('[data-blok-database-layout-apply]'));
    editor?.history.undo();
    await quiet();

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    expect(editor?.history.canUndo()).toBe(false);
  });

  it('shows the saved layout on every row page', async () => {
    await make(doc({}, { pageLayoutPlacements: [{ id: 'due', place: 'heading' }] }));
    await openRow('r2');

    expect(q('[data-blok-database-drawer-pins] [data-property-id="due"]')).not.toBeNull();
    expect(shownTitle()).toBe('Two');
  });

  it('opens the first row page in Customize from More settings > Customize page layout', async () => {
    await make(doc());
    const action = await customizeAction();

    expect(action?.disabled).toBe(false);
    await click(action);

    expect(shownTitle()).toBe('One');
    expect(document.querySelector(BUILDER)).not.toBeNull();
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
  });

  // research/09 §1: the `layout` glyph, and the chevron every More settings row carries.
  it('draws Customize page layout with the page layout icon and a chevron', async () => {
    await make(doc());
    const action = await customizeAction();

    const glyph = (svg: Element | null | undefined): string[] => [...(svg?.querySelectorAll('rect') ?? [])].map((rect) => ['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name)).join(' '));
    const expected = new DOMParser().parseFromString(IconPageLayout, 'image/svg+xml').documentElement;

    expect(glyph(action?.querySelector('svg'))).toEqual(glyph(expected));
    expect(action?.querySelector('[data-blok-database-panel-chevron]')).not.toBeNull();
  });

  // research/09 §1: with zero rows the builder previews a "New page" placeholder.
  it('opens Customize page layout on a placeholder page with no rows', async () => {
    await make([{ ...doc()[0], content: [] }]);
    const action = await customizeAction();

    expect(action?.disabled).toBe(false);
    await click(action);

    expect(b('[data-blok-database-layout-canvas-title]')?.textContent).toBe('New page');
    expect(b('[data-blok-database-layout-preview]')?.textContent?.trim()).toBe('Preview: New page');
    expect(drawer()).toBeNull();
    await click(b('[data-blok-database-layout-item-menu][data-property-id="due"]'));
    await click(item('pin'));
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: 'due', place: 'heading' }] });
    expect(document.querySelector(BUILDER)).toBeNull();
    expect(drawer()).toBeNull();
    expect((await editor?.save())?.blocks.filter((block) => block.type === 'database-row')).toHaveLength(0);
  });

  // Q4: the Preview switch lists the view's rows in view order.
  it('previews another row from the Preview switch, in view order', async () => {
    await make(doc({ sorts: [{ propertyId: 't', direction: 'desc' }] }));
    await click(await customizeAction());
    await click(b('[data-blok-database-layout-preview]'));
    const pages = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item][data-blok-item-name^="preview-"]')];

    expect(pages.map((page) => page.textContent?.trim())).toEqual(['Two', 'Three', 'One']);
    await click(item('preview-r3'));

    expect(b('[data-blok-database-layout-canvas-title]')?.textContent).toBe('Three');
    expect(shownTitle()).toBe('Three');
  });

  // research/09 §1b: the row page's property menu ends with Customize layout; a column header's does not (research/10 §1).
  it('ends the row page property menu with Customize layout, which opens the builder on this page', async () => {
    await make(doc());
    await openRow('r2');
    await click(q('[data-blok-database-drawer-prop-label][data-property-id="due"]'));
    const items = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')];

    expect(items.at(-1)?.getAttribute('data-blok-item-name')).toBe('customize-layout');
    await click(item('customize-layout'));

    expect(b('[data-blok-database-layout-preview]')?.textContent?.trim()).toBe('Preview: Two');
  });

  it('offers no Customize layout in the column header menu', async () => {
    await make(doc());
    await click(q('[data-blok-database-table-column-header][data-property-id="due"]'));

    expect(document.querySelector('[data-blok-popover-opened] [data-blok-popover-item]')).not.toBeNull();
    expect(item('customize-layout')).toBeNull();
  });

  it('hides Customize page layout when read-only or locked', async () => {
    await make(doc(), {}, true);

    expect(await customizeAction()).toBeNull();
    editor?.destroy();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    holder?.replaceChildren();
    await make(doc({}, { databaseLocked: true }));

    expect(await customizeAction()).toBeNull();
  });

  it('hides Customize page layout on a linked view', async () => {
    const [database, ...rows] = doc();
    const { schema, views } = database.data as { schema: unknown[]; views: Array<Record<string, unknown>> };

    await make([
      database,
      ...rows,
      { id: 'linked', type: 'database', data: { source: { databaseId: 'db' }, schema, views: views.map((v) => ({ ...v, id: 'lv' })), activeViewId: 'lv' } },
    ]);

    expect(await customizeAction('db')).not.toBeNull();
    await click(document.body);
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());

    expect(await customizeAction('linked')).toBeNull();
    expect(q('[data-blok-element][data-blok-id="linked"] [data-blok-testid="database-toolbar-settings"]')).not.toBeNull();
  });

  it('adds a pinned property from the pins row: the property saves at once, the pin on Apply', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-add-pin]'));
    await click(document.querySelector('[data-blok-database-property-type-option="number"]'));
    const added = (await editorSchema()).find((property) => property.type === 'number');

    expect(added).toBeDefined();
    expect(b(`[data-blok-database-drawer-pins] [data-property-id="${String(added?.id)}"]`)).not.toBeNull();
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [] });
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: added?.id, place: 'heading' }] });
  });

  // research/09 §3b: after Discard, the property made in the builder is gone.
  it('deletes a property added from the pins row when Cancel is confirmed with Discard', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-add-pin]'));
    await click(document.querySelector('[data-blok-database-property-type-option="number"]'));

    expect((await editorSchema()).some((property) => property.type === 'number')).toBe(true);
    await click(b('[data-blok-database-layout-cancel]'));
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

    expect((await editorSchema()).some((property) => property.type === 'number')).toBe(false);
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [] });
    expect(q('[data-blok-database-drawer-pins]')).toBeNull();
    expect(document.querySelector(BUILDER)).toBeNull();
    expect(drawer()?.isConnected).toBe(true);
  });

  it('closes Customize at once on Cancel with no edits', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-cancel]'));

    expect(document.querySelector('[data-blok-database-confirm-dialog]')).toBeNull();
    expect(document.querySelector(BUILDER)).toBeNull();
  });

  it('saves Property icons off on the title property, and Reset drops the key', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-testid="database-layout-option-layoutPropertyIcons"]'));
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPropertyIcons: false });
    expect(q('[data-blok-database-drawer-prop-icon]')).toBeNull();
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-more-save]'));
    await click(item('reset'));

    expect(await savedTitle()).not.toHaveProperty('pageLayoutPropertyIcons');
    expect(q('[data-blok-database-drawer-prop-icon]')).not.toBeNull();
  });

  it('offers no Customize layout on a locked database', async () => {
    await make(doc({}, { databaseLocked: true }));
    await openRow('r1');

    expect(q('[data-blok-database-drawer-customize]')).toBeNull();
  });
});
