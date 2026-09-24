import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ListItem } from '../../../../src/tools/list';
import { CodeTool } from '../../../../src/tools/code';
import { ToggleItem } from '../../../../src/tools/toggle';
import { ownClone } from '../../../../src/components/utils/own-element';
import type { API, OutputBlockData } from '../../../../types';

/**
 * Tool UI that sits next to the user's text (a list marker, a checkbox, the
 * code block's language button and line numbers) is not content: an empty
 * list item or code block reads empty, and a copy of the block leaves it out.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  blocks: API['blocks'];
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const createEditor = async (blocks: OutputBlockData[], readOnly = false): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    readOnly,
    tools: {
      paragraph: Paragraph,
      list: ListItem,
      code: CodeTool,
      toggle: ToggleItem,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const isEmpty = (instance: TestEditor, id: string): boolean | undefined => instance.blocks.getById(id)?.isEmpty;

// The preview renders after isReady, so read it only once it has landed.
const waitForPreview = async (instance: TestEditor, id: string): Promise<void> => {
  await vi.waitFor(() => {
    const preview = instance.blocks.getById(id)?.holder.querySelector('[data-blok-testid="code-preview"]');

    expect(preview?.childNodes.length).toBeGreaterThan(0);
  }, { timeout: 20_000, interval: 20 });
};

const ownText = (instance: TestEditor, id: string): string | undefined => {
  const block = instance.blocks.getById(id);

  return block === null || block === undefined ? undefined : ownClone(block.holder).textContent?.trim();
};

describe('Block.isEmpty ignores tool chrome', () => {
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

  it('an empty list item reads empty in every style: the marker and the checkbox are not content', async () => {
    const instance = await createEditor([
      { id: 'B', type: 'list', data: { text: '', style: 'unordered' } },
      { id: 'N', type: 'list', data: { text: '', style: 'ordered' } },
      { id: 'C', type: 'list', data: { text: '', style: 'checklist', checked: false } },
      { id: 'D', type: 'list', data: { text: '', style: 'checklist', checked: true } },
    ]);

    expect(isEmpty(instance, 'B')).toBe(true);
    expect(isEmpty(instance, 'N')).toBe(true);
    expect(isEmpty(instance, 'C')).toBe(true);
    expect(isEmpty(instance, 'D')).toBe(true);
  }, 30_000);

  it('a list item with text is not empty', async () => {
    const instance = await createEditor([
      { id: 'B', type: 'list', data: { text: 'x', style: 'unordered' } },
      { id: 'C', type: 'list', data: { text: 'x', style: 'checklist', checked: false } },
    ]);

    expect(isEmpty(instance, 'B')).toBe(false);
    expect(isEmpty(instance, 'C')).toBe(false);
  }, 30_000);

  it('an empty code block reads empty: the language button, controls and line numbers are not content', async () => {
    const instance = await createEditor([
      { id: 'K', type: 'code', data: { code: '', language: 'plain text' } },
      { id: 'M', type: 'code', data: { code: '', language: 'mermaid' } },
    ]);

    expect(isEmpty(instance, 'K')).toBe(true);
    expect(isEmpty(instance, 'M')).toBe(true);
  }, 30_000);

  it('an empty mermaid block still reads empty once its preview has rendered', async () => {
    const instance = await createEditor([
      { id: 'M', type: 'code', data: { code: '', language: 'mermaid' } },
    ]);

    await waitForPreview(instance, 'M');

    expect(isEmpty(instance, 'M')).toBe(true);
    expect(ownText(instance, 'M')).toBe('');
  }, 30_000);

  it('an empty mermaid block still reads empty once its read-only preview has rendered', async () => {
    const instance = await createEditor([
      { id: 'M', type: 'code', data: { code: '', language: 'mermaid' } },
    ], true);

    await waitForPreview(instance, 'M');

    expect(isEmpty(instance, 'M')).toBe(true);
    expect(ownText(instance, 'M')).toBe('');
  }, 30_000);

  it('a code block with code is not empty', async () => {
    const instance = await createEditor([
      { id: 'K', type: 'code', data: { code: 'a', language: 'plain text' } },
    ]);

    expect(isEmpty(instance, 'K')).toBe(false);
  }, 30_000);

  it('the own-content copy of a block leaves the chrome out', async () => {
    const instance = await createEditor([
      { id: 'K', type: 'code', data: { code: 'abc', language: 'plain text' } },
      { id: 'B', type: 'list', data: { text: 'item', style: 'unordered' } },
      { id: 'T', type: 'toggle', data: { text: 'title' } },
    ]);

    expect(ownText(instance, 'K')).toBe('abc');
    expect(ownText(instance, 'B')).toBe('item');
    expect(ownText(instance, 'T')).toBe('title');
  }, 30_000);
});
