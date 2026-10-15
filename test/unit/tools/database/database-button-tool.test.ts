import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ButtonAction, DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});


const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'text', position: 'a1' },
  {
    id: 'btn', name: 'Act', type: 'button', position: 'a2',
    button: {
      label: 'Finish',
      buttonActions: [
        { id: 'x1', type: 'editProperty', propertyId: 'status', value: 'done' },
        { id: 'x2', type: 'insertBlocks', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Closed' } }] },
        { id: 'x3', type: 'callback', name: 'notify' },
      ],
    },
  },
];

const data = (): DatabaseData => ({
  schema: structuredClone(schema),
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['status', 'btn'] }],
  activeViewId: 'v',
});

const buttonOf = (el: HTMLElement, rowId: string): HTMLButtonElement | null =>
  el.querySelector<HTMLButtonElement>(`[data-row-id="${rowId}"] [data-blok-database-button]`);

describe('DatabaseTool — button property', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows a button with its label in the cell', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', data());

    expect(buttonOf(el, 'r1')?.textContent).toBe('Finish');
  });

  it('runs the actions on click as one undo step and calls the host', () => {
    const onAction = vi.fn();
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', data(), { buttons: { onAction } });

    doc.transact.mockClear();
    buttonOf(el, 'r1')?.click();

    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(doc.row('r1').properties.status).toBe('done');
    const body = doc.childrenOf('r1');

    expect(body).toHaveLength(1);
    expect(doc.blocks.get(body[0])?.data).toEqual({ text: 'Closed' });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'db', rowId: 'r1', propertyId: 'btn', action: expect.objectContaining({ name: 'notify' }) }));
  });

  it('never stores a value for the button', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', data());

    buttonOf(el, 'r1')?.click();

    expect(doc.row('r1').properties.btn).toBeUndefined();
  });
});

const withActions = (buttonActions: ButtonAction[], extra: PropertyDefinition[] = []): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'status', name: 'Status', type: 'text', position: 'a1' },
    { id: 'btn', name: 'Act', type: 'button', position: 'a2', button: { label: 'Go', buttonActions } },
    ...extra,
  ],
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['status', 'btn'] }],
  activeViewId: 'v',
});

const otherData = (): DatabaseData => ({
  schema: [
    { id: 't', name: 'Name', type: 'title', position: 'a0' },
    { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
  ],
  views: [{ id: 'ov', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['done'] }],
  activeViewId: 'ov',
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('DatabaseTool — button actions from Notion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('adds a page to this database with its name and values in the click\'s one undo step', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', withActions([
      { id: 'a', type: 'addPage', name: 'Follow-up', edits: [{ id: 'e', propertyId: 'status', value: 'new' }] },
    ]));

    doc.transact.mockClear();
    buttonOf(el, 'r1')?.click();

    expect(doc.transact).toHaveBeenCalledTimes(1);
    const added = doc.childrenOf('db').filter((id) => id !== 'r1');

    expect(added).toHaveLength(1);
    expect(doc.row(added[0]).properties).toEqual(expect.objectContaining({ title: 'Follow-up', status: 'new' }));
  });

  it('adds a page to another database and edits the pages there that match its filter', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'One' } }),
      { id: 'other', name: 'database', parentId: null, data: {} },
      rowSeed('o1', 'other', { properties: { t: 'Alpha', done: false } }),
      rowSeed('o2', 'other', { properties: { t: 'Beta', done: false }, position: 'a1' }),
    ]);

    buildDatabase(doc, 'other', otherData());
    const { el } = buildDatabase(doc, 'db', withActions([
      { id: 'a', type: 'addPage', databaseId: 'other', name: 'Alpine' },
      { id: 'b', type: 'editPages', target: { type: 'database', databaseId: 'other', filters: [{ propertyId: 't', operator: 'contains', value: 'Alp' }] }, edits: [{ id: 'e', propertyId: 'done', value: true }] },
    ]));

    doc.transact.mockClear();
    buttonOf(el, 'r1')?.click();

    expect(doc.transact).toHaveBeenCalledTimes(1);
    const added = doc.childrenOf('other').filter((id) => id !== 'o1' && id !== 'o2');

    expect(added).toHaveLength(1);
    expect(doc.row(added[0]).properties).toEqual(expect.objectContaining({ t: 'Alpine', done: true }));
    expect(doc.row('o1').properties.done).toBe(true);
    expect(doc.row('o2').properties.done).toBe(false);
  });

  it('runs the writes only after Continue, as one undo step', async () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', withActions([
      { id: 'c', type: 'showConfirmation', message: 'Really?', confirmLabel: 'Yes', cancelLabel: 'No' },
      { id: 'x', type: 'editProperty', propertyId: 'status', value: 'done' },
    ]));

    doc.transact.mockClear();
    buttonOf(el, 'r1')?.click();

    const confirm = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Really?');
    expect(confirm?.textContent).toBe('Yes');
    expect(doc.row('r1').properties.status).toBeUndefined();
    confirm?.click();
    await flush();

    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(doc.row('r1').properties.status).toBe('done');
  });

  it('runs nothing after Cancel', async () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { el } = buildDatabase(doc, 'db', withActions([
      { id: 'c', type: 'showConfirmation' },
      { id: 'x', type: 'editProperty', propertyId: 'status', value: 'done' },
    ]));

    buttonOf(el, 'r1')?.click();
    document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="cancel"]')?.click();
    await flush();

    expect(doc.row('r1').properties.status).toBeUndefined();
  });

  it('asks the host to notify the people of a person property, with the message', () => {
    const onNotify = vi.fn();
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One', owner: [{ id: 'u5' }] } })]);
    const { el } = buildDatabase(doc, 'db', withActions(
      [{ id: 'n', type: 'sendNotification', recipients: { type: 'property', propertyId: 'owner' }, message: 'Ready' }],
      [{ id: 'owner', name: 'Owner', type: 'person', position: 'a3' }],
    ), { buttons: { onNotify } });

    buttonOf(el, 'r1')?.click();

    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'db', rowId: 'r1', propertyId: 'btn', to: ['u5'], message: 'Ready' }));
  });

  it('marks the header of a button whose action cannot run (research/17 §3d)', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const header = (el: HTMLElement): Element | null => el.querySelector('[data-blok-database-table-column-header][data-property-id="btn"]');
    const broken = buildDatabase(doc, 'db', withActions([{ id: 'n', type: 'sendNotification' }]), { buttons: { onNotify: vi.fn() } });

    expect(header(broken.el)?.querySelector('[data-blok-database-button-error]')?.getAttribute('aria-label')).toBe('tools.database.buttonError');
    document.body.innerHTML = '';
    const fine = buildDatabase(makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]), 'db', withActions([{ id: 'x', type: 'editProperty', propertyId: 'status', value: 'a' }]));

    expect(header(fine.el)).not.toBeNull();
    expect(header(fine.el)?.querySelector('[data-blok-database-button-error]')).toBeNull();
  });
});
