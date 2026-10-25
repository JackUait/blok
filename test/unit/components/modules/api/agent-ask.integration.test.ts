import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Core } from '../../../../../src/components/core';
import { CORE_TOOL_NAMES } from '../../../../../src/mcp/tools';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlokConfig, OutputData } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type {
  Agent,
  AgentModel,
  AgentModelRequest,
  AgentModelResponse,
  AgentThinkingLevel,
} from '../../../../../types/api';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
  blocks: API['blocks'];
  history: API['history'];
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const editors: TestEditor[] = [];

// Past the first message's 50-block outline.
const LONG_DOC = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, type: 'paragraph', data: { text: `Paragraph number ${i}` } }));

const putCaretIn = (id: string): void => {
  const textNode = document.querySelector(`[data-blok-id="${id}"] [data-blok-tool="paragraph"]`)?.firstChild ?? null;

  if (textNode === null) {
    throw new Error(`${id} has no editable text`);
  }
  const range = document.createRange();

  range.setStart(textNode, 2);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

const createEditor = async (
  model: AgentModel | null,
  assistant: Partial<NonNullable<NonNullable<BlokConfig['agent']>['assistant']>> = {}
): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const config: BlokConfig = {
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First line here' } }] },
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer', ...assistant } } }),
  };
  const editor = new Blok(config) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

/** Exposes the module graph so a test can call AgentAPI.startRun the way the assistant bar does. */
class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

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
  const scrolls = { spy: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no scrolling.
    scrolls.spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
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

  it('draws the local agent marker as before, and does not follow', async () => {
    const editor = await createEditor(scripted(insertBatch('Written by the model'), answer('Done.')));

    const run = editor.agent.ask('Add a sentence');

    await run.result;

    expect(document.querySelector('[data-blok-presence-caret], [data-blok-agent-marker]')).not.toBeNull();
    expect(scrolls.spy).not.toHaveBeenCalled();
    run.end();
  });

  it('sends the document with the request, as blok_read returns it, so the model need not read first', async () => {
    const model = scripted(answer('Nothing to do.'));
    const editor = await createEditor(model);

    const run = editor.agent.ask('Shorten the first line');

    await run.result;
    const first = model.requests[0].messages[0].content;

    expect(typeof first === 'string' && first.startsWith('Shorten the first line')).toBe(true);
    expect(first).toEqual(expect.stringContaining('"id":"p1","type":"paragraph","depth":0,"text":"First line here"'));
    run.end();
  });

  it('sends the full arguments of the common commands, so a plain insert needs no blok_describe call', async () => {
    const model = scripted(answer('Nothing to do.'));
    const editor = await createEditor(model);

    const run = editor.agent.ask('Hello');

    await run.result;

    const execute = model.requests[0].tools.find((tool) => tool.name === 'blok_execute');
    const schema = JSON.stringify(execute?.input_schema);

    expect(schema).toContain('"const":"markdown.insert"');
    expect(schema).toContain('"const":"block.insert"');
    expect(model.requests[0].system).not.toContain('before using a command for the first time');
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

  it('the model\'s own history.undo takes back only its last batch, as in MCP', async () => {
    const undo: AgentModelResponse = { stop_reason: 'tool_use', content: [{
      type: 'tool_use', id: 'use-undo', name: 'blok_execute', input: { commands: [{ name: 'history.undo', args: {} }] },
    }] };
    const editor = await createEditor(scripted(insertBatch('One'), insertBatch('Two'), undo, answer('Done')));
    const run = editor.agent.ask('Add two, then undo one');

    await run.result;
    expect(await texts(editor)).toEqual(['First line here', 'One']);
    run.end();
  });

  it('one undo after the run takes the whole run back, and one redo after discard() brings it all back', async () => {
    const editor = await createEditor(scripted(insertBatch('One'), insertBatch('Two'), answer('Done'), insertBatch('Three'), insertBatch('Four'), answer('Done')));
    const first = editor.agent.ask('Add two');

    await first.result;
    first.end();
    editor.history.undo();
    await settle();
    expect(await texts(editor)).toEqual(['First line here']);

    editor.history.redo();
    await settle();
    const second = editor.agent.ask('Add two more');

    await second.result;
    await second.discard();
    expect(await texts(editor)).toEqual(['First line here', 'One', 'Two']);
    editor.history.redo();
    await settle();
    expect(await texts(editor)).toEqual(['First line here', 'One', 'Two', 'Three', 'Four']);
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

  it('allows 100 model calls per prompt by default', async () => {
    const calls = { count: 0 };
    const editor = await createEditor(async () => {
      calls.count += 1;

      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `use-${calls.count}`, name: 'blok_read', input: {} }] };
    });
    const run = editor.agent.ask('Keep going');

    expect(await run.result).toMatchObject({ status: 'step-limit' });
    expect(calls.count).toBe(100);
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

    // The first message awaits a document read, so the model is called a few ticks later.
    await vi.waitFor(() => expect(seen).toHaveLength(1));
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

    expect(first).toEqual(expect.stringContaining('selected this text in block p1: "line"'));
    run.end();
  });

  it('the caret context asks the model to write after the caret block', async () => {
    const model = scripted(answer('ok'));
    const editor = await createEditor(model);

    putCaretIn('p1');

    const run = editor.agent.ask('Add a line');

    await run.result;

    expect(model.requests[0].messages[0].content).toEqual(expect.stringContaining(
      '(Editor context: the user\'s caret is in block p1.) Write new content right after this block unless the request names another place.'
    ));
    run.end();
  });

  it('reads the caret block by id when the document outline stops before it', async () => {
    const model = scripted(answer('ok'));
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: LONG_DOC },
      agent: { assistant: { model, name: 'Writer' } },
    }) as unknown as TestEditor;

    editors.push(editor);
    await editor.isReady;
    await settle();
    putCaretIn('p55');

    const run = editor.agent.ask('Fix this line');

    await run.result;
    const first = model.requests[0].messages[0].content;

    expect(first).toEqual(expect.stringContaining('{"ids":["p55"]}'));
    expect(first).toEqual(expect.stringContaining('Paragraph number 55'));
    run.end();
  });

  it('reads the caret block the bar captured on open, after focus has moved to the bar', async () => {
    const model = scripted(answer('ok'));
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new BootedEditor({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: LONG_DOC },
      agent: { assistant: { model, name: 'Writer' } },
    });

    editors.push(editor as unknown as TestEditor);
    await editor.isReady;
    await settle();

    const agentApi = editor.moduleGraph?.AgentAPI;

    if (agentApi === undefined) {
      throw new Error('The ready editor has no AgentAPI module.');
    }
    putCaretIn('p55');
    const place = agentApi.describeUserPlace();

    document.getSelection()?.removeAllRanges();

    const run = agentApi.startRun('Fix this line', place, () => undefined);

    await run.result;
    const first = model.requests[0].messages[0].content;

    expect(first).toEqual(expect.stringContaining('{"ids":["p55"]}'));
    expect(first).toEqual(expect.stringContaining('caret is in block p55'));
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

  it('sends the configured default level, and an ask() option overrides it', async () => {
    const model = scripted(answer('One'), answer('Two'));
    const editor = await createEditor(model, { thinking: { levels: ['low', 'high'], default: 'high' } });

    const first = editor.agent.ask('First');

    await first.result;
    first.end();

    const second = editor.agent.ask('Second', { thinking: 'low' });

    await second.result;
    second.end();

    expect(model.requests.map((request) => request.thinking)).toEqual(['high', 'low']);
  });

  it('sends no level when the host configured none', async () => {
    const model = scripted(answer('Hi'));
    const editor = await createEditor(model);
    const run = editor.agent.ask('Hi');

    await run.result;
    run.end();

    expect('thinking' in model.requests[0]).toBe(false);
  });

  it('throws on a bad thinking config, before any model call', async () => {
    const model = scripted();
    const editor = await createEditor(model, { thinking: { levels: ['low', 'turbo' as never] } });

    expect(() => editor.agent.ask('Hi')).toThrow(TypeError);
    expect(model.requests).toHaveLength(0);
  });

  it('throws on an unknown ask() level', async () => {
    const editor = await createEditor(scripted());

    expect(() => editor.agent.ask('Hi', { thinking: 'turbo' as never })).toThrow(TypeError);
  });

  it('keeps the level an answer started with, and a follow-up reads the new pick', async () => {
    const pick: { level: AgentThinkingLevel } = { level: 'high' };
    const firstCall: { release: () => void } = { release: () => undefined };
    const released = new Promise<void>((resolve) => {
      firstCall.release = resolve;
    });
    const inner = scripted(insertBatch('Added'), answer('Done'), answer('Again'));
    const model: AgentModel = async (request) => {
      if (inner.requests.length === 0) {
        await released;
      }

      return inner(request);
    };
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new BootedEditor({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First line here' } }] },
      agent: { assistant: { model, name: 'Writer' } },
    });

    editors.push(editor as unknown as TestEditor);
    await editor.isReady;
    await settle();

    const agentApi = editor.moduleGraph?.AgentAPI;

    if (agentApi === undefined) {
      throw new Error('The ready editor has no AgentAPI module.');
    }

    const run = agentApi.startRun('First', { text: '', blockIds: [] }, () => pick.level);

    // The pick changes after the prompt is sent and again while the model is answering.
    pick.level = 'medium';
    await settle();
    pick.level = 'low';
    firstCall.release();
    await run.result;

    await run.followUp('Next');
    run.end();

    expect(inner.requests.map((request) => request.thinking)).toEqual(['high', 'high', 'low']);
  });

  describe('host tools', () => {
    const search = {
      name: 'web_search',
      description: 'Searches the web.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    };
    const searchCall: AgentModelResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'use-search', name: 'web_search', input: { query: 'red panda' } }],
    };

    it('offers a host tool to the model next to the Blok tools, and runs it with the model\'s input', async () => {
      const run = vi.fn(async (input: unknown) => `found ${JSON.stringify(input)}`);
      const model = scripted(searchCall, answer('Red pandas live in the Himalayas.'));
      const editor = await createEditor(model, { tools: [{ ...search, run }] });

      const ask = editor.agent.ask('What is a red panda?');
      const result = await ask.result;

      expect(model.requests[0].tools.map((tool) => tool.name)).toEqual([...CORE_TOOL_NAMES, 'web_search']);
      expect(model.requests[0].tools.at(-1)).toEqual(search);
      expect(run).toHaveBeenCalledWith({ query: 'red panda' });
      expect(model.requests[1].messages.at(-1)).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'use-search', content: 'found {"query":"red panda"}', is_error: false }],
      });
      expect(result).toMatchObject({ status: 'done', reply: 'Red pandas live in the Himalayas.' });
      ask.end();
    });

    it('gives a host tool that throws back to the model as an error, and the run goes on', async () => {
      const model = scripted(searchCall, answer('Search is down.'));
      const editor = await createEditor(model, { tools: [{ ...search, run: () => Promise.reject(new Error('offline')) }] });

      const ask = editor.agent.ask('What is a red panda?');
      const result = await ask.result;

      expect(model.requests[1].messages.at(-1)).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'use-search', content: 'offline', is_error: true }],
      });
      expect(result.status).toBe('done');
      ask.end();
    });

    it('throws when a host tool takes a Blok tool\'s name', async () => {
      const editor = await createEditor(scripted(), { tools: [{ ...search, name: 'blok_read', run: async () => '' }] });

      expect(() => editor.agent.ask('Hi')).toThrow(/blok_read/);
    });
  });
});
