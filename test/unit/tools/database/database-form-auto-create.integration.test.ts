import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData, OutputData } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;
let database: DatabaseTool | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const prompt = (): HTMLElement | null => q('[data-blok-database-confirm-dialog]');
const action = (name: 'confirm' | 'cancel'): HTMLButtonElement => {
  const button = q<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`);

  if (button === null) throw new Error(`Missing ${name}`);

  return button;
};

// Research/19 §0: Pick (Select), Who (Person), Doc (Files), Stage (Status), Link (Relation).
const measured: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'pick', name: 'Pick', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'who', name: 'Who', type: 'person', position: 'a2' },
  { id: 'doc', name: 'Doc', type: 'files', position: 'a3' },
  { id: 'stage', name: 'Stage', type: 'status', position: 'a4', config: { options: [] } },
  { id: 'link', name: 'Link', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db' } },
  { id: 'made', name: 'Created', type: 'createdTime', position: 'a6' },
];

const blocksFor = (schema: PropertyDefinition[]): OutputBlockData[] => [{
  id: 'db', type: 'database', content: [],
  data: {
    schema,
    views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'table',
  } satisfies DatabaseData,
}];

const mount = async (blocks: OutputBlockData[]): Promise<void> => {
  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config: { people: { list: async () => [] } } });
      database = this;
    }
  }

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    data: { blocks },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-view-tabs], [data-blok-database-tab]')).not.toBeNull());
};

const formView = async (): Promise<DatabaseViewConfig | undefined> => {
  if (editor === undefined) throw new Error('Missing editor');
  const saved: OutputData = await editor.save();

  return (saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData).views.find((view) => view.type === 'form');
};

const questions = (): Array<string | null> =>
  [...document.querySelectorAll('[data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question'));

const addForm = (): void => {
  if (database === undefined) throw new Error('Missing database');
  database.addView('form');
};

describe('form view auto-create prompt (research/19 §3a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    database = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('asks to auto-create questions, counting supported properties without Status', async () => {
    await mount(blocksFor(measured));
    addForm();

    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    expect(prompt()?.getAttribute('role')).toBe('dialog');
    expect(prompt()?.textContent).toContain('Auto-create form questions based on existing properties?');
    expect(prompt()?.textContent).toContain('Only supported property types will create new questions.');
    expect(action('confirm').textContent).toBe('Create 4 questions');
    expect(action('cancel').textContent).toBe('Start from scratch');
  });

  it('"Create 4 questions" keeps Name, Pick, Who, Doc and Link in property order; Stage gets none', async () => {
    await mount(blocksFor(measured));
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    action('confirm').click();

    await vi.waitFor(() => expect(prompt()).toBeNull());
    expect(questions()).toEqual(['title', 'pick', 'who', 'doc', 'link']);
  });

  it('"Start from scratch" leaves only Name, and that survives a save', async () => {
    await mount(blocksFor(measured));
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    action('cancel').click();

    await vi.waitFor(() => expect(questions()).toEqual(['title']));
    const saved = await formView();

    expect(saved?.properties?.filter((entry) => entry.visible).map((entry) => entry.id)).toEqual(['title']);
  });

  it('Escape keeps the auto-created questions (the primary choice)', async () => {
    await mount(blocksFor(measured));
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    action('confirm').focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => expect(prompt()).toBeNull());
    expect(questions()).toEqual(['title', 'pick', 'who', 'doc', 'link']);
  });

  it('says "Create 1 question" for a single supported property', async () => {
    await mount(blocksFor([measured[0], measured[1], measured[4]]));
    addForm();

    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    expect(action('confirm').textContent).toBe('Create 1 question');
  });

  it('asks again on every new form view, and not for other layouts or a duplicate', async () => {
    await mount(blocksFor(measured));
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    action('cancel').click();
    await vi.waitFor(() => expect(prompt()).toBeNull());
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    action('confirm').click();
    await vi.waitFor(() => expect(prompt()).toBeNull());

    database?.addView('board');
    if (database === undefined) throw new Error('Missing database');
    const forms = (await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData;
    const form = forms.views.find((view) => view.type === 'form');

    database.duplicateView(form?.id ?? '');
    await Promise.resolve();
    expect(prompt()).toBeNull();
  });

  it('asks nothing when no property can be a question', async () => {
    await mount(blocksFor([measured[0], measured[4], measured[6]]));
    addForm();
    await vi.waitFor(() => expect(questions()).toEqual(['title']));

    expect(prompt()).toBeNull();
  });

  it('closes the prompt without writing when the editor goes away', async () => {
    await mount(blocksFor(measured));
    addForm();
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    editor?.destroy();
    editor = undefined;

    expect(prompt()).toBeNull();
  });
});
