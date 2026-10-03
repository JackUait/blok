import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools';
import type { BlokConfig, OutputData } from '../../../../types';

const NANOID_21 = /^[A-Za-z0-9_-]{21}$/;

const createSaver = (config: BlokConfig = {}, blocks: Block[] = []): Saver => {
  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as Saver['eventsDispatcher'];

  const saver = new Saver({
    config: { sanitizer: {}, ...config },
    eventsDispatcher,
  });

  const blokState = {
    BlockManager: { blocks },
    Tools: {
      blockTools: new Map([ [ 'stub', { sanitizeConfig: {} } ] ]),
      stubTool: 'stub',
    },
    MediaFailures: { onSave: vi.fn() },
  };

  (saver as unknown as { state: Saver['Blok'] }).state = blokState as unknown as Saver['Blok'];

  return saver;
};

/** One empty default block: the saver's empty-document branch. */
const emptyDefaultBlock = (): Block => ({
  id: 'p1',
  name: 'paragraph',
  save: vi.fn(() => Promise.resolve({ id: 'p1', tool: 'paragraph', data: { text: '' }, time: 0 })),
  validate: vi.fn(() => Promise.resolve(true)),
  parentId: null,
  contentIds: [],
  isEmpty: true,
  tool: { isDefault: true },
} as unknown as Block);

describe('Saver — document id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the id of the loaded document', async () => {
    const saver = createSaver({ data: { id: 'doc-1', blocks: [] } });
    const output = await saver.save();

    expect(output?.id).toBe('doc-1');
  });

  it('writes the id on an empty document too', async () => {
    const saver = createSaver({ data: { id: 'doc-1', blocks: [] } }, [ emptyDefaultBlock() ]);
    const output = await saver.save();

    expect(output?.id).toBe('doc-1');
    expect(output?.blocks).toEqual([]);
  });

  it('mints one id and keeps it across saves when the document has none', async () => {
    const saver = createSaver({ data: { blocks: [] } });
    const first = await saver.save();
    const second = await saver.save();

    expect(first?.id).toMatch(NANOID_21);
    expect(second?.id).toBe(first?.id);
    expect(saver.hasMintedDocumentId()).toBe(true);
  });

  it('does not count a loaded id as minted', () => {
    const saver = createSaver({ data: { id: 'doc-1', blocks: [] } });

    expect(saver.getDocumentRecordId()).toBe('doc-1');
    expect(saver.hasMintedDocumentId()).toBe(false);
  });

  it('ignores an empty or non-string id', async () => {
    const empty = createSaver({ data: { id: '', blocks: [] } });
    const missing = createSaver({ data: { id: null, blocks: [] } });

    expect((await empty.save())?.id).toMatch(NANOID_21);
    expect((await missing.save())?.id).toMatch(NANOID_21);
  });

  it('reads the loaded id lazily, after core replaced config.data', async () => {
    const config: BlokConfig = { data: { blocks: [] } };
    const saver = createSaver(config);

    (saver as unknown as { config: BlokConfig }).config.data = { id: 'persisted', blocks: [] };

    expect((await saver.save())?.id).toBe('persisted');
  });

  it('mints without crypto.randomUUID (plain-http pages)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const saver = createSaver({ data: { blocks: [] } });

    expect((await saver.save())?.id).toMatch(NANOID_21);
  });

  it('adopts the leader id on join', async () => {
    const saver = createSaver({ data: { blocks: [] } });

    saver.adoptDocumentRecordId('leader-id');

    expect((await saver.save())?.id).toBe('leader-id');
    expect(saver.hasMintedDocumentId()).toBe(false);
  });

  it('adopting after a mint clears the minted flag', () => {
    const saver = createSaver({ data: { blocks: [] } });

    saver.getDocumentRecordId();
    saver.adoptDocumentRecordId('leader-id');

    expect(saver.getDocumentRecordId()).toBe('leader-id');
    expect(saver.hasMintedDocumentId()).toBe(false);
  });

  it('reset mints a fresh id even though config.data still holds the old one', () => {
    const saver = createSaver({ data: { id: 'A', blocks: [] } });

    saver.getDocumentRecordId();
    saver.resetDocumentRecordId();

    expect(saver.getDocumentRecordId()).toMatch(NANOID_21);
    expect(saver.hasMintedDocumentId()).toBe(true);
  });
});

describe('Blok — document id through a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type TestEditor = {
    isReady: Promise<unknown>;
    save: () => Promise<OutputData>;
    render: (data: BlokConfig['data']) => Promise<void>;
    blocks: { render: (data: BlokConfig['data']) => Promise<void> };
    destroy: () => void;
  };

  const withEditor = async (
    data: BlokConfig['data'],
    act: (editor: TestEditor) => Promise<void> = async () => undefined
  ): Promise<OutputData> => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data,
    }) as unknown as TestEditor;

    try {
      await editor.isReady;
      await act(editor);

      return await editor.save();
    } finally {
      editor.destroy();
      holder.remove();
    }
  };

  const saveOnce = (data: BlokConfig['data']): Promise<OutputData> => withEditor(data);

  const docA = { id: 'A', blocks: [ { id: 'pa', type: 'paragraph', data: { text: 'A' } } ] };

  it('keeps the id of a loaded document with blocks', async () => {
    const saved = await saveOnce({ id: 'doc-1', blocks: [ { id: 'p1', type: 'paragraph', data: { text: 'Hi' } } ] });

    expect(saved.id).toBe('doc-1');
  }, 60_000);

  it('keeps the id of a loaded empty document', async () => {
    const saved = await saveOnce({ id: 'doc-1', blocks: [] });

    expect(saved.id).toBe('doc-1');
  }, 60_000);

  it('adopts the id of a document swapped in with editor.render()', async () => {
    const saved = await withEditor(docA, editor => editor.render({
      id: 'B',
      blocks: [ { id: 'pb', type: 'paragraph', data: { text: 'B' } } ],
    }));

    expect(saved.id).toBe('B');
  }, 60_000);

  it('adopts the id of a document swapped in with blocks.render()', async () => {
    const saved = await withEditor(docA, editor => editor.blocks.render({
      id: 'B',
      blocks: [ { id: 'pb', type: 'paragraph', data: { text: 'B' } } ],
    }));

    expect(saved.id).toBe('B');
  }, 60_000);

  it('mints a fresh id when the swapped-in document has none', async () => {
    const saved = await withEditor(docA, editor => editor.render({
      blocks: [ { id: 'pb', type: 'paragraph', data: { text: 'B' } } ],
    }));

    expect(saved.id).toMatch(NANOID_21);
    expect(saved.id).not.toBe('A');
  }, 60_000);

  it('adopts a new id even when the rendered blocks equal the current ones', async () => {
    const saved = await withEditor(docA, editor => editor.render({ ...docA, id: 'B' }));

    expect(saved.id).toBe('B');
  }, 60_000);

  it('keeps the id when an id-less echo of the current content is rendered', async () => {
    const saved = await withEditor(docA, editor => editor.render({ blocks: docA.blocks }));

    expect(saved.id).toBe('A');
  }, 60_000);
});
