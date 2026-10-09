import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { createRevisionCounter, editorSnapshot } from '../../../../../src/components/modules/agent/editor-snapshot';
import { Tools } from '../../../../../src/components/modules/tools';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { OutputData } from '../../../../../types/data-formats/output-data';
import type { BlockToolConstructorOptions } from '../../../../../types/tools/block-tool';
import type { RichText } from '../../../../../types/rich-text';

type SnapshotModules = Pick<BlokModules, 'YjsManager' | 'Tools'>;

class QuestionTool {
  public static get richTextFields(): string[] {
    return ['question'];
  }

  public static get sanitize(): SanitizerConfig {
    return { question: { b: true }, text: 'plaintext', labels: 'plaintext' };
  }

  private readonly data: Record<string, unknown>;

  constructor({ data }: BlockToolConstructorOptions<Record<string, unknown>, Record<string, unknown>>) {
    this.data = data;
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = 'Question';

    return element;
  }

  public save(): Record<string, unknown> {
    return this.data;
  }
}

const snapshotModules = (instance: Blok): SnapshotModules => {
  if ('module' in instance && typeof instance.module === 'object' && instance.module !== null
    && 'yjsManager' in instance.module && instance.module.yjsManager instanceof YjsManager
    && 'tools' in instance.module && instance.module.tools instanceof Tools) {
    return { YjsManager: instance.module.yjsManager, Tools: instance.module.tools };
  }

  throw new Error('The ready editor must expose its real Yjs and tools modules.');
};

let holder: HTMLDivElement;
let editor: Blok | undefined;
let counter: ReturnType<typeof createRevisionCounter> | undefined;

const boot = async (data: OutputData = {
  blocks: [{ id: 'a', type: 'paragraph', data: { text: 'original' } }],
}): Promise<SnapshotModules> => {
  editor = new Blok({ holder, tools: { paragraph: Paragraph, question: QuestionTool, toggle: ToggleItem }, data });
  await editor.isReady;
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  return snapshotModules(editor);
};

describe('editor snapshot and revision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    counter?.dispose();
    counter = undefined;
    editor?.destroy();
    editor = undefined;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    holder.remove();
    vi.restoreAllMocks();
  });

  it('reads HTML rich text as canonical segments', async () => {
    const modules = await boot({
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'a <b>b</b><br>c' } }],
    });

    expect(editorSnapshot(modules).get('a')?.data.text).toEqual([
      { text: 'a ' },
      { text: 'b', marks: { bold: true } },
      { text: '\nc' },
    ]);
  });

  it('preserves segment input and its marks without converting it to HTML', async () => {
    const text: RichText = [
      { text: 'plain ' },
      { text: 'bold', marks: { bold: true } },
      { text: '\nitalic', marks: { italic: true } },
    ];
    const modules = await boot({ blocks: [
      { id: 't', type: 'toggle', data: { text: 'Parent' }, content: ['b', 'a'] },
      { id: 'a', type: 'paragraph', data: { text }, parent: 't' },
      { id: 'b', type: 'paragraph', data: { text: 'First child' }, parent: 't' },
    ] });

    expect(editorSnapshot(modules).get('a')?.data.text).toEqual(text);

    const output = editorSnapshot(modules).toOutput();

    expect(output.blocks.map(block => block.id)).toEqual(['t', 'b', 'a']);
    expect(output.blocks.find(block => block.id === 't')?.content).toEqual(['b', 'a']);
    expect(output.blocks.find(block => block.id === 'a')?.parent).toBe('t');
    expect(output.blocks.find(block => block.id === 'b')?.parent).toBe('t');
  });

  it('converts only declared custom rich fields and leaves plain metadata intact', async () => {
    const modules = await boot({
      blocks: [{ id: 'q', type: 'question', data: {
        question: 'Ask <b>bold</b>',
        text: 'Metadata <b>not rich</b>',
        labels: ['<i>tag</i>'],
        score: 3,
      } }],
    });
    const data = editorSnapshot(modules).get('q')?.data;

    expect(data?.question).toEqual([{ text: 'Ask ' }, { text: 'bold', marks: { bold: true } }]);
    expect(data?.text).toBe('Metadata <b>not rich</b>');
    expect(data?.labels).toEqual(['<i>tag</i>']);
    expect(data?.score).toBe(3);
  });

  it('includes the current page title and icon', async () => {
    const modules = await boot();

    modules.YjsManager.setPageField('title', 'Current title', { record: false });
    modules.YjsManager.setPageField('icon', { type: 'emoji', value: '📚' }, { record: false });

    const output = editorSnapshot(modules).toOutput();

    expect(output.title).toBe('Current title');
    expect(output.icon).toEqual({ type: 'emoji', value: '📚' });
  });

  it('starts at e0 and clean snapshot reads do not advance it', async () => {
    const modules = await boot();

    counter = createRevisionCounter(modules);
    expect(counter.value()).toBe('e0');

    editorSnapshot(modules);
    expect(counter.value()).toBe('e0');

    editorSnapshot(modules);
    expect(counter.value()).toBe('e0');
  });

  it('advances on page and block document updates', async () => {
    const modules = await boot();

    counter = createRevisionCounter(modules);
    modules.YjsManager.setPageField('title', 'Changed title', { record: false });
    expect(counter.value()).toBe('e1');

    modules.YjsManager.updateBlockData('a', 'text', 'changed block');
    expect(counter.value()).toBe('e2');

    const snapshot = editorSnapshot(modules);

    expect(snapshot.title).toBe('Changed title');
    expect(snapshot.get('a')?.data.text).toEqual([{ text: 'changed block' }]);
  });

  it('stops advancing after disposal and permits repeated disposal', async () => {
    const modules = await boot();

    counter = createRevisionCounter(modules);
    modules.YjsManager.setPageField('title', 'Before disposal', { record: false });
    expect(counter.value()).toBe('e1');

    counter.dispose();
    modules.YjsManager.setPageField('title', 'After disposal', { record: false });
    expect(counter.value()).toBe('e1');
    expect(modules.YjsManager.getPageFields().title).toBe('After disposal');

    const disposed = counter;

    expect(() => disposed.dispose()).not.toThrow();
    modules.YjsManager.updateBlockData('a', 'text', 'after repeated disposal');
    expect(disposed.value()).toBe('e1');
    expect(editorSnapshot(modules).get('a')?.data.text).toEqual([{ text: 'after repeated disposal' }]);
  });
});
