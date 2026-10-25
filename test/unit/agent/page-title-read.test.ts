// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { describePage } from '../../../src/shared/tool-descriptions/page';
import { describePageLink } from '../../../src/shared/tool-descriptions/page-link';
import { Page, PageLink, Paragraph } from '../../../src/tools';
import { openJsonSession } from './harness';

import type { Agent, OutputData } from '../../../types';
import type { PageInfo } from '../../../types/tools/page';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent }

const editors: TestEditor[] = [];

const PAGES: Record<string, PageInfo | null> = {
  roadmap: { title: 'Roadmap' },
  secret: { title: 'Payroll', access: 'none' },
  gone: null,
};

const resolve = (pageId: string): Promise<PageInfo | null> => Promise.resolve(PAGES[pageId] ?? null);

const DOC: OutputData = {
  blocks: [
    { id: 'link', type: 'page-link', data: { pageId: 'roadmap' } },
    { id: 'sub', type: 'page', data: { pageId: 'roadmap' } },
    { id: 'hidden', type: 'page-link', data: { pageId: 'secret' } },
    { id: 'missing', type: 'page-link', data: { pageId: 'gone' } },
  ],
};

const boot = async (data: OutputData): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    data,
    tools: {
      paragraph: { class: Paragraph },
      page: { class: Page, config: { resolve } },
      'page-link': { class: PageLink, config: { resolve } },
    },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the editor agent reads the page titles its page blocks show', () => {
  it('gives page and page-link blocks the title the user sees, and none it does not show', async () => {
    const editor = await boot(DOC);

    await vi.waitFor(() => expect(document.body.textContent).toContain('Roadmap'));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    try {
      const blocks = Object.fromEntries((await turn.read()).blocks.map(block => [block.id, block]));

      expect(blocks.link?.pageTitle).toBe('Roadmap');
      expect(blocks.sub?.pageTitle).toBe('Roadmap');
      expect(blocks.hidden).not.toHaveProperty('pageTitle');
      expect(blocks.missing).not.toHaveProperty('pageTitle');
    } finally {
      turn.end();
    }
  });
});

describe('what the model is told about page titles is true', () => {
  const CLAIM = 'In the editor a read gives pageTitle, the title the block shows; other runtimes leave it out.';

  it('tells both page tools, and a headless read leaves pageTitle out', async () => {
    expect(describePage().guidance).toContain(CLAIM);
    expect(describePageLink().guidance).toContain(CLAIM);

    const session = openJsonSession(DOC);

    try {
      const blocks = (await session.read()).blocks;

      expect(blocks.length).toBe(4);
      blocks.forEach(block => expect(block).not.toHaveProperty('pageTitle'));
    } finally {
      await session.close();
    }
  });
});
