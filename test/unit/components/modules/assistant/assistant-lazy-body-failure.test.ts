import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Agent, AgentModel } from '../../../../../types/api';

// A chunk that cannot load (a 404, a deploy that removed it).
vi.mock('../../../../../src/components/modules/assistant/body', () => {
  throw new Error('chunk failed to load');
});

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
}

const model: AgentModel = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] });

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

describe('Assistant body that fails to load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });

  afterEach(() => {
    process.off('unhandledRejection', onRejection);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('boots the editor with Ask AI off, warns once, and leaves no unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
      agent: { assistant: { model } },
    }) as unknown as TestEditor;

    await editor.isReady;
    // Lets a stray rejection reach the process before the check.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mac = getUserOS().mac;
    const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');
    const press = new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });

    input?.dispatchEvent(press);
    editor.agent.openAssistant();

    expect(rejections).toEqual([]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('Module Assistant was skipped'))).toHaveLength(1);
    expect(press.defaultPrevented).toBe(false);
    expect(document.querySelector('[data-blok-testid="assistant-bar"]')).toBeNull();

    editor.destroy();
  });
});
