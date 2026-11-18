/**
 * A selected block whose tool asks before it goes (a database) is never
 * replaced by a key or a paste. Notion ignores a typed letter on a selected
 * database and pastes after it, keeping it (notion-motion.md Round 67 §2).
 * Other selected blocks keep Blok's replace-on-type and replace-on-paste.
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
    blockManager: { blocks: Block[]; currentBlock: Block | undefined };
    blockSelection: {
      selectBlock: (block: Block) => void;
      clearSelection: () => void;
      enableNavigationMode: () => void;
      navigationModeEnabled: boolean;
    };
    blockEvents: { keydown: (event: KeyboardEvent) => void };
  };
}

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
        { id: 'ask', type: 'asking', data: {}, content: ['child'] },
        { id: 'child', type: 'paragraph', parent: 'ask', data: { text: 'row' } },
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
/** Rich text saves as segments; joins them back into a string. */
const textOf = (text: unknown): string => Array.isArray(text)
  ? text.map(segment => (segment as { text?: string }).text ?? '').join('')
  : String(text);
const texts = async (instance: Runtime): Promise<string[]> => (await instance.save()).blocks
  .map(saved => {
    const { text } = saved.data as { text?: unknown };

    return text === undefined ? `<${saved.type}>` : textOf(text);
  });

/** A keydown on the block's own holder, as when its field has focus. */
const pressOn = (instance: Runtime, id: string, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  Object.defineProperty(event, 'target', { value: block(instance, id).holder });
  instance.module.blockEvents.keydown(event);

  return event;
};

const select = (instance: Runtime, ...selected: string[]): void => {
  instance.module.blockSelection.clearSelection();
  selected.forEach(id => instance.module.blockSelection.selectBlock(block(instance, id)));
};

const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

const paste = (text: string, target: EventTarget = document.body): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], files: [], items: [], getData: (type: string): string => (type === 'text/plain' ? text : '') },
  });
  target.dispatchEvent(event);

  return event;
};

describe('input over a selected block whose tool asks before it goes', () => {
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

  describe('a typed letter', () => {
    it('does nothing: the block stays, selected, and no text is typed', async () => {
      const instance = await boot();

      select(instance, 'ask');
      const event = press('k');

      await settle();

      expect(ids(instance)).toContain('ask');
      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
      expect(selectedIds(instance)).toEqual(['ask']);
      expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing on the block\'s own key path either', async () => {
      const instance = await boot();

      select(instance, 'ask');
      const event = pressOn(instance, 'ask', 'k');

      await settle();

      expect(ids(instance)).toContain('ask');
      expect(selectedIds(instance)).toEqual(['ask']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing in navigation mode, which stays on', async () => {
      const instance = await boot();

      instance.module.blockSelection.clearSelection();
      instance.module.blockManager.currentBlock = block(instance, 'ask');
      instance.module.blockSelection.enableNavigationMode();
      const event = press('k');

      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
      expect(instance.module.blockSelection.navigationModeEnabled).toBe(true);
      expect(selectedIds(instance)).toContain('ask');
      expect(event.defaultPrevented).toBe(true);
    });

    it('a dead key does nothing in navigation mode either, so the composed letter has nowhere to go', async () => {
      const instance = await boot();

      instance.module.blockSelection.clearSelection();
      instance.module.blockManager.currentBlock = block(instance, 'ask');
      instance.module.blockSelection.enableNavigationMode();
      const event = press('Dead');

      await settle();

      expect(instance.module.blockSelection.navigationModeEnabled).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing to a selection that also holds an ordinary block', async () => {
      const instance = await boot();

      select(instance, 'p1', 'ask');
      pressOn(instance, 'p1', 'k');
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
    });

    it('still replaces an ordinary selected block', async () => {
      const instance = await boot();

      select(instance, 'p2');
      pressOn(instance, 'p2', 'k');
      await settle();

      expect(ids(instance)).not.toContain('p2');
      expect(selectedIds(instance)).toEqual([]);
    });
  });

  describe('a paste', () => {
    it('lands after the block and its children, and the block stays', async () => {
      const instance = await boot();

      select(instance, 'ask');
      const event = paste('pasted');

      await settle();

      expect(ids(instance)).toContain('ask');
      expect(event.defaultPrevented).toBe(true);
      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'pasted', 'two']);

      const pasted = instance.module.blockManager.blocks.find(candidate => candidate.id !== 'p2' && candidate.name === 'paragraph' && candidate.holder.textContent === 'pasted');

      expect(pasted?.parentId).toBeNull();
      expect(selectedIds(instance)).toEqual(pasted === undefined ? ['missing'] : [pasted.id]);
    });

    it('is one undo step that leaves the block as it was', async () => {
      const instance = await boot();

      select(instance, 'ask');
      paste('pasted');
      await settle();
      instance.history.undo();
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
    });

    it('keeps a selection that also holds an ordinary block', async () => {
      const instance = await boot();

      select(instance, 'p1', 'ask');
      paste('pasted');
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'pasted', 'two']);
    });

    it('still replaces an ordinary selected block', async () => {
      const instance = await boot();

      select(instance, 'p2');
      paste('pasted');
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'pasted']);
    });
  });

  describe('while its delete question is open', () => {
    const asking = async (): Promise<Runtime> => {
      const instance = await boot();

      select(instance, 'ask');
      press('Backspace');
      await settle();
      expect(questions).toHaveLength(1);

      return instance;
    };

    it('a paste does nothing', async () => {
      const instance = await asking();

      paste('pasted');
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
      expect(selectedIds(instance)).toEqual(['ask']);
    });

    it('a cut does nothing', async () => {
      const instance = await asking();
      const cut = new Event('cut', { bubbles: true, cancelable: true });

      Object.defineProperty(cut, 'clipboardData', { value: { setData: (): void => undefined, getData: (): string => '' } });
      document.dispatchEvent(cut);
      await settle();

      expect(await texts(instance)).toEqual(['one', '<asking>', 'row', 'two']);
      expect(selectedIds(instance)).toEqual(['ask']);
    });
  });
});
