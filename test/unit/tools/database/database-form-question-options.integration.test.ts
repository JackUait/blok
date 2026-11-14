import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const byTestId = (id: string): string => `[data-blok-testid="${id}"]`;
const click = (selector: string): void => {
  const element = q(selector);

  if (element === null) throw new Error(`Missing ${selector}`);
  element.click();
};
const questionIds = (): Array<string | null> =>
  [...document.querySelectorAll('[data-blok-database-form] [data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question'));

const blocks: OutputBlockData[] = [{
  id: 'db', type: 'database', content: [],
  data: {
    schema: [
      { id: 'title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'email', name: 'Email', type: 'email', position: 'a1' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
    ],
    views: [{
      id: 'form', name: 'Form builder', type: 'form', position: 'a0', sorts: [], filters: [],
      visibleProperties: ['email', 'notes'],
      properties: [{ id: 'title', visible: true }, { id: 'email', visible: true }, { id: 'notes', visible: true }],
    }],
    activeViewId: 'form',
  } satisfies DatabaseData,
}];

const mount = async (): Promise<void> => {
  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-form]')).not.toBeNull());
};

const openOptions = (id: string): void => click(`[data-blok-database-form-question="${id}"] ${byTestId('database-form-question-menu')}`);

describe('form Question options (notion-motion.md Round 31 §1)', () => {
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

  it('Move question › Move down reorders the questions and saves the order', async () => {
    await mount();
    expect(questionIds()).toEqual(['title', 'email', 'notes']);
    openOptions('email');
    click(byTestId('database-form-question-move'));
    click(byTestId('database-form-question-move-down'));

    await vi.waitFor(() => expect(questionIds()).toEqual(['title', 'notes', 'email']));
    const saved = (await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const order = saved?.views[0].properties?.filter((entry) => entry.visible).map((entry) => entry.id);

    expect(order).toEqual(['title', 'notes', 'email']);
  });

  it('View linked property opens the property menu of that question\'s property', async () => {
    await mount();
    openOptions('notes');
    click(byTestId('database-form-question-linked-property'));

    await vi.waitFor(() => expect(q(byTestId('database-form-question-settings'))).toBeNull());
    await vi.waitFor(() => expect(q<HTMLInputElement>('[data-blok-database-property-menu-name-input]')?.value).toBe('Notes'));
  });
});

describe('form "+" between cards (notion-motion.md Round 31 §1)', () => {
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

  it('adds the picked question in that gap, saves it there, and one undo takes it away', async () => {
    await mount();
    click(`[data-blok-database-form-question="notes"] ${byTestId('database-form-insert-question')}`);
    click(byTestId('database-form-new-number'));

    await vi.waitFor(() => expect(questionIds()).toHaveLength(4));
    const added = questionIds()[2];

    expect(questionIds()).toEqual(['title', 'email', added, 'notes']);
    const saved = (await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(saved?.views[0].properties?.filter((entry) => entry.visible).map((entry) => entry.id)).toEqual(['title', 'email', added, 'notes']);
    // Adding opens the new question's options; close them so the view can redraw.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(q(byTestId('database-form-question-settings'))).toBeNull());
    (editor as unknown as { history: { undo: () => void } }).history.undo();
    await vi.waitFor(async () => {
      const undone = (await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

      expect(undone?.schema.map((property) => property.id)).toEqual(['title', 'email', 'notes']);
    });
    await vi.waitFor(() => expect(questionIds()).toEqual(['title', 'email', 'notes']));
  });
});

describe('form header and name edits keep focus (notion-motion.md Round 31 §1)', () => {
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

  it('a saved title does not redraw the form under the next box; leaving the form does', async () => {
    await mount();
    const title = q<HTMLInputElement>('input[data-blok-database-form-header-title]');
    const description = q<HTMLInputElement>('input[data-blok-database-form-header-description]');

    if (title === null || description === null) throw new Error('no header');
    // Chrome's order on Tab: the box blurs, then "change" fires, then the next box takes focus.
    title.focus();
    title.value = 'Signup';
    title.blur();
    title.dispatchEvent(new Event('change', { bubbles: true }));
    description.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(description.isConnected).toBe(true);
    expect(description).toHaveFocus();
    description.blur();
    await vi.waitFor(() => expect(description.isConnected).toBe(false));
    expect(q<HTMLInputElement>('input[data-blok-database-form-header-title]')?.value).toBe('Signup');
  });

  it('a rename then a click on that card\'s ⋯ opens Question options: no redraw takes the ⋯ away first', async () => {
    await mount();
    const name = q<HTMLInputElement>(`[data-blok-database-form-question="notes"] ${byTestId('database-form-question-name')}`);
    const menu = q(`[data-blok-database-form-question="notes"] ${byTestId('database-form-question-menu')}`);

    if (name === null || menu === null) throw new Error('no card');
    name.focus();
    name.value = 'Details';
    menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    name.blur();
    name.dispatchEvent(new Event('change', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(menu.isConnected).toBe(true);
    menu.click();

    expect(q(byTestId('database-form-question-settings'))).not.toBeNull();
  });
});
