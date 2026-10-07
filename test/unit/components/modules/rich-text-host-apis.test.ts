/**
 * Host APIs that hand out block data without going through `blok.save()`
 * return segments too, with the same fallbacks as the Saver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Blok } from '../../../../src/blok';
import { BlockAPI } from '../../../../src/components/block/api';
import type { Block } from '../../../../src/components/block';
import { API } from '../../../../src/components/modules/api';
import { Saver } from '../../../../src/components/modules/saver';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import { createBlocksApiForEditor } from '../../../../src/components/utils/blocks-api';
import { Header } from '../../../../src/tools/header';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Blok as PublicBlok, API as PublicAPI, BlokConfig, OutputData } from '../../../../types';
import type { BlockAPI as BlockAPIInterface } from '../../../../types/api';
import type { BlockToolConstructable } from '../../../../types/tools';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: PublicAPI['blocks'];
}

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const createEditor = async (config: Partial<BlokConfig>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header as unknown as BlockToolConstructable },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const bold = [{ text: 'a', marks: { bold: true } }];

/** Any warning about rich text: the fallbacks are silent. */
const richTextWarnings = (spy: MockInstance): unknown[][] =>
  spy.mock.calls.filter(call => call.some(arg => typeof arg === 'string' && /rich ?text|segments/i.test(arg)));

/** A BlockAPI over a stub block whose core runs with or without collaboration. */
const blockApiUnder = (
  collaborating: boolean,
  data: Record<string, unknown> = { text: '<b>a</b>' },
  name = 'paragraph'
): BlockAPIInterface => {
  const paragraph = { name: 'paragraph', richTextFields: [ 'text' ] } as unknown as BlockToolAdapter;
  const tool = name === 'paragraph'
    ? paragraph
    : { name, richTextFields: [] } as unknown as BlockToolAdapter;
  const moduleConfig = {
    config: {},
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as Saver['eventsDispatcher'],
  };
  const saver = new Saver(moduleConfig);
  const api = new API(moduleConfig);
  const state = {
    Saver: saver,
    Tools: { blockTools: new Map([['paragraph', paragraph], [name, tool]]) },
    Renderer: { getDetectedInputFormat: () => 'flat' },
    ...(collaborating ? { Collaboration: { isEnabled: true } } : {}),
  } as unknown as BlokModules;

  saver.state = state;
  api.state = state;

  const block = {
    id: 'p1',
    name,
    tool,
    save: () => Promise.resolve({ id: 'p1', tool: name, data, time: 0 }),
  } as unknown as Block;

  return new BlockAPI(block, api);
};

describe('host APIs that bypass the Saver — segments', { timeout: 60_000 }, () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('BlockAPI.save returns segments by default', async () => {
    const editor = await createEditor({ data: { blocks: [{ type: 'paragraph', data: { text: '<b>a</b>' } }] } });

    const saved = await editor.blocks.getBlockByIndex(0)?.save();

    expect(saved?.data.text).toEqual(bold);
  });

  it('BlockAPI.save keeps HTML, silently, under collaboration', async () => {
    expect((await blockApiUnder(false).save())?.data.text).toEqual(bold);

    const saved = await blockApiUnder(true).save();

    expect(saved?.data.text).toBe('<b>a</b>');
    expect(richTextWarnings(warnSpy)).toHaveLength(0);
  });

  it('BlockAPI.save converts a nested row document too', async () => {
    const nested = { properties: { notes: { blocks: [{ type: 'paragraph', data: { text: '<b>a</b>' } }] } } };

    const saved = await blockApiUnder(false, nested, 'database-row').save();

    expect(saved?.data).toEqual({ properties: { notes: { blocks: [{ type: 'paragraph', data: { text: bold } }] } } });
  });

  it('BlockAPI.save leaves a custom tool\'s nested documents alone', async () => {
    const nested = { properties: { notes: { blocks: [{ type: 'paragraph', data: { text: '<b>a</b>' } }] } } };

    const saved = await blockApiUnder(false, nested, 'my-tool').save();

    expect(saved?.data).toEqual(nested);
  });

  it('BlockAPI.save keeps HTML with legacy output, like the document save', async () => {
    const editor = await createEditor({
      dataModel: 'legacy',
      data: { blocks: [{ type: 'paragraph', data: { text: '<b>a</b>' } }] },
    });

    const saved = await editor.blocks.getBlockByIndex(0)?.save();
    const document = await editor.save();

    expect(saved?.data.text).toBe('<strong>a</strong>');
    expect(document.blocks[0].data.text).toBe('<strong>a</strong>');
  });

  it('onChange target.save returns segments', async () => {
    const targetSaves: unknown[] = [];
    const editor = await createEditor({
      data: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] },
      onChange: (_api, event) => {
        const events = Array.isArray(event) ? event : [ event ];

        events.forEach(change => targetSaves.push(change.detail.target.save().then(saved => saved?.data.text)));
      },
    });

    const element = editor.blocks.getBlockByIndex(0)?.holder.querySelector('[data-blok-tool="paragraph"]');

    if (!(element instanceof HTMLElement)) {
      throw new Error('paragraph has no editable element');
    }
    element.innerHTML = '<b>a</b>';

    await vi.waitFor(() => expect(targetSaves.length).toBeGreaterThan(0), { timeout: 5000 });

    expect(await targetSaves[targetSaves.length - 1]).toEqual(bold);
  });

  it('importMarkdown returns segments by default', async () => {
    const editor = await createEditor({});

    const data = await editor.blocks.importMarkdown('**a**');

    expect(data.blocks[0].data.text).toEqual(bold);
  });

  it('exportMarkdown still writes markdown', async () => {
    const editor = await createEditor({});

    await editor.blocks.importMarkdown('**a** _b_ [c](https://example.com) `d`');

    // The HTML output's markdown, before segments became the default.
    expect(await editor.blocks.exportMarkdown()).toBe('**a** *b* [c](https://example.com) `d`');
  });

  it('typed markup characters survive a host round trip', async () => {
    const editor = await createEditor({ data: { blocks: [{ type: 'paragraph', data: { text: 'first' } }] } });

    editor.blocks.insert('paragraph', { text: [{ text: 'a < b && "c"' }] }, {}, 1);
    const saved = await editor.save();

    expect(saved.blocks.at(-1)?.data.text).toEqual([{ text: 'a < b && "c"' }]);
  });

  it('useBlocks().getBlockData returns segments by default', async () => {
    const editor = await createEditor({
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: '<b>a</b>' } }] },
    });

    const api = createBlocksApiForEditor(editor as unknown as PublicBlok);

    expect(api.getBlockData('p1')?.data.text).toEqual(bold);
  });
});
