// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { createEditorAgentSession, liveContractSource } from '../../../src/components/modules/agent/editor-session';
import { askAiSessionOptions } from '../../../src/components/modules/api/agent-session-options';
import { Listeners } from '../../../src/components/utils/listeners';
import { destroy as destroyTooltip } from '../../../src/components/utils/tooltip';
import { Audio, Bold, Bookmark, Callout, Code, Column, ColumnList, Database, DatabaseRow, Embed, File, Header, Image, Italic, List, Paragraph, Quote, Table, TabsTool, TabTool, Toggle, Video } from '../../../src/tools';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { AgentActor, AgentSession } from '../../../types/agent';
import { callerChosenIds, expectationFor, hostServicesFor, loadParityCases } from './parity/corpus';
import { normalizeForParity } from './parity/normalize';
import { compareToGolden, runCorpusCase } from './parity/run-case';

// Each batch re-renders through real Core in jsdom. A 12-batch table case grows the grid
// to 5×5 and takes about 5 s, just past vitest's default.
const CASE_TIMEOUT_MS = 30_000;
const actor: AgentActor = { id: 'agent-test', name: 'Parity', kind: 'agent' };
const cases = loadParityCases();
let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let session: AgentSession | undefined;
let cleanupStarted = false;
const unsubscribers = new Set<() => void>();

const reflectInputs = (root: HTMLElement): void => {
  // jsdom does not reflect the property onto the attribute core queries.
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element instanceof HTMLElement &&
        (element.contentEditable === 'true' || element.contentEditable === 'false')) {
      element.setAttribute('contenteditable', element.contentEditable);
    }
  }
};

class FixtureParagraph extends Paragraph {
  public render(): HTMLDivElement {
    const element = super.render();

    reflectInputs(element);

    return element;
  }
}

class FixtureHeader extends Header {
  public render(): HTMLElement {
    const element = super.render();

    reflectInputs(element);

    return element;
  }
}

class FixtureQuote extends Quote {
  public render(): HTMLQuoteElement {
    const element = super.render();

    reflectInputs(element);

    return element;
  }
}

class FixtureToggle extends Toggle {
  public render(): HTMLElement {
    const element = super.render();

    reflectInputs(element);

    return element;
  }
}

const settle = async (editor: BlokModules, activeSession: AgentSession): Promise<void> => {
  await activeSession.read();
  let writesSettled = false;
  const unsubscribe = editor.YjsManager.onPendingBlockWritesSettled(() => {
    writesSettled = true;
  });

  unsubscribers.add(unsubscribe);
  try {
    editor.YjsManager.flushPendingBlockWrites();
    await vi.waitFor(() => {
      expect(writesSettled).toBe(true);
      expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
      expect(editor.BlockManager.suppressStopCapturing).toBe(false);
    });
    await activeSession.read();
  } finally {
    unsubscribe();
    unsubscribers.delete(unsubscribe);
  }
};

const hasDestroy = (owner: unknown): owner is { destroy(): void | Promise<void> } =>
  typeof owner === 'object' && owner !== null &&
  'destroy' in owner && typeof owner.destroy === 'function';

const removeModuleListeners = (owner: unknown): void => {
  if (typeof owner === 'object' && owner !== null &&
      'listeners' in owner && owner.listeners instanceof Listeners) {
    owner.listeners.removeAll();
  }
};

const waitForReady = async (instance: Core): Promise<void> => {
  const timer: { id?: ReturnType<typeof setTimeout> } = {};

  try {
    await Promise.race([
      instance.isReady.catch(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timer.id = setTimeout(() => {
          reject(new Error('Editor readiness timed out during teardown.'));
        }, 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer.id);
  }
};

const teardownCore = async (instance: Core, clean: (run: () => unknown) => Promise<void>): Promise<void> => {
  await clean(() => waitForReady(instance));
  const modules = Object.values<BlokModules[keyof BlokModules]>({ ...instance.moduleInstances });

  // Mark all modules before teardown can call into another module.
  for (const module of modules) {
    await clean(() => module.markDestroyed());
  }
  for (const module of modules) {
    await clean(() => (hasDestroy(module) ? module.destroy() : undefined));
    await clean(() => removeModuleListeners(module));
  }
  await clean(destroyTooltip);
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanupStarted = false;
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(async () => {
  cleanupStarted = true;
  const failures: unknown[] = [];
  const clean = async (run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures.push(error);
    }
  };

  try {
    await clean(() => session?.close());
    for (const unsubscribe of unsubscribers) {
      await clean(unsubscribe);
    }
    unsubscribers.clear();

    if (core !== undefined) {
      await teardownCore(core, clean);
    }
  } finally {
    core = undefined;
    session = undefined;
    await clean(() => holder?.remove());
    holder = undefined;
    await clean(() => document.getSelection()?.removeAllRanges());
    await clean(() => vi.restoreAllMocks());
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Editor parity teardown failed.');
  }
});

it('has corpus cases to exercise', () => {
  expect(cases.length).toBeGreaterThan(0);
});

describe.each(cases)('editor runner: $name', (c) => {
  it('matches its literal expectation and reviewed golden through real Core', async () => {
    if (holder === undefined) {
      throw new Error('Editor parity holder is missing.');
    }
    const saveErrors: Error[] = [];
    const instance = new Core({
      holder,
      onError: (error, context) => {
        if (context.source === 'save') {
          saveErrors.push(error);
        }
      },
      tabSync: false,
      // A configured user is how the editor credits a block to the human, so the corpus sees a wrong creator.
      user: { id: 'human-1' },
      dataModel: 'hierarchical',
      i18n: { locale: 'en' },
      tools: {
        paragraph: { class: FixtureParagraph },
        header: { class: FixtureHeader },
        toggle: { class: FixtureToggle },
        quote: { class: FixtureQuote },
        list: { class: List },
        code: { class: Code },
        table: { class: Table },
        image: { class: Image },
        file: { class: File },
        audio: { class: Audio },
        video: { class: Video },
        embed: { class: Embed },
        bookmark: { class: Bookmark },
        database: { class: Database },
        'database-row': { class: DatabaseRow },
        callout: { class: Callout },
        column_list: { class: ColumnList },
        column: { class: Column },
        tabs: { class: TabsTool },
        tab: { class: TabTool },
        bold: { class: Bold },
        italic: { class: Italic },
      },
      data: c.seed,
    });

    core = instance;
    await instance.isReady;
    if (cleanupStarted || core !== instance) {
      throw new Error('Editor parity boot completed after teardown began.');
    }
    const editor = instance.moduleInstances;
    const services = hostServicesFor(c);
    // Ask AI's own options, so the corpus also checks its per-turn undo merging.
    const activeSession = createEditorAgentSession(editor, actor, askAiSessionOptions({
      contractSource: liveContractSource(editor, { services: services.names }),
      services: services.impl,
    }));

    session = activeSession;
    await settle(editor, activeSession);
    const outcome = await runCorpusCase(activeSession, c);

    await settle(editor, activeSession);
    if (c.name === '01-delete-everything') {
      expect(editor.BlockManager.blocks.map(block => block.id)).toEqual([]);
    }
    expect(outcome).toEqual(expectationFor(c, 'editor'));
    const saved = await editor.Saver.save({ dialect: 'host' });

    if (saved === undefined) {
      throw new Error(`${c.name}: Saver.save returned no document.`, { cause: saveErrors.at(-1) });
    }
    if (c.name === '01-delete-everything') {
      expect(saved.blocks).toEqual([]);
    }
    expect(process.env.BLOK_UPDATE_GOLDENS, 'Only the json runner generates goldens.').not.toBe('1');
    compareToGolden(c, normalizeForParity(saved, callerChosenIds(c)));
  }, CASE_TIMEOUT_MS);
});
