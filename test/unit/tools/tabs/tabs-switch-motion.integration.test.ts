import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

interface Call {
  target: HTMLElement;
  options: KeyframeAnimationOptions;
  animation: Animation;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const doc = (): OutputBlockData[] => [
  { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
  { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'tabs', content: ['p1'] },
  { id: 'p1', type: 'paragraph', data: { text: 'first' }, parent: 't1' },
  { id: 't2', type: 'tab', data: { title: 'Two' }, parent: 'tabs', content: ['p2', 'p3'] },
  { id: 'p2', type: 'paragraph', data: { text: 'second' }, parent: 't2' },
  { id: 'p3', type: 'paragraph', data: { text: 'third' }, parent: 't2' },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let calls: Call[] = [];

const holderOf = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);

  if (element === null) {
    throw new Error(`no holder for ${id}`);
  }

  return element;
};

const boot = async (onChange: () => void): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, tabs: TabsTool, tab: TabTool },
    data: { blocks: doc() },
    onChange,
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const openTab = async (name: string): Promise<void> => {
  const pill = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(element => element.textContent === name);

  pill?.click();
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  Object.assign(HTMLElement.prototype, {
    animate(this: HTMLElement, _frames: Keyframe[], options: KeyframeAnimationOptions): Animation {
      const animation = { cancel: vi.fn(), finish: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;

      calls.push({ target: this, options, animation });

      return animation;
    },
    getAnimations: (): Animation[] => [],
  });
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  delete (HTMLElement.prototype as Partial<{ animate: unknown }>).animate;
  delete (HTMLElement.prototype as Partial<{ getAnimations: unknown }>).getAnimations;
  vi.restoreAllMocks();
});

describe('tabs block: switching', () => {
  it('swaps the content at once: nothing in the panels animates', async () => {
    await boot(vi.fn());
    calls = [];

    await openTab('Two');
    await openTab('One');

    const panels = document.querySelector<HTMLElement>('[data-blok-tabs-panels]');

    expect(holderOf('t1').classList.contains('hidden')).toBe(false);
    expect(calls.filter(call => panels?.contains(call.target))).toEqual([]);
  });

  it('records no edit while switching', async () => {
    const onChange = vi.fn();

    await boot(onChange);
    onChange.mockClear();

    await openTab('Two');
    await openTab('One');
    await new Promise(resolve => {
      setTimeout(resolve, 400);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
