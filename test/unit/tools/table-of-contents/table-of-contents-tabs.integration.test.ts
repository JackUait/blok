import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { TableOfContentsTool } from '../../../../src/tools/table-of-contents';
import type { OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const wait = async (ms: number): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

const boot = async (blocks: OutputBlockData[]): Promise<void> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      tabs: TabsTool,
      tab: TabTool,
      table_of_contents: TableOfContentsTool,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await wait(50);
};

const tocLinks = (): string[] =>
  Array.from(document.querySelectorAll('[data-blok-tool="table_of_contents"] a')).map(a => a.getAttribute('href') ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  vi.restoreAllMocks();
});

describe('table of contents: headings inside tabs', () => {
  it('lists the top-level heading and leaves out headings in the open tab and in a hidden tab', async () => {
    await boot([
      { id: 'toc', type: 'table_of_contents', data: {} },
      { id: 'top', type: 'header', data: { text: 'Top', level: 2 } },
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Open' }, parent: 'tabs', content: ['inOpen'] },
      { id: 'inOpen', type: 'header', data: { text: 'In open tab', level: 2 }, parent: 't1' },
      { id: 't2', type: 'tab', data: { title: 'Hidden' }, parent: 'tabs', content: ['inHidden'] },
      { id: 'inHidden', type: 'header', data: { text: 'In hidden tab', level: 2 }, parent: 't2' },
    ]);

    const tabHolder = (id: string): Element | null => document.querySelector(`[data-blok-id="${id}"]`);

    expect(tabHolder('t1')?.classList.contains('hidden')).toBe(false);
    expect(tabHolder('t2')?.classList.contains('hidden')).toBe(true);
    expect(tabHolder('t1')?.querySelector('[data-blok-id="inOpen"] [data-blok-tool="header"]')).not.toBeNull();
    expect(tabHolder('t2')?.querySelector('[data-blok-id="inHidden"] [data-blok-tool="header"]')).not.toBeNull();

    // The editor and the static renderer share OUTLINE_CONTAINERS.
    expect(tocLinks()).toEqual(['#top']);
  });
});
