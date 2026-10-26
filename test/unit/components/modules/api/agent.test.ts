import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { composeGuidance } from '../../../../../src/agent/guidance';
import { AgentToolsStrictError, renderAgentTools } from '../../../../../src/agent/render-tools';
import { AgentAPI, AgentTurnOpenError } from '../../../../../src/components/modules/api/agent';
import type {
  ContractSource,
  createEditorAgentSession,
  liveContractSource,
} from '../../../../../src/components/modules/agent/editor-session';
import type { Core } from '../../../../../src/components/core';
import type * as AnnouncerModule from '../../../../../src/components/utils/announcer';
import { Modules } from '../../../../../src/components/modules';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { buildToolRuntimes } from '../../../../../src/shared/tool-actions/runtime';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { AgentActor, AgentResult, AgentSession, DocumentView } from '../../../../../types/agent';
import type { AgentState, AgentTurnOptions } from '../../../../../types/api';
import type { AgentContract, BlockToolManifestEntry } from '../../../../../types/tool-manifest';
import { makeContract } from '../../../agent/fixtures/contract';

const editorSession = vi.hoisted(() => ({
  createEditorAgentSession: vi.fn<typeof createEditorAgentSession>(),
  liveContractSource: vi.fn<typeof liveContractSource>(),
}));

vi.mock('../../../../../src/components/modules/agent/editor-session', () => editorSession);

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));

vi.mock('../../../../../src/components/utils/announcer', async (importOriginal) => ({
  ...await importOriginal<typeof AnnouncerModule>(),
  announce: announcer.announce,
}));

const ACTOR: AgentActor = { id: 'bot', name: 'Bot', kind: 'agent' };
const VIEW: DocumentView = {
  revision: 'rev-1',
  rootId: null,
  blocks: [{ id: 'p', type: 'paragraph', depth: 0, text: 'Hello' }],
};
const RESULT: AgentResult = {
  ok: true,
  revision: 'rev-1',
  results: [VIEW],
  refs: {},
  changed: { created: [], updated: [], moved: [], removed: [] },
  warnings: [],
};
const GUIDANCE = [
  'General guidance.',
  '',
  'You are editing the document the user has open.',
  '',
  '- Call blok_read when you need blocks, text or data you do not have. Address blocks by the ids it returns.',
  '- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.',
  '- When the blok_execute schema lists a command\'s full arguments, use them. Otherwise call blok_describe with { command } before using it for the first time. Call it with { tool } for a block type\'s data.',
  '- Someone may be typing in the document at the same time, so its text can change between your calls.',
  '- On a STALE error, call blok_read again and retry with fresh ids and text.',
  '- A CORRECTED warning means Blok changed your command. Check the result is what you meant.',
  '- Change only the blocks the request is about. To add something, insert a new block; do not convert or rewrite a nearby block to get it.',
  '- Put related edits in one blok_execute call.',
  '- The first message may carry the document as blok_read returns it. If it does not, call blok_read before you edit.',
  '- The user can undo your edits to this document with Cmd+Z.',
  '- You cannot move the user\'s caret, selection or scroll.',
  '- When the user asks a question, answer it in your reply. Edit the document only when they ask for a change.',
  '- After you edit, your whole reply is one friendly sentence of under 10 words on what you did, in the user\'s language, like "Added a short paragraph about how YouTube began." It must make sense on its own: never end it with a colon, never introduce a list, write nothing before or after it. Say what, never where: no caret, position, block names or ids. No lists, tables or Markdown.',
].join('\n');

const fakeSession = (id = 'turn-1', actor: AgentActor = ACTOR) => ({
  id,
  actor,
  read: vi.fn<AgentSession['read']>().mockResolvedValue(VIEW),
  describe: vi.fn<AgentSession['describe']>().mockReturnValue(makeContract()),
  execute: vi.fn<AgentSession['execute']>().mockResolvedValue(RESULT),
  log: vi.fn<AgentSession['log']>().mockReturnValue([]),
  close: vi.fn<AgentSession['close']>(),
  sealSteps: vi.fn<() => void>(),
}) satisfies AgentSession & { sealSteps(): void };

const sourceOf = (contract: AgentContract) => ({
  contract: vi.fn<ContractSource['contract']>().mockReturnValue(contract),
  runtimes: vi.fn<ContractSource['runtimes']>().mockReturnValue(buildToolRuntimes([])),
}) satisfies ContractSource;

const apis: AgentAPI[] = [];
const editors: Blok[] = [];
let source = sourceOf(makeContract());

class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

const createAgentApi = async (): Promise<{ api: AgentAPI; modules: BlokModules }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new BootedEditor({ holder, tools: { paragraph: Paragraph }, tabSync: false });

  editors.push(editor);
  await editor.isReady;
  const modules = editor.moduleGraph;

  if (modules === undefined || Object.keys(modules).length !== Object.keys(Modules).length
    || Object.keys(Modules).some(name => !(name in modules))) {
    throw new Error('The ready editor has an incomplete module graph.');
  }

  const api = new AgentAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  apis.push(api);
  api.state = modules;

  return { api, modules };
};

beforeEach(() => {
  vi.clearAllMocks();
  editorSession.createEditorAgentSession.mockReset();
  editorSession.liveContractSource.mockReset();
  localStorage.clear();
  source = sourceOf(makeContract());
  editorSession.liveContractSource.mockReturnValue(source);
  editorSession.createEditorAgentSession.mockImplementation((_editor, actor) => fakeSession('turn-1', actor));
});

afterEach(() => {
  const errors: unknown[] = [];

  try {
    [...apis.splice(0), ...editors.splice(0)].forEach(owner => {
      try {
        owner.destroy();
      } catch (error) {
        errors.push(error);
      }
    });
  } finally {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Test editor cleanup failed.');
  }
});

describe('editor.agent namespace', () => {
  it('is exposed by a real editor after its API modules boot', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const editor = new Blok({ holder, tools: { paragraph: Paragraph }, tabSync: false });

    editors.push(editor);
    await editor.isReady;

    expect(editor).toHaveProperty('agent');
    if (!('agent' in editor)) {
      throw new Error('The ready editor has no agent namespace.');
    }
    expect(editor.agent).toMatchObject({
      tools: expect.any(Function),
      guidance: expect.any(Function),
      begin: expect.any(Function),
      subscribe: expect.any(Function),
      state: { status: 'idle' },
    });
    expect(editorSession.createEditorAgentSession).not.toHaveBeenCalled();
  });
});

describe('AgentAPI state and turns', () => {
  it('starts idle and shares its stable state across method facades', async () => {
    const { api } = await createAgentApi();
    const agent = api.methods;
    const idle = agent.state;
    const listener = vi.fn();
    const unsubscribe = agent.subscribe(listener);

    expect(idle).toEqual({ status: 'idle' });
    expect(agent.state).toBe(idle);
    expect(api.methods.state).toBe(idle);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('publishes the working snapshot before notifying and binds the agent actor', async () => {
    const { api, modules } = await createAgentApi();
    const agent = api.methods;
    const idle = agent.state;
    const snapshots: AgentState[] = [];
    const listener = vi.fn(() => snapshots.push(agent.state));

    agent.subscribe(listener);
    const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const working = agent.state;

    expect(working).toEqual({
      status: 'working',
      turn: { id: 'turn-1', agent: { id: 'bot', name: 'Bot' } },
    });
    expect(working).not.toBe(idle);
    expect(idle).toEqual({ status: 'idle' });
    expect(agent.state).toBe(working);
    expect(api.methods.state).toBe(working);
    expect(snapshots).toEqual([working]);
    expect(snapshots[0]).toBe(working);
    expect(listener).toHaveBeenCalledExactlyOnceWith();
    expect(turn.id).toBe('turn-1');
    expect(turn.actor).toEqual(ACTOR);
    expect(editorSession.createEditorAgentSession).toHaveBeenCalledExactlyOnceWith(
      modules,
      ACTOR,
      { contractSource: source, services: {}, attributeLastEditedBy: true, mergeSteps: 'turn', onPrepared: expect.any(Function), onPagePointed: expect.any(Function) }
    );
    expect(editorSession.liveContractSource).toHaveBeenCalledExactlyOnceWith(modules, { services: [] });
    expect(editorSession.liveContractSource.mock.calls[0]?.[0]).toBe(modules);
    expect(editorSession.createEditorAgentSession.mock.calls[0]?.[0]).toBe(modules);
  });

  it('copies the supplied identity into the turn state and session actor', async () => {
    const { api } = await createAgentApi();
    const agent = api.methods;
    const identity = { id: 'bot', name: 'Bot', color: '#123456', onBehalfOf: 'user-1' };
    const original = { ...identity };
    const turn = agent.begin({ agent: identity });
    const working = agent.state;

    identity.name = 'Changed';
    identity.color = '#abcdef';

    expect(working).toEqual({ status: 'working', turn: { id: 'turn-1', agent: original } });
    expect(turn.actor).toEqual({ ...original, kind: 'agent' });
    if (working.status !== 'working') {
      throw new Error('begin did not publish a working state.');
    }
    expect(working.turn.agent).not.toBe(identity);
    expect(turn.actor).not.toBe(identity);
  });

  it.each([
    { attributeTo: 'agent', stamp: true },
    { attributeTo: 'user', stamp: false },
  ] satisfies Array<{ attributeTo: 'agent' | 'user'; stamp: boolean }>)(
    'attributeTo: $attributeTo controls lastEditedBy without changing the actor or turn merge',
    async ({ attributeTo, stamp }) => {
      const { api, modules } = await createAgentApi();

      api.methods.begin({ agent: { id: 'bot', name: 'Bot' }, attributeTo });

      expect(editorSession.createEditorAgentSession).toHaveBeenCalledExactlyOnceWith(
        modules,
        ACTOR,
        { contractSource: source, services: {}, attributeLastEditedBy: stamp, mergeSteps: 'turn', onPrepared: expect.any(Function), onPagePointed: expect.any(Function) }
      );
      expect(editorSession.liveContractSource).toHaveBeenCalledExactlyOnceWith(modules, { services: [] });
      expect(editorSession.liveContractSource.mock.calls[0]?.[0]).toBe(modules);
      expect(editorSession.createEditorAgentSession.mock.calls[0]?.[0]).toBe(modules);
    }
  );

  it('refuses a second open turn with the named error and leaves the first turn unchanged', async () => {
    const { api } = await createAgentApi();
    const agent = api.methods;
    const listener = vi.fn();

    agent.subscribe(listener);
    agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const working = agent.state;

    expect(() => agent.begin({ agent: { id: 'other', name: 'Other' } })).toThrow(AgentTurnOpenError);
    expect(() => agent.begin({ agent: { id: 'other', name: 'Other' } }))
      .toThrowError(expect.objectContaining({ name: 'AgentTurnOpenError' }));
    expect(agent.state).toBe(working);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editorSession.createEditorAgentSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    { agent: { id: '', name: 'Bot' } },
    { agent: { id: 'bot', name: '' } },
    { agent: { id: 'bot', name: '   ' } },
  ] satisfies AgentTurnOptions[])('rejects an empty identity (%#) before opening a session', async options => {
    const { api } = await createAgentApi();
    const agent = api.methods;
    const listener = vi.fn();

    agent.subscribe(listener);

    expect(() => agent.begin(options)).toThrow(TypeError);
    expect(agent.state).toEqual({ status: 'idle' });
    expect(listener).not.toHaveBeenCalled();
    expect(editorSession.createEditorAgentSession).not.toHaveBeenCalled();
    expect(editorSession.liveContractSource).not.toHaveBeenCalled();
  });

  it('returns a usable real turn backed by the typed session dependency', async () => {
    const session = fakeSession();

    editorSession.createEditorAgentSession.mockReturnValueOnce(session);
    const { api } = await createAgentApi();
    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(await turn.call('blok_read', {})).toEqual({ content: JSON.stringify(VIEW), isError: false });
    expect(await turn.execute({ commands: [{ name: 'doc.read', args: {} }] })).toEqual(RESULT);
    expect(turn.describe()).toEqual(makeContract());
    expect(turn.log()).toEqual([]);
    expect(session.read).toHaveBeenCalledExactlyOnceWith({});
    expect(session.execute).toHaveBeenCalledExactlyOnceWith(
      { commands: [{ name: 'doc.read', args: {} }] },
      { signal: turn.signal }
    );
    turn.end();
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });

  it.each(['end', 'stop'] satisfies Array<'end' | 'stop'>)(
    '%s returns to stable idle, allows a new turn, and honors unsubscribe',
    async method => {
      const firstSession = fakeSession('turn-1');
      const nextSession = fakeSession('turn-2');

      editorSession.createEditorAgentSession.mockReturnValueOnce(firstSession).mockReturnValueOnce(nextSession);
      const { api } = await createAgentApi();
      const agent = api.methods;
      const listener = vi.fn();
      const unsubscribe = agent.subscribe(listener);
      const first = agent.begin({ agent: { id: 'bot', name: 'Bot' } });
      const firstWorking = agent.state;

      first[method]();

      expect(agent.state).toEqual({ status: 'idle' });
      expect(agent.state).toBe(agent.state);
      expect(first.signal.aborted).toBe(method === 'stop');
      expect(firstWorking).toEqual({ status: 'working', turn: { id: 'turn-1', agent: { id: 'bot', name: 'Bot' } } });
      expect(listener).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(firstSession.close).toHaveBeenCalledTimes(1));

      const next = agent.begin({ agent: { id: 'bot', name: 'Bot' } });
      const nextWorking = agent.state;

      expect(next.id).toBe('turn-2');
      expect(next.signal.aborted).toBe(false);
      expect(nextWorking).toEqual({ status: 'working', turn: { id: 'turn-2', agent: { id: 'bot', name: 'Bot' } } });
      expect(listener).toHaveBeenCalledTimes(3);
      first.stop();
      expect(agent.state).toBe(nextWorking);

      unsubscribe();
      next.stop();

      expect(agent.state).toEqual({ status: 'idle' });
      expect(listener).toHaveBeenCalledTimes(3);
      await vi.waitFor(() => expect(nextSession.close).toHaveBeenCalledTimes(1));
    }
  );

  it('destroy aborts the open turn and closes its session', async () => {
    const { api } = await createAgentApi();
    const agent = api.methods;
    const session = fakeSession();

    editorSession.createEditorAgentSession.mockReturnValueOnce(session);
    const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    api.destroy();

    expect(turn.signal.aborted).toBe(true);
    expect(agent.state).toEqual({ status: 'idle' });
    await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  });
});

describe('AgentAPI tools and guidance', () => {
  it('renders actual Anthropic definitions with input_schema and no false strict flag', async () => {
    const { api } = await createAgentApi();
    const tools = await api.methods.tools({ format: 'anthropic' });

    expect(tools.map(tool => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    // Default 'mixed', like Ask AI and @bloklabs/mcp: common commands carry their arguments, so no describe call.
    expect(tools).toEqual(renderAgentTools(makeContract(), { format: 'anthropic', schema: 'mixed' }));
    tools.forEach(tool => {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    });
  });

  it('renders actual flat OpenAI Responses definitions with explicit strict:false', async () => {
    const { api } = await createAgentApi();
    const tools = await api.methods.tools({ format: 'openai' });

    expect(tools.map(tool => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    expect(tools).toEqual(renderAgentTools(makeContract(), { format: 'openai', schema: 'mixed' }));
    tools.forEach(tool => {
      expect(tool).toMatchObject({ type: 'function', strict: false });
      expect(Object.keys(tool).sort()).toEqual(['description', 'name', 'parameters', 'strict', 'type']);
    });
  });

  it.each(['anthropic', 'openai'] satisfies Array<'anthropic' | 'openai'>)(
    'forwards the accepted full schema and strict:false options for %s',
    async format => {
      const { api } = await createAgentApi();
      const agent = api.methods;
      const tools = format === 'anthropic'
        ? await agent.tools({ format: 'anthropic', schema: 'full', strict: false })
        : await agent.tools({ format: 'openai', schema: 'full', strict: false });
      const execute = tools.find(tool => tool.name === 'blok_execute');

      expect(tools).toEqual(renderAgentTools(makeContract(), { format, schema: 'full', strict: false }));
      if (execute === undefined) {
        throw new Error('No blok_execute definition was rendered.');
      }
      const schema = 'input_schema' in execute ? execute.input_schema : execute.parameters;

      expect(schema).toHaveProperty('properties.commands.items.oneOf');
    }
  );

  it('forwards strict:true to the real Anthropic renderer', async () => {
    const { api } = await createAgentApi();
    const tools = await api.methods.tools({ format: 'anthropic', schema: 'envelope', strict: true });

    expect(tools).toEqual(renderAgentTools(makeContract(), { format: 'anthropic', schema: 'envelope', strict: true }));
    expect(tools.find(tool => tool.name === 'blok_read')).toHaveProperty('strict', true);
    expect(tools.find(tool => tool.name === 'blok_describe')).toHaveProperty('strict', true);
    expect(tools.find(tool => tool.name === 'blok_execute')).not.toHaveProperty('strict');
  });

  it('preserves the real OpenAI strict error for optional input fields', async () => {
    const { api } = await createAgentApi();

    await expect(api.methods.tools({ format: 'openai', strict: true }))
      .rejects.toBeInstanceOf(AgentToolsStrictError);
  });

  it('returns the real composed guidance and reuses its source for tools and turns', async () => {
    const { api, modules } = await createAgentApi();
    const agent = api.methods;

    expect(await agent.guidance()).toBe(GUIDANCE);
    await agent.tools({ format: 'anthropic' });
    agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(editorSession.liveContractSource).toHaveBeenCalledTimes(1);
    expect(source.contract).toHaveBeenCalledTimes(2);
    expect(editorSession.createEditorAgentSession).toHaveBeenCalledExactlyOnceWith(
      modules,
      ACTOR,
      { contractSource: source, services: {}, attributeLastEditedBy: true, mergeSteps: 'turn', onPrepared: expect.any(Function), onPagePointed: expect.any(Function) }
    );
    expect(editorSession.liveContractSource).toHaveBeenCalledExactlyOnceWith(modules, { services: [] });
    expect(editorSession.liveContractSource.mock.calls[0]?.[0]).toBe(modules);
    expect(editorSession.createEditorAgentSession.mock.calls[0]?.[0]).toBe(modules);
  });

  it('trims the contract preamble before appending the in-app rules', () => {
    const contract = makeContract();

    contract.guidance.general = '  \nGeneral guidance.\n  ';

    expect(composeGuidance(contract)).toBe(GUIDANCE);
  });

  it('tells the model that Cmd+Z does not undo its sub-page writes; Discard does, then the page\'s version history', () => {
    const contract = makeContract();

    contract.guidance.general = 'General guidance.';

    expect(composeGuidance(contract, { pages: true })).toContain('Cmd+Z does not undo your writes to a sub-page. Discard reverts them before the user keeps your work. After that, the user can restore an earlier version from that sub-page\'s version history, if the app keeps one.');
    expect(composeGuidance(contract)).not.toContain('sub-page');
  });
});

describe('AgentAPI presence wiring', () => {
  const entry = (name: string, inputFields: string[]): BlockToolManifestEntry => ({
    name,
    title: name,
    summary: name,
    level: 'described',
    insertable: true,
    variants: [],
    data: { type: 'object' },
    richTextFields: inputFields,
    viewState: [],
    guardedFields: {},
    children: { accepts: false, ownedByTool: false, layout: false, deletedWithParent: false },
    selfPlacesChildren: false,
    restrictedInTableCell: false,
    inputFields,
    convertsTo: [],
    conversion: {},
    inlineTools: [],
    tunes: [],
    actions: [],
  });

  it('inputIndexFor maps a field through the block tool\'s manifest entry', async () => {
    const contract = makeContract();

    editorSession.liveContractSource.mockReturnValue(sourceOf({
      ...contract,
      manifest: { ...contract.manifest, blocks: [entry('paragraph', ['caption'])] },
    }));
    const { api, modules } = await createAgentApi();
    const block = modules.BlockManager.blocks[0];

    expect(api.inputIndexFor(block.id, 'caption')).toBe(0);
    expect(api.inputIndexFor(block.id, 'url')).toBeNull();
    expect(api.inputIndexFor('missing', 'caption')).toBeNull();
  });

  it('draws the agent on the block a batch created, and removes it when the turn ends', async () => {
    const { api, modules } = await createAgentApi();
    const block = modules.BlockManager.blocks[0];
    const session = fakeSession();

    session.execute.mockResolvedValue({ ...RESULT, changed: { created: [block.id], updated: [], moved: [], removed: [] } });
    editorSession.createEditorAgentSession.mockReturnValue(session);
    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.call('blok_execute', { commands: [] });

    expect(block.holder.querySelector('[data-blok-agent-marker-label="Bot"]')).not.toBeNull();

    turn.end();

    expect(block.holder.querySelector('[data-blok-agent-marker]')).toBeNull();
  });
});

describe('AgentAPI agentCursor wiring', () => {
  it('writes agentCursor through YjsManager and clears it on end()', async () => {
    const { api, modules } = await createAgentApi();
    const block = modules.BlockManager.blocks[0];
    const session = fakeSession();
    const setAwarenessField = vi.spyOn(modules.YjsManager, 'setAwarenessField');

    session.execute.mockResolvedValue({ ...RESULT, changed: { created: [block.id], updated: [], moved: [], removed: [] } });
    editorSession.createEditorAgentSession.mockReturnValue(session);
    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [] });
    turn.end();

    expect(setAwarenessField.mock.calls.filter(([field]) => field === 'agentCursor')).toEqual([
      ['agentCursor', expect.objectContaining({ actorId: 'bot', name: 'Bot', blockId: block.id })],
      ['agentCursor', null],
    ]);
  });

  it('destroy clears a published agentCursor', async () => {
    const { api, modules } = await createAgentApi();
    const block = modules.BlockManager.blocks[0];
    const session = fakeSession();
    const setAwarenessField = vi.spyOn(modules.YjsManager, 'setAwarenessField');

    session.execute.mockResolvedValue({ ...RESULT, changed: { created: [block.id], updated: [], moved: [], removed: [] } });
    editorSession.createEditorAgentSession.mockReturnValue(session);
    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [] });
    api.destroy();

    expect(setAwarenessField.mock.calls.at(-1)).toEqual(['agentCursor', null]);
  });
});

describe('AgentAPI announcement', () => {
  const changedResult = (changed: Partial<Extract<AgentResult, { ok: true }>['changed']>): AgentResult => ({
    ...RESULT,
    changed: { created: [], updated: [], moved: [], removed: [], ...changed },
  });

  const begin = async (...results: AgentResult[]) => {
    const { api, modules } = await createAgentApi();
    const session = fakeSession();

    results.forEach((value) => session.execute.mockResolvedValueOnce(value));
    editorSession.createEditorAgentSession.mockReturnValue(session);
    vi.spyOn(modules.I18n, 't').mockImplementation((key, vars) => `${key}|${JSON.stringify(vars ?? {})}`);

    return api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });
  };

  it('end() announces the distinct blocks the turn changed, once', async () => {
    const turn = await begin(changedResult({ created: ['b1'] }), changedResult({ updated: ['b1'], created: ['b2'] }));

    await turn.execute({ commands: [] });
    await turn.execute({ commands: [] });
    turn.end();

    expect(announcer.announce).toHaveBeenCalledExactlyOnceWith('agent.changedBlocks|{"agent":"Bot","count":2}', { politeness: 'polite' });
  });

  it('one block uses the singular key; stop() announces too', async () => {
    const turn = await begin(changedResult({ removed: ['b1'] }));

    await turn.execute({ commands: [] });
    turn.stop();

    expect(announcer.announce).toHaveBeenCalledExactlyOnceWith('agent.changedOneBlock|{"agent":"Bot","count":1}', { politeness: 'polite' });
  });

  it('a turn that changed nothing announces nothing', async () => {
    const turn = await begin(changedResult({}));

    await turn.execute({ commands: [] });
    turn.end();

    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it('a second turn counts only its own blocks', async () => {
    const first = await begin(changedResult({ created: ['b1', 'b2'] }));

    await first.execute({ commands: [] });
    first.end();
    announcer.announce.mockClear();

    const session = fakeSession();

    session.execute.mockResolvedValueOnce(changedResult({ updated: ['b3'] }));
    editorSession.createEditorAgentSession.mockReturnValue(session);
    const second = apis[apis.length - 1].methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await second.execute({ commands: [] });
    second.end();

    expect(announcer.announce).toHaveBeenCalledExactlyOnceWith('agent.changedOneBlock|{"agent":"Bot","count":1}', { politeness: 'polite' });
  });
});
