import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseConfig, DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData, OutputData } from '../../../../types';
import type { BlokUploader } from '../../../../types/configs/uploader';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const requireElement = <T extends Element = HTMLElement>(selector: string): T => {
  const element = q<T>(selector);

  if (element === null) throw new Error(`Missing ${selector}`);

  return element;
};

const save = async (): Promise<OutputData> => {
  if (editor === undefined) throw new Error('Missing editor');

  return editor.save();
};

const mount = async (
  property: PropertyDefinition,
  config: DatabaseConfig = {},
  uploader?: BlokUploader,
  extraBlocks: OutputBlockData[] = [],
): Promise<void> => {
  const schema: PropertyDefinition[] = [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    property,
  ];
  const relatedRows: OutputBlockData[] = property.type === 'relation' ? [{
    id: 'target', type: 'database-row', parent: 'db',
    data: { position: 'a0', properties: { title: 'Existing target' } },
  }] : [];

  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config });
    }
  }

  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    ...(uploader === undefined ? {} : { uploader }),
    data: { blocks: [{
      id: 'db', type: 'database', content: property.type === 'relation' ? ['target'] : [],
      data: {
        schema,
        views: [{
          id: 'form', name: 'Form', type: 'form', position: 'a0', sorts: [], filters: [],
          visibleProperties: [property.id],
          properties: schema.map((entry) => ({ id: entry.id, visible: true })),
        }],
        activeViewId: 'form',
      } satisfies DatabaseData,
    }, ...relatedRows, ...extraBlocks] },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-form]')).not.toBeNull());
};

const openAnswer = (id: string): void => {
  const question = q(`[data-blok-database-form-question="${id}"]`);

  expect(question).not.toBeNull();
  requireElement(`[id="blok-form-form-${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const finishAnswer = (): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const submit = (): void => {
  requireElement<HTMLInputElement>('[id="blok-form-form-title"]').value = 'Response';
  requireElement<HTMLButtonElement>('[data-blok-database-form-submit]').click();
};

describe('provider-backed form questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('asks for a person and saves the chosen id in a normal child row', async () => {
    const onSubmit = vi.fn();

    await mount(
      { id: 'assignee', name: 'Assignee', type: 'person', position: 'a1' },
      { people: { list: async () => [{ id: 'ada', name: 'Ada' }] }, forms: { onSubmit } },
    );
    openAnswer('assignee');
    await vi.waitFor(() => expect(q('[data-blok-database-person-option="ada"]')).not.toBeNull());
    requireElement('[data-blok-database-person-option="ada"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    finishAnswer();
    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row');

    expect(response?.data.properties).toEqual({ title: 'Response', assignee: [{ id: 'ada' }] });
    if (response === undefined || response.id === undefined || response.id === '') throw new Error('Missing response id');
    expect(response.parent).toBe('db');
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual([response.id]);
    expect(response.data.title).toBe('Response');
    expect(typeof response.data.position).toBe('string');
    expect(response.data.position).not.toBe('');
    expect(saved.blocks.filter((block) => block.type === 'database-row')).toHaveLength(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      databaseId: 'db', viewId: 'form', rowId: response?.id,
      values: { title: 'Response', assignee: [{ id: 'ada' }] },
    }));
  });

  it('asks for an existing related row and keeps the reference, not its title', async () => {
    await mount({
      id: 'related', name: 'Related', type: 'relation', position: 'a1',
      relation: { targetDatabaseId: 'db' },
    });
    openAnswer('related');
    requireElement('[data-blok-database-relation-option="target"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    finishAnswer();
    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row' && block.id !== 'target');

    expect(response?.data.properties).toEqual({ title: 'Response', related: [{ id: 'target' }] });
    if (response === undefined || response.id === undefined || response.id === '') throw new Error('Missing response id');
    expect(response.parent).toBe('db');
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual(['target', response.id]);
    expect(response.data.title).toBe('Response');
    expect(typeof response.data.position).toBe('string');
    expect(response.data.position).not.toBe('');
    expect(saved.blocks.find((block) => block.id === 'target')?.data.properties).toMatchObject({ title: 'Existing target' });
    expect(saved.blocks.filter((block) => block.type === 'database-row')).toHaveLength(2);
  });

  it.each([
    { databaseId: 'other-source', documentId: 'source-document' },
    { databaseId: 'source-db', documentId: 'other-document' },
  ])('does not deliver a prior answer after the same form changes source to %j', async (source) => {
    const onSubmit = vi.fn();

    await mount(
      { id: 'assignee', name: 'Assignee', type: 'person', position: 'a1' },
      { people: { list: async () => [{ id: 'ada', name: 'Ada' }] }, forms: { onSubmit } },
    );
    const initial = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || initial === undefined) throw new Error('Missing database');
    await editor.blocks.update('db', {
      ...initial, source: { databaseId: 'source-db', documentId: 'source-document' },
    });
    openAnswer('assignee');
    await vi.waitFor(() => expect(q('[data-blok-database-person-option="ada"]')).not.toBeNull());
    requireElement('[data-blok-database-person-option="ada"]').click();
    const selected = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (selected === undefined) throw new Error('Missing selected form');
    await editor.blocks.update('db', { ...selected, source });

    expect(q('[data-blok-database-person-editor]')).toBeNull();
    finishAnswer();
    submit();
    const saved = await save();

    expect(onSubmit).toHaveBeenCalledWith({ databaseId: 'db', viewId: 'form', values: { title: 'Response' } });
    expect(saved.blocks.filter((block) => block.type === 'database-row')).toEqual([]);
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toBeUndefined();
    expect(saved.blocks.find((block) => block.id === 'db')?.data.source).toEqual(source);
  });

  it.each([
    { targetDatabaseId: 'other' },
    { targetDatabaseId: 'db', targetDocumentId: 'other-document' },
  ])('does not save a prior answer after the same relation changes target to %j', async (relation) => {
    const onSubmit = vi.fn();
    const otherBlocks: OutputBlockData[] = [{
      id: 'other', type: 'database', content: ['other-target'],
      data: {
        schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }],
        views: [{
          id: 'other-table', name: 'Other', type: 'table', position: 'a0',
          sorts: [], filters: [], visibleProperties: [],
        }],
        activeViewId: 'other-table',
      } satisfies DatabaseData,
    }, {
      id: 'other-target', type: 'database-row', parent: 'other',
      data: { position: 'a0', properties: { title: 'Other target' } },
    }];

    await mount({
      id: 'related', name: 'Related', type: 'relation', position: 'a1',
      relation: { targetDatabaseId: 'db' },
    }, { forms: { onSubmit } }, undefined, otherBlocks);
    openAnswer('related');
    requireElement('[data-blok-database-relation-option="target"]').click();
    const selected = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || selected === undefined) throw new Error('Missing selected form');
    await editor.blocks.update('db', {
      ...selected,
      schema: selected.schema.map((property) => property.id === 'related' ? { ...property, relation } : property),
    });
    finishAnswer();
    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row' && block.id !== 'target' && block.id !== 'other-target');

    expect(response?.data.properties).toEqual({ title: 'Response', related: [] });
    if (response === undefined || response.id === undefined || response.id === '') throw new Error('Missing response id');
    expect(onSubmit).toHaveBeenCalledWith({
      databaseId: 'db', viewId: 'form', rowId: response.id, values: { title: 'Response' },
    });
    expect(response.parent).toBe('db');
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual(['target', response.id]);
    expect(saved.blocks.find((block) => block.id === 'other')?.content).toEqual(['other-target']);
    expect(saved.blocks.find((block) => block.id === 'target')?.data.properties).toMatchObject({ title: 'Existing target' });
    expect(saved.blocks.find((block) => block.id === 'other-target')?.data.properties).toMatchObject({ title: 'Other target' });
  });

  it('uses the existing uploader for a file answer and saves a FileValue list', async () => {
    const uploadByFile = vi.fn(async () => ({
      url: 'https://example.test/stored/brief.pdf', fileName: 'stored-brief.pdf',
    }));

    await mount(
      { id: 'attachment', name: 'Attachment', type: 'files', position: 'a1' },
      {},
      { uploadByFile },
    );
    openAnswer('attachment');
    const input = requireElement<HTMLInputElement>('[data-blok-database-files-input]');
    const file = new File(['brief'], 'brief.pdf', { type: 'application/pdf' });

    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(q('[data-blok-database-file-row]')).not.toBeNull());
    finishAnswer();
    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row');

    expect(response?.data.properties).toEqual({
      title: 'Response',
      attachment: [{ id: expect.any(String), name: 'stored-brief.pdf', url: 'https://example.test/stored/brief.pdf' }],
    });
    if (response === undefined || response.id === undefined || response.id === '') throw new Error('Missing response id');
    expect(response.parent).toBe('db');
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual([response.id]);
    expect(response.data.title).toBe('Response');
    expect(typeof response.data.position).toBe('string');
    expect(response.data.position).not.toBe('');
    expect(uploadByFile).toHaveBeenCalledWith(file, expect.objectContaining({ kind: 'file', tool: 'database' }));
    expect(saved.blocks.filter((block) => block.type === 'database-row')).toHaveLength(1);
  });
});
