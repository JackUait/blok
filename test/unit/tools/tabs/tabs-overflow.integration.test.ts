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

const PILL = 100;
const ADD = 28;

/** jsdom lays nothing out: pills, buttons and the strip get fixed widths. */
const layout = { strip: 800 };
const observers: ResizeObserverCallback[] = [];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const names = ['One', 'Two', 'Three', 'Four', 'Five'];

const doc = (): OutputBlockData[] => [
  { id: 'tabs', type: 'tabs', data: {}, content: names.map((_, i) => `t${i + 1}`) },
  ...names.flatMap((name, i): OutputBlockData[] => [
    { id: `t${i + 1}`, type: 'tab', data: { title: name }, parent: 'tabs', content: [`p${i + 1}`] },
    { id: `p${i + 1}`, type: 'paragraph', data: { text: `${name} body` }, parent: `t${i + 1}` },
  ]),
];

const boot = async (): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, tabs: TabsTool, tab: TabTool },
    data: { blocks: doc() },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const resize = async (width: number): Promise<void> => {
  layout.strip = width;
  observers.forEach(callback => callback([], {} as ResizeObserver));
  await settle();
};

const pills = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const shown = (): string[] => pills().filter(pill => !pill.hidden).map(pill => pill.textContent ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  layout.strip = 800;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      observers.push(callback);
    }

    public observe(): void {}

    public unobserve(): void {}

    public disconnect(): void {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hidden || !this.isConnected) {
      return 0;
    }
    if (this.hasAttribute('data-blok-tabs-pill')) {
      return PILL;
    }
    if (this.hasAttribute('data-blok-tabs-add')) {
      return ADD;
    }

    return 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.hasAttribute('data-blok-tabs-strip') ? layout.strip : 0;
  });
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tabs strip overflow', () => {
  // Notion's overflow for a plain tabs block is unmeasured: only the
  // database row page's own tab bar collapses into "N more…".
  it('scrolls a plain tabs block that does not fit, with every tab in the strip and no "more" button', async () => {
    await boot();
    await resize(330);

    expect(shown()).toEqual(names);
    expect(document.querySelector('[data-blok-tabs-more]')).toBeNull();
  });
});
