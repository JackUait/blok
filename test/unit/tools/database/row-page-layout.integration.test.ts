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

      expect(prompt()?.textContent).toBe('Press Enter to continue with an empty page, or create a template');
      await click(prompt()?.querySelector('[data-blok-database-row-create-template]') ?? null);

      const saved = await editor?.save();
      const templates = saved?.blocks.filter((block) => (block.data as { template?: boolean }).template === true) ?? [];

      expect(templates).toHaveLength(1);
      expect(q('[data-blok-database-template-banner]')).not.toBeNull();
      expect(prompt()?.textContent).toBe('Press Enter to continue with an empty page');
    });

    it('lists templates, Empty and New template on an empty page when templates are on', async () => {
      await make(withTemplate());
      await openRow('r1');

      expect(prompt()?.querySelector('[data-blok-database-row-empty-text]')?.textContent)
        .toBe('Press Enter to continue with an empty page, or pick a template (use ↑ and ↓ to select)');
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
      expect(prompt()?.textContent).toBe('Press Enter to continue with an empty page, or create a template');
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
      await click(item('template-tB'));
      await click(item('template-tB-edit'));

      expect(prompt()?.textContent).toBe('Press Enter to continue with an empty page');
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

  it('offers no Customize layout on a locked database', async () => {
    await make(doc({}, { databaseLocked: true }));
    await openRow('r1');

    expect(q('[data-blok-database-drawer-customize]')).toBeNull();
  });
});
