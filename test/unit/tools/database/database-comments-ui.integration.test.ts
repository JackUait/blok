import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * Built-in comments when the host gives no `comments` hook (research/12 §3):
 * a cell's right-click opens a thread popover with an "Add a comment…"
 * composer; the row then shows an "Open comments" badge; the row page has a
 * "Comments" section.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (config: Record<string, unknown> = {}, companions = true): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      ...(companions ? { 'database-row': DatabaseRowTool, 'database-comment': DatabaseCommentTool } : {}),
    },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const titleCell = (): HTMLElement => {
  const cell = holder?.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-cell][data-property-id="t"]');

  if (cell === null || cell === undefined) throw new Error('no cell');

  return cell;
};

const composerInput = (): HTMLTextAreaElement | null =>
  document.querySelector<HTMLTextAreaElement>('[data-blok-database-comments] [data-blok-database-comment-input]');

const send = async (text: string): Promise<void> => {
  const input = composerInput();

  if (input === null) throw new Error('no composer');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await quiet();
};

const savedComments = async (): Promise<OutputBlockData[]> =>
  ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-comment');

describe('built-in database comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a cell right-click opens a composer that writes a thread on that cell, then a badge shows its count', async () => {
    await make();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    titleCell().dispatchEvent(event);
    await quiet();

    expect(event.defaultPrevented).toBe(true);
    expect(composerInput()?.placeholder).toBe('Add a comment…');
    await send('Looks good');

    const saved = await savedComments();

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ parent: 'r1', data: { text: 'Looks good', propertyId: 't' } });
    expect(document.querySelector('[data-blok-database-comment-text]')?.textContent).toBe('Looks good');
    expect(document.querySelector('[data-blok-database-comment-author]')?.textContent).toBe('Anonymous');
    expect(document.querySelector('[data-blok-database-comment-time]')?.textContent).toBe('Just now');

    const badge = holder?.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-comment-badge]');

    expect(badge?.getAttribute('aria-label')).toBe('Open comments');
    expect(badge?.textContent?.trim()).toBe('1');
  });

  it('a second message in the same popover replies to the thread', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('First');
    await send('Second');

    const saved = await savedComments();

    expect(saved.map((block) => block.data.text)).toEqual(['First', 'Second']);
    expect(saved[1]?.parent).toBe(saved[0]?.id);
  });

  it('Resolve hides the thread and drops the badge', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('Done?');
    document.querySelector<HTMLElement>('[data-blok-database-comment-resolve]')?.click();
    await quiet();

    expect((await savedComments())[0]?.data.resolved).toBe(true);
    expect(document.querySelector('[data-blok-database-comment-text]')).toBeNull();
    expect(holder?.querySelector('[data-row-id="r1"] [data-blok-database-comment-badge]')).toBeNull();
  });

  it('keeps the host hook when the host gives one', async () => {
    const open = vi.fn();

    await make({ comments: { open } });
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();

    expect(open).toHaveBeenCalledTimes(1);
    expect(composerInput()).toBeNull();
  });

  it('works with only `database` registered: it brings its rows and comments', async () => {
    await make({}, false);
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('No extra entry');

    expect((await savedComments())[0]).toMatchObject({ parent: 'r1', data: { text: 'No extra entry' } });
  });

  it('offers nothing where the host denies comments', async () => {
    await make({ permissions: { can: (action: string) => action !== 'comment' } });
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();

    expect(composerInput()).toBeNull();
  });

  it('the row page shows a Comments section with an always-shown composer, and its thread', async () => {
    await make();
    const open = holder?.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-open]')
      ?? holder?.querySelector<HTMLElement>('[data-blok-database-table-open][data-row-id="r1"]');

    open?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();
    const section = holder?.querySelector<HTMLElement>('[data-blok-database-comments-section]');

    expect(section?.querySelector('[data-blok-database-comments-label]')?.textContent).toBe('Comments');
    const input = section?.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

    if (input === null || input === undefined) throw new Error('no composer');
    input.value = 'From the page';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect(section?.querySelector('[data-blok-database-comment-text]')?.textContent).toBe('From the page');
    expect((await savedComments())[0]?.data).not.toHaveProperty('propertyId');
  });

  // feel/findings-rowpage R14: the composer starts with the viewer's avatar, as Notion's.
  it('the composer shows the viewer avatar before the field', async () => {
    await make({ people: { list: () => Promise.resolve([{ id: 'u1', name: 'Ada Lovelace' }]), me: () => 'u1' } });
    holder?.querySelector<HTMLElement>('[data-blok-database-table-open]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();
    const composer = holder?.querySelector<HTMLElement>('[data-blok-database-comments-section] [data-blok-database-comment-composer]');

    expect(composer?.firstElementChild?.hasAttribute('data-blok-database-comment-avatar')).toBe(true);
    expect(composer?.firstElementChild?.textContent).toBe('A');
  });

  it('Delete asks "Delete this comment?" first and deletes only on confirm', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('Oops');
    const more = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-comment-actions]');
    const pickDelete = async (): Promise<void> => {
      more()?.click();
      await quiet();
      document.querySelector<HTMLElement>('[data-blok-database-comment-action="delete"]')?.click();
      await quiet();
    };

    await pickDelete();
    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Delete this comment?');
    document.querySelector<HTMLElement>('[data-blok-database-confirm-action="cancel"]')?.click();
    await quiet();
    expect(await savedComments()).toHaveLength(1);

    await pickDelete();
    document.querySelector<HTMLElement>('[data-blok-database-confirm-action="confirm"]')?.click();
    await quiet();
    expect(await savedComments()).toHaveLength(0);
  });

  it('Edit from More actions changes the text and marks it edited; Escape leaves only the edit', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('Typo');
    const startEdit = async (): Promise<HTMLTextAreaElement | null> => {
      document.querySelector<HTMLElement>('[data-blok-database-comment-actions]')?.click();
      document.querySelector<HTMLElement>('[data-blok-database-comment-action="edit"]')?.click();
      await quiet();

      return document.querySelector<HTMLTextAreaElement>('[data-blok-database-comment] [data-blok-database-comment-input]');
    };

    const escaped = await startEdit();

    escaped?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();
    expect(document.querySelector('[data-blok-database-comment-text]')?.textContent).toBe('Typo');
    expect(composerInput()).not.toBeNull();

    const input = await startEdit();

    if (input === null) throw new Error('no edit field');
    input.value = 'Fixed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await savedComments())[0]?.data).toMatchObject({ text: 'Fixed', editedAt: expect.any(Number) });
    expect(document.querySelector('[data-blok-database-comment-time]')?.textContent).toBe('Just now (edited)');
  });

  it('opening one comment\'s actions menu closes another\'s, so one Escape closes the open one', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('First');
    await send('Second');
    const [moreA, moreB] = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-database-comment-actions]'));
    const [menuA, menuB] = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-database-comment-menu]'));

    moreA?.click();
    moreB?.click();

    expect(menuA?.hidden).toBe(true);
    expect(menuB?.hidden).toBe(false);
    expect(moreA?.getAttribute('aria-expanded')).toBe('false');
  });

  it('closing the popover mid-edit removes the edit\'s window Escape listener', async () => {
    await make();
    titleCell().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    await send('Draft');
    document.querySelector<HTMLElement>('[data-blok-database-comment-actions]')?.click();
    // Spy after the menu opens: the menu adds an Escape listener of its own.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');

    document.querySelector<HTMLElement>('[data-blok-database-comment-action="edit"]')?.click();
    await quiet();
    const listener = added.mock.calls.find(([type, , capture]) => type === 'keydown' && capture === true)?.[1];

    if (listener === undefined) throw new Error('no edit Escape listener');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(document.querySelector('[data-blok-database-comments]')?.isConnected ?? false).toBe(false);
    expect(removed).toHaveBeenCalledWith('keydown', listener, true);
  });
});

