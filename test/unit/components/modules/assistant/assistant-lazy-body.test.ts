import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { BlokEventMap } from '../../../../../src/components/events';
import { Assistant } from '../../../../../src/components/modules/assistant';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type * as BodyModule from '../../../../../src/components/modules/assistant/body';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { getUserOS } from '../../../../../src/components/utils/browser';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../../types';
import type { Agent, AgentModel } from '../../../../../types/api';

const loads = vi.hoisted(() => ({ count: 0, prepared: 0 }));

vi.mock('../../../../../src/components/modules/assistant/body', async (importOriginal) => {
  loads.count += 1;
  const original = await importOriginal<typeof BodyModule>();
  const prepare = original.AssistantBody.prototype.prepare;

  original.AssistantBody.prototype.prepare = function (this: InstanceType<typeof original.AssistantBody>): void {
    loads.prepared += 1;
    prepare.call(this);
  };

  return original;
});

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  agent: Agent;
}

const editors: TestEditor[] = [];

const model: AgentModel = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] });

const createEditor = (extra: Partial<BlokConfig> = {}): TestEditor => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hello' } }] },
    ...extra,
  }) as unknown as TestEditor;

  editors.push(editor);

  return editor;
};

const pressModJ = (target: HTMLElement): KeyboardEvent => {
  const mac = getUserOS().mac;
  const event = new KeyboardEvent('keydown', {
    key: 'j', code: 'KeyJ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
  });

  target.dispatchEvent(event);

  return event;
};

const paragraph = (): HTMLElement => {
  const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');

  if (input === null) {
    throw new Error('no paragraph input');
  }

  return input;
};

const bar = (): Element | null => document.querySelector('[data-blok-testid="assistant-bar"]');

describe('Assistant body loads lazily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loads.prepared = 0;
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // First: the module cache lives per file, so a later test would have loaded the body already.
  it('never loads the body without agent.assistant', async () => {
    const editor = createEditor();

    await editor.isReady;
    editor.agent.openAssistant();
    const event = pressModJ(paragraph());

    expect(loads.count).toBe(0);
    expect(loads.prepared).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(bar()).toBeNull();
  });

  it('has the body ready once isReady resolves, so Mod+J opens the bar at once', async () => {
    const editor = createEditor({ agent: { assistant: { model } } });

    await editor.isReady;
    const event = pressModJ(paragraph());

    expect(loads.prepared).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(bar()).not.toBeNull();
  });

  it('opens through api.agent.openAssistant right after isReady', async () => {
    const editor = createEditor({ agent: { assistant: { model } } });

    await editor.isReady;
    editor.agent.openAssistant();

    expect(bar()).not.toBeNull();
  });

  it('does not start the body when destroyed while it loads', async () => {
    const assistant = new Assistant({
      config: { agent: { assistant: { model } } },
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    assistant.state = { AgentAPI: { hasAssistant: true } } as unknown as BlokModules;
    const preparing = assistant.prepare();

    assistant.markDestroyed();
    assistant.destroy();
    await preparing;

    expect(loads.prepared).toBe(0);
    expect(assistant.isOpen).toBe(false);
  });
});
