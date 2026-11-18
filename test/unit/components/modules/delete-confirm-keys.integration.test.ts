/**
 * A tool's `confirmDelete` asks before every user delete of its block, not only
 * the block menu's: Backspace and Delete on a selected block ask too, and a "no"
 * keeps the selection (notion-motion.md Round 66 §2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    blockSelection: { selectBlock: (block: Block) => void; clearSelection: () => void };
    blockEvents: { keydown: (event: KeyboardEvent) => void };
  };
}

/** The questions asked so far, answered by the test. */
const questions: Array<(answer: boolean) => void> = [];

/** A tool that asks before it goes, as the database does. */
class AskingTool {
  public static get toolbox(): { title: string; icon: string } {
    return { title: 'Asking', icon: '' };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = 'asks';

    return element;
  }

  public save(): Record<string, never> {
    return {};
  }

  public confirmDelete(): Promise<boolean> {
    return new Promise((resolve) => {
      questions.push(resolve);
    });
  }
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

const boot = async (): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, asking: AskingTool },
    data: {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'one' } },
        { id: 'ask', type: 'asking', data: {} },
        { id: 'p2', type: 'paragraph', data: { text: 'two' } },
      ],
    },
  }) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const block = (instance: Runtime, id: string): Block => {
  const found = instance.module.blockManager.blocks.find(candidate => candidate.id === id);

  if (found === undefined) throw new Error(`no block ${id}`);

  return found;
};

const ids = (instance: Runtime): string[] => instance.module.blockManager.blocks.map(candidate => candidate.id);
const selectedIds = (instance: Runtime): string[] => instance.module.blockManager.blocks.filter(candidate => candidate.selected).map(candidate => candidate.id);

const select = (instance: Runtime, ...selected: string[]): void => {
  instance.module.blockSelection.clearSelection();
  selected.forEach(id => instance.module.blockSelection.selectBlock(block(instance, id)));
};

const press = (key: string, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

const answer = async (value: boolean): Promise<void> => {
  const reply = questions.shift();

  if (reply === undefined) throw new Error('nothing was asked');
  reply(value);
  await settle();
};

describe('keys on a selected block whose tool asks before it goes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    questions.length = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  for (const key of ['Backspace', 'Delete']) {
    it(`${key} asks first and deletes nothing before the answer`, async () => {
      const instance = await boot();

      select(instance, 'ask');
      const event = press(key);

      await settle();

      expect(questions).toHaveLength(1);
      expect(event.defaultPrevented).toBe(true);
      expect(ids(instance)).toContain('ask');
    });
  }

  it('a no keeps the block, still selected', async () => {
    const instance = await boot();

    select(instance, 'ask');
    press('Backspace');
    await answer(false);

    expect(ids(instance)).toContain('ask');
    expect(selectedIds(instance)).toEqual(['ask']);
  });

  it('a yes deletes it, and undo brings it back', async () => {
    const instance = await boot();

    select(instance, 'ask');
    press('Backspace');
    await answer(true);

    expect(ids(instance)).not.toContain('ask');

    instance.history.undo();
    await settle();

    expect(ids(instance)).toContain('ask');
  });

  // notion-motion.md Round 66 §2: with the database and a row of another selected, one dialog; nothing goes before the answer.
  it('asks once for a selection that holds it, and the answer covers the whole selection', async () => {
    const instance = await boot();

    select(instance, 'p1', 'ask');
    press('Delete');
    await settle();

    expect(questions).toHaveLength(1);
    expect(ids(instance)).toEqual(expect.arrayContaining(['p1', 'ask']));

    await answer(false);
    expect(ids(instance)).toEqual(expect.arrayContaining(['p1', 'ask']));
    expect(selectedIds(instance)).toEqual(['p1', 'ask']);

    press('Delete');
    await answer(true);
    expect(ids(instance)).not.toContain('p1');
    expect(ids(instance)).not.toContain('ask');
    expect(ids(instance)).toContain('p2');
  });

  it('a block that does not ask still goes at once', async () => {
    const instance = await boot();

    select(instance, 'p1');
    press('Backspace');
    await settle();

    expect(questions).toHaveLength(0);
    expect(ids(instance)).not.toContain('p1');
  });

  it('keys wait while the question is open: no second question, and Enter still reaches the dialog', async () => {
    const instance = await boot();

    select(instance, 'ask');
    press('Backspace');
    await settle();
    press('Backspace');
    const enter = press('Enter');

    await settle();

    expect(questions).toHaveLength(1);
    expect(enter.defaultPrevented).toBe(false);
    expect(selectedIds(instance)).toEqual(['ask']);
  });

  it('the selected block\'s own key path asks too', async () => {
    const instance = await boot();
    const asking = block(instance, 'ask');

    select(instance, 'ask');
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });

    Object.defineProperty(event, 'target', { value: asking.holder });
    instance.module.blockEvents.keydown(event);
    await settle();

    expect(questions).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
    expect(ids(instance)).toContain('ask');
  });
});
