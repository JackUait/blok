import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { CORE_TOOL_NAMES } from '../../../../../src/mcp/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlokConfig, OutputData } from '../../../../../types';
import type { Agent, AgentModel, AgentModelRequest, AgentModelResponse } from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
  blocks: API['blocks'];
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const editors: TestEditor[] = [];

const createEditor = async (model: AgentModel | null): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const config: BlokConfig = {
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First line here' } }] },
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer' } } }),
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

const insertBatch = (text: string): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: `use-${text}`,
    name: 'blok_execute',
    input: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] },
  }],
});

const answer = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

const scripted = (...responses: AgentModelResponse[]): AgentModel & { requests: AgentModelRequest[] } => {
  const requests: AgentModelRequest[] = [];

  return Object.assign(async (request: AgentModelRequest) => {
    requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = responses.shift();

    if (next === undefined) {
      throw new Error('unscripted model call');
    }

    return next;
  }, { requests });
};

const plain = (value: unknown): string => (Array.isArray(value)
  ? value.map((segment: { text?: unknown }) => (typeof segment.text === 'string' ? segment.text : '')).join('')
  : String(value));

const texts = async (editor: TestEditor): Promise<string[]> =>
  (await editor.save()).blocks.map((block) => plain(block.data.text));

describe('editor.agent.ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes into the document through the same three tools the MCP server serves', async () => {
    const model = scripted(insertBatch('Written by the model'), answer('Added one paragraph.'));
    const editor = await createEditor(model);

    const run = editor.agent.ask('Add a sentence');
    const result = await run.result;

    expect(result).toMatchObject({ status: 'done', reply: 'Added one paragraph.' });
    expect(await texts(editor)).toEqual(['First line here', 'Written by the model']);
    expect(result.changed).toHaveLength(1);
    expect(model.requests[0].tools.map((tool) => tool.name)).toEqual([...CORE_TOOL_NAMES]);
    expect(model.requests[0].system).toContain('blok_read');
    expect(model.requests[0].messages[0]).toEqual({ role: 'user', content: expect.stringContaining('Add a sentence') });
    run.end();
  });

  it('keeps the turn open until end(), then goes idle', async () => {
    const editor = await createEditor(scripted(answer('Hi')));
    const run = editor.agent.ask('Say hi');

    expect(editor.agent.state.status).toBe('working');
    await run.result;
    expect(editor.agent.state.status).toBe('working');
    run.end();
    expect(editor.agent.state.status).toBe('idle');
  });

  it('discard() removes everything the run wrote', async () => {
    const editor = await createEditor(scripted(insertBatch('One'), insertBatch('Two'), answer('Done')));
    const run = editor.agent.ask('Add two');

    await run.result;
    expect(await texts(editor)).toEqual(['First line here', 'One', 'Two']);

    await expect(run.discard()).resolves.toBe(true);
    expect(await texts(editor)).toEqual(['First line here']);
    expect(editor.agent.state.status).toBe('idle');
  });

  it('followUp() continues the same conversation', async () => {
    const model = scripted(insertBatch('Draft'), answer('Wrote a draft.'), answer('Shorter now.'));
    const editor = await createEditor(model);
    const run = editor.agent.ask('Write a draft');

    await run.result;
    const second = await run.followUp('Make it shorter');

    expect(second).toMatchObject({ status: 'done', reply: 'Shorter now.' });
    const history = model.requests[2].messages;

    expect(history[0]).toEqual({ role: 'user', content: expect.stringContaining('Write a draft') });
    expect(history.at(-1)).toEqual({ role: 'user', content: 'Make it shorter' });
    expect(history.filter((message) => message.role === 'assistant')).toHaveLength(2);
    run.end();
  });

  it('stop() aborts the model call, applies nothing, and the run can still be discarded or ended', async () => {
    const seen: AbortSignal[] = [];
    const model: AgentModel = (request) => {
      seen.push(request.signal);

      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    };
    const editor = await createEditor(model);
    const run = editor.agent.ask('Write');

    await settle();
    run.stop();

    await expect(run.result).resolves.toMatchObject({ status: 'stopped', changed: [] });
    expect(seen[0].aborted).toBe(true);
    expect(await texts(editor)).toEqual(['First line here']);
    run.end();
    expect(editor.agent.state.status).toBe('idle');
  });

  it('tells the model which block holds the caret and what text is selected', async () => {
    const model = scripted(answer('ok'));
    const editor = await createEditor(model);
    const textNode = document.querySelector('[data-blok-id="p1"] [data-blok-tool="paragraph"]')?.firstChild ?? null;

    if (textNode === null) {
      throw new Error('p1 has no editable text');
    }
    const range = document.createRange();

    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    const run = editor.agent.ask('Rewrite this');

    await run.result;
    const first = model.requests[0].messages[0].content;

    expect(first).toEqual(expect.stringContaining('p1'));
    expect(first).toEqual(expect.stringContaining('"line"'));
    run.end();
  });

  it('throws a clear error when no assistant model is configured', async () => {
    const editor = await createEditor(null);

    expect(() => editor.agent.ask('x')).toThrow(/agent\.assistant\.model/);
  });

  it('reports a failed model call as an error result, not a throw', async () => {
    const editor = await createEditor(async () => {
      throw new Error('No API key');
    });
    const run = editor.agent.ask('x');

    await expect(run.result).resolves.toMatchObject({ status: 'failed', error: 'No API key' });
    run.end();
  });
});
