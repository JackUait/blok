import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabasePropertyMenu } from '../../../../src/tools/database/database-property-menu';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { readMainCss } from '../../styles/helpers/read-main-css';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabasePermissions, DatabaseViewConfig } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  save(): Promise<OutputData>;
  destroy(): void;
  blocks: API['blocks'];
  readOnly: API['readOnly'];
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;
let denied = new Set<string>();

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const table = (id: string, position: string, showPageIcon?: boolean): DatabaseViewConfig => ({
  id, name: id, type: 'table', position, filters: [], sorts: [], visibleProperties: [],
  ...(showPageIcon === undefined ? {} : { showPageIcon }),
});

const database = (id: string, views: DatabaseViewConfig[], activeViewId: string, rowId: string): OutputBlockData => ({
  id, type: 'database', content: [rowId],
  data: {
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'n', name: 'Notes', type: 'text', position: 'a1' },
      { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a2',
        config: { options: [{ id: 'red', label: 'Red', position: 'a0' }] } },
    ],
    views, activeViewId,
  },
});

const row = (id: string, parent: string): OutputBlockData => ({
  id, type: 'database-row', parent,
  data: { icon: '★', properties: { t: id, n: 'Keep this text', tags: ['red'] }, position: 'a0' },
});

const ordinaryDoc = (initial?: boolean): OutputBlockData[] => [
  database('db', [table('v1', 'a0', initial), table('v2', 'a1', false)], 'v1', 'r1'),
  row('r1', 'db'),
];

const dashboardDoc = (twins = false): OutputBlockData[] => [
  database('db', [{
    ...table('dash', 'a0'), type: 'dashboard',
    dashboard: { rows: [{ id: 'widget-row', widgets: [
      { id: 'foreign', databaseId: 'view-owner', viewId: 'owned', width: twins ? 6 : 12 },
      ...(twins ? [{ id: 'twin', databaseId: 'view-owner', viewId: 'owned', width: 6 }] : []),
    ] }] },
  }], 'dash', 'local-row'),
  row('local-row', 'db'),
  database('view-owner', [
    { ...table('owned', 'a0', true), dataSourceId: 'source' },
    table('owner-other', 'a1', false),
  ], 'owner-other', 'owner-row'),
  row('owner-row', 'view-owner'),
  database('source', [table('source-active', 'a0', false), table('source-other', 'a1', true)], 'source-active', 'source-row'),
  row('source-row', 'source'),
];

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  const permissions: DatabasePermissions = {
    can: (_action, { databaseId }) => !denied.has(databaseId),
  };

  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: { permissions } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (api) => { ready = api; },
  });
  await editor.isReady;
  await quiet();

  if (ready === undefined) throw new Error('editor did not expose its ready API');
  return ready;
};

const element = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error('missing fixture element ' + selector);
  return found;
};

const databaseRoot = (id: string): HTMLElement => {
  if (holder === undefined) throw new Error('missing editor holder');
  return element(holder, '[data-blok-element][data-blok-id="' + id + '"]');
};

const widgetRoot = (id = 'foreign'): HTMLElement =>
  element(databaseRoot('db'), '[data-blok-database-dashboard-widget="' + id + '"]');

const header = (root: ParentNode, propertyId: string): HTMLElement =>
  element(root, '[role="columnheader"][data-property-id="' + propertyId + '"]');

const iconItem = (menu: ParentNode): HTMLElement | undefined =>
  [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="switch"]')]
    .find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === 'Show page icon');

const openHeader = async (root: ParentNode, propertyId: string): Promise<HTMLElement> => {
  header(root, propertyId).click();
  await quiet();
  const input = document.querySelector('[data-blok-database-property-menu-name-input]');
  const menu = input?.closest<HTMLElement>('[data-blok-popover]');

  if (menu === null || menu === undefined) throw new Error('native property menu did not open');
  return menu;
};

const iconAction = async (root: ParentNode): Promise<HTMLElement> => {
  const action = iconItem(await openHeader(root, 't'));

  expect(action, 'title header must offer Show page icon').toBeDefined();
  if (action === undefined) throw new Error('missing title header Show page icon');
  return action;
};

const closeMenu = async (): Promise<void> => {
  const menu = element(document, '[data-blok-popover][data-blok-popover-opened="true"]');

  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await quiet();
};

const settingsIcon = async (): Promise<HTMLElement> => {
  element(databaseRoot('db'), '[data-blok-testid="database-toolbar-settings"]').click();
  await quiet();
  element(document, '[data-blok-testid="database-settings-layout"]').click();
  await quiet();
  return element(document, '[data-blok-testid="database-settings-page-icon"]');
};

const dataOf = (output: OutputData, id: string): DatabaseData => {
  const block = output.blocks.find((candidate) => candidate.id === id);

  if (block === undefined || block.type !== 'database'
    || !Array.isArray(block.data.schema) || !Array.isArray(block.data.views)) {
    throw new Error('missing saved database ' + id);
  }
  return block.data as unknown as DatabaseData;
};

const viewsWithoutIcon = (data: DatabaseData, id: string): DatabaseViewConfig[] =>
  data.views.map((view) => view.id === id ? { ...view, showPageIcon: undefined } : view);

const rowData = (output: OutputData): unknown[] =>
  output.blocks.filter((block) => block.type === 'database-row')
    .map((block) => ({ id: block.id, parent: block.parent, content: block.content, data: block.data }));

const databaseData = (output: OutputData): unknown[] =>
  output.blocks.filter((block) => block.type === 'database').map((block) => ({ id: block.id, data: block.data }));

const expectOnlyViewIconChanged = (after: OutputData, before: OutputData, databaseId: string, viewId: string): void => {
  for (const block of before.blocks.filter((candidate) => candidate.type === 'database')) {
    if (block.id === undefined) throw new Error('database fixture lacks id');
    const oldData = dataOf(before, block.id);
    const newData = dataOf(after, block.id);

    expect(block.id === databaseId ? { ...newData, views: viewsWithoutIcon(newData, viewId) } : newData)
      .toEqual(block.id === databaseId ? { ...oldData, views: viewsWithoutIcon(oldData, viewId) } : oldData);
    expect(newData).not.toHaveProperty('rows');
  }
  expect(rowData(after)).toEqual(rowData(before));
};

describe('title header page icons through the real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    denied = new Set();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  it('offers Show page icon on the title header, not on a text header', async () => {
    await make(ordinaryDoc());

    expect(iconItem(await openHeader(databaseRoot('db'), 't'))).toBeDefined();
    await closeMenu();
    expect(iconItem(await openHeader(databaseRoot('db'), 'n'))).toBeUndefined();
  });

  it.each([
    { label: 'default-on', initial: undefined, next: false },
    { label: 'saved-off', initial: false, next: true },
  ])('saves and reloads the selected view icon setting from the $label title header', async ({ initial, next }) => {
    const current = await make(ordinaryDoc(initial));
    const before = await current.save();
    const action = await iconAction(databaseRoot('db'));

    expect(action.getAttribute('role')).toBe('switch');
    expect(action.getAttribute('aria-checked')).toBe(String(initial !== false));
    expect(action.closest('[data-blok-item-name]')?.getAttribute('data-blok-item-name')).toBe('database-show-page-icon');
    action.click();
    await quiet();
    const changed = await current.save();

    expect(dataOf(changed, 'db').views.find((view) => view.id === 'v1')?.showPageIcon).toBe(next);
    expect([...databaseRoot('db').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(next ? ['★'] : []);
    expectOnlyViewIconChanged(changed, before, 'db', 'v1');

    current.destroy();
    editor = undefined;
    if (holder === undefined) throw new Error('missing reload holder');
    holder.replaceChildren();
    const reloaded = await make(changed.blocks);
    const restored = await reloaded.save();

    expect(dataOf(restored, 'db').views.find((view) => view.id === 'v1')?.showPageIcon).toBe(next);
    expect([...databaseRoot('db').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(next ? ['★'] : []);
    expectOnlyViewIconChanged(restored, before, 'db', 'v1');

    const settings = await settingsIcon();

    expect(settings.getAttribute('aria-checked')).toBe(String(next));
    settings.click();
    await quiet();
    const reversed = await reloaded.save();

    expect(dataOf(reversed, 'db').views.find((view) => view.id === 'v1')?.showPageIcon).toBe(!next);
    expect([...databaseRoot('db').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(next ? [] : ['★']);
    expectOnlyViewIconChanged(reversed, before, 'db', 'v1');
  });

  it('changes only the widget definition owner icon setting and its source-row rendering', async () => {
    const current = await make(dashboardDoc());
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);

    expect(action, 'title header must offer Show page icon').toBeDefined();
    if (action === undefined) throw new Error('missing title header Show page icon');
    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(action.getAttribute('role')).toBe('switch');
    expect(action.getAttribute('aria-checked')).toBe('true');

    action.click();
    await quiet();

    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(menu.isConnected).toBe(true);
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(menu);
    const unchecked = iconItem(menu);

    expect(unchecked, 'the still-open menu must retain its title icon toggle').toBeDefined();
    expect(unchecked?.getAttribute('role')).toBe('switch');
    expect(unchecked?.getAttribute('aria-checked')).toBe('false');
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(false);
    expect(widgetRoot().querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
  });

  it('toggles both widgets of one saved view twice from the same title menu', async () => {
    const current = await make(dashboardDoc(true));
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);

    if (action === undefined) throw new Error('missing title header Show page icon');
    action.click();
    await quiet();

    expect([...widgetRoot('twin').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual([]);
    expect(widgetRoot().querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();

    action.click();
    await quiet();

    expect([...widgetRoot('twin').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(['★']);
    expect([...widgetRoot().querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(['★']);
    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(menu.isConnected).toBe(true);
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(menu);
    expect(iconItem(menu)?.getAttribute('aria-checked')).toBe('true');
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(true);
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
    await closeMenu();
    expect([...widgetRoot('twin').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(['★']);
  });

  it('keeps the replacement twin title menu open between Enter close and redraw', async () => {
    const current = await make(dashboardDoc(true));
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);

    if (action === undefined) throw new Error('missing title header Show page icon');
    action.click();
    await quiet();
    const field = element(menu, '[data-blok-database-property-menu-name-input]');
    const twinHeader = header(widgetRoot('twin'), 't');
    const next: { menu: HTMLElement | null } = { menu: null };

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    queueMicrotask(() => {
      twinHeader.click();
      next.menu = document.querySelector<HTMLElement>(
        '[data-blok-popover][data-blok-popover-opened="true"] [data-blok-database-property-menu-name-input]'
      )?.closest<HTMLElement>('[data-blok-popover]') ?? null;
    });
    await quiet();
    const replacement = next.menu;

    if (replacement === null) throw new Error('twin header did not open a replacement menu');
    expect(replacement.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(replacement.isConnected).toBe(true);
    expect(replacement).not.toBe(menu);
    expect(document.querySelector('[data-blok-popover][data-blok-popover-opened="true"] [data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(replacement);
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(false);
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
  });

  it('rejects the retained title callback after a twin replaces its menu', async () => {
    const originalOpen = DatabasePropertyMenu.prototype.open;
    const opened: Array<Parameters<DatabasePropertyMenu['open']>> = [];

    vi.spyOn(DatabasePropertyMenu.prototype, 'open').mockImplementation(function (
      this: DatabasePropertyMenu, ...args: Parameters<DatabasePropertyMenu['open']>
    ): void {
      opened.push(args);
      originalOpen.apply(this, args);
    });
    const current = await make(dashboardDoc(true));
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);
    const retained = opened[0]?.[2]?.find((item) => 'name' in item && item.name === 'database-show-page-icon');

    if (action === undefined || retained === undefined || !('onActivate' in retained)
      || typeof retained.onActivate !== 'function') throw new Error('missing captured title icon callback');
    action.click();
    await quiet();
    const replacement = await openHeader(widgetRoot('twin'), 't');
    const before = await current.save();

    retained.onActivate(retained);
    await quiet();
    const unchanged = await current.save();

    expect(dataOf(unchanged, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(false);
    expect(databaseData(unchanged)).toEqual(databaseData(before));
    expect(rowData(unchanged)).toEqual(rowData(before));
    expect(replacement.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(replacement.isConnected).toBe(true);
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(replacement);
    const currentAction = iconItem(replacement);

    if (currentAction === undefined) throw new Error('missing replacement title icon action');
    currentAction.click();
    await quiet();
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(true);
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
  });

  it('refreshes the held title checkbox and both widgets after an owner update', async () => {
    const current = await make(dashboardDoc(true));
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);

    if (action === undefined) throw new Error('missing title header Show page icon');
    action.click();
    await quiet();
    const ownerData = dataOf(await current.save(), 'view-owner');
    const owner = current.blocks.getById('view-owner');

    if (owner === null) throw new Error('missing saved view owner');
    ownerData.views = ownerData.views.map((view) => view.id === 'owned' ? { ...view, showPageIcon: true } : view);
    owner.call('setData', ownerData);
    owner.dispatchChange();
    await quiet();

    expect(iconItem(menu)?.getAttribute('aria-checked')).toBe('true');
    expect([...widgetRoot('twin').querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(['★']);
    expect([...widgetRoot().querySelectorAll('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')]
      .map((icon) => icon.textContent)).toEqual(['★']);
    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(menu);

    action.click();
    await quiet();
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(false);
    expect(iconItem(menu)?.getAttribute('aria-checked')).toBe('false');
    expect(widgetRoot('twin').querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();
    expect(widgetRoot().querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
  });

  it('flushes held owner filters after an untoggled twin title menu closes', async () => {
    const current = await make(dashboardDoc(true));
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const action = iconItem(menu);

    if (action === undefined) throw new Error('missing title header Show page icon');
    action.click();
    await quiet();
    const ownerData = dataOf(await current.save(), 'view-owner');
    const filters: DatabaseViewConfig['filters'] = [{
      id: 'held-owner-notes-filter', propertyId: 'n', operator: 'equals', value: 'Missing source note',
    }];

    await current.blocks.update('view-owner', {
      ...ownerData,
      views: ownerData.views.map((entry) => entry.id === 'owned' ? { ...entry, filters } : entry),
    });
    await quiet();
    const replacement = await openHeader(widgetRoot('twin'), 't');

    replacement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect([...widgetRoot().querySelectorAll('[data-blok-database-table-row]')]
      .map((entry) => entry.getAttribute('data-row-id'))).toEqual([]);
    expect([...widgetRoot('twin').querySelectorAll('[data-blok-database-table-row]')]
      .map((entry) => entry.getAttribute('data-row-id'))).toEqual([]);
    expect(widgetRoot().querySelector(
      '[data-blok-database-filter-pill][data-filter-id="held-owner-notes-filter"]'
    )?.textContent).toContain('Missing source note');
    expect(widgetRoot('twin').querySelector(
      '[data-blok-database-filter-pill][data-filter-id="held-owner-notes-filter"]'
    )?.textContent).toContain('Missing source note');
    expect(replacement).not.toBe(menu);
    expect(replacement.getAttribute('data-blok-popover-opened')).toBeNull();
    const output = await current.save();

    expect(dataOf(output, 'view-owner').views.find((entry) => entry.id === 'owned'))
      .toEqual({ ...dataOf(before, 'view-owner').views.find((entry) => entry.id === 'owned'), showPageIcon: false, filters });
    expect(dataOf(output, 'view-owner').activeViewId).toBe('owner-other');
    expect(dataOf(output, 'source')).toEqual(dataOf(before, 'source'));
    expect(dataOf(output, 'db')).toEqual(dataOf(before, 'db'));
    expect(rowData(output)).toEqual(rowData(before));
  });

  it('lets the property emoji child commit after a held title menu hands off focus', async () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    try {
      const blocks = dashboardDoc(true);
      const source = blocks.find((block) => block.id === 'source');

      if (source === undefined) throw new Error('missing property icon source');
      const sourceData = source.data as DatabaseData;

      source.data = {
        ...sourceData,
        schema: sourceData.schema.map((property) => property.id === 't' ? { ...property, icon: 'x' } : property),
      };
      const current = await make(blocks);
      const menu = await openHeader(widgetRoot(), 't');
      const action = iconItem(menu);

      if (action === undefined) throw new Error('missing title header Show page icon');
      action.click();
      await quiet();
      const before = await current.save();
      const field = element(menu, '[data-blok-database-property-menu-name-input]');

      element(menu, '[data-blok-database-property-menu-icon]').click();
      const picker = document.querySelector<HTMLElement>('[data-blok-emoji-picker]');

      await vi.waitFor(() => {
        if (picker?.isConnected === false) return;
        if (picker === null || picker.hidden || !picker.contains(document.activeElement) || field.isConnected) {
          throw new Error('property emoji child is not ready');
        }
      });
      const remove = picker?.querySelector<HTMLElement>('[data-emoji-picker-remove]');
      const handoffReached = picker !== null && picker.isConnected && !picker.hidden
        && picker.contains(document.activeElement) && !field.isConnected && remove?.isConnected === true;

      if (!(field instanceof HTMLInputElement)) throw new Error('missing parent name input');
      field.value = 'Stale closed parent';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      if (handoffReached) remove?.click();
      await quiet();
      const output = await current.save();
      const afterSource = dataOf(output, 'source');
      const beforeSource = dataOf(before, 'source');

      expect(afterSource.schema.find((property) => property.id === 't')?.icon).toBeUndefined();
      expect(handoffReached).toBe(true);
      expect(afterSource.schema.map((property) => property.id === 't' ? { ...property, icon: undefined } : property))
        .toEqual(beforeSource.schema.map((property) => property.id === 't' ? { ...property, icon: undefined } : property));
      expect(dataOf(output, 'view-owner')).toEqual(dataOf(before, 'view-owner'));
      expect(dataOf(output, 'db')).toEqual(dataOf(before, 'db'));
      expect(rowData(output)).toEqual(rowData(before));
    } finally {
      if (matchMediaDescriptor === undefined) Reflect.deleteProperty(window, 'matchMedia');
      else Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
    }
  });

  it('flushes the deferred widget redraw when Enter closes its held title menu', async () => {
    const current = await make(dashboardDoc(true));
    const before = await current.save();
    const menu = await openHeader(widgetRoot(), 't');
    const field = element(document, '[data-blok-database-property-menu-name-input]');
    const action = iconItem(menu);

    if (action === undefined) throw new Error('missing title header Show page icon');
    action.click();
    await quiet();
    const beforeClose = widgetRoot();

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect(widgetRoot()).not.toBe(beforeClose);
    expect(menu.getAttribute('data-blok-popover-opened')).toBeNull();
    expect(widgetRoot('twin').querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();
    const changed = await current.save();

    expect(dataOf(changed, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(false);
    expectOnlyViewIconChanged(changed, before, 'view-owner', 'owned');
  });

  it.each(['db', 'view-owner'] as const)('does not admit a title icon write while only %s is read-only', async (databaseId) => {
    denied.add(databaseId);
    const current = await make(dashboardDoc());
    const before = await current.save();

    header(widgetRoot(), 't').click();
    await quiet();
    const unchanged = await current.save();

    expect(databaseData(unchanged)).toEqual(databaseData(before));
    expect(iconItem(document)).toBeUndefined();
    expect(rowData(unchanged)).toEqual(rowData(before));
    expect(header(widgetRoot(), 't').querySelector('[data-blok-database-table-column-button]')?.getAttribute('role')).not.toBe('button');

    const sourceAction = await iconAction(databaseRoot('source'));

    sourceAction.click();
    await quiet();
    const sourceChanged = await current.save();

    expect(dataOf(sourceChanged, 'source').views.find((view) => view.id === 'source-active')?.showPageIcon).toBe(true);
    expect(databaseRoot('source').querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')?.textContent).toBe('★');
    expectOnlyViewIconChanged(sourceChanged, before, 'source', 'source-active');
  });

  it.each(['db', 'view-owner'] as const)('rejects a captured title icon write after only %s loses permission', async (databaseId) => {
    const current = await make(dashboardDoc());
    const before = await current.save();
    const retained = await iconAction(widgetRoot());

    denied.add(databaseId);
    await current.readOnly.set(true);
    await current.readOnly.set(false);
    await quiet();
    retained.click();
    await quiet();
    const unchanged = await current.save();

    expect(dataOf(unchanged, 'view-owner').views.find((view) => view.id === 'owned')?.showPageIcon).toBe(true);
    expect(databaseData(unchanged)).toEqual(databaseData(before));
    expect(rowData(unchanged)).toEqual(rowData(before));

    const sourceAction = await iconAction(databaseRoot('source'));

    sourceAction.click();
    await quiet();
    const sourceChanged = await current.save();

    expect(dataOf(sourceChanged, 'source').views.find((view) => view.id === 'source-active')?.showPageIcon).toBe(true);
    expect(databaseRoot('source').querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')?.textContent).toBe('★');
    expectOnlyViewIconChanged(sourceChanged, before, 'source', 'source-active');
  });

  it('keeps the same title header menu open and unchecks Show page icon after click', async () => {
    const current = await make(ordinaryDoc());
    const before = await current.save();
    const menu = await openHeader(databaseRoot('db'), 't');
    const action = iconItem(menu);

    expect(action, 'title header must offer Show page icon').toBeDefined();
    if (action === undefined) throw new Error('missing title header Show page icon');
    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(action.getAttribute('role')).toBe('switch');
    expect(action.getAttribute('aria-checked')).toBe('true');

    action.click();
    await quiet();

    expect(menu.getAttribute('data-blok-popover-opened')).toBe('true');
    expect(menu.isConnected).toBe(true);
    expect(document.querySelector('[data-blok-database-property-menu-name-input]')
      ?.closest('[data-blok-popover]')).toBe(menu);
    const unchecked = iconItem(menu);

    expect(unchecked, 'the still-open menu must retain its title icon toggle').toBeDefined();
    expect(unchecked?.getAttribute('role')).toBe('switch');
    expect(unchecked?.getAttribute('aria-checked')).toBe('false');
    const changed = await current.save();

    expect(dataOf(changed, 'db').views.find((view) => view.id === 'v1')?.showPageIcon).toBe(false);
    expect(databaseRoot('db').querySelector('[role="gridcell"][data-property-id="t"] [data-blok-database-page-icon]')).toBeNull();
    expectOnlyViewIconChanged(changed, before, 'db', 'v1');
  });

  // No blue selected states: the switch carries the state, the row keeps no fill and the menu's ink.
  it('paints Show page icon on with no fill and the same ink as when off', () => {
    const css = readMainCss();
    const rule = css.match(/\[data-blok-database-property-menu-switch\]\s*\{([^}]*)\}/)?.[1];

    expect(rule).toMatch(/background:\s*transparent\s*;/);
    expect(rule).toMatch(/color:\s*var\(--blok-database-ink\)\s*;/);
    expect(css).not.toMatch(/\[data-blok-database-property-menu-switch\][^{,]*\[aria-checked/);
    expect(css).not.toContain('[data-blok-item-name="database-show-page-icon"]');
  });
});
