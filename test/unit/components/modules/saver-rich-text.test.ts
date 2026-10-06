import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import { isEmptyOutputData } from '../../../../src/shared/output-data';
import { Header } from '../../../../src/tools/header';
import { ImageTool } from '../../../../src/tools/image';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const createEditor = async (config: Partial<BlokConfig>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header as unknown as BlockToolConstructable,
      image: ImageTool as unknown as BlockToolConstructable,
    },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const blocks: OutputData['blocks'] = [
  { type: 'paragraph', data: { text: '<b>a</b> b' } },
  { type: 'header', data: { text: '<i>h</i>', level: 2 } },
  { type: 'image', data: { url: 'https://example.com/a.png', caption: 'cap' } },
];

const fallbackWarnings = (spy: MockInstance): unknown[][] =>
  spy.mock.calls.filter(call => call.some(arg => typeof arg === 'string' && arg.includes('richText: "segments" is ignored')));

/** A Saver driven through the module with one paragraph block, as saver.test.ts does. */
const createModuleSaver = (config: Partial<BlokConfig>, collaborating: boolean): Saver => {
  const saver = new Saver({
    config: { sanitizer: {}, ...config },
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as Saver['eventsDispatcher'],
  });

  const block = {
    id: 'p1',
    name: 'paragraph',
    save: vi.fn(() => Promise.resolve({ id: 'p1', tool: 'paragraph', data: { text: '<strong>a</strong> b' }, time: 0 })),
    validate: vi.fn(() => Promise.resolve(true)),
    parentId: null,
    contentIds: [],
    lastEditedBy: null,
    isEmpty: false,
    tool: { isDefault: false },
  } as unknown as Block;

  const state = {
    BlockManager: { blocks: [ block ] },
    Tools: {
      blockTools: new Map([
        ['paragraph', { sanitizeConfig: {}, richTextFields: [ 'text' ] }],
        ['stub', { sanitizeConfig: {}, richTextFields: [] }],
      ]),
      stubTool: 'stub',
    },
    MediaFailures: { onSave: vi.fn() },
    ...(collaborating ? { Collaboration: { isEnabled: true } } : {}),
  };

  (saver as unknown as { state: Saver['Blok'] }).state = state as unknown as Saver['Blok'];

  return saver;
};

describe('Saver — richText output format', { timeout: 60_000 }, () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('saves rich fields as segments when richText is segments', async () => {
    const editor = await createEditor({ richText: 'segments', data: { blocks } });

    const saved = await editor.save();

    expect(saved.blocks[0].data.text).toEqual([{ text: 'a', marks: { bold: true } }, { text: ' b' }]);
    expect(saved.blocks[1].data.text).toEqual([{ text: 'h', marks: { italic: true } }]);
    expect(saved.blocks[2].data.caption).toBe('cap');
    expect(fallbackWarnings(warnSpy)).toHaveLength(0);
  });

  it('keeps HTML by default', async () => {
    const editor = await createEditor({ data: { blocks } });

    const saved = await editor.save();

    expect(saved.blocks[0].data.text).toBe('<strong>a</strong> b');
  });

  it('saves an empty paragraph as an empty array that still counts as empty', async () => {
    // Two blocks: a lone empty default block is dropped from the output.
    // preserveBlank: without it the paragraph fails validate() and is skipped.
    const editor = await createEditor({
      richText: 'segments',
      tools: { paragraph: { class: Paragraph, config: { preserveBlank: true } } },
      data: { blocks: [{ type: 'paragraph', data: { text: '' } }, { type: 'paragraph', data: { text: '' } }] },
    });

    const saved = await editor.save();

    expect(saved.blocks[0].data.text).toEqual([]);
    expect(isEmptyOutputData(saved)).toBe(true);
  });

  it('keeps HTML and warns once when the output is collapsed to legacy', async () => {
    const editor = await createEditor({ richText: 'segments', dataModel: 'legacy', data: { blocks } });

    await editor.save();
    const saved = await editor.save();

    expect(saved.blocks[0].data.text).toBe('<strong>a</strong> b');
    expect(fallbackWarnings(warnSpy)).toHaveLength(1);
  });

  it('keeps HTML and warns once under collaboration', async () => {
    const control = await createModuleSaver({ richText: 'segments' }, false).save();

    expect(Array.isArray(control?.blocks[0].data.text)).toBe(true);

    const saver = createModuleSaver({ richText: 'segments' }, true);

    await saver.save();
    const saved = await saver.save();

    expect(typeof saved?.blocks[0].data.text).toBe('string');
    expect(fallbackWarnings(warnSpy)).toHaveLength(1);
  });

  it('internal saves stay HTML', async () => {
    const saver = createModuleSaver({ richText: 'segments' }, false);

    const host = await saver.save();
    const internal = await saver.save({ dialect: 'internal' });

    expect(Array.isArray(host?.blocks[0].data.text)).toBe(true);
    expect(typeof internal?.blocks[0].data.text).toBe('string');
  });
});

describe('isEmptyOutputData — non-rich arrays', () => {
  it('keeps its result for a list block with items: []', () => {
    expect(isEmptyOutputData({ blocks: [{ type: 'list', data: { items: [] } }] })).toBe(true);
    expect(isEmptyOutputData({ blocks: [{ type: 'list', data: { style: 'unordered', items: [] } }] })).toBe(false);
  });
});
