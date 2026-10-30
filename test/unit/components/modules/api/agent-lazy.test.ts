import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlokConfig, OutputData } from '../../../../../types';
import type { AgentBatch } from '../../../../../types/agent';
import type { Agent, AgentModel, AgentModelResponse, AgentState } from '../../../../../types/api';
import type { Core } from '../../../../../src/components/core';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/** Holds back or breaks the agent code's chunk. Vitest rewords a failed mock's message, so tests check only that it failed. */
const chunk = vi.hoisted(() => ({
  loads: 0,
  gate: null as Promise<void> | null,
  /** Each load takes the next one and fails with it. */
  failures: [] as Error[],
}));

const AGENT_CODE = '../../../../../src/components/modules/api/agent-impl';

/** The agent code, behind the test's gate and failures. */
const mockAgentCode = async (importOriginal: () => Promise<unknown>): Promise<unknown> => {
  chunk.loads += 1;
  await chunk.gate;
  const failure = chunk.failures.shift();

  if (failure !== undefined) {
    throw failure;
  }

  return importOriginal();
};

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: Agent;
  modules: BlokModules | undefined;
}

const editors: TestEditor[] = [];

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const holdChunk = (): (() => void) => {
  const opened: { open: () => void } = { open: () => undefined };

  chunk.gate = new Promise<void>((resolve) => {
    opened.open = resolve;
  });

  return () => opened.open();
};

/** A fresh module graph per test, so each one loads the agent chunk anew. */
const boot = async (config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  vi.resetModules();
  // Per test: a vi.mock factory result outlives resetModules.
  vi.doMock(AGENT_CODE, mockAgentCode);
  const { Blok } = await import('../../../../../src/blok');
  const { Paragraph } = await import('../../../../../src/tools/paragraph');
  const holder = document.createElement('div');

  class BootedEditor extends Blok {
    public modules: BlokModules | undefined;

    public override exportAPI(core: Core): void {
      this.modules = core.moduleInstances;
      super.exportAPI(core);
    }
  }

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First' } }] },
    tabSync: false,
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const INSERT: AgentBatch = { commands: [{ name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'Added' } } }] };

const answer = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

// A cold transform of the whole editor can outlast one test's timeout.
beforeAll(async () => {
  await import('../../../../../src/blok');
  await import(AGENT_CODE);
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  chunk.loads = 0;
  chunk.gate = null;
  chunk.failures = [];
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('editor.agent loads its code on first use', () => {
  it('an editor without agent config does not load the agent code', async () => {
    const editor = await boot();

    await settle(10);

    expect(chunk.loads).toBe(0);
    expect(editor.agent.state).toEqual({ status: 'idle' });
  });

  it('begin() before the code loads gives a working turn at once and runs its calls once loaded', async () => {
    const open = holdChunk();
    const editor = await boot();
    const states: AgentState[] = [];

    editor.agent.subscribe(() => states.push(editor.agent.state));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(turn.actor).toMatchObject({ id: 'bot', name: 'Bot', kind: 'agent' });
    expect(turn.id).toEqual(expect.any(String));
    expect(turn.signal.aborted).toBe(false);
    expect(editor.agent.state).toEqual({ status: 'working', turn: { id: turn.id, agent: { id: 'bot', name: 'Bot' } } });
    expect(turn.log()).toEqual([]);

    const executed = turn.execute(INSERT);

    open();
    const result = await executed;

    expect(result.ok).toBe(true);
    expect(turn.id).toEqual(expect.any(String));
    turn.end();
    expect(editor.agent.state).toEqual({ status: 'idle' });
    expect(states.map((state) => state.status)).toEqual(['working', 'idle']);
    expect((await editor.save()).blocks.map((block) => block.id)).toContain('n1');
  });

  it('a turn ended before the code loads still applies the calls made before end(), with no second working state', async () => {
    const open = holdChunk();
    const editor = await boot();
    const states: string[] = [];

    editor.agent.subscribe(() => states.push(editor.agent.state.status));
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const executed = turn.execute(INSERT);

    turn.end();
    expect(editor.agent.state).toEqual({ status: 'idle' });
    open();

    expect((await executed).ok).toBe(true);
    await settle();
    expect(states).toEqual(['working', 'idle']);
    expect(editor.agent.state).toEqual({ status: 'idle' });
    expect((await editor.save()).blocks.map((block) => block.id)).toContain('n1');
  });

  it('a turn stopped before the code loads aborts at once and applies nothing', async () => {
    const open = holdChunk();
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const executed = turn.execute(INSERT);

    turn.stop();
    expect(turn.signal.aborted).toBe(true);
    open();

    const result = await executed;

    expect(!result.ok && result.error.code).toBe('CANCELLED');
    expect((await editor.save()).blocks.map((block) => block.id)).not.toContain('n1');
  });

  it('keeps the sync checks of begin() before the code loads', async () => {
    holdChunk();
    const editor = await boot();

    expect(() => editor.agent.begin({ agent: { id: '', name: 'Bot' } })).toThrow(TypeError);
    editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    expect(() => editor.agent.begin({ agent: { id: 'other', name: 'Other' } }))
      .toThrowError(expect.objectContaining({ name: 'AgentTurnOpenError' }));
  });

  it('describe() before the code loads throws a clear error, and works after an awaited call', async () => {
    const open = holdChunk();
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(() => turn.describe()).toThrow(/still loading/);
    const read = turn.read();

    open();
    await read;
    expect(turn.describe({ command: 'block.insert' })).toMatchObject({ command: { name: 'block.insert' } });
    turn.end();
  });

  it('a chunk that fails to load fails only the agent calls, and the next call loads again', async () => {
    chunk.failures = [new Error('chunk failed')];
    const editor = await boot();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await expect(turn.execute(INSERT)).rejects.toBeInstanceOf(Error);
    expect(turn.signal.aborted).toBe(true);
    expect(editor.agent.state).toEqual({ status: 'idle' });

    const again = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect((await again.execute(INSERT)).ok).toBe(true);
    again.end();
    expect(chunk.loads).toBe(2);
  });

  it('tools() and guidance() wait for the code, and a failed chunk rejects them', async () => {
    chunk.failures = [new Error('chunk failed')];
    const editor = await boot();

    await expect(editor.agent.guidance()).rejects.toBeInstanceOf(Error);
    await expect(editor.agent.guidance()).resolves.toEqual(expect.any(String));
    const tools = await editor.agent.tools({ format: 'anthropic' });

    expect(tools.map((tool) => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
  });

  it('ask() before the code loads answers once it lands', async () => {
    const model = vi.fn<AgentModel>(async () => answer('Done.'));

    // Agent config preloads before isReady; a failed preload leaves ask() to load the code.
    chunk.failures = [new Error('chunk failed')];
    const editor = await boot({ agent: { assistant: { model } } });
    const open = holdChunk();
    const run = editor.agent.ask('Write a line');

    expect(editor.agent.state).toMatchObject({ status: 'working', turn: { agent: { name: 'AI' } } });
    expect(() => run.followUp('More')).toThrow(/still answering/);
    open();
    await expect(run.result).resolves.toMatchObject({ status: 'done', reply: 'Done.' });
    run.end();
    expect(editor.agent.state).toEqual({ status: 'idle' });
  });

  it('ask() surfaces a failed chunk as a failed run, not a thrown boot', async () => {
    const model = vi.fn<AgentModel>(async () => answer('Done.'));

    chunk.failures = [new Error('chunk failed'), new Error('chunk failed')];
    const editor = await boot({ agent: { assistant: { model } } });
    const run = editor.agent.ask('Write a line');

    await expect(run.result).resolves.toMatchObject({ status: 'failed', error: expect.any(String) });
    expect(editor.agent.state).toEqual({ status: 'idle' });
    expect(model).not.toHaveBeenCalled();
  });
});

describe('a remote agent cursor', () => {
  it('finds no input until the code loads, then asks for one redraw', async () => {
    const open = holdChunk();
    const editor = await boot();
    const redraw = vi.fn();
    const agentApi = editor.modules?.AgentAPI;

    if (agentApi === undefined) {
      throw new Error('The ready editor has no AgentAPI module.');
    }
    expect(agentApi.inputIndexFor('p1', 'text', redraw)).toBeNull();
    expect(agentApi.inputIndexFor('p1', 'text', redraw)).toBeNull();
    open();
    await settle(10);

    expect(redraw).toHaveBeenCalledTimes(1);
    expect(agentApi.inputIndexFor('p1', 'text', redraw)).toBe(0);
  });
});

describe('editor.agent with agent config', () => {
  it('isReady waits for the agent code, so describe() works at once', async () => {
    const editor = await boot({ agent: {} });

    expect(chunk.loads).toBe(1);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(turn.describe({ command: 'block.insert' })).toMatchObject({ command: { name: 'block.insert' } });
    turn.end();
  });

  it('a failed chunk does not fail isReady', async () => {
    chunk.failures = [new Error('chunk failed')];
    const editor = await boot({ agent: {} });

    expect(editor.agent.state).toEqual({ status: 'idle' });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect((await turn.execute(INSERT)).ok).toBe(true);
    turn.end();
  });
});
