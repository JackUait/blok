import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { DatabaseData, DatabaseSavedAutomations } from '../../../../src/tools/database/types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildTool, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();
    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }
    destroy(): void {}
  },
}));

/** The toolbox entry's insert data (built-in-statics.ts). */
const SEED = { initialView: 'table' } as unknown as DatabaseData;

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc === null) throw new Error('DocumentStore has no Y.Doc');
  doc.clientID = clientId;

  return store;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const dataOf = (store: DocumentStore): DatabaseData =>
  (store.toJSON().find((block) => block.id === 'db')?.data ?? {}) as DatabaseData;

/** Core's sync writes each saved key with updateBlockData; equal keys are no-ops there. */
const persist = (tool: DatabaseTool, el: HTMLElement, store: DocumentStore): void => {
  for (const [key, value] of Object.entries(tool.save(el))) {
    store.updateBlockData('db', key, value);
  }
};

const byTestId = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

  if (element === null) throw new Error(`missing ${id}`);
  return element;
};

/** The settings panel's automation builder, by test id: the harness i18n returns raw keys. */
const createDefinition = (el: HTMLElement, name: string): void => {
  const settings = el.querySelector<HTMLElement>('[data-blok-testid="database-toolbar-settings"]');

  if (settings === null) throw new Error('missing settings button');
  settings.click();
  byTestId('database-settings-automations').click();
  byTestId('database-automation-new').click();
  const field = byTestId('database-automation-name') as HTMLInputElement;

  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  byTestId('database-automation-add-trigger').click();
  byTestId('database-automation-choice-page-added').click();
  byTestId('database-automation-add-action').click();
  byTestId('database-automation-choice-edit-property').click();
  byTestId('database-automation-create').click();
};

const namesOf = (automations: DatabaseSavedAutomations | undefined): string[] =>
  (automations?.definitions ?? []).map((definition) => definition.name);

describe('DatabaseTool — automations slot is born with the database', () => {
  const tools: DatabaseTool[] = [];

  /** One peer at a time owns the page, so the builder's test ids stay unique. */
  const peer = (data: DatabaseData): { tool: DatabaseTool; el: HTMLElement } => {
    tools.forEach((tool) => tool.destroy());
    tools.length = 0;
    document.body.innerHTML = '';
    const built = buildTool(makeDoc([]), {}, data);

    tools.push(built.tool);
    return built;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.forEach((tool) => tool.destroy());
    tools.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a database made from the toolbox seed saves an empty automations slot', () => {
    const { tool, el } = peer(SEED);

    expect(tool.save(el).automations).toEqual({ version: 1, definitions: [] });
  });

  it('a database loaded without automations saves an empty slot on its next save', () => {
    const { tool, el } = peer(tableData());

    expect(tool.save(el).automations).toEqual({ version: 1, definitions: [] });
  });

  it('keeps both definitions two peers first add to a database made from the seed', () => {
    const storeA = createStore(1);
    const storeB = createStore(2);

    storeA.fromJSON([{ id: 'db', type: 'database', data: SEED }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
    const a = peer(SEED);

    // rendered() saves the seed once; that save is the one that births the slot.
    persist(a.tool, a.el, storeA);
    sync(storeA, storeB);
    createDefinition(a.el, 'From A');
    persist(a.tool, a.el, storeA);
    const b = peer(dataOf(storeB));

    createDefinition(b.el, 'From B');
    persist(b.tool, b.el, storeB);
    sync(storeA, storeB);

    expect(namesOf(dataOf(storeA).automations)).toEqual(expect.arrayContaining(['From A', 'From B']));
    expect(dataOf(storeB).automations).toEqual(dataOf(storeA).automations);
    expect(namesOf(dataOf(storeA).automations)).toHaveLength(2);
  });

  it('a definition the builder creates already carries its triggers and actions', () => {
    const { tool, el } = peer(tableData());

    createDefinition(el, 'Pinned');
    const [definition] = tool.save(el).automations?.definitions ?? [];

    expect(definition?.triggers).toHaveLength(1);
    expect(definition?.actions).toHaveLength(1);
  });
});
