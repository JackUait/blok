/**
 * Every way block data enters the editor reads segment arrays. They become
 * the HTML tools store BEFORE any sanitize pass, so typed `<` and `&` are
 * escaped once, not parsed as markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { BlockToolAdapter } from '../../../../src/components/tools/block';
import { richTextInputToHtml } from '../../../../src/components/utils/rich-text-input';
import { richTextOutputForHost } from '../../../../src/components/utils/rich-text-output';
import type { API, BlockToolConstructable, OutputBlockData, OutputData } from '../../../../types';
import type { BlockMigrations } from '../../../../src/components/migration/block-migrations';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  module: { yjsManager: { toJSON: () => OutputBlockData[] } };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[], migrations?: BlockMigrations): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table },
    ...(migrations !== undefined ? { migrations } : {}),
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const lastBlock = async (instance: TestEditor): Promise<OutputBlockData> => {
  const saved = await instance.save();

  return saved.blocks[saved.blocks.length - 1];
};

const warningsAbout = (spy: { mock: { calls: unknown[][] } }, key: string): number =>
  spy.mock.calls.filter(call => call.some(arg => typeof arg === 'string' && arg.includes(key))).length;

describe('rich text segments on input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('renders segments given to the constructor', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: [{ text: 'a < b', marks: { bold: true } }] } }]);
    const saved = await instance.save();

    expect(saved.blocks[0].data.text).toEqual([{ text: 'a < b', marks: { bold: true } }]);
  }, 60_000);

  it('renders segments given to blocks.render', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: 'old' } }]);

    await instance.blocks.render({ blocks: [{ type: 'paragraph', data: { text: [{ text: 'a < b', marks: { bold: true } }] } }] });
    const saved = await instance.save();

    expect(saved.blocks[0].data.text).toEqual([{ text: 'a < b', marks: { bold: true } }]);
  }, 60_000);

  it('inserts segments through blocks.insert without escaping typed text twice', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', { text: [{ text: 'a < b && c' }] }, {}, 1);

    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'a < b && c' }]);
  }, 60_000);

  it('keeps typed quotes byte-equal through blocks.insert', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', { text: [{ text: 'say "hi" & \'bye\'' }] }, {}, 1);

    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'say "hi" & \'bye\'' }]);
  }, 60_000);

  it('inserts segments through blocks.insertMany into the document as HTML', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insertMany([{ id: 'm1', type: 'paragraph', data: { text: [{ text: 'a < b' }] } }]);

    expect(instance.module.yjsManager.toJSON().find(block => block.id === 'm1')?.data.text).toBe('a &lt; b');
    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'a < b' }]);
  }, 60_000);

  it('inserts segments under a parent into the document as HTML', async () => {
    const instance = await boot([{ id: 'p', type: 'paragraph', data: { text: 'parent' } }]);

    const child = instance.blocks.insertAt('paragraph', { text: [{ text: 'a < b', marks: { bold: true } }] }, { parentId: 'p' });

    expect(instance.module.yjsManager.toJSON().find(block => block.id === child.id)?.data.text).toBe('<strong>a &lt; b</strong>');
    expect((await instance.save()).blocks.find(block => block.id === child.id)?.data.text).toEqual([{ text: 'a < b', marks: { bold: true } }]);
  }, 60_000);

  it('converts segments for the default tool when insertInsideParent names none', async () => {
    const instance = await boot([{ id: 'p', type: 'paragraph', data: { text: 'parent' } }]);

    const child = instance.blocks.insertInsideParent('p', 1, { text: [{ text: 'x & y' }] });

    expect(instance.module.yjsManager.toJSON().find(block => block.id === child.id)?.data.text).toBe('x &amp; y');
  }, 60_000);

  it('updates a block with segments', async () => {
    const instance = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'old' } }]);

    await instance.blocks.update('p1', { text: [{ text: 'x', marks: { italic: true } }] });

    expect(instance.module.yjsManager.toJSON()[0].data.text).toBe('<i>x</i>');
    expect((await instance.save()).blocks[0].data.text).toEqual([{ text: 'x', marks: { italic: true } }]);
  }, 60_000);

  it('accepts segments in splitBlock', async () => {
    const instance = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'a < bc' } }]);

    const tail = instance.blocks.splitBlock('p1', { text: [{ text: 'a < b' }] }, 'paragraph', { text: [{ text: 'c', marks: { bold: true } }] }, 1);
    const stored = instance.module.yjsManager.toJSON();

    // The current half: jsdom has no contenteditable, so splitBlock cannot
    // write it into the DOM here; the document is where it lands.
    expect(stored.find(block => block.id === 'p1')?.data.text).toBe('a &lt; b');
    expect(stored.find(block => block.id === tail.id)?.data.text).toBe('<strong>c</strong>');
    expect((await instance.save()).blocks[1].data.text).toEqual([{ text: 'c', marks: { bold: true } }]);
  }, 60_000);

  it('accepts segments in a convert override', async () => {
    const instance = await boot([{ id: 'p1', type: 'paragraph', data: { text: 'old' } }]);

    await instance.blocks.convert('p1', 'paragraph', { text: [{ text: 'a < b' }] });

    // The override is written to the document before the factory runs.
    expect(instance.module.yjsManager.toJSON()[0].data.text).toBe('a &lt; b');
    expect((await instance.save()).blocks[0].data.text).toEqual([{ text: 'a < b' }]);
  }, 60_000);

  it('hands a tool\'s upgradeData HTML, not segments', async () => {
    const seen: unknown[] = [];

    class UpgradingParagraph extends Paragraph {
      public static upgradeData(data: Record<string, unknown>): Record<string, unknown> {
        seen.push(data.text);

        return data;
      }
    }

    const instance = new Blok({
      holder,
      tools: { paragraph: UpgradingParagraph },
      data: { blocks: [{ type: 'paragraph', data: { text: 'first' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    seen.length = 0;

    instance.blocks.insert('paragraph', { text: [{ text: 'a < b' }] }, {}, 1);

    expect(seen).toEqual(['a &lt; b']);
  }, 60_000);

  it('drops an unknown mark key and warns once per key', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', {
      text: [{ text: 'a', marks: { 'acme:once': true } }, { text: 'b', marks: { 'acme:once': true } }],
    }, {}, 1);
    instance.blocks.insert('paragraph', { text: [{ text: 'c', marks: { 'acme:once': true } }] }, {}, 2);

    const saved = await instance.save();

    expect(saved.blocks[1].data.text).toEqual([{ text: 'ab' }]);
    expect(warningsAbout(warnSpy, 'acme:once')).toBe(1);
  }, 60_000);

  it('warns once for a tag mark whose name the writer drops', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', {
      text: [{ text: 'a', marks: { 'tag:x y': {} } }, { text: 'b', marks: { 'tag:x y': {} } }],
    }, {}, 1);

    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'ab' }]);
    expect(warningsAbout(warnSpy, 'tag:x y')).toBe(1);
  }, 60_000);

  it('saves runs whose marks key is undefined as their text', async () => {
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', { text: [{ text: 'a', marks: undefined }, { text: 'b', marks: { bold: true } }] }, {}, 1);

    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'a' }, { text: 'b', marks: { bold: true } }]);
  }, 60_000);

  it('reads a malformed segment array leniently and warns once per field', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', { text: [{ text: 'a', id: 1 }, { text: 'b', marks: { 'acme:lenient': true } }, 7] }, {}, 1);
    instance.blocks.insert('paragraph', { text: [{ text: 'c', id: 2 }] }, {}, 2);

    const saved = await instance.save();

    expect(saved.blocks.slice(1).map(block => block.data.text)).toEqual([[{ text: 'ab' }], [{ text: 'c' }]]);
    expect(warningsAbout(warnSpy, 'paragraph.text')).toBe(1);
    expect(warningsAbout(warnSpy, 'acme:lenient')).toBe(1);
  }, 60_000);

  it('keeps a tag mark only when an inline tool allows the tag', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = await boot([{ type: 'paragraph', data: { text: 'first' } }]);

    instance.blocks.insert('paragraph', { text: [{ text: 'x', marks: { 'tag:abbr': { title: 't' } } }] }, {}, 1);

    expect((await lastBlock(instance)).data.text).toEqual([{ text: 'x' }]);
    expect(warningsAbout(warnSpy, 'tag:abbr')).toBe(0);
  }, 60_000);

  it('runs host migrations first, so a migration may still produce segments', async () => {
    const instance = await boot(
      [{ type: 'paragraph', data: { text: 'old' } }],
      { paragraph: data => ({ ...data, text: [{ text: 'migrated' }] }) }
    );
    const saved = await instance.save();

    expect(saved.blocks[0].data.text).toEqual([{ text: 'migrated' }]);
  }, 60_000);

  it('leaves an empty table content array alone on render', async () => {
    const instance = await boot([{ id: 't1', type: 'table', data: { withHeadings: false, content: [] } }]);
    const saved = await instance.save();
    const table = saved.blocks.find(block => block.id === 't1');

    expect(Array.isArray(table?.data.content)).toBe(true);
  }, 60_000);
});

describe('a child demoted to another tool', () => {
  /** Only paragraphs may be its children. */
  class ParagraphsOnly {
    public static get childTools(): { allow: string[] } {
      return { allow: ['paragraph'] };
    }

    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(): Record<string, never> {
      return {};
    }
  }

  /** Declares no rich fields, so its own data is never read as segments. */
  class Plain {
    private readonly data: Record<string, unknown>;

    constructor({ data }: { data: Record<string, unknown> }) {
      this.data = data;
    }

    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(): Record<string, unknown> {
      return this.data;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('converts its data with the tool it was demoted to', async () => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        plain: Plain as unknown as BlockToolConstructable,
        only: ParagraphsOnly as unknown as BlockToolConstructable,
      },
      data: { blocks: [{ id: 'c', type: 'only', data: {} }, { id: 'p', type: 'paragraph', data: { text: 'x' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    const text = [{ text: 'a < b', marks: { bold: true } }];
    const demoted = instance.blocks.insertInsideParent('c', 1, { text }, 'plain');
    const direct = instance.blocks.insert('paragraph', { text });
    const yjsData = (id: string): unknown => instance.module.yjsManager.toJSON().find(block => block.id === id)?.data;

    expect(demoted.name).toBe('paragraph');
    expect(yjsData(demoted.id)).toEqual(yjsData(direct.id));
  }, 60_000);
});

describe('a third-party tool that declares no richTextFields', () => {
  /** Tag-map and `{}` rules, but neither field is rich text. */
  class ItemsTool {
    public static get sanitize(): Record<string, unknown> {
      return { items: { br: true }, style: {} };
    }

    private readonly data: Record<string, unknown>;

    constructor({ data }: { data: Record<string, unknown> }) {
      this.data = data;
    }

    public render(): HTMLElement {
      return document.createElement('div');
    }

    public save(): Record<string, unknown> {
      return this.data;
    }
  }

  const bootItems = async (data: Record<string, unknown>): Promise<OutputBlockData> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, items: ItemsTool as unknown as BlockToolConstructable },
      data: { blocks: [{ id: 'i1', type: 'items', data }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;

    const saved = await instance.save();

    return saved.blocks[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('saves an empty items array unchanged', async () => {
    expect((await bootItems({ items: [], style: 'ordered' })).data).toEqual({ items: [], style: 'ordered' });
  }, 60_000);

  it('saves an items array of text records unchanged', async () => {
    expect((await bootItems({ items: [{ text: 'x' }], style: 'ordered' })).data).toEqual({ items: [{ text: 'x' }], style: 'ordered' });
  }, 60_000);
});

describe('a tool adapter that has no richTextFields', () => {
  // Test doubles and older adapters may lack the getter; conversion must not throw.
  const bare = { name: 'paragraph' } as unknown as BlockToolAdapter;
  const data = { text: [{ text: 'a' }] };

  it('passes input data through unchanged', () => {
    expect(richTextInputToHtml(bare, data, () => undefined)).toEqual(data);
  });

  it('passes output data through unchanged', () => {
    expect(richTextOutputForHost(bare, data, () => undefined, { collaborating: false })).toEqual(data);
  });
});

describe('richTextInputToHtml on the table tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const tableAdapter = (): BlockToolAdapter => new BlockToolAdapter({
    name: 'table',
    constructable: Table as unknown as BlockToolConstructable,
    config: {},
    api: {} as API,
    isDefault: false,
    isInternal: false,
  });

  it('declares no rich text fields, so its 2D content is never read as segments', () => {
    expect(tableAdapter().richTextFields).toEqual([]);
  });

  it('leaves content [] and real content unchanged', () => {
    const adapter = tableAdapter();
    const resolve = (): undefined => undefined;

    expect(richTextInputToHtml(adapter, { content: [] }, resolve)).toEqual({ content: [] });
    expect(richTextInputToHtml(adapter, { content: [['a', 'b']] }, resolve)).toEqual({ content: [['a', 'b']] });
  });
});

describe('nested row documents on input', () => {
  const adapter = (name: string, constructable: unknown): BlockToolAdapter => new BlockToolAdapter({
    name,
    constructable: constructable as BlockToolConstructable,
    config: {},
    api: {} as API,
    isDefault: false,
    isInternal: false,
  });
  const paragraph = adapter('paragraph', Paragraph);
  const resolve = (name: string): BlockToolAdapter | undefined => (name === 'paragraph' ? paragraph : undefined);
  const nested = { properties: { notes: { blocks: [{ type: 'paragraph', data: { text: [{ text: 'a < b' }] } }] } } };

  it('reads a database-row property document', () => {
    expect(richTextInputToHtml(adapter('database-row', Table), nested, resolve)).toEqual({
      properties: { notes: { blocks: [{ type: 'paragraph', data: { text: 'a &lt; b' } }] } },
    });
  });

  it('hands back the caller\'s own data object when it is already HTML', () => {
    const data = { text: '<b>a</b>' };

    expect(richTextInputToHtml(paragraph, data, resolve)).toBe(data);
  });

  it('leaves a custom tool\'s nested documents alone', () => {
    expect(richTextInputToHtml(adapter('my-tool', Table), nested, resolve)).toEqual(nested);
  });
});
