import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { createBlocksApiForEditor } from '../../../../../src/components/utils/blocks-api';
import { CodeTool } from '../../../../../src/tools/code';
import { ListItem } from '../../../../../src/tools/list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, Blok as BlokType, BlockToolConstructable, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const editors: TestEditor[] = [];
const MD = '- Item\n\n  ```\n  code\n  ```\n\n  - Child';

const boot = async (blocks: OutputBlockData[] = []): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      list: ListItem as unknown as BlockToolConstructable,
      code: CodeTool as unknown as BlockToolConstructable,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

/** Each saved block as its text, its parent's text and its children's texts. */
const tree = async (editor: TestEditor): Promise<Array<{ text: unknown; parent: unknown; content: unknown }>> => {
  const { blocks } = await editor.save();
  const label = (id: unknown): unknown => {
    const block = blocks.find((b) => b.id === id);

    if (block === undefined) {
      return id;
    }

    const text: unknown = block.data.code ?? block.data.text;

    return Array.isArray(text) ? text.map((segment: { text: string }) => segment.text).join('') : text;
  };

  return blocks.map((b) => ({ text: label(b.id), parent: label(b.parent), content: b.content?.map(label) }));
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Markdown with blocks inside a list item, through the editor APIs', () => {
  it('blocks.importMarkdown keeps the code block and the nested item under the item', async () => {
    const editor = await boot();

    await editor.blocks.importMarkdown(MD);

    expect(await tree(editor)).toEqual([
      { text: 'Item', parent: undefined, content: ['code', 'Child'] },
      { text: 'code', parent: 'Item', content: undefined },
      { text: 'Child', parent: 'Item', content: undefined },
    ]);
  }, 30_000);

  it('useBlocks insertMarkdown under a parent keeps the item tree inside it', async () => {
    const editor = await boot([{ id: 'host', type: 'list', data: { text: 'Host', style: 'unordered' } }]);
    const api = createBlocksApiForEditor(editor as unknown as BlokType);

    await api.insertMarkdown(MD, { parentId: 'host' });

    expect(await tree(editor)).toEqual([
      { text: 'Host', parent: undefined, content: ['Item'] },
      { text: 'Item', parent: 'Host', content: ['code', 'Child'] },
      { text: 'code', parent: 'Item', content: undefined },
      { text: 'Child', parent: 'Item', content: undefined },
    ]);
  }, 30_000);
});
