import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Page, Paragraph } from '../../../src/tools';
import type { Agent, OutputData } from '../../../types';
import type { PageConfig } from '../../../types/tools/page';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: Agent; save: () => Promise<OutputData> }

const editors: TestEditor[] = [];

const boot = async (page: PageConfig & Record<string, unknown>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    tools: { paragraph: { class: Paragraph }, page: { class: Page, config: page } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('an agent inserts a page in the editor', () => {
  it('asks the host to create it, with only a create hook, and the block points at the host id', async () => {
    const create = vi.fn(() => ({ pageId: 'host-page' }));
    const editor = await boot({ create });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'page', position: 'end' } }] });

    turn.end();
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await editor.save()).blocks.filter((block) => block.type === 'page').map((block) => block.data.pageId)).toEqual(['host-page']);
  });

  it('inserts nothing when the host refuses to create the page', async () => {
    const editor = await boot({ create: () => Promise.reject(new Error('no room')) });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'block.insert', args: { type: 'page', position: 'end' } }] });

    turn.end();
    expect(result.ok).toBe(false);
    expect((await editor.save()).blocks.some((block) => block.type === 'page')).toBe(false);
  });
});
