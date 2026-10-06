import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  readOnly: { toggle: (state?: boolean) => Promise<boolean> };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
};

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const boot = async (blocks: OutputBlockData[]): Promise<{ editor: TestEditor; holder: HTMLElement }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, tabs: TabsTool, tab: TabTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return { editor, holder };
};

const doc = (): OutputBlockData[] => [
  { id: 'tabs', type: 'tabs', data: {}, content: ['a', 'b', 'c'] },
  { id: 'a', type: 'tab', data: { title: 'A' }, parent: 'tabs' },
  { id: 'b', type: 'tab', data: { title: 'B' }, parent: 'tabs' },
  { id: 'c', type: 'tab', data: { title: 'C' }, parent: 'tabs' },
];

const strip = (holder: HTMLElement): string[] =>
  Array.from(holder.querySelectorAll<HTMLElement>('[role="tab"]'))
    .map(pill => `${pill.textContent ?? ''}${pill.getAttribute('aria-selected') === 'true' ? '*' : ''}`);

const pill = (holder: HTMLElement, index: number): HTMLElement => {
  const element = holder.querySelectorAll<HTMLElement>('[role="tab"]')[index];

  if (element === undefined) {
    throw new Error(`no pill ${index}`);
  }

  return element;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  holders.splice(0).forEach(holder => holder.remove());
  vi.restoreAllMocks();
});

describe('tabs block: two editors with the same document', () => {
  it('keeps each editor on its own open tab', async () => {
    const first = await boot(doc());
    const second = await boot(doc());

    pill(second.holder, 2).click();
    await settle();
    await first.editor.blocks.update('a', { title: 'A2' });
    await settle();

    expect(strip(first.holder)).toEqual(['A2*', 'B', 'C']);
    expect(strip(second.holder)).toEqual(['A', 'B', 'C*']);
  });

  it('keeps tab titles when the other editor is destroyed', async () => {
    const first = await boot(doc());
    const second = await boot(doc());

    second.editor.destroy();
    editors.splice(editors.indexOf(second.editor), 1);
    await first.editor.blocks.update('b', { title: 'B2' });
    await settle();

    expect(strip(first.holder)).toEqual(['A*', 'B2', 'C']);
  });
});

describe('tabs block: deleting tabs', () => {
  it('keeps the open tab when another tab before it is deleted', async () => {
    const { editor, holder } = await boot(doc());

    pill(holder, 2).click();
    await settle();
    editor.blocks.getById('tabs')?.call('deleteTab', { id: 'a' });
    await settle();

    expect(strip(holder)).toEqual(['B', 'C*']);
  });

  it('never deletes the last tab, even while a delete is still animating', async () => {
    const animations: Animation[] = [];

    Object.assign(HTMLElement.prototype, {
      animate(): Animation {
        const animation = { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;

        animations.push(animation);

        return animation;
      },
      getAnimations: (): Animation[] => [],
    });

    const { editor } = await boot(doc().slice(0, 3).map(block => block.id === 'tabs' ? { ...block, content: ['a', 'b'] } : block));
    const tabs = editor.blocks.getById('tabs');

    tabs?.call('deleteTab', { id: 'a' });
    tabs?.call('deleteTab', { id: 'b' });
    animations.forEach((animation) => {
      animation.onfinish?.call(animation, {} as AnimationPlaybackEvent);
    });
    await settle();

    const saved = await editor.save();

    expect(saved.blocks.filter(block => block.type === 'tab').map(block => block.id)).toEqual(['b']);

    delete (HTMLElement.prototype as Partial<{ animate: unknown }>).animate;
    delete (HTMLElement.prototype as Partial<{ getAnimations: unknown }>).getAnimations;
  });
});

describe('tabs block: read-only', () => {
  it('refuses rename and delete calls while read-only', async () => {
    const { editor } = await boot(doc());

    await editor.readOnly.toggle(true);

    const tabs = editor.blocks.getById('tabs');

    tabs?.call('renameTab', { id: 'a', title: 'Nope' });
    tabs?.call('deleteTab', { id: 'b' });
    await settle();
    await editor.readOnly.toggle(false);

    const saved = await editor.save();

    expect(saved.blocks.filter(block => block.type === 'tab').map(block => block.data.title)).toEqual(['A', 'B', 'C']);
  });
});
