import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { findRanges } from '../../../../src/components/modules/find/text-index';
import type { OutputBlockData, OutputData } from '../../../../types';
import { IconPageLayout } from '../../../../src/components/icons';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
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

const TAB_TOOLS = { tabs: TabsTool, tab: TabTool };

const make = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}, readOnly = false, tabTools: Record<string, unknown> = TAB_TOOLS, editorConfig: Record<string, unknown> = {}): Promise<void> => {
  editor = new Blok({
    ...editorConfig,
    holder,
    readOnly,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
      ...tabTools,
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

const headingMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-testid="database-layout-heading-menu"]');

/** Opens the Heading module's ••• menu (plan Phase 5a). */
const openHeadingMenu = async (): Promise<void> => {
  if (headingMenu() === null) await click(b('[data-blok-database-layout-module="heading"] [data-blok-database-layout-module-menu]'));
};

const pinFromMenu = async (propertyId: string): Promise<void> => {
  await openHeadingMenu();
  await click(document.querySelector(`[data-blok-testid="database-layout-pin-${propertyId}"]`));
};

const addPin = async (): Promise<HTMLElement | null> => {
  await openHeadingMenu();

  return headingMenu()?.querySelector<HTMLElement>('[data-blok-database-layout-add-pin]') ?? null;
};

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
    await pinFromMenu('due');
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
    await pinFromMenu('due');
    await click(b('[data-blok-database-layout-apply]'));
    editor?.history.undo();
    await quiet();

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    expect(editor?.history.canUndo()).toBe(false);
  });

  // research/09 §5: the eye is a draft; Apply writes it on the property, with the layout, as one step.
  it('applies eye visibility and layout edits as one undo step', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-module="group"] [data-blok-database-layout-module-menu]'));
    await click(document.querySelector('[data-blok-testid="database-layout-eye-due"]'));
    await click(document.querySelector('[data-blok-testid="database-layout-visibility-hidden"]'));
    await pinFromMenu('due');

    expect((await editorSchema()).find((property) => property.id === 'due')?.pageVisibility).toBeUndefined();
    await click(b('[data-blok-database-layout-apply]'));
    const due = (await editorSchema()).find((property) => property.id === 'due');

    expect(due?.pageVisibility).toBe('hidden');
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: 'due', place: 'heading' }] });
    expect(await savedTitle()).not.toHaveProperty('pageVisibility');
    editor?.history.undo();
    await quiet();

    expect((await editorSchema()).find((property) => property.id === 'due')?.pageVisibility).toBeUndefined();
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [], pageLayoutSections: [] });
    expect(editor?.history.canUndo()).toBe(false);
  });

  it('drops eye visibility edits on Discard', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-module="group"] [data-blok-database-layout-module-menu]'));
    await click(document.querySelector('[data-blok-testid="database-layout-eye-due"]'));
    await click(document.querySelector('[data-blok-testid="database-layout-visibility-hidden"]'));

    expect(b('[data-blok-database-drawer-prop-value][data-property-id="due"]')).toBeNull();
    await click(b('[data-blok-database-layout-cancel]'));
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

    expect(document.querySelector(BUILDER)).toBeNull();
    expect((await editorSchema()).find((property) => property.id === 'due')?.pageVisibility).toBeUndefined();
    expect(q('[data-blok-database-drawer-prop-value][data-property-id="due"]')).not.toBeNull();
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
    await pinFromMenu('due');
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

  // feel/findings-rowpage R07: the row page menu has none of the table's view rows.
  it('opens the row page own property menu, not the table column menu', async () => {
    await make(doc());
    await openRow('r2');
    await click(q('[data-blok-database-drawer-prop-label][data-property-id="due"]'));
    const names = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')]
      .map((el) => el.getAttribute('data-blok-item-name'))
      .filter((name) => name !== null);

    expect(names.slice(0, 2)).toEqual(['rename', 'editProperty']);
    expect(names.some((name) => /filter|sort|freeze|insert|hide/i.test(name ?? ''))).toBe(false);
  });

  it.each(['rename', 'editProperty'])('%s opens the Edit property panel with the name selected, and a rename saves', async (entry) => {
    await make(doc());
    await openRow('r2');
    await click(q('[data-blok-database-drawer-prop-label][data-property-id="due"]'));
    await click(item(entry));
    const input = document.querySelector<HTMLInputElement>('[data-blok-popover-opened] [data-blok-database-property-menu-name-input]');

    expect(input).not.toBeNull();
    expect(input).toHaveFocus();
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 'Due'.length]);
    expect(item('visibility')).toBeNull();
    if (input === null) return;
    input.value = 'Deadline';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await editorSchema()).find((p) => p.id === 'due')?.name).toBe('Deadline');
  });

  const addFromRowPage = async (name: string, type: string): Promise<void> => {
    await openRow('r2');
    await click(q('[data-blok-database-drawer-add-prop]'));
    const field = document.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

    if (field !== null) field.value = name;
    await click(document.querySelector(`[data-blok-database-property-type-option="${type}"]`));
  };

  // research/09 §3 L57: picking a type adds the property and switches to its Edit property panel.
  it('picking a type on the row page opens the new property\'s Edit property panel, name selected', async () => {
    await make(doc());
    await addFromRowPage('Score', 'number');
    const input = document.querySelector<HTMLInputElement>('[data-blok-popover-opened] [data-blok-database-property-menu-name-input]');

    expect(input).toHaveFocus();
    expect(input?.value).toBe('Score');
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 'Score'.length]);
    expect(item('numberFormat')).not.toBeNull();
    expect((await editorSchema()).some((p) => p.name === 'Score' && p.type === 'number')).toBe(true);
  });

  // research/08 L203: a Relation opens "Related to", so it gets no Edit property panel.
  it('a Relation picked on the row page opens no Edit property panel', async () => {
    await make(doc());
    await addFromRowPage('Link', 'relation');

    expect((await editorSchema()).some((p) => p.name === 'Link' && p.type === 'relation')).toBe(true);
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')).toBeNull();
  });

  // The drawer redraw removes the "+ Add a property" button the type menu hung on.
  it('a Relation picked on the row page opens "Related to" under the new property', async () => {
    await make(doc());
    await addFromRowPage('Link', 'relation');
    await quiet();
    const picker = document.querySelector('[data-blok-database-related-to]');

    expect(picker).toBeInstanceOf(HTMLElement);
    expect(picker?.querySelector('[role="menuitem"], [data-blok-popover-item]')).toBeInstanceOf(HTMLElement);
  });

  // Closing it used to re-close it in a microtask without end, freezing the page.
  it('picking a database in "Related to" retargets the relation and closes the picker', async () => {
    await make(doc());
    await addFromRowPage('Link', 'relation');
    await quiet();
    const target = document.querySelector('[data-blok-database-related-to] [data-blok-popover-item]');

    expect(target).toBeInstanceOf(HTMLElement);
    await click(target);

    expect(document.querySelector('[data-blok-database-related-to][data-blok-popover-opened]')).toBeNull();
    expect((await editorSchema()).find((p) => p.name === 'Link')?.relation).toEqual({ targetDatabaseId: 'db' });
  });

  // research/12 §2: Summarize opens its own setup, so it gets no Edit property panel.
  it('an AI Autofill preset on the row page opens its setup, not the Edit property panel', async () => {
    await make(doc(), { ai: { autofill: vi.fn(() => Promise.resolve(undefined)) } });
    await openRow('r2');
    await click(q('[data-blok-database-drawer-add-prop]'));
    document.querySelector('[data-blok-database-property-autofill-option="summary"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Read at once: a frame later the open dialog has closed any menu.
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')).toBeNull();
    await quiet();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Autofill');
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

  it('adds a pinned property from the Heading menu: the property saves at once, the pin on Apply', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(await addPin());
    await click(document.querySelector('[data-blok-database-property-type-option="number"]'));
    const added = (await editorSchema()).find((property) => property.type === 'number');

    expect(added).toBeDefined();
    expect(b(`[data-blok-database-drawer-pins] [data-property-id="${String(added?.id)}"]`)).not.toBeNull();
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [] });
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: added?.id, place: 'heading' }] });
  });

  // research/10 §2b: a section's own "+ Add a property" on the row page puts the new property in that section, as one undo step.
  it('adds a property into a section from the row page, and one undo takes both back', async () => {
    await make(doc({}, { pageLayoutSections: [{ id: 's1', name: 'Planning' }], pageLayoutPlacements: [{ id: 'due', place: 'section', sectionId: 's1' }] }));
    await openRow('r1');
    await click(q('[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-drawer-section-add]'));
    await click(document.querySelector('[data-blok-database-property-type-option="number"]'));
    const added = (await editorSchema()).find((property) => property.type === 'number');

    expect(added).toBeDefined();
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: added?.id, place: 'section', sectionId: 's1' }, { id: 'due', place: 'section', sectionId: 's1' }] });
    expect(q(`[data-blok-database-drawer-section][data-section-id="s1"] [data-blok-database-drawer-prop-value][data-property-id="${String(added?.id)}"]`)).not.toBeNull();
    editor?.history.undo();
    await quiet();

    expect((await editorSchema()).some((property) => property.type === 'number')).toBe(false);
    expect(await savedTitle()).toMatchObject({ pageLayoutPlacements: [{ id: 'due', place: 'section', sectionId: 's1' }] });
    expect(editor?.history.canUndo()).toBe(false);
  });

  // research/09 §3b: after Discard, the property made in the builder is gone.
  it('deletes a property added from the Heading menu when Cancel is confirmed with Discard', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(await addPin());
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

  // research/10 §7: the switch sits in the Heading menu's Options.
  it('saves Property labels off on the title property', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await openHeadingMenu();
    await click(headingMenu()?.querySelector('[data-blok-testid="database-layout-option-layoutPropertyLabels"]') ?? null);
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutPropertyLabels: false });
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
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

    expect(await savedTitle()).not.toHaveProperty('pageLayoutPropertyIcons');
    expect(q('[data-blok-database-drawer-prop-icon]')).not.toBeNull();
  });

  describe('Reset to original page layout', () => {
    const SHAPED = {
      pageLayoutSections: [{ id: 's1', name: 'More' }],
      pageLayoutPlacements: [{ id: 'notes', place: 'section', sectionId: 's1' }, { id: 'due', place: 'heading' }, { id: 'owner', place: 'section', sectionId: 's1' }],
    };
    const shapedDoc = (): OutputBlockData[] => {
      const blocks = doc({}, SHAPED);
      const data = blocks[0].data as { schema: Array<Record<string, unknown>> };

      data.schema.push({ id: 'owner', name: 'Owner', type: 'text', position: 'a2' }, { id: 'notes', name: 'Notes', type: 'text', position: 'a3' });

      return blocks;
    };
    const reset = async (): Promise<void> => {
      await click(q('[data-blok-database-drawer-customize]'));
      await click(b('[data-blok-database-layout-more-save]'));
      await click(item('reset'));
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));
    };
    const headers = (): string[] => [...(holder?.querySelectorAll('[role="columnheader"]') ?? [])].map((el) => el.textContent?.trim() ?? '');

    it('is one undo step', async () => {
      await make(shapedDoc());
      await openRow('r1');
      await reset();

      expect(await savedTitle()).toMatchObject({ pageLayoutSections: [], pageLayoutPlacements: [{ id: 'due', place: 'group' }, { id: 'notes', place: 'group' }, { id: 'owner', place: 'group' }] });
      expect(document.querySelector(BUILDER)).toBeNull();
      editor?.history.undo();
      await quiet();

      expect(await savedTitle()).toMatchObject(SHAPED);
      expect(editor?.history.canUndo()).toBe(false);
    });

    it('leaves the table column order alone', async () => {
      await make(shapedDoc());
      const before = { headers: headers(), positions: (await editorSchema()).map((p) => [p.id, p.position]) };

      await openRow('r1');
      await reset();

      expect(headers()).toEqual(before.headers);
      expect((await editorSchema()).map((p) => [p.id, p.position])).toEqual(before.positions);
      expect([...(q('[data-blok-database-drawer-props]')?.querySelectorAll('[data-blok-database-drawer-prop-value]') ?? [])].map((el) => el.getAttribute('data-property-id')))
        .toEqual(['due', 'notes', 'owner']);
    });
  });

  describe('Database templates on the empty row page', () => {
    const withTemplate = (titleOverrides: Record<string, unknown> = {}): OutputBlockData[] => {
      const blocks = doc({}, titleOverrides);

      (blocks[0] as { content: string[] }).content.push('tA');
      blocks.push(
        { id: 'tA', type: 'database-row', parent: 'db', data: { properties: { t: 'Tmpl A', due: 'soon' }, position: 'b0', title: 'Tmpl A', template: true }, content: ['tp'] },
        { id: 'tp', type: 'paragraph', parent: 'tA', data: { text: 'From template' } },
      );

      return blocks;
    };
    const prompt = (): HTMLElement | null => drawer()?.querySelector<HTMLElement>('[data-blok-database-row-empty]') ?? null;
    const picks = (): string[] => [...(drawer()?.querySelectorAll('[data-blok-database-row-pick]') ?? [])].map((el) => el.getAttribute('data-blok-database-row-pick') ?? '');
    const applyTemplatesOff = async (): Promise<void> => {
      await click(q('[data-blok-database-drawer-customize]'));
      await click(b('[data-blok-testid="database-layout-option-layoutTemplates"]'));
      await click(b('[data-blok-database-layout-apply]'));
    };
    const bodyTexts = (): string[] => [...(drawer()?.querySelectorAll('[data-blok-database-row-body] > [data-blok-element]') ?? [])].map((el) => el.textContent ?? '');
    const titleKey = async (key: string): Promise<void> => {
      q('[data-blok-database-drawer-title]')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await quiet();
    };

    it('shows create a template on an empty page, which makes and opens a template', async () => {
      await make(doc());
      await openRow('r1');

      expect(prompt()?.textContent).toBe('Press ‘enter’ to continue with an empty page, or create a template');
      await click(prompt()?.querySelector('[data-blok-database-row-create-template]') ?? null);

      const saved = await editor?.save();
      const templates = saved?.blocks.filter((block) => (block.data as { template?: boolean }).template === true) ?? [];

      expect(templates).toHaveLength(1);
      expect(q('[data-blok-database-template-banner]')).not.toBeNull();
      expect(prompt()?.textContent).toBe('Press ‘enter’ to continue with an empty page');
    });

    it('lists templates, Empty and New template on an empty page when templates are on', async () => {
      await make(withTemplate());
      await openRow('r1');

      expect(prompt()?.querySelector('[data-blok-database-row-empty-text]')?.textContent)
        .toBe('Press ‘enter’ to continue with an empty page, or pick a template (use ↑ and ↓ to select)');
      expect(picks()).toEqual(['tA', 'empty', 'new']);
      expect([...(drawer()?.querySelectorAll('[data-blok-database-row-pick-label]') ?? [])].map((el) => el.textContent)).toEqual(['Tmpl A', 'Empty', 'New template']);
    });

    it('adds no undo step for drawing the prompt', async () => {
      await make(withTemplate());
      await openRow('r1');

      expect(editor?.history.canUndo()).toBe(false);
    });

    it('shows no prompt and no picker when Database templates is off', async () => {
      await make(withTemplate({ pageLayoutTemplates: false }));
      await openRow('r1');

      expect(prompt()?.textContent).toBe('');
      expect(picks()).toEqual([]);
    });

    it('redraws the empty-page prompt on every row when Database templates is applied off, and undo brings it back', async () => {
      await make(withTemplate());
      await openRow('r1');
      await applyTemplatesOff();

      expect(await savedTitle()).toMatchObject({ pageLayoutTemplates: false });
      expect(picks()).toEqual([]);
      await openRow('r2');

      expect(prompt()?.textContent).toBe('');
      editor?.history.undo();
      await quiet();

      expect(picks()).toEqual(['tA', 'empty', 'new']);
    });

    it('Reset turns Database templates back on', async () => {
      await make(doc({}, { pageLayoutTemplates: false }));
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(b('[data-blok-database-layout-more-save]'));
      await click(item('reset'));
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

      expect(await savedTitle()).not.toHaveProperty('pageLayoutTemplates');
      expect(prompt()?.textContent).toBe('Press ‘enter’ to continue with an empty page, or create a template');
    });

    it('shows the picker on an empty row once the first template is added', async () => {
      await make(doc());
      await openRow('r1');
      await click(prompt()?.querySelector('[data-blok-database-row-create-template]') ?? null);
      await openRow('r2');

      expect(picks()).toHaveLength(3);
    });

    it('shows no picker on an empty template row', async () => {
      const blocks = withTemplate();

      blocks.push({ id: 'tB', type: 'database-row', parent: 'db', data: { properties: { t: 'Blank' }, position: 'b1', template: true } });
      (blocks[0] as { content: string[] }).content.push('tB');
      await make(blocks);
      await click(q('[data-blok-element][data-blok-id="db"] [data-blok-testid="database-toolbar-new-menu"]'));
      // A click on the row itself makes a page from the template (a7407fba); "…" opens Edit.
      await click(item('template-tB')?.querySelector('[data-blok-popover-item-more]') ?? null);
      await click(item('template-tB-edit'));

      expect(prompt()?.textContent).toBe('Press ‘enter’ to continue with an empty page');
      expect(picks()).toEqual([]);
    });

    it('picks a template: fills the empty values, copies its body, and one undo takes both back', async () => {
      await make(withTemplate());
      await openRow('r1');
      await click(drawer()?.querySelector('[data-blok-database-row-pick="tA"]') ?? null);

      expect(bodyTexts()).toEqual(['From template']);
      expect(prompt()?.matches('[data-blok-database-row-body]:empty ~ [data-blok-database-row-empty]')).toBe(false);
      const row = (await editor?.save())?.blocks.find((block) => block.id === 'r1');

      expect(row?.data).toMatchObject({ properties: { t: 'One', due: 'soon' } });
      editor?.history.undo();
      await quiet();
      const undone = await editor?.save();

      expect(undone?.blocks.find((block) => block.id === 'r1')?.data).toMatchObject({ properties: { t: 'One' } });
      expect((undone?.blocks.find((block) => block.id === 'r1')?.data as { properties: Record<string, unknown> }).properties.due ?? null).toBeNull();
      expect(undone?.blocks.filter((block) => block.parent === 'r1')).toEqual([]);
    });

    it('picks with the arrows and Enter from the page title', async () => {
      await make(withTemplate());
      await openRow('r1');
      await titleKey('ArrowDown');

      expect(drawer()?.querySelector('[data-blok-database-row-pick][data-active]')?.getAttribute('data-blok-database-row-pick')).toBe('tA');
      await titleKey('Enter');

      expect(bodyTexts()).toEqual(['From template']);
      await titleKey('ArrowUp');
      await titleKey('Enter');
      const saved = await editor?.save();

      expect(saved?.blocks.filter((block) => (block.data as { template?: boolean }).template === true)).toHaveLength(1);
      expect(bodyTexts()).toEqual(['From template']);
    });

    it('refuses the picker when read-only', async () => {
      await make(withTemplate(), {}, true);
      await openRow('r1');
      await click(drawer()?.querySelector('[data-blok-database-row-pick="tA"]') ?? null);

      expect(bodyTexts()).toEqual([]);
    });
  });

  it('saves Full width on Apply, marks the page with it, and Reset drops it', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-testid="database-layout-option-layoutFullWidth"]'));
    await click(b('[data-blok-database-layout-apply]'));

    expect(await savedTitle()).toMatchObject({ pageLayoutFullWidth: true });
    expect(drawer()?.hasAttribute('data-full-width')).toBe(true);
    await click(q('[data-blok-database-drawer-customize]'));
    await click(b('[data-blok-database-layout-more-save]'));
    await click(item('reset'));
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

    expect(await savedTitle()).not.toHaveProperty('pageLayoutFullWidth');
    expect(drawer()?.hasAttribute('data-full-width')).toBe(false);
  });

  // research/09 "Other checks": N more properties stays open from row to row in a session.
  it('keeps N more properties expanded when another row page opens', async () => {
    const blocks = doc();
    const data = blocks[0].data as { schema: Array<Record<string, unknown>> };

    data.schema[1] = { ...data.schema[1], pageVisibility: 'hidden' };
    await make(blocks);
    await openRow('r1');
    await click(q('[data-blok-database-drawer-hidden-props]'));

    expect(q('[data-blok-database-drawer-hidden-props]')?.getAttribute('aria-expanded')).toBe('true');
    await click(q('[data-blok-database-drawer-close]'));
    await openRow('r2');

    expect(shownTitle()).toBe('Two');
    expect(q('[data-blok-database-drawer-hidden-props]')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-blok-database-drawer-props] [data-property-id="due"]')).not.toBeNull();
  });

  describe('Tabbed structure as blocks', () => {
    const LINKED_VIEW = { id: 'lvv', name: 'Roadmap', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
    /** A database whose row pages are Tabbed: Content, then "Roadmap", a view of this database. */
    const tabbedDoc = (): OutputBlockData[] => {
      const blocks = doc({}, { pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });

      (blocks[0] as { content: string[] }).content.push('lt');
      blocks.push(
        { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', 'tv'] },
        { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
        { id: 'tv', type: 'tab', parent: 'lt', data: { title: 'Roadmap' }, content: ['lv'] },
        { id: 'lv', type: 'database', parent: 'tv', data: { title: '', schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [LINKED_VIEW], activeViewId: 'lvv', source: { databaseId: 'db' } } },
      );

      return blocks;
    };
    const savedBlocks = async (): Promise<OutputBlockData[]> => (await editor?.save())?.blocks ?? [];
    const layoutTabs = async (): Promise<OutputBlockData[]> => (await savedBlocks()).filter((block) => block.type === 'tabs');
    const tabsIn = (root: Element | null): HTMLElement[] => [...(root?.querySelectorAll<HTMLElement>('[data-blok-database-drawer-tabs] [role="tab"]') ?? [])];
    const names = (root: Element | null): string[] => tabsIn(root).map((tab) => tab.textContent?.trim() ?? '');
    const selected = (root: Element | null): string | undefined => tabsIn(root).find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent?.trim();
    const tabNamed = (root: Element | null, name: string): HTMLElement | undefined => tabsIn(root).find((tab) => tab.textContent?.trim() === name);
    const builderRoot = (): HTMLElement | null => document.querySelector<HTMLElement>(BUILDER);
    const testId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);
    const hover = (el: Element | null, on: boolean): void => {
      el?.dispatchEvent(new MouseEvent(on ? 'pointerenter' : 'pointerleave'));
    };
    const toTabbed = async (): Promise<void> => {
      await click(document.querySelectorAll(`${BUILDER} [data-blok-database-layout-structure-card]`)[1] ?? null);
    };
    const addViewTab = async (sourceId: string, name: string): Promise<void> => {
      const bar = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;

      hover(bar, true);
      await click(bar?.querySelector('[data-blok-database-layout-add-tab]') ?? null);
      await click(testId('database-layout-link-data-source'));
      await click(testId(`database-layout-source-${sourceId}`));
      const field = testId('database-layout-view-name') as HTMLInputElement | null;

      if (field !== null) {
        field.value = name;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await click(testId('database-layout-add-view'));
    };

    it('adds a linked view tab as a tab block holding a linked database block under the layout tabs block', async () => {
      await make(doc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();
      await addViewTab('db', 'Roadmap');
      const [tabs] = await layoutTabs();
      const blocks = await savedBlocks();
      const tabBlocks = blocks.filter((block) => block.parent === tabs?.id);

      expect(tabs?.parent).toBe('db');
      expect(tabBlocks.map((block) => [block.type, block.data.title])).toEqual([['tab', ''], ['tab', 'Roadmap']]);
      expect(blocks.find((block) => block.parent === tabBlocks[1]?.id)).toMatchObject({ type: 'database', data: { source: { databaseId: 'db' } } });
      expect(names(builderRoot())).toEqual(['Content', 'Roadmap']);
      expect(selected(builderRoot())).toBe('Roadmap');
      expect(await savedTitle()).not.toHaveProperty('pageLayoutTabsId');
    });

    it('Apply with a new view tab is one undo step', async () => {
      await make(doc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();
      await addViewTab('db', 'Roadmap');
      await click(b('[data-blok-database-layout-apply]'));
      const [tabs] = await layoutTabs();

      expect(await savedTitle()).toMatchObject({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: tabs?.id });
      expect(names(drawer())).toEqual(['Content', 'Roadmap']);
      // research/11 §2a: the new tab stays selected, so the row page shows it.
      expect(q(`[data-blok-database-drawer-tab-panel] [data-blok-id="${String(tabs?.id)}"]`)).not.toBeNull();
      editor?.history.undo();
      await quiet();

      // The tabs block made in the session stays, empty and unnamed: deleting a
      // database child outside the step would write the layout outside it too.
      expect((await savedBlocks()).some((block) => block.type === 'tab' || block.parent === tabs?.id)).toBe(false);
      expect(await savedTitle()).not.toHaveProperty('pageLayoutTabsId');
      expect(await savedTitle()).not.toHaveProperty('pageLayoutStructure');
      expect(q('[data-blok-database-drawer-tabs]')).toBeNull();
      expect(editor?.history.canUndo()).toBe(false);
      editor?.history.redo();
      await quiet();

      expect((await layoutTabs()).map((block) => block.id)).toEqual([tabs?.id]);
      expect(names(drawer())).toEqual(['Content', 'Roadmap']);
      expect(q(`[data-blok-database-drawer-tab-panel] [data-blok-id="${String(tabs?.id)}"]`)).not.toBeNull();
      expect(q(`[data-blok-database-row-pool] [data-blok-id="${String(tabs?.id)}"]`)).toBeNull();
      await click(tabNamed(drawer(), 'Content') ?? null);

      expect(q(`[data-blok-database-layout-pool] [data-blok-id="${String(tabs?.id)}"]`)).not.toBeNull();
    });

    it('Discard deletes tab blocks made while customizing, and adds no undo step', async () => {
      await make(doc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();
      await addViewTab('db', 'Roadmap');

      expect(await layoutTabs()).toHaveLength(1);
      await click(b('[data-blok-database-layout-cancel]'));
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

      expect(await layoutTabs()).toEqual([]);
      expect((await savedBlocks()).some((block) => block.type === 'tab' || block.parent !== undefined && block.type === 'database')).toBe(false);
      expect(editor?.history.canUndo()).toBe(false);
    });

    it('shows the saved view tabs on every row page, and the view tab shows the whole linked database', async () => {
      await make(tabbedDoc());
      await openRow('r1');

      expect(names(drawer())).toEqual(['Content', 'Roadmap']);
      await click(tabNamed(drawer(), 'Roadmap') ?? null);
      const panel = q('[data-blok-database-drawer-tab-panel]');
      const linked = panel?.querySelector('[data-blok-id="lv"]');

      expect(linked).not.toBeNull();
      expect([...(linked?.querySelectorAll('[data-row-id]') ?? [])].map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2', 'r3']);
      expect(q('[data-blok-database-drawer-editor]')?.hidden).toBe(true);
      // The saver checks every holder sits in its home slot: a borrowed view must pass it.
      expect((await savedBlocks()).some((block) => block.id === 'lv')).toBe(true);
      await click(tabNamed(drawer(), 'Content') ?? null);

      expect(q('[data-blok-database-drawer-tab-panel] [data-blok-id="lv"]')).toBeNull();
      expect(q('[data-blok-database-layout-pool] [data-blok-id="tv"] [data-blok-id="lv"]')).not.toBeNull();
    });

    it('a view tab that links its own database renders without recursing', async () => {
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent): void => {
        errors.push(event.error);
      };

      window.addEventListener('error', onError);
      try {
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        const linked = q('[data-blok-database-drawer-tab-panel] [data-blok-id="lv"]');

        const open = linked?.querySelector('[data-row-id="r2"] [data-blok-database-table-open]') ?? null;

        expect(open).not.toBeNull();
        await click(open);
        // The view's own row page opened: it is Tabbed too, and its strip lists the same tabs.
        expect([...(holder?.querySelectorAll('[data-blok-database-drawer]') ?? [])].length).toBeGreaterThan(0);
        await click([...(holder?.querySelectorAll<HTMLElement>('[data-blok-database-drawer-tabs] [role="tab"]') ?? [])].reverse().find((tab) => tab.textContent?.trim() === 'Roadmap') ?? null);
        const shown = q('[data-blok-id="lv"]');

        expect(errors).toEqual([]);
        expect(shown?.isConnected).toBe(true);
        expect(shown?.querySelectorAll('[data-blok-id="lv"]')).toHaveLength(0);
        expect([...(holder?.querySelectorAll('[data-blok-database-drawer]') ?? [])].every((el) => !shown?.contains(el) || !el.contains(shown ?? null))).toBe(true);
      } finally {
        window.removeEventListener('error', onError);
      }
    });

    it('adds no find match inside the layout tabs block while no row page shows it', async () => {
      await make(tabbedDoc());
      const lt = q('[data-blok-id="lt"]');

      expect(lt).not.toBeNull();
      expect(findRanges(document.body, 'Roadmap')).toEqual([]);
      expect(findRanges(document.body, 'Three').filter((range) => lt?.contains(range.startContainer))).toEqual([]);
    });

    it('deletes a view tab after Delete this view? and selects Content; Apply deletes the block in one undo step', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(tabNamed(builderRoot(), 'Roadmap') ?? null);
      await click(tabNamed(builderRoot(), 'Roadmap') ?? null);
      await click(testId('database-layout-delete-view'));

      expect(document.querySelector('[data-blok-database-confirm-dialog]')?.textContent).toContain('Delete this view?');
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

      expect(names(builderRoot())).toEqual(['Content']);
      expect(selected(builderRoot())).toBe('Content');
      // The toast mounts only after the notifier module's lazy import resolves.
      await vi.waitFor(() => expect(document.body.textContent).toContain('Deleted Roadmap view'), { timeout: 2000 });
      expect((await savedBlocks()).some((block) => block.id === 'tv')).toBe(true);
      await click(b('[data-blok-database-layout-apply]'));

      expect((await savedBlocks()).some((block) => block.id === 'tv' || block.id === 'lv')).toBe(false);
      expect(names(drawer())).toEqual(['Content']);
      editor?.history.undo();
      await quiet();

      expect((await savedBlocks()).filter((block) => block.id === 'tv' || block.id === 'lv')).toHaveLength(2);
      expect(editor?.history.canUndo()).toBe(false);
    });

    it('Content tab renames and has no delete', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(tabNamed(builderRoot(), 'Content') ?? null);
      const field = testId('database-layout-tab-name') as HTMLInputElement | null;

      expect(field?.value).toBe('Content');
      expect(testId('database-layout-delete-view')).toBeNull();
      if (field !== null) {
        field.value = 'Overview';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await quiet();

      expect(names(builderRoot())).toEqual(['Overview', 'Roadmap']);
      await click(b('[data-blok-database-layout-apply]'));

      expect((await savedBlocks()).find((block) => block.id === 'tc')?.data.title).toBe('Overview');
      expect(names(drawer())).toEqual(['Overview', 'Roadmap']);
    });

    /** Types into the open tab name field one key at a time; the field must stay the same, focused element. */
    const typeInName = async (keys: string): Promise<HTMLInputElement | null> => {
      const field = testId('database-layout-tab-name') as HTMLInputElement | null;

      field?.focus();
      for (const key of keys) {
        expect(testId('database-layout-tab-name')).toBe(field);
        if (field === null) return null;
        field.value += key;
        field.setSelectionRange(field.value.length, field.value.length);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await quiet();
      }

      return field;
    };

    it('keeps the tab name field, its focus and its value while typing a saved tab\'s name key by key', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(tabNamed(builderRoot(), 'Roadmap') ?? null);
      await click(tabNamed(builderRoot(), 'Roadmap') ?? null);
      const field = await typeInName('AB');

      expect(field?.isConnected).toBe(true);
      expect(field?.value).toBe('RoadmapAB');
      expect(field).toHaveFocus();
      expect(field?.selectionStart).toBe('RoadmapAB'.length);
      expect(names(builderRoot())).toEqual(['Content', 'RoadmapAB']);
    });

    it('keeps the tab name field open while typing the name of a tab made in this session', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await addViewTab('db', 'New');
      await click(tabNamed(builderRoot(), 'New') ?? null);
      const field = await typeInName('AB');

      expect(field?.isConnected).toBe(true);
      expect(field).toHaveFocus();
      expect(names(builderRoot())).toEqual(['Content', 'Roadmap', 'NewAB']);
    });

    it('keeps the Content name field open while typing on a Tabbed page with no tabs block yet', async () => {
      await make(doc({}, { pageLayoutStructure: 'tabbed' }));
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(tabNamed(builderRoot(), 'Content') ?? null);
      const field = testId('database-layout-tab-name') as HTMLInputElement | null;

      if (field !== null) field.value = '';
      await typeInName('Ov');

      expect(field?.isConnected).toBe(true);
      expect(field?.value).toBe('Ov');
      expect(names(builderRoot())).toEqual(['Ov']);
    });

    // research/11 §1: a tab made in the session never outlives it; Reset is no exception.
    it('Reset discards a tab drafted in the session, so Undo does not bring it back', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await addViewTab('db', 'Draft');
      await click(b('[data-blok-database-layout-more-save]'));
      await click(item('reset'));
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));
      editor?.history.undo();
      await quiet();

      expect((await savedBlocks()).filter((block) => block.type === 'tab').map((block) => block.data.title)).toEqual(['', 'Roadmap']);
      expect(editor?.history.canUndo()).toBe(false);
    });

    // Keyboard and touch reach it too: it stays in the DOM, outside the tablist; CSS shows it on hover or focus.
    it('keeps Add tab in the bar for keyboard and touch, outside the tablist', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      const bar = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;
      const add = bar?.querySelector<HTMLButtonElement>('[data-blok-database-layout-add-tab]') ?? null;

      expect(add?.getAttribute('aria-label')).toBe('Add tab');
      expect(add?.closest('[role="tablist"]')).toBeNull();
      expect(add?.tabIndex).toBe(0);
      hover(bar, true);
      hover(bar, false);

      expect(add?.isConnected).toBe(true);
    });

    it('destroys the editor mid-draft without an error, with the tabs block back in its pool', async () => {
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent): void => {
        errors.push(event.error);
      };

      window.addEventListener('error', onError);
      try {
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(q('[data-blok-database-drawer-customize]'));
        await addViewTab('db', 'Draft');
        const lt = q('[data-blok-id="lt"]');

        editor?.destroy();
        editor = undefined;
        await quiet();

        expect(errors).toEqual([]);
        expect(lt?.closest('[data-blok-database-drawer-tab-panel]') ?? null).toBeNull();
      } finally {
        window.removeEventListener('error', onError);
      }
    });

    // A peer's undo can take Content away and leave a view tab first: it must not be read as Content.
    it('reads Content as the tab with no database, never a view tab that happens to come first', async () => {
      const blocks = tabbedDoc().filter((block) => block.id !== 'tc');

      (blocks.find((block) => block.id === 'lt') as { content: string[] }).content = ['tv'];
      await make(blocks);
      await openRow('r1');

      expect(names(drawer())).toEqual(['Content', 'Roadmap']);
      await click(tabNamed(drawer(), 'Roadmap') ?? null);

      expect(q('[data-blok-database-drawer-tab-panel] [data-blok-id="lv"]')).not.toBeNull();
    });

    it('Reset deletes the view tabs and returns to Simple, as one undo step', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(b('[data-blok-database-layout-more-save]'));
      await click(item('reset'));
      await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

      expect(await layoutTabs()).toEqual([]);
      expect((await savedBlocks()).some((block) => ['tc', 'tv', 'lv'].includes(String(block.id)))).toBe(false);
      expect(await savedTitle()).not.toHaveProperty('pageLayoutTabsId');
      expect(await savedTitle()).not.toHaveProperty('pageLayoutStructure');
      expect(q('[data-blok-database-drawer-tabs]')).toBeNull();
      editor?.history.undo();
      await quiet();

      expect((await savedBlocks()).filter((block) => ['lt', 'tc', 'tv', 'lv'].includes(String(block.id)))).toHaveLength(4);
      expect(await savedTitle()).toMatchObject({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });
      expect(editor?.history.canUndo()).toBe(false);
    });

    it('keeps the view tabs through Simple, and Tabbed brings them back', async () => {
      await make(tabbedDoc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await click(document.querySelectorAll(`${BUILDER} [data-blok-database-layout-structure-card]`)[0] ?? null);
      await click(b('[data-blok-database-layout-apply]'));

      expect(q('[data-blok-database-drawer-tabs]')).toBeNull();
      expect((await savedBlocks()).filter((block) => ['lt', 'tc', 'tv', 'lv'].includes(String(block.id)))).toHaveLength(4);
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();

      expect(names(builderRoot())).toEqual(['Content', 'Roadmap']);
    });

    it('offers no Add tab when the editor has no tabs tools', async () => {
      await make(doc({}, { pageLayoutStructure: 'tabbed' }), {}, false, {});
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      const bar = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;

      hover(bar, true);

      expect(names(builderRoot())).toEqual(['Content']);
      expect(bar?.querySelector('[data-blok-database-layout-add-tab]')).toBeNull();
    });

    describe('Duplicate view and the row page tab menu (research/13 §3)', () => {
      const FILTERED = { ...LINKED_VIEW, filters: [{ id: 'f1', propertyId: 't', operator: 'contains', value: 'Tw' }] };
      const filteredDoc = (): OutputBlockData[] => tabbedDoc().map((block) => (block.id === 'lv' ? { ...block, data: { ...block.data, views: [FILTERED] } } : block));
      const openTabMenu = async (name: string): Promise<void> => {
        await click(tabNamed(builderRoot(), name) ?? null);
        if (testId('database-layout-tab-menu') === null) await click(tabNamed(builderRoot(), name) ?? null);
      };
      const menuIds = (): Array<string | null> => [...(testId('database-layout-tab-menu')?.querySelectorAll('[data-blok-testid]') ?? [])].map((el) => el.getAttribute('data-blok-testid'));

      it('View settings offers Duplicate view above Delete view; Content has neither', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        const ids = menuIds();

        expect(ids.indexOf('database-layout-duplicate-view')).toBeGreaterThan(-1);
        expect(ids.indexOf('database-layout-duplicate-view')).toBeLessThan(ids.indexOf('database-layout-delete-view'));
        await click(tabNamed(builderRoot(), 'Content') ?? null);
        await openTabMenu('Content');

        expect(testId('database-layout-duplicate-view')).toBeNull();
      });

      it('names the copy "<name> (1)" in any locale', async () => {
        await make(filteredDoc(), {}, false, undefined, { i18n: { locale: 'ja' } });
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        await click(testId('database-layout-duplicate-view'));

        expect(names(builderRoot())).toContain('Roadmap (1)');
      });

      it('appends the copy at the end as "<name> (1)", then (2), selects it and keeps its filter', async () => {
        await make(filteredDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        await click(testId('database-layout-duplicate-view'));

        expect(testId('database-layout-tab-menu')).toBeNull();
        expect(names(builderRoot())).toEqual(['Content', 'Roadmap', 'Roadmap (1)']);
        expect(selected(builderRoot())).toBe('Roadmap (1)');
        await click(tabNamed(builderRoot(), 'Roadmap') ?? null);
        await openTabMenu('Roadmap');
        await click(testId('database-layout-duplicate-view'));

        expect(names(builderRoot())).toEqual(['Content', 'Roadmap', 'Roadmap (1)', 'Roadmap (2)']);
        const blocks = await savedBlocks();
        const copies = blocks.filter((block) => block.type === 'database' && block.id !== 'lv' && (block.data as { source?: { databaseId?: string } }).source?.databaseId === 'db');
        const views = copies.map((block) => (block.data as { views: Array<{ id: string; filters: unknown[] }>; activeViewId: string }));

        expect(copies).toHaveLength(2);
        // A view of its own: personal view state is keyed by view id.
        expect(views.every((data) => data.views[0].id !== 'lvv' && data.activeViewId === data.views[0].id)).toBe(true);
        expect(views.map((data) => data.views[0].filters)).toEqual([FILTERED.filters, FILTERED.filters]);
        expect(blocks.find((block) => block.id === 'lv')?.data).toMatchObject({ views: [FILTERED] });
      });

      it('keeps $ patterns in a tab name literal in the copy\'s name', async () => {
        await make(tabbedDoc().map((block) => (block.id === 'tv' ? { ...block, data: { title: 'Q$$A' } } : block)));
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Q$$A');
        await click(testId('database-layout-duplicate-view'));

        expect(names(builderRoot())).toEqual(['Content', 'Q$$A', 'Q$$A (1)']);
      });

      it('names the copy from a rename made just before', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        const field = testId('database-layout-tab-name') as HTMLInputElement | null;

        if (field !== null) {
          field.value = 'Plan';
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await click(testId('database-layout-duplicate-view'));

        expect(names(builderRoot())).toEqual(['Content', 'Plan', 'Plan (1)']);
      });

      it('Discard removes the copy; Apply keeps it on every row page', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        await click(testId('database-layout-duplicate-view'));
        await click(b('[data-blok-database-layout-cancel]'));
        await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

        expect((await savedBlocks()).filter((block) => block.type === 'tab')).toHaveLength(2);
        await click(q('[data-blok-database-drawer-customize]'));
        await openTabMenu('Roadmap');
        await click(testId('database-layout-duplicate-view'));
        await click(b('[data-blok-database-layout-apply]'));
        await openRow('r2');

        expect(names(drawer())).toEqual(['Content', 'Roadmap', 'Roadmap (1)']);
      });

      it('on a row page the selected tab opens Customize layout, which opens the builder', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        const menu = item('row-tab-customize-layout')?.closest('[data-blok-popover]');

        expect(menu).not.toBeNull();
        expect(menu?.textContent).toContain('Customize layout');
        expect(menu?.textContent).not.toContain('Delete view');
        await click(item('row-tab-customize-layout'));

        expect(builderRoot()).not.toBeNull();
      });

      it('marks the selected view tab as opening a menu, and its expanded state', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        const tab = (): HTMLElement | undefined => tabNamed(drawer(), 'Roadmap');

        expect(tab()?.getAttribute('aria-haspopup')).toBe('menu');
        expect(tab()?.getAttribute('aria-expanded')).toBe('false');
        expect(tabNamed(drawer(), 'Content')?.hasAttribute('aria-haspopup')).toBe(false);
        await click(tab() ?? null);

        expect(tab()?.getAttribute('aria-expanded')).toBe('true');
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await quiet();

        expect(item('row-tab-customize-layout')).toBeNull();
        expect(tab()?.getAttribute('aria-expanded')).toBe('false');
      });

      it('Escape closes the row page tab menu only, not the row page', async () => {
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        expect(item('row-tab-customize-layout')).not.toBeNull();
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await quiet();

        expect(item('row-tab-customize-layout')).toBeNull();
        expect(drawer()?.isConnected).toBe(true);
      });

      it('opens no row page tab menu when the database cannot be customized', async () => {
        await make(tabbedDoc(), {}, true);
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(tabNamed(drawer(), 'Roadmap') ?? null);

        expect(item('row-tab-customize-layout')).toBeNull();
      });
    });

    describe('Copy link to view (research/11 §4, research/13 §3)', () => {
      const base = (): string => window.location.href.split('#')[0];
      // Every hash differs: a closed link page stays closed for the whole file.
      const loadWithHash = async (hash: string): Promise<void> => {
        window.history.replaceState(null, '', `${base()}${hash}`);
        await make(tabbedDoc());
      };

      afterEach(() => {
        window.history.replaceState(null, '', base());
      });

      it('copies the row link naming the selected view tab', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);

        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await make(tabbedDoc());
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        expect(item('row-tab-copy-link-to-view')?.textContent).toContain('Copy link to view');
        await click(item('row-tab-copy-link-to-view'));

        expect(writeText).toHaveBeenCalledWith(`${base()}#r1?v=tv`);
        expect(item('row-tab-copy-link-to-view')).toBeNull();
        Reflect.deleteProperty(navigator, 'clipboard');
      });

      it('a locked database still offers Copy link to view, as the row menu offers Copy link', async () => {
        await make(tabbedDoc().map((block) => (block.id === 'db'
          ? { ...block, data: { ...block.data, schema: (block.data.schema as Array<Record<string, unknown>>).map((p) => (p.type === 'title' ? { ...p, databaseLocked: true } : p)) } }
          : block)));
        await openRow('r1');
        await click(tabNamed(drawer(), 'Roadmap') ?? null);
        await click(tabNamed(drawer(), 'Roadmap') ?? null);

        expect(item('row-tab-copy-link-to-view')).not.toBeNull();
        expect(item('row-tab-customize-layout')).toBeNull();
      });

      it('a view link opens the row page on that tab', async () => {
        await loadWithHash('#r1?v=tv');

        expect(shownTitle()).toBe('One');
        expect(selected(drawer())).toBe('Roadmap');
      });

      it('a row link without a view still opens the row page on Content', async () => {
        await loadWithHash('#r2');

        expect(shownTitle()).toBe('Two');
        expect(selected(drawer())).toBe('Content');
      });

      it('a view link naming a tab that is gone opens the row page on Content', async () => {
        await loadWithHash('#r3?v=gone');

        expect(shownTitle()).toBe('Three');
        expect(selected(drawer())).toBe('Content');
      });
    });

    describe('Related to this database (research/13 §1b-1c)', () => {
      /**
       * Measure A (db) relates two-way to Measure B (dbb), which comes AFTER it:
       * the linked view of B renders before B's tool exists.
       * r1 (One) → b1, b2; r2 (Two) → none; r3 (Three) → b3.
       */
      const relatedDoc = (): OutputBlockData[] => {
        const blocks = doc({}, { pageLayoutStructure: 'tabbed' });
        const a = blocks[0] as unknown as { data: { title?: string; schema: Array<Record<string, unknown>> } };

        a.data.title = 'Measure A';
        a.data.schema.push({ id: 'rel', name: 'Measure B', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'dbb', twoWay: true, syncedPropertyId: 'back' } });
        (blocks[1].data as { properties: Record<string, unknown> }).properties.rel = ['b1', 'b2'];
        (blocks[3].data as { properties: Record<string, unknown> }).properties.rel = ['b3'];
        blocks.push(
          {
            id: 'dbb',
            type: 'database',
            data: {
              title: 'Measure B',
              schema: [
                { id: 'bt', name: 'Name', type: 'title', position: 'a0' },
                { id: 'back', name: 'Measure A', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'rel' } },
              ],
              views: [{ id: 'bv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
              activeViewId: 'bv',
            },
            content: ['b1', 'b2', 'b3'],
          },
          { id: 'b1', type: 'database-row', parent: 'dbb', data: { properties: { bt: 'Uno', back: ['r1'] }, position: 'a0' } },
          { id: 'b2', type: 'database-row', parent: 'dbb', data: { properties: { bt: 'Dos', back: ['r1'] }, position: 'a1' } },
          { id: 'b3', type: 'database-row', parent: 'dbb', data: { properties: { bt: 'Tres', back: ['r3'] }, position: 'a2' } },
        );

        return blocks;
      };
      const openAddTab = async (): Promise<HTMLElement | null> => {
        const bar = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;

        hover(bar, true);
        await click(bar?.querySelector('[data-blok-database-layout-add-tab]') ?? null);

        return testId('database-layout-add-tab-menu');
      };
      const shownRows = (root: Element | null): string[] =>
        [...(root?.querySelectorAll('[data-blok-database-drawer-tab-panel] [data-blok-database-table-row][data-row-id]') ?? [])].map((el) => el.getAttribute('data-row-id') ?? '');

      it('lists each related database under Related to <this database>, then a divider and Link existing data source', async () => {
        await make(relatedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        const menu = await openAddTab();
        const text = [...(menu?.querySelectorAll('[data-blok-testid]') ?? [])].map((el) => el.getAttribute('data-blok-testid'));

        expect(menu?.textContent).toContain('Related to Measure A');
        expect(testId('database-layout-related-rel')?.textContent?.trim()).toBe('Measure B');
        expect(text.indexOf('database-layout-related-rel')).toBeLessThan(text.indexOf('database-layout-link-data-source'));
        expect(menu?.querySelector('[data-blok-database-panel-separator], hr, [role="separator"]')).not.toBeNull();
      });

      it('shows only Link existing data source when the database has no relation to another database', async () => {
        await make(doc({}, { pageLayoutStructure: 'tabbed' }));
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        const menu = await openAddTab();

        expect(menu?.textContent).not.toContain('Related to');
        expect(menu?.querySelector('[data-blok-testid^="database-layout-related-"]')).toBeNull();
        expect(testId('database-layout-link-data-source')).not.toBeNull();
      });

      it('adds a tab at once, named after the related database, showing its rows that link to this page', async () => {
        await make(relatedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openAddTab();
        await click(testId('database-layout-related-rel'));

        // The filter is written as a token, so the one view changes per row.
        const blocks = await savedBlocks();
        const linked = blocks.find((block) => block.type === 'database' && (block.data as { source?: { databaseId?: string } }).source?.databaseId === 'dbb');

        expect((linked?.data as { views: Array<{ filters: unknown[] }> } | undefined)?.views[0]?.filters).toEqual([
          expect.objectContaining({ propertyId: 'back', operator: 'contains', value: ['this_page'] }),
        ]);
        expect(names(builderRoot())).toEqual(['Content', 'Measure B']);
        expect(selected(builderRoot())).toBe('Measure B');
        expect(shownRows(builderRoot())).toEqual(['b1', 'b2']);
        await click(b('[data-blok-database-layout-preview]'));
        await click(item('preview-r3'));

        expect(shownRows(builderRoot())).toEqual(['b3']);
      });

      it('after Apply each row page lists only its own related rows', async () => {
        await make(relatedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openAddTab();
        await click(testId('database-layout-related-rel'));
        await click(b('[data-blok-database-layout-apply]'));

        expect(selected(drawer())).toBe('Measure B');
        expect(shownRows(drawer())).toEqual(['b1', 'b2']);
        await openRow('r2');

        expect(selected(drawer())).toBe('Measure B');
        expect(shownRows(drawer())).toEqual([]);
        await openRow('r3');

        expect(shownRows(drawer())).toEqual(['b3']);
        // The filter pill names the token.
        expect(drawer()?.querySelector('[data-blok-database-drawer-tab-panel]')?.textContent).toContain('Measure A: This page');
      });

      describe('a relation to this same database (research/36 §12)', () => {
        /**
         * R14 relates one-way to itself through "Related R14". F2 (r2) → F3, T4.
         * Database order is Select, Text, Place, Related R14; the tab sorts by name.
         */
        const selfDoc = (extraSchema: Array<Record<string, unknown>> = [], values: Record<string, Record<string, unknown>> = {}): OutputBlockData[] => {
          const blocks = doc({}, { pageLayoutStructure: 'tabbed' });
          const a = blocks[0] as unknown as { data: { title?: string; schema: Array<Record<string, unknown>> }; content: string[] };

          a.data.title = 'R14';
          a.data.schema.splice(1, 1,
            { id: 'sel', name: 'Select', type: 'select', position: 'a1', config: { options: [] } },
            { id: 'txt', name: 'Text', type: 'text', position: 'a2' },
            { id: 'pl', name: 'Place', type: 'place', position: 'a3' },
            { id: 'rel', name: 'Related R14', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db' } },
            ...extraSchema);
          a.content.push('r4');
          (blocks[2].data as { properties: Record<string, unknown> }).properties.rel = ['r3', 'r4'];
          blocks.push({ id: 'r4', type: 'database-row', parent: 'db', data: { properties: { t: 'T4' }, position: 'a3' } });

          return blocks.map((block) => (block.id !== undefined && values[block.id] !== undefined
            ? { ...block, data: { ...block.data, properties: { ...(block.data as { properties: Record<string, unknown> }).properties, ...values[block.id] } } }
            : block));
        };
        const headers = (root: Element | null): string[] =>
          [...(root?.querySelectorAll('[data-blok-database-drawer-tab-panel] [data-blok-database-table-column-header]') ?? [])].map((el) => el.getAttribute('data-property-id') ?? '');
        const addSelfTab = async (blocks: OutputBlockData[]): Promise<void> => {
          await make(blocks);
          await openRow('r2');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-related-rel'));
        };

        it('offers the relation under Related to <this database>, by its property name', async () => {
          await make(selfDoc());
          await openRow('r2');
          await click(q('[data-blok-database-drawer-customize]'));
          const menu = await openAddTab();

          expect(testId('database-layout-related-rel')?.textContent?.trim()).toBe('Related R14');
          expect(menu?.textContent).toContain('Related to R14');
        });

        it('adds a tab named after the property that lists the pages this row relates to', async () => {
          await addSelfTab(selfDoc());

          expect(names(builderRoot())).toEqual(['Content', 'Related R14']);
          expect(selected(builderRoot())).toBe('Related R14');
          expect([...shownRows(builderRoot())].sort()).toEqual(['r3', 'r4']);
        });

        it('lists the title first, then every property by name', async () => {
          await addSelfTab(selfDoc());

          expect(headers(builderRoot())).toEqual(['t', 'pl', 'rel', 'sel', 'txt']);
        });

        it('shows a property added from the main table at its place by name', async () => {
          await addSelfTab(selfDoc());
          await click(b('[data-blok-database-layout-apply]'));
          await click(q('[data-blok-database-drawer-close]'));
          const plus = [...(holder?.querySelectorAll<HTMLElement>('[data-blok-database-table-add-property]') ?? [])]
            .find((el) => el.closest('[data-blok-database-drawer-tab-panel]') === null) ?? null;

          await click(plus);
          await click(document.querySelector<HTMLElement>('[data-blok-database-property-type-option="number"]'));
          const added = ((await savedBlocks()).find((block) => block.id === 'db')?.data as { schema: Array<{ id: string; type: string }> }).schema.find((p) => p.type === 'number')?.id;

          await openRow('r2');

          expect(added).toBeDefined();
          expect(headers(drawer())).toEqual(['t', added, 'pl', 'rel', 'sel', 'txt']);
        });

        it('also lists a row that points at this one, as the relation cell does (unmeasured in Notion)', async () => {
          await addSelfTab(selfDoc([], { r1: { rel: ['r2'] } }));

          expect([...shownRows(builderRoot())].sort()).toEqual(['r1', 'r3', 'r4']);
        });

        it('a two-way pair such as Sub-items lists the rows on the other side', async () => {
          await make(selfDoc([
            { id: 'par', name: 'Parent item', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'sub' } },
            { id: 'sub', name: 'Sub-items', type: 'relation', position: 'a6', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'par' } },
          ], { r1: { sub: ['r3'] }, r3: { par: ['r1'] } }));
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-related-sub'));

          expect(selected(builderRoot())).toBe('Sub-items');
          expect(shownRows(builderRoot())).toEqual(['r3']);
        });
      });

      describe('Link existing data source > Add new relation (research/13 §1d, §2)', () => {
        const openForm = async (): Promise<void> => {
          await make(relatedDoc());
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-link-data-source'));
          await click(testId('database-layout-source-dbb'));
        };
        const schemaOf = async (id: string): Promise<Array<Record<string, unknown>>> =>
          ((await savedBlocks()).find((block) => block.id === id)?.data as { schema: Array<Record<string, unknown>> }).schema;

        it('shows View of <source> and an Add new relation switch, off', async () => {
          await openForm();

          expect(testId('database-layout-view-of')?.textContent).toContain('View of');
          expect(testId('database-layout-view-of')?.textContent).toContain('Measure B');
          expect(testId('database-layout-add-relation')?.getAttribute('aria-checked')).toBe('false');
          expect(testId('database-layout-add-view')?.textContent?.trim()).toBe('Add view');
          expect(testId('database-layout-two-way')).toBeNull();
          expect(testId('database-layout-related-name')).toBeNull();
        });

        it('turned on: View & relation name, a locked-on Two-way relation and a Related property name', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          const twoWay = testId('database-layout-two-way') as HTMLButtonElement | null;

          expect((testId('database-layout-view-name') as HTMLInputElement | null)?.placeholder).toBe('View & relation name');
          expect((testId('database-layout-view-name') as HTMLInputElement | null)?.value).toBe('Measure B');
          expect(twoWay?.getAttribute('aria-checked')).toBe('true');
          expect(twoWay?.disabled).toBe(true);
          expect((testId('database-layout-related-name') as HTMLInputElement | null)?.placeholder).toBe('Measure A 1');
          expect(testId('database-layout-add-view')?.textContent?.trim()).toBe('Add view & relation');
        });

        it('puts the Two-way hint outside the disabled switch, so hovering it works in every browser', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          const twoWay = testId('database-layout-two-way') as HTMLButtonElement | null;
          const info = twoWay?.closest('[data-blok-database-layout-locked]')?.querySelector<HTMLElement>('[data-blok-database-layout-hint]') ?? null;

          expect(info).not.toBeNull();
          expect(info?.closest('button, :disabled')).toBeNull();
          expect(twoWay?.disabled).toBe(true);
          expect(twoWay?.getAttribute('aria-label')).toBe('Two-way relation');
          expect(document.getElementById(twoWay?.getAttribute('aria-describedby') ?? '')?.textContent).toContain('required for relations of linked databases');
        });

        it('Add view & relation makes a relation, its mirror on the source, and a tab filtered by the mirror', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          await click(testId('database-layout-add-view'));
          const a = await schemaOf('db');
          const bSchema = await schemaOf('dbb');
          const made = a.find((property) => property.type === 'relation' && property.id !== 'rel');
          const mirror = bSchema.find((property) => property.type === 'relation' && property.id !== 'back');

          // research/13 §2, research/14 §6: A already has "Measure B", so the new relation is "Measure B 1"; the tab keeps "Measure B".
          expect(made).toMatchObject({ name: 'Measure B 1', relation: { targetDatabaseId: 'dbb', twoWay: true, syncedPropertyId: mirror?.id } });
          expect(mirror).toMatchObject({ name: 'Measure A 1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: made?.id } });
          const linked = (await savedBlocks()).filter((block) => block.type === 'database' && (block.data as { source?: { databaseId?: string } }).source?.databaseId === 'dbb');

          expect((linked[0]?.data as { views: Array<{ filters: unknown[] }> }).views[0]?.filters).toEqual([
            expect.objectContaining({ propertyId: mirror?.id, operator: 'contains', value: ['this_page'] }),
          ]);
          expect(names(builderRoot())).toEqual(['Content', 'Measure B']);
          expect(selected(builderRoot())).toBe('Measure B');
          expect(shownRows(builderRoot())).toEqual([]);
        });

        it('keeps typed text unselected when Add new relation is turned on', async () => {
          await openForm();
          const before = testId('database-layout-view-name') as HTMLInputElement | null;

          if (before !== null) {
            before.value = 'Tasks';
            before.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await click(testId('database-layout-add-relation'));
          const field = testId('database-layout-view-name') as HTMLInputElement | null;

          expect(field?.value).toBe('Tasks');
          expect(field?.selectionStart === 0 && field?.selectionEnd === field?.value.length).toBe(false);
        });

        it('fills Related property name with "<this database> 1" in any locale when the source has that name', async () => {
          await make(relatedDoc(), {}, false, TAB_TOOLS, { i18n: { locale: 'ru' } });
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-link-data-source'));
          await click(testId('database-layout-source-dbb'));
          await click(testId('database-layout-add-relation'));

          expect((testId('database-layout-related-name') as HTMLInputElement | null)?.placeholder).toBe('Measure A 1');
        });

        // research/14 §5b: no clash on the source, no suffix.
        it('fills Related property name with "<this database>" when the source has no property of that name', async () => {
          const blocks = relatedDoc();
          const back = (blocks.find((block) => block.id === 'dbb')?.data as { schema: Array<{ id: string; name: string }> }).schema.find((property) => property.id === 'back');

          if (back !== undefined) back.name = 'Owner';
          await make(blocks);
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-link-data-source'));
          await click(testId('database-layout-source-dbb'));
          await click(testId('database-layout-add-relation'));

          expect((testId('database-layout-related-name') as HTMLInputElement | null)?.placeholder).toBe('Measure A');
          await click(testId('database-layout-add-view'));

          expect((await schemaOf('dbb')).filter((property) => property.type === 'relation').map((property) => property.name)).toEqual(['Owner', 'Measure A']);
        });

        // research/14 §5c: a typed taken related name is saved suffixed, with no error.
        it('saves a typed related name the source already has as "<name> 1"', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          const related = testId('database-layout-related-name') as HTMLInputElement | null;

          if (related !== null) {
            related.value = 'Name';
            related.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await click(testId('database-layout-add-view'));

          expect((await schemaOf('dbb')).map((property) => property.name)).toEqual(['Name', 'Measure A', 'Name 1']);
        });

        it('names both properties from the fields', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          const field = (id: string, value: string): void => {
            const input = testId(id) as HTMLInputElement | null;

            if (input === null) return;
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          };

          field('database-layout-view-name', 'Tasks');
          field('database-layout-related-name', 'Owner');
          await click(testId('database-layout-add-view'));

          expect((await schemaOf('db')).some((property) => property.name === 'Tasks' && property.type === 'relation')).toBe(true);
          expect((await schemaOf('dbb')).some((property) => property.name === 'Owner' && property.type === 'relation')).toBe(true);
          expect(names(builderRoot())).toEqual(['Content', 'Tasks']);
        });

        it('Discard removes both new properties and the tab, as other builder-made properties go', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          await click(testId('database-layout-add-view'));
          await click(b('[data-blok-database-layout-cancel]'));
          await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

          expect((await schemaOf('db')).map((property) => property.id)).toEqual(['t', 'due', 'rel']);
          expect((await schemaOf('dbb')).map((property) => property.id)).toEqual(['bt', 'back']);
          expect(await layoutTabs()).toEqual([]);
        });

        it('Discard removes the mirror even when the relation was deleted first', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          await click(testId('database-layout-add-view'));
          const made = (await schemaOf('db')).find((property) => property.type === 'relation' && property.id !== 'rel');
          const api = editor as unknown as { blocks: { getById: (id: string) => { call: (name: string, param: Record<string, unknown>) => void } | null } };

          api.blocks.getById('db')?.call('deleteMirrorProperty', { propertyId: String(made?.id) });
          await quiet();

          expect((await schemaOf('db')).map((property) => property.id)).toEqual(['t', 'due', 'rel']);
          await click(b('[data-blok-database-layout-cancel]'));
          await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

          expect((await schemaOf('dbb')).map((property) => property.id)).toEqual(['bt', 'back']);
        });

        it('Apply keeps both properties and shows the tab on every row', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          await click(testId('database-layout-add-view'));
          await click(b('[data-blok-database-layout-apply]'));

          expect((await schemaOf('db'))).toHaveLength(4);
          expect((await schemaOf('dbb'))).toHaveLength(3);
          await openRow('r2');
          await click(tabNamed(drawer(), 'Measure B') ?? null);

          expect(shownRows(drawer())).toEqual([]);
        });

        it('offers no Add new relation for a locked source, whose properties stay as they are', async () => {
          const blocks = relatedDoc().map((block) => {
            if (block.id !== 'dbb') return block;
            const data = block.data as { schema: Array<Record<string, unknown>> };

            return { ...block, data: { ...data, schema: data.schema.map((property) => (property.type === 'title' ? { ...property, databaseLocked: true } : property)) } };
          });

          await make(blocks);
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-link-data-source'));
          await click(testId('database-layout-source-dbb'));

          expect(testId('database-layout-view-of')).not.toBeNull();
          expect(testId('database-layout-add-relation')).toBeNull();
        });

        it('leaves no half-made relation when the source refuses the mirror', async () => {
          await openForm();
          await click(testId('database-layout-add-relation'));
          // The source turns read-only for writes after the form opened.
          const source = document.querySelector('[data-blok-id="dbb"]');

          expect(source).not.toBeNull();
          vi.spyOn(DatabaseTool.prototype, 'addSyncedRelation').mockImplementation(() => undefined);
          await click(testId('database-layout-add-view'));

          expect((await schemaOf('db')).map((property) => property.id)).toEqual(['t', 'due', 'rel']);
          expect(names(builderRoot())).toEqual(['Content']);
          // No trace: no empty list on any row, no undo step.
          const keys = (await savedBlocks()).filter((block) => block.parent === 'db' && block.type === 'database-row')
            .flatMap((block) => Object.keys((block.data as { properties: Record<string, unknown> }).properties));

          expect(keys.every((key) => ['t', 'due', 'rel'].includes(key))).toBe(true);
          expect(editor?.history.canUndo()).toBe(false);
        });

        it('offers no Add new relation for a view of this database', async () => {
          await make(relatedDoc());
          await openRow('r1');
          await click(q('[data-blok-database-drawer-customize]'));
          await openAddTab();
          await click(testId('database-layout-link-data-source'));
          await click(testId('database-layout-source-db'));

          expect(testId('database-layout-view-of')).not.toBeNull();
          expect(testId('database-layout-add-relation')).toBeNull();
        });
      });

      it('a new row added in the tab links to this page, so it stays in the tab', async () => {
        await make(relatedDoc());
        await openRow('r2');
        await click(q('[data-blok-database-drawer-customize]'));
        await openAddTab();
        await click(testId('database-layout-related-rel'));
        await click(b('[data-blok-database-layout-apply]'));

        expect(shownRows(drawer())).toEqual([]);
        await click(q('[data-blok-database-drawer-tab-panel] [data-blok-database-table-add-row]'));
        const blocks = await savedBlocks();
        const added = blocks.find((block) => block.type === 'database-row' && block.parent === 'dbb' && !['b1', 'b2', 'b3'].includes(String(block.id)));
        const back = (added?.data as { properties: Record<string, unknown> } | undefined)?.properties.back;

        expect(JSON.stringify(back)).toContain('r2');
        expect(shownRows(drawer())).toEqual([String(added?.id)]);
        // Two-way: the page's own relation lists the new row too.
        expect(q('[data-blok-database-table-row][data-row-id="r1"] [data-row-id="b1"]')).not.toBeNull();
        expect(q(`[data-blok-database-table-row][data-row-id="r2"] [data-row-id="${String(added?.id)}"]`)).not.toBeNull();
        editor?.history.undo();
        await quiet();
        const after = await savedBlocks();
        const page = after.find((block) => block.id === 'r2')?.data as { properties: Record<string, unknown> } | undefined;

        // One step: the row and the page's link to it go together.
        expect(after.some((block) => block.id === added?.id)).toBe(false);
        expect(JSON.stringify(page?.properties.rel ?? [])).not.toContain(String(added?.id));
      });

      it('keeps the per-row filter after a save and a reload', async () => {
        await make(relatedDoc());
        await openRow('r1');
        await click(q('[data-blok-database-drawer-customize]'));
        await openAddTab();
        await click(testId('database-layout-related-rel'));
        await click(b('[data-blok-database-layout-apply]'));
        const saved = await savedBlocks();

        editor?.destroy();
        holder?.remove();
        holder = document.createElement('div');
        document.body.appendChild(holder);
        await make(saved);
        await openRow('r3');
        await click(tabNamed(drawer(), 'Measure B') ?? null);

        expect(shownRows(drawer())).toEqual(['b3']);
      });
    });
  });

  it('offers no Customize layout on a locked database', async () => {
    await make(doc({}, { databaseLocked: true }));
    await openRow('r1');

    expect(q('[data-blok-database-drawer-customize]')).toBeNull();
  });
});
