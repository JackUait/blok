import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Map as YMap, XmlText } from 'yjs';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession as openEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Bold, Database, DatabaseRow, Header, Link, Paragraph } from '../../../../../src/tools';
import type { ParagraphData } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';
import type { AgentActor, AgentResult, AgentSession } from '../../../../../types/agent';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const booted: Core[] = [];
const holders: HTMLDivElement[] = [];
const unsubscribe: Array<() => void> = [];
const sessions: AgentSession[] = [];

const createEditorAgentSession = (Blok: BlokModules, sessionActor: AgentActor): AgentSession => {
  const session = openEditorAgentSession(Blok, sessionActor);

  sessions.push(session);

  return session;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCallable = (value: unknown): value is (this: unknown) => unknown =>
  typeof value === 'function';

const two = (): OutputData => ({
  blocks: [
    { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
    { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
  ],
});

const pendingWritesSettled = (Blok: BlokModules): Promise<void> =>
  new Promise(resolve => {
    unsubscribe.push(Blok.YjsManager.onPendingBlockWritesSettled(() => resolve()));
  });

const bounded = async <Value>(work: Promise<Value>, message: string): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1500);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

class FixtureParagraph extends Paragraph {
  public render(): HTMLDivElement {
    const element = super.render();

    // jsdom does not reflect this property onto the attribute core queries.
    element.setAttribute('contenteditable', element.contentEditable);

    return element;
  }
}

const boot = async (data: OutputData, setterTool?: typeof Paragraph): Promise<BlokModules> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const core = new Core({
    holder,
    user: { id: 'human-1' },
    dataModel: 'hierarchical',
    tools: {
      paragraph: { class: FixtureParagraph },
      header: { class: Header },
      database: { class: Database },
      'database-row': { class: DatabaseRow },
      bold: { class: Bold },
      link: { class: Link },
      ...(setterTool === undefined ? {} : { 'latched-paragraph': { class: setterTool } }),
    },
    data,
  });

  booted.push(core);
  await core.isReady;

  const Blok = core.moduleInstances;

  for (const block of Blok.BlockManager.blocks) {
    if ((block.name === 'paragraph' || block.name === 'latched-paragraph') &&
        block.pluginsContent.contentEditable === 'true') {
      // jsdom does not reflect contentEditable onto the attribute core queries.
      block.pluginsContent.setAttribute('contenteditable', 'true');
    }
  }
  await pendingWritesSettled(Blok);

  return Blok;
};

const inputOf = (Blok: BlokModules, id: string): HTMLElement => {
  const input = Blok.BlockManager.getBlockById(id)?.inputs[0];

  if (!(input instanceof HTMLElement)) {
    throw new Error(`Fixture block "${id}" has no editable input`);
  }

  return input;
};

describe('editor pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    const clean = async (run: () => unknown): Promise<void> => {
      try {
        await run();
      } catch (error) {
        failures.push(error);
      }
    };

    const cleanCore = async (core: Core): Promise<void> => {
      const instances: unknown[] = Object.values(core.moduleInstances);

      // Mark every module before teardown can call into another module.
      for (const instance of instances) {
        if (!isRecord(instance)) {
          continue;
        }
        const markDestroyed = instance.markDestroyed;

        if (isCallable(markDestroyed)) {
          await clean(() => markDestroyed.call(instance));
        }
      }

      for (const instance of instances) {
        if (!isRecord(instance)) {
          continue;
        }
        const destroy = instance.destroy;

        if (isCallable(destroy)) {
          await clean(() => destroy.call(instance));
        }
        const listeners = instance.listeners;

        if (!isRecord(listeners)) {
          continue;
        }
        const removeAll = listeners.removeAll;

        if (isCallable(removeAll)) {
          await clean(() => removeAll.call(listeners));
        }
      }
    };

    for (const session of sessions.splice(0)) {
      await clean(() => session.close());
    }

    for (const stop of unsubscribe.splice(0)) {
      await clean(stop);
    }

    for (const core of booted.splice(0)) {
      await cleanCore(core);
    }

    for (const holder of holders.splice(0)) {
      await clean(() => holder.remove());
    }
    await clean(() => document.getSelection()?.removeAllRanges());
    await clean(() => vi.restoreAllMocks());

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Editor pin teardown failed');
    }
  });

  it('R3-6: doc.setTitle inside a batch is undone with the batch', async () => {
    const Blok = await boot(two());
    const session = createEditorAgentSession(Blok, actor);
    const result: unknown = await session.execute({
      commands: [
        { name: 'block.insert', args: { id: 'agent-created', type: 'paragraph', data: { text: 'Created' } } },
        { name: 'doc.setTitle', args: { title: 'New' } },
      ],
    });
    const applied = {
      ok: isRecord(result) && result.ok === true,
      title: Blok.YjsManager.getPageFields().title,
      created: Blok.YjsManager.toJSON().some(block => block.id === 'agent-created'),
    };

    Blok.YjsManager.undo();

    expect({
      pageAfterUndo: Blok.YjsManager.getPageFields(),
      idsAfterUndo: Blok.YjsManager.toJSON().map(block => block.id),
      applied,
    }).toEqual({
      pageAfterUndo: {},
      idsAfterUndo: ['a', 'b'],
      applied: { ok: true, title: 'New', created: true },
    });
  });

  it('C3: a block the user edits during the apply window keeps the human id', async () => {
    const latch: {
      armed: boolean;
      held: boolean;
      signalEntry?: () => void;
      resume?: () => void;
    } = { armed: false, held: false };
    const setterEntered = new Promise<void>(resolve => {
      latch.signalEntry = resolve;
    });
    const setterReleased = new Promise<void>(resolve => {
      latch.resume = resolve;
    });
    const releaseSetter = (): void => {
      latch.armed = false;
      latch.held = false;
      latch.resume?.();
    };

    class LatchedParagraph extends Paragraph {
      public async setData(data: ParagraphData): Promise<void> {
        const content = document.createElement('div');

        content.innerHTML = data.text;
        if (latch.armed && content.textContent === 'Alpha' &&
            content.querySelector('b, strong')?.textContent === 'Alpha') {
          latch.armed = false;
          latch.held = true;
          latch.signalEntry?.();
          await setterReleased;
        }

        this.render().innerHTML = data.text;
      }
    }

    const Blok = await boot({
      blocks: [
        { id: 'a', type: 'latched-paragraph', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
      ],
    }, LatchedParagraph);
    const session = createEditorAgentSession(Blok, actor);
    const execution = { settled: false };
    let running: Promise<AgentResult> | undefined;
    let result: AgentResult | undefined;

    try {
      latch.armed = true;
      running = session.execute({
        commands: [{ name: 'text.format', args: { id: 'a', range: 'all', set: { bold: true } } }],
      }).finally(() => {
        execution.settled = true;
      });
      void running.catch(() => undefined);

      await bounded(setterEntered, 'C3: the agent did not enter the real tool setter');

      const humanSaved = new Promise<{
        humanId: string;
        humanText: string;
        setterHeldAtSave: boolean;
        executeSettledAtSave: boolean;
      }>(resolve => {
        unsubscribe.push(Blok.YjsManager.onDocUpdate(() => {
          if (!latch.held) {
            return;
          }
          const block = Blok.YjsManager.getBlockById('b');
          const data: unknown = block?.get('data');

          if (!(data instanceof YMap)) {
            return;
          }
          const text: unknown = data.get('text');
          const humanId: unknown = block?.get('lastEditedBy');
          const editedAt: unknown = block?.get('lastEditedAt');

          if (!(text instanceof XmlText) || text.toString() !== 'Beta typed' ||
              typeof humanId !== 'string' || typeof editedAt !== 'number') {
            return;
          }

          resolve({
            humanId,
            humanText: text.toString(),
            setterHeldAtSave: latch.held,
            executeSettledAtSave: execution.settled,
          });
        }));
      });
      const input = inputOf(Blok, 'b');
      const text = input.firstChild;

      if (!(text instanceof Text) || text.data !== 'Beta') {
        throw new Error('Fixture has no Beta text node to type into');
      }

      text.appendData(' typed');
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: ' typed',
      }));

      const observed = await bounded(
        humanSaved, 'C3: native text and edit metadata did not land while the setter was held'
      );

      expect({
        ...observed,
        setterHeldNow: latch.held,
      }).toEqual({
        humanId: 'human-1',
        humanText: 'Beta typed',
        setterHeldAtSave: true,
        executeSettledAtSave: false,
        setterHeldNow: true,
      });
    } finally {
      releaseSetter();
      if (running !== undefined) {
        result = await bounded(running, 'C3: execute did not settle after the setter was released');
      }
    }

    const agentBlock = Blok.YjsManager.toJSON().find(block => block.id === 'a');

    expect({
      agentId: agentBlock?.lastEditedBy,
      agentText: Blok.YjsManager.richSegmentsOf(agentBlock?.data.text),
      ok: result?.ok === true,
    }).toEqual({
      agentId: 'agent-1',
      agentText: [{ text: 'Alpha', marks: { bold: true } }],
      ok: true,
    });
  });

  it('B8: a write to the block holding the caret leaves the caret where it was', async () => {
    const Blok = await boot(two());
    const session = createEditorAgentSession(Blok, actor);
    const input = inputOf(Blok, 'a');

    input.focus();
    if (!Blok.API.methods.caret.setToBlock('a', 'default', 2)) {
      throw new Error('Fixture caret target was not found');
    }
    const selection = document.getSelection();

    if (selection === null || selection.rangeCount !== 1) {
      throw new Error('Fixture has no caret range');
    }
    const before = selection.getRangeAt(0);

    if (!before.collapsed || before.startOffset !== 2 || !input.contains(before.startContainer)) {
      throw new Error('Fixture caret was not placed at character 2');
    }

    const result: unknown = await session.execute({
      commands: [{ name: 'text.insert', args: { id: 'a', at: 5, text: '!' } }],
    });
    const currentInput = Blok.BlockManager.getBlockById('a')?.inputs[0];
    const live = document.getSelection();
    const after = live !== null && live.rangeCount === 1 ? live.getRangeAt(0) : undefined;

    expect({
      offset: after?.startOffset,
      insideCurrentBlock: currentInput?.contains(after?.startContainer ?? null) ?? false,
      connected: after?.startContainer.isConnected ?? false,
      collapsed: after?.collapsed,
      text: currentInput?.textContent,
      ok: isRecord(result) && result.ok === true,
    }).toEqual({
      offset: 2,
      insideCurrentBlock: true,
      connected: true,
      collapsed: true,
      text: 'Alpha!',
      ok: true,
    });
  });

  it('D5 second half: block.convert data is sanitized on the agent path', async () => {
    const Blok = await boot(two());
    const session = createEditorAgentSession(Blok, actor);
    const result: unknown = await session.execute({
      commands: [{
        name: 'block.convert',
        args: {
          id: 'a',
          type: 'header',
          data: { level: 2, text: [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' } } }] },
        },
      }],
    });
    const saved = Blok.YjsManager.toJSON();
    const converted = saved.find(block => block.id === 'a');

    expect({
      hasUnsafeScheme: /javascript:/i.test(JSON.stringify(saved)),
      convertedType: converted?.type,
      convertedText: Blok.YjsManager.richSegmentsOf(converted?.data.text),
      ok: isRecord(result) && result.ok === true,
    }).toEqual({
      hasUnsafeScheme: false,
      convertedType: 'header',
      convertedText: [{ text: 'x' }],
      ok: true,
    });
  });

  it('02-Q4: block.update on a database keeps its rows attached', async () => {
    const Blok = await boot({
      blocks: [
        {
          id: 'db',
          type: 'database',
          data: {
            title: 'DB',
            schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' }],
            views: [{
              id: 'view-list', name: 'List', type: 'list', position: 'a0',
              sorts: [], filters: [], visibleProperties: [],
            }],
            activeViewId: 'view-list',
          },
          content: ['r1'],
        },
        {
          id: 'r1',
          type: 'database-row',
          parent: 'db',
          data: { position: 'a0', title: 'First', properties: { 'prop-title': 'First' } },
        },
      ],
    });
    const session = createEditorAgentSession(Blok, actor);
    const result: unknown = await session.execute({
      commands: [{ name: 'block.update', args: { id: 'db', data: { title: 'Renamed' } } }],
    });
    const saved = Blok.YjsManager.toJSON();
    const database = saved.find(block => block.id === 'db');
    const row = saved.find(block => block.id === 'r1');

    expect({
      rowParent: row?.parent,
      parentChildren: database?.content,
      liveChildren: Blok.API.methods.blocks.getChildren('db').map(block => block.id),
      rowType: row?.type,
      rowProperties: row?.data.properties,
      databaseType: database?.type,
      databaseTitle: database?.data.title,
      renderedTitle: Blok.BlockManager.getBlockById('db')?.holder
        .querySelector('[data-blok-database-title]')?.textContent,
      ok: isRecord(result) && result.ok === true,
    }).toEqual({
      rowParent: 'db',
      parentChildren: ['r1'],
      liveChildren: ['r1'],
      rowType: 'database-row',
      rowProperties: { 'prop-title': 'First' },
      databaseType: 'database',
      databaseTitle: 'Renamed',
      renderedTitle: 'Renamed',
      ok: true,
    });
  });

  it('01 §3.3: typing still being saved is in the snapshot', async () => {
    const Blok = await boot(two());
    const session = createEditorAgentSession(Blok, actor);

    await session.read();
    const block = Blok.BlockManager.getBlockById('b');
    const input = inputOf(Blok, 'b');
    const text = input.firstChild;

    if (block === undefined || !(text instanceof Text) || text.data !== 'Beta') {
      throw new Error('Fixture has no Beta text node to type into');
    }

    let readStarted = false;
    const started = new Promise<{
      view: ReturnType<typeof session.read>;
      hadPendingSave: boolean;
    }>(resolve => {
      const onMutation = (): void => {
        if (readStarted) {
          return;
        }
        readStarted = true;

        let alreadySettled = false;
        const stop = Blok.YjsManager.onPendingBlockWritesSettled(() => {
          alreadySettled = true;
        });

        stop();
        resolve({
          view: session.read({ ids: ['b'], detail: 'full' }),
          hadPendingSave: !alreadySettled,
        });
      };

      block.on('didMutated', onMutation);
      unsubscribe.push(() => block.off('didMutated', onMutation));
    });

    text.appendData(' typed');
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: ' typed',
    }));

    const observed = await started;
    const view = await observed.view;

    expect({
      snapshotText: view.blocks.find(entry => entry.id === 'b')?.data?.text,
      readDuringPendingSave: observed.hadPendingSave,
    }).toEqual({
      snapshotText: [{ text: 'Beta typed' }],
      readDuringPendingSave: true,
    });
  });
});
