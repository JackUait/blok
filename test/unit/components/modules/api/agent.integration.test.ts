import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import type { Agent, AgentBatch, API, BlockMutationEvent, BlokConfig, OutputData } from '../../../../../types';

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

const createRealEditor = async (config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First' } }] },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

const INSERT: AgentBatch = { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'From agent' }, position: 'end' } }] };

const errorCode = (content: string): string => (JSON.parse(content) as { error: { code: string } }).error.code;

const teardown = (): void => {
  vi.restoreAllMocks();
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.innerHTML = '';
};

describe('editor.agent on a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(teardown);

  it('a turn inserts a block', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', INSERT);

    turn.end();
    await settle();

    expect(result.isError).toBe(false);
    expect((await editor.save()).blocks).toHaveLength(2);
  });

  it('blok_execute shows the changed blocks as blok_read of their ids does, so the model need not read to check', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = JSON.parse((await turn.call('blok_execute', {
      commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: 'From agent' }, position: 'end' } },
        { name: 'text.replace', args: { id: 'p1', range: 'all', with: 'Edited' } },
      ],
    })).content) as { changed: { created: string[]; updated: string[] }; blocks?: unknown[] };
    const ids = [...result.changed.updated, ...result.changed.created];
    const read = JSON.parse((await turn.call('blok_read', { ids })).content) as { blocks: unknown[] };

    turn.end();

    expect(result.blocks).toEqual(read.blocks);
    expect(result.blocks).toHaveLength(2);
  });

  it('test 2: read-only refuses blok_execute with READ_ONLY and still reads', async () => {
    const editor = await createRealEditor({ readOnly: true });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const write = await turn.call('blok_execute', INSERT);
    const read = await turn.call('blok_read', {});

    expect(write.isError).toBe(true);
    expect(errorCode(write.content)).toBe('READ_ONLY');
    expect(read.isError).toBe(false);
  });

  it('test 23 (point 1): stop before start writes nothing', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    turn.stop();

    const result = await turn.execute(INSERT);

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect((await editor.save()).blocks).toHaveLength(1);
  });

  it('test 1: destroy() stops the open turn, and a later call throws', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    editors.splice(editors.indexOf(editor), 1);
    editor.destroy();

    expect(turn.signal.aborted).toBe(true);
    await expect(turn.call('blok_read', {})).rejects.toThrow(/destroyed/);
  });

  it('test 20: an action hidden by overrides is absent from tools() and refused at execute', async () => {
    const visible = await createRealEditor({ tools: { paragraph: Paragraph, table: Table } });
    const visibleTools = await visible.agent.tools({ format: 'anthropic' });

    // Without overrides the action is listed, so the hidden checks below mean something.
    expect(JSON.stringify(visibleTools)).toContain('"table.insertRows"');

    const hidden = await createRealEditor({
      tools: { paragraph: Paragraph, table: Table },
      agent: { overrides: { table: { hiddenActions: ['insertRows'] } } },
    });
    const hiddenTools = await hidden.agent.tools({ format: 'anthropic' });
    const turn = hidden.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'table.insertRows', args: { id: 'missing', at: 0 } }] });

    expect(JSON.stringify(hiddenTools)).not.toContain('"table.insertRows"');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  });
});

const collect = (): { config: Partial<BlokConfig>; events: BlockMutationEvent[] } => {
  const events: BlockMutationEvent[] = [];

  return {
    events,
    config: {
      user: { id: 'human' },
      onChange: (_api, event) => {
        events.push(...(Array.isArray(event) ? event : [event]));
      },
    },
  };
};

const savedBlock = async (editor: TestEditor, id: string): Promise<OutputData['blocks'][number] | undefined> =>
  (await editor.save()).blocks.find((block) => block.id === id);

// Waits past the mutation coalescing window before reading events.
const MUTATION_WINDOW_MS = 500;

describe('agent attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(teardown);

  it('test 4: a block the agent changes names the agent, and its event carries detail.agent', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent text' } } }] });
    turn.end();
    await settle(MUTATION_WINDOW_MS);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('bot');

    const forP1 = events.filter((event) => event.detail.target.id === 'p1');

    expect(forP1.length).toBeGreaterThan(0);
    forP1.forEach((event) => {
      expect(event.detail.agent).toEqual({ id: 'bot', name: 'Bot', turnId: turn.id });
      expect(event.detail.origin).toBe('local');
    });
  });

  it('attributeTo: user keeps the human id but still marks the event', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' }, attributeTo: 'user' });

    await turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent text' } } }] });
    turn.end();
    await settle(MUTATION_WINDOW_MS);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('human');
    expect(events.some((event) => event.detail.agent?.id === 'bot')).toBe(true);
  });

  it.each([
    { name: 'the agent by default, with a user configured', attributeTo: undefined, user: { id: 'human' }, by: 'bot' },
    { name: 'the agent by default, with no user configured', attributeTo: undefined, user: undefined, by: 'bot' },
    { name: 'the user with attributeTo: user', attributeTo: 'user' as const, user: { id: 'human' }, by: 'human' },
  ])('a block the agent creates names $name as creator and last editor', async ({ attributeTo, user, by }) => {
    const editor = await createRealEditor(user === undefined ? {} : { user });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' }, ...(attributeTo === undefined ? {} : { attributeTo }) });

    await turn.execute({ commands: [{ name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'New' }, position: 'end' } }] });
    turn.end();
    await settle(MUTATION_WINDOW_MS);
    const block = await savedBlock(editor, 'n1');

    expect(block?.createdBy).toBe(by);
    expect(block?.lastEditedBy).toBe(by);
    expect(typeof block?.createdAt).toBe('number');
    expect(typeof block?.lastEditedAt).toBe('number');
  });

  it('a block the user adds while a turn is open still names the user as creator', async () => {
    const editor = await createRealEditor({ user: { id: 'human' } });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'New' }, position: 'end' } }] });
    await editor.blocks.insert('paragraph', { text: 'Mine' }, undefined, undefined, undefined, undefined, 'h1');
    turn.end();
    await settle(MUTATION_WINDOW_MS);

    expect((await savedBlock(editor, 'h1'))?.createdBy).toBe('human');
  });

  it('outside a turn nothing is attributed to an agent', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);

    await editor.blocks.update('p1', { text: 'Host text' });
    await settle(MUTATION_WINDOW_MS);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('human');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.detail.agent === undefined)).toBe(true);
  });

  it('test 17: a write to another block during the agent batch keeps the human id', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor({
      ...config,
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    // Started, not awaited: the host write lands inside the batch's open undo group.
    const agentWrite = turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent' } } }] });
    const humanWrite = editor.blocks.update('p2', { text: 'Human' });

    await Promise.all([agentWrite, humanWrite]);
    turn.end();
    await settle(MUTATION_WINDOW_MS);

    expect((await savedBlock(editor, 'p2'))?.lastEditedBy).toBe('human');
    expect(events.filter((event) => event.detail.target.id === 'p2').every((event) => event.detail.agent === undefined)).toBe(true);
    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('bot');
  });
});

const texts = async (editor: TestEditor): Promise<string[]> => (await editor.save()).blocks.map((block) => {
  const text: unknown = block.data.text;

  return Array.isArray(text)
    ? text.map((segment: unknown) => (typeof segment === 'object' && segment !== null && 'text' in segment ? String(segment.text) : '')).join('')
    : String(text);
});

const insert = (text: string): AgentBatch => ({
  commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }],
});

// Past Yjs's 500ms captureTimeout, so only the turn merge can join two steps.
const PAST_CAPTURE_MS = 600;

describe('agent undo pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(teardown);

  it('test 9 (R-U4): an agent batch is undoable by the user', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    turn.end();
    await settle(50);

    expect(editor.history.canUndo()).toBe(true);
    editor.history.undo();
    await settle(50);
    expect(await texts(editor)).toEqual(['First']);
  });

  it('test 7 (R-U1): two batches across an await, past the capture window, undo as one step', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    await settle(PAST_CAPTURE_MS);
    await turn.execute(insert('B'));
    turn.end();
    await settle(50);

    editor.history.undo();
    await settle(50);

    expect(await texts(editor)).toEqual(['First']);
  });

  it('R-U5: after end(), the next write starts its own step', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    turn.end();
    await settle(50);
    editor.blocks.insert('paragraph', { text: 'Host' });
    await settle(PAST_CAPTURE_MS);

    editor.history.undo();
    await settle(50);

    expect(await texts(editor)).toEqual(['First', 'A']);
  });
});

describe('focus neutrality — test 6', () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    } else {
      Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    }
    teardown();
  });

  it('follow: true scrolls the window to the block the agent changed, honouring topOffset', async () => {
    const editor = await createRealEditor({ scrollToBlock: { topOffset: 30 } });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' }, follow: true });
    const measure = Element.prototype.getBoundingClientRect;

    // The block may re-render, so stub every element that is p1's holder at measure time.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('data-blok-id') === 'p1' ? new DOMRect(0, 200, 10, 10) : measure.call(this);
    });

    await turn.execute({ commands: [{ name: 'text.replace', args: { id: 'p1', with: 'Changed' } }] });
    turn.end();

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 170, behavior: 'smooth' });
  });

  it('an agent batch leaves focus, selection and scroll where the user put them', async () => {
    const editor = await createRealEditor({
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });
    const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [data-blok-tool="paragraph"]');
    const textNode = input?.firstChild ?? null;

    if (input === null || textNode === null) {
      throw new Error('p1 has no editable text');
    }

    // jsdom keeps contentEditable as a plain property, so it is not focusable without the attribute.
    input.setAttribute('contenteditable', 'true');
    input.focus();
    expect(input).toHaveFocus();

    const range = document.createRange();

    range.setStart(textNode, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const scrollIntoView = vi.fn();

    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });

    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'New' }, position: 'end' } },
      { name: 'text.replace', args: { id: 'p2', with: 'Changed' } },
    ] });

    turn.end();
    await settle(50);

    expect(input).toHaveFocus();
    expect(window.getSelection()?.anchorNode).toBe(textNode);
    expect(window.getSelection()?.anchorOffset).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true });
    expect(await texts(editor)).toEqual(['First', 'Changed', 'New']);
  });
});
