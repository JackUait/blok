import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputData } from '../../../../types';
import type { BlokUploader } from '../../../../types/configs/uploader';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const byTestId = (id: string): string => `[data-blok-testid="${id}"]`;
const need = <T extends Element = HTMLElement>(selector: string): T => {
  const element = q<T>(selector);

  if (element === null) throw new Error(`Missing ${selector}`);

  return element;
};
const question = (id: string): string => `[data-blok-database-form-question="${id}"]`;
const questions = (): Array<string | null> =>
  [...document.querySelectorAll('[data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question'));
const rowIds = (panel: string, prefix: string): string[] =>
  [...document.querySelectorAll(`${byTestId(panel)} [data-blok-testid^="${prefix}"]`)].map((el) => (el.getAttribute('data-blok-testid') ?? '').slice(prefix.length));

// Research/19 §0's database, with Pick, Who, Doc and Link not yet questions.
const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'pick', name: 'Pick', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'who', name: 'Who', type: 'person', position: 'a2' },
  { id: 'doc', name: 'Doc', type: 'files', position: 'a3' },
  { id: 'stage', name: 'Stage', type: 'status', position: 'a4', config: { options: [] } },
  { id: 'link', name: 'Link', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db' } },
];

const mount = async (visible: string[], uploader?: BlokUploader): Promise<void> => {
  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config: { people: { list: async () => [{ id: 'ada', name: 'Ada' }] } } });
    }
  }

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    ...(uploader === undefined ? {} : { uploader }),
    data: { blocks: [{
      id: 'db', type: 'database', content: ['rowa'],
      data: {
        title: 'Measure D9',
        schema,
        views: [{
          id: 'form', name: 'Form', type: 'form', position: 'a0', sorts: [], filters: [], visibleProperties: [],
          properties: schema.map((property) => ({ id: property.id, visible: visible.includes(property.id) })),
        }],
        activeViewId: 'form',
      } satisfies DatabaseData,
    }, { id: 'rowa', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { title: 'Rowa Nine' } } }] },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-form]')).not.toBeNull());
};

const save = async (): Promise<OutputData> => {
  if (editor === undefined) throw new Error('Missing editor');

  return editor.save();
};

const openMenu = (id: string): void => need(`${question(id)} ${byTestId('database-form-question-menu')}`).click();

describe('form question types (research/19 §3b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('"Add question" opens "Select type": existing properties that are not questions yet, then new question types', async () => {
    await mount(['title', 'who']);
    need(byTestId('database-form-add-question')).click();

    const panel = need(byTestId('database-form-select-type'));

    expect(panel.textContent).toContain('Select type');
    expect([...panel.querySelectorAll('[data-blok-database-panel-section]')].map((el) => el.textContent)).toEqual(['Existing properties', 'New question']);
    expect(rowIds('database-form-select-type', 'database-form-existing-')).toEqual(['pick', 'doc', 'link']);
    expect(need(byTestId('database-form-existing-link')).textContent).toContain('Relation');
    expect(rowIds('database-form-select-type', 'database-form-new-')).toEqual([
      'text', 'multiSelect', 'date', 'person', 'files', 'number', 'checkbox', 'email', 'url', 'phone', 'place',
    ]);
    expect(need(byTestId('database-form-new-multiSelect')).textContent).toContain('Multiple choice');
  });

  it('an existing property becomes the last question, with no new property', async () => {
    await mount(['title', 'who']);
    need(byTestId('database-form-add-question')).click();
    need(byTestId('database-form-existing-link')).click();

    await vi.waitFor(() => expect(questions()).toEqual(['title', 'who', 'link']));
    const data = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData;

    expect(data.schema.map((property) => property.id)).toEqual(schema.map((property) => property.id));
    expect(data.views[0].properties?.find((entry) => entry.id === 'link')?.visible).toBe(true);
  });

  it('a new "Multiple choice" question adds a multi-select property', async () => {
    await mount(['title']);
    need(byTestId('database-form-add-question')).click();
    need(byTestId('database-form-new-multiSelect')).click();

    await vi.waitFor(() => expect(questions()).toHaveLength(2));
    const data = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData;

    expect(data.schema.at(-1)?.type).toBe('multiSelect');
  });

  it('"Question type" lists the new question types; a Select question reads "Multiple choice"', async () => {
    await mount(['title', 'pick']);
    openMenu('pick');

    expect(need(byTestId('database-form-question-type')).textContent).toContain('Multiple choice');
    need(byTestId('database-form-question-type')).click();
    expect(rowIds('database-form-question-settings', 'database-form-question-type-')).toEqual([
      'text', 'multiSelect', 'date', 'person', 'files', 'number', 'checkbox', 'email', 'url', 'phone', 'place',
    ]);
  });

  it('options differ per type as measured: Relation has no Duplicate, Select and Files have no Max selection', async () => {
    await mount(['title', 'pick', 'who', 'doc', 'link']);
    const rows = (id: string): string[] => {
      openMenu(id);
      const found = [...document.querySelectorAll(`${byTestId('database-form-question-settings')} [data-blok-testid]`)]
        .map((el) => el.getAttribute('data-blok-testid') ?? '');

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      return found;
    };
    const link = rows('link');

    expect(link).not.toContain('database-form-duplicate-question');
    expect(link).toContain('database-form-question-max-selection');
    expect(rows('who')).toEqual(expect.arrayContaining(['database-form-duplicate-question', 'database-form-question-max-selection']));
    expect(rows('pick')).not.toContain('database-form-question-max-selection');
    expect(rows('doc')).not.toContain('database-form-question-max-selection');
  });

  it('Person and Relation say how many may be picked, like Multiple choice', async () => {
    await mount(['title', 'who', 'link']);

    expect(q(`${question('who')} [data-blok-database-form-selection-limit]`)?.textContent).toBe('(Respondents can select as many as they like)');
    expect(q(`${question('link')} [data-blok-database-form-selection-limit]`)?.textContent).toBe('(Respondents can select as many as they like)');
  });

  it('a Relation answer picks a page of the related database: "Select a page", "In <database>", "Search…"', async () => {
    await mount(['title', 'link']);
    need('[id="blok-form-form-link"]').click();

    const picker = need('[data-blok-database-relation-editor]');

    expect(picker.querySelector<HTMLInputElement>('[data-blok-database-relation-search]')?.placeholder).toBe('Search…');
    expect(picker.querySelector('[data-blok-database-relation-scope]')?.textContent).toBe('In Measure D9');
    expect(picker.querySelector('[data-blok-database-relation-heading]')?.textContent).toBe('Select a page');
    expect(picker.textContent).toContain('Rowa Nine');
  });

  it('a Files question shows Blok\'s upload limit and refuses a larger file', async () => {
    const uploadByFile = vi.fn(async () => ({ url: 'https://example.test/a.pdf' }));

    await mount(['title', 'doc'], { uploadByFile });

    expect(q(`${question('doc')} [data-blok-database-form-file-limit]`)?.textContent).toBe('Size limit: 30 MB.');
    need('[id="blok-form-form-doc"]').click();
    const input = need<HTMLInputElement>('[data-blok-database-files-input]');
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });

    Object.defineProperty(big, 'size', { value: 31 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { configurable: true, value: [big] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(q(`${question('doc')} [data-blok-database-form-file-error]`)?.textContent)
      .toBe('File is too large. 31 MB exceeds the 30 MB limit.'));
    expect(uploadByFile).not.toHaveBeenCalled();
  });

  it('a Files question without an uploader shows no size limit', async () => {
    await mount(['title', 'doc']);

    expect(q(`${question('doc')} [data-blok-database-form-file-limit]`)).toBeNull();
  });
});
