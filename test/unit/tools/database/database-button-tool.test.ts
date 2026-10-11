import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
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
