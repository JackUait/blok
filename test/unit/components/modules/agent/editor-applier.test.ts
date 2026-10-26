import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { Block } from '../../../../../src/components/block';
import { ConvertConflictError } from '../../../../../src/components/errors/convert-conflict';
import { EditorApplier } from '../../../../../src/components/modules/agent/editor-applier';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { CalloutTool } from '../../../../../src/tools/callout';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';
import { applyEdits } from '../../../../../src/shared/agent/json-applier';
import { AgentFailure } from '../../../../../src/shared/agent/errors';
import type { Plan } from '../../../../../src/shared/agent/types';
import { Header, Paragraph, Table, Toggle } from '../../../../../src/tools';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { AgentActor, Edit } from '../../../../../types/agent';
import type { ToolSanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { OutputData } from '../../../../../types/data-formats/output-data';
import type { BlockTool, BlockToolConstructorOptions } from '../../../../../types/tools/block-tool';

interface UpdateGate {
  entered: Promise<void>;
  waiting: Promise<void>;
  payload?: Record<string, unknown>;
  enter(): void;
  release(): void;
}

let holder: HTMLDivElement | undefined;
let core: Core | undefined;
let appliers: EditorApplier[] = [];
let gates: UpdateGate[] = [];
let pending: Promise<void>[] = [];

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const tag = { actorId: 'agent-1', sessionId: 's1' };

class RecordTool implements BlockTool {
  public static readonly isReadOnlySupported = true;
  public static readonly richTextFields = ['text'];
  public static readonly conversionConfig = { export: 'text', import: 'text' };
  public static updateGate: UpdateGate | undefined;

  public static get sanitize(): ToolSanitizerConfig {
    return { text: { b: true, strong: true, i: true, em: true, br: true }, extra: 'plaintext' };
  }

  private data: Record<string, unknown>;
  private readonly element = document.createElement('div');

  public constructor({ data, readOnly }: BlockToolConstructorOptions<Record<string, unknown>, Record<string, unknown>>) {
    this.data = { ...data };
    this.setReadOnly(readOnly);
    this.element.innerHTML = typeof data.text === 'string' ? data.text : '';
  }

  public render(): HTMLElement {
    return this.element;
  }

  public save(): Record<string, unknown> {
    return { ...this.data, text: this.element.innerHTML };
  }

  public async setData(data: Record<string, unknown>): Promise<boolean> {
    const gate = RecordTool.updateGate;

    RecordTool.updateGate = undefined;
    if (gate !== undefined) {
      gate.payload = { ...data };
      gate.enter();
      await gate.waiting;
    }
    this.data = { ...data };
    this.element.innerHTML = typeof data.text === 'string' ? data.text : '';

    return true;
  }

  public setReadOnly(state: boolean): void {
    this.element.setAttribute('contenteditable', state ? 'false' : 'true');
  }
}

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null &&
  'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null &&
  'destroy' in value && typeof value.destroy === 'function';
const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  typeof value === 'object' && value !== null && 'listeners' in value &&
  typeof value.listeners === 'object' && value.listeners !== null &&
  'removeAll' in value.listeners && typeof value.listeners.removeAll === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);
  const jobs: Array<void | Promise<void>> = [];

  // Stop async work in every module before destroying dependencies.
  modules.filter(hasMarkDestroyed).forEach(module => module.markDestroyed());
  for (const module of modules) {
    if (hasDestroy(module)) {
      jobs.push(module.destroy());
    }
    if (hasListeners(module)) {
      module.listeners.removeAll();
    }
  }
  destroyTooltip();
  await Promise.all(jobs);
};

const tick = async (): Promise<void> => {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
};

const initial = (): OutputData => ({
  title: 'Original',
  blocks: [
    { id: 'p', type: 'paragraph', data: { text: 'Hello' }, lastEditedAt: 101, lastEditedBy: 'human' },
    { id: 'tg', type: 'toggle', data: { text: 'T' }, content: ['k'], lastEditedAt: 102, lastEditedBy: 'human' },
    { id: 'k', type: 'paragraph', data: { text: 'K' }, parent: 'tg', lastEditedAt: 103, lastEditedBy: 'human' },
    { id: 'r', type: 'record', data: { text: 'Record', extra: 'keep' }, lastEditedAt: 104, lastEditedBy: 'human' },
  ],
});

const boot = async (data = initial()): Promise<BlokModules> => {
  if (holder === undefined || core !== undefined) {
    throw new Error('The editor fixture is not ready to boot.');
  }
  const instance = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    user: { id: 'human', name: 'Human' },
    tools: {
      paragraph: { class: Paragraph },
      header: { class: Header },
      toggle: { class: Toggle },
      table: { class: Table },
      callout: { class: CalloutTool },
      record: { class: RecordTool, inlineToolbar: false },
      recordCopy: { class: RecordTool, inlineToolbar: false },
    },
    data,
  });

  core = instance;
  await instance.isReady;
  await vi.waitFor(() => {
    expect(instance.moduleInstances.BlockManager.isSyncingFromYjs).toBe(false);
  });
  await tick();

  return instance.moduleInstances;
};

const createApplier = (modules: BlokModules): EditorApplier => {
  const applier = new EditorApplier(modules, { actor, sessionId: 's1', turnId: 't1' });

  appliers.push(applier);

  return applier;
};

const plan = (edits: Edit[], touched: string[]): Plan => ({
  edits, results: [], refs: {},
  changed: { created: [], updated: [], moved: [], removed: [] },
  warnings: [], touched: new Set(touched),
});

const apply = (applier: EditorApplier, edits: Edit[], touched: string[]): Promise<void> => {
  const draft = applier.snapshot().clone();

  // The applier receives the final draft; expectations stay literal.
  applyEdits(draft, edits, { actorId: actor.id, at: Date.now() });

  return applier.apply(plan(edits, touched), draft);
};

const requireBlock = (modules: BlokModules, id: string): Block => {
  const block = modules.BlockManager.getBlockById(id);

  if (block === undefined) {
    throw new Error(`The fixture is missing block "${id}".`);
  }

  return block;
};

const saved = async (modules: BlokModules): Promise<OutputData> => {
  const output = await modules.Saver.save();

  if (output === undefined) {
    throw new Error('The ready editor did not save.');
  }

  return output;
};

const settle = async (applier: EditorApplier): Promise<void> => {
  await tick();
  await applier.settle();
  await tick();
};

const stamped = (modules: BlokModules, ids: string[], since: number): void => {
  const output = modules.YjsManager.toJSON();

  for (const id of ids) {
    const stored = output.find(block => block.id === id);
    const live = requireBlock(modules, id);
    const at = stored?.lastEditedAt;

    expect(stored?.lastEditedBy).toBe('agent-1');
    expect(typeof at).toBe('number');
    if (typeof at !== 'number') {
      throw new Error('The inserted block has no persisted edit timestamp.');
    }
    expect(at).toBeGreaterThanOrEqual(since);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(live.lastEditedBy).toBe('agent-1');
    expect(live.lastEditedAt).toBe(at);
  }
};

const updateGate = (): UpdateGate => {
  let enter = (): void => {};
  let release = (): void => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const gate = { entered, waiting, enter, release };

  gates.push(gate);

  return gate;
};

const selectRecordText = (modules: BlokModules): { selection: Selection; node: Text } => {
  const input = requireBlock(modules, 'r').firstInput;
  const node = input?.firstChild;
  const selection = document.getSelection();

  if (input === undefined || !(node instanceof Text) || selection === null) {
    throw new Error('The real record input is missing a text selection.');
  }
  input.focus();
  const range = document.createRange();

  range.setStart(node, 1);
  range.setEnd(node, 4);
  selection.removeAllRanges();
  selection.addRange(range);

  return { selection, node };
};

describe('EditorApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    RecordTool.updateGate = undefined;
    appliers = [];
    gates = [];
    pending = [];
  });

  afterEach(async () => {
    for (const gate of gates) {
      gate.release();
    }
    await Promise.allSettled(pending);
    for (const applier of appliers) {
      applier.dispose();
    }
    try {
      if (core !== undefined) {
        await core.isReady.catch(() => undefined);
        await destroyCore(core);
      }
    } finally {
      core = undefined;
      RecordTool.updateGate = undefined;
      holder?.remove();
      holder = undefined;
      document.getSelection()?.removeAllRanges();
      vi.restoreAllMocks();
    }
  });

  it('exposes current snapshots, read-only state and a disposable document revision', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    expect(applier.runtime).toBe('editor');
    expect(applier.revision()).toBe('e0');
    expect(applier.snapshot().get('p')?.data.text).toEqual([{ text: 'Hello' }]);
    expect(applier.isReadOnly()).toBe(false);
    modules.YjsManager.setPageField('title', 'Changed', { record: false });
    expect(applier.revision()).toBe('e1');
    expect(applier.snapshot().title).toBe('Changed');
    await modules.ReadOnly.toggle(true);
    expect(applier.isReadOnly()).toBe(true);
    await modules.ReadOnly.toggle(false);
    expect(applier.isReadOnly()).toBe(false);
    await applier.settle();

    applier.dispose();
    const revision = applier.revision();

    modules.YjsManager.setPageField('title', 'After disposal', { record: false });
    expect(applier.revision()).toBe(revision);
    expect(applier.snapshot().title).toBe('After disposal');
  });

  it('persists live insert metadata and a tree plus tune edits as one undo step', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const before = applier.snapshot().toOutput();
    const since = Date.now();

    await apply(applier, [
      { op: 'insert', parentId: null, afterId: 'p', block: {
        id: 'n', type: 'toggle', data: { text: [{ text: 'N' }] },
        tunes: { absentTune: { value: 'seed' } },
        children: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'Child', marks: { bold: true } }] }, children: [] }],
      } },
      { op: 'setTunes', id: 'n', tunes: { absentTune: { value: 'changed' } } },
    ], ['n', 'n1']);

    stamped(modules, ['n', 'n1'], since);
    expect(modules.BlockManager.suppressStopCapturing).toBe(false);
    expect(modules.YjsManager.toJSON().map(block => block.id)).toEqual(['p', 'n', 'n1', 'tg', 'k', 'r']);
    expect(applier.snapshot().get('n')?.content).toEqual(['n1']);
    expect(applier.snapshot().get('n1')?.parent).toBe('n');
    expect((await saved(modules)).blocks.find(block => block.id === 'n')?.tunes?.absentTune).toEqual({ value: 'changed' });
    expect(applier.snapshot().get('r')?.rest.lastEditedBy).toBe('human');
    expect(requireBlock(modules, 'n1').pluginsContent.querySelector('b, strong')?.textContent).toBe('Child');
    expect((await saved(modules)).blocks.find(block => block.id === 'n1')?.data.text).toEqual([
      { text: 'Child', marks: { bold: true } },
    ]);

    const token = applier.lastStepToken();

    expect(token).toBeDefined();
    expect(modules.YjsManager.topUndoToken()).toBe(token);
    expect(modules.YjsManager.undoStepTag(token)).toEqual(tag);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().toOutput()).toEqual(before);
    expect(modules.YjsManager.canUndo()).toBe(false);
    expect(modules.YjsManager.topRedoToken()).toBe(token);
    modules.YjsManager.redo();
    await settle(applier);
    expect(applier.snapshot().childrenOf('n')).toEqual(['n1']);
    expect(modules.YjsManager.undoStepTag(modules.YjsManager.topUndoToken())).toEqual(tag);
  });

  it('resolves start and after slots under an existing parent and removes a leaf', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    await apply(applier, [
      { op: 'insert', parentId: 'tg', afterId: 'k', block: {
        id: 'n', type: 'paragraph', data: { text: [{ text: 'After K' }] },
        children: [
          { id: 'n1', type: 'paragraph', data: { text: [{ text: 'One' }] }, children: [] },
          { id: 'n2', type: 'paragraph', data: { text: [{ text: 'Two' }] }, children: [] },
        ],
      } },
      { op: 'insert', parentId: 'tg', afterId: null, block: {
        id: 'first', type: 'paragraph', data: { text: [{ text: 'First' }] }, children: [],
      } },
      { op: 'remove', id: 'k', withChildren: false },
    ], ['tg', 'n', 'n1', 'n2', 'first', 'k']);

    expect(applier.snapshot().childrenOf('tg')).toEqual(['first', 'n']);
    expect(applier.snapshot().childrenOf('n')).toEqual(['n1', 'n2']);
    expect(modules.YjsManager.toJSON().map(block => block.id)).toEqual(['p', 'tg', 'first', 'n', 'n1', 'n2', 'r']);
    expect(modules.BlockManager.getBlockById('k')).toBeUndefined();
    expect(requireBlock(modules, 'n1').parentId).toBe('n');
    expect(requireBlock(modules, 'n2').parentId).toBe('n');
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().childrenOf('tg')).toEqual(['k']);
    expect(modules.YjsManager.toJSON().map(block => block.id)).toEqual(['p', 'tg', 'k', 'r']);
  });

  it('keeps self-placed siblings, descendant parents, tunes and metadata in a real table', async () => {
    const data = initial();

    data.blocks.unshift(
      { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['cell'] }]] }, content: ['cell'] },
      { id: 'cell', type: 'paragraph', data: { text: 'Cell' }, parent: 'tbl' }
    );
    const modules = await boot(data);
    const applier = createApplier(modules);
    const since = Date.now();

    await apply(applier, [
      { op: 'insert', parentId: 'tbl', afterId: 'cell', block: {
        id: 'n', type: 'paragraph', data: { text: [{ text: 'Nested' }] },
        tunes: { absentTune: { value: 'root' } },
        children: [
          { id: 'n1', type: 'paragraph', data: { text: [{ text: 'One' }] }, tunes: { absentTune: { value: 'child' } }, children: [] },
          { id: 'n2', type: 'paragraph', data: { text: [{ text: 'Two' }] }, children: [] },
        ],
      } },
      { op: 'insert', parentId: 'tbl', afterId: 'n', block: {
        id: 's', type: 'paragraph', data: { text: [{ text: 'Sibling' }] }, children: [],
      } },
    ], ['tbl', 'n', 'n1', 'n2', 's']);

    expect(applier.snapshot().childrenOf('n')).toEqual(['n1', 'n2']);
    expect(applier.snapshot().childrenOf('tbl')).toEqual(['cell', 'n', 's']);
    expect(requireBlock(modules, 'n1').parentId).toBe('n');
    expect(requireBlock(modules, 'n2').parentId).toBe('n');
    const cell = requireBlock(modules, 'cell').holder.parentElement;

    expect(requireBlock(modules, 'n').holder.parentElement).toBe(cell);
    expect(requireBlock(modules, 's').holder.parentElement).toBe(cell);
    const output = await saved(modules);

    expect(output.blocks.find(block => block.id === 'n')?.tunes?.absentTune).toEqual({ value: 'root' });
    expect(output.blocks.find(block => block.id === 'n1')?.tunes?.absentTune).toEqual({ value: 'child' });
    stamped(modules, ['n', 'n1', 'n2', 's'], since);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().childrenOf('tbl')).toEqual(['cell']);
    expect(modules.BlockManager.getBlockById('n')).toBeUndefined();
    expect(modules.BlockManager.getBlockById('s')).toBeUndefined();
  });

  it.each([
    { path: 'in-place', tunes: undefined },
    { path: 'recompose', tunes: {} },
  ])('keeps public explicit undefined behavior on the $path path', async ({ path, tunes }) => {
    const modules = await boot();
    const original = requireBlock(modules, 'r');
    const updated = await modules.API.methods.blocks.update('r', { extra: undefined }, tunes);

    expect((await requireBlock(modules, 'r').save())?.data).toHaveProperty('extra', undefined);
    expect(updated.holder === original.holder).toBe(path === 'in-place');
    expect(modules.YjsManager.toJSON().find(block => block.id === 'r')?.data).toEqual({ text: 'Record' });
  });

  it.each([
    { path: 'in-place', tunes: undefined },
    { path: 'recompose', tunes: {} },
  ])('deletes an internal delete-only key from the live tool and save-back on the $path path', async ({ path, tunes }) => {
    const modules = await boot();
    const original = requireBlock(modules, 'r');

    modules.YjsManager.beginApiCall();
    const updated = await modules.BlockManager.update(original, undefined, tunes, undefined, ['extra']);

    expect((await updated.save())?.data).not.toHaveProperty('extra');
    expect(updated === original).toBe(path === 'in-place');
    expect(modules.YjsManager.toJSON().find(block => block.id === 'r')?.data).toEqual({ text: 'Record' });
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data).toEqual({ text: [{ text: 'Record' }] });

    await tick();
    updated.dispatchChange();
    await new Promise<void>(resolve => {
      modules.YjsManager.onPendingBlockWritesSettled(resolve);
    });
    modules.YjsManager.flushPendingBlockWrites();

    expect((await updated.save())?.data).not.toHaveProperty('extra');
    expect(modules.YjsManager.toJSON().find(block => block.id === 'r')?.data).not.toHaveProperty('extra');
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data).not.toHaveProperty('extra');
    expect(modules.YjsManager.toJSON().find(block => block.id === 'r')?.data).toEqual({ text: 'Record' });
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data).toEqual({ text: [{ text: 'Record' }] });
  });

  it('deletes null keys from the live tool and later saves and restores them on undo', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    await apply(applier, [{ op: 'setData', id: 'r', patch: { extra: null } }], ['r']);

    expect((await requireBlock(modules, 'r').save())?.data).not.toHaveProperty('extra');
    expect(applier.snapshot().get('r')?.data).not.toHaveProperty('extra');
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data).not.toHaveProperty('extra');
    requireBlock(modules, 'r').dispatchChange();
    await settle(applier);
    expect(modules.YjsManager.toJSON().find(block => block.id === 'r')?.data).not.toHaveProperty('extra');

    modules.YjsManager.undo();
    await settle(applier);
    expect((await requireBlock(modules, 'r').save())?.data.extra).toBe('keep');
    expect(applier.snapshot().get('r')?.data.extra).toBe('keep');
    modules.YjsManager.redo();
    await settle(applier);
    expect((await requireBlock(modules, 'r').save())?.data).not.toHaveProperty('extra');
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data).not.toHaveProperty('extra');
  });

  it('attributes every moved block without stamping an untouched sibling and replays placement', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const before = applier.snapshot().toOutput();
    const untouched = requireBlock(modules, 'k').lastEditedAt;

    await apply(applier, [
      { op: 'move', id: 'p', parentId: 'tg', afterId: 'k' },
      { op: 'move', id: 'r', parentId: 'tg', afterId: 'p' },
    ], ['p', 'r']);

    expect(modules.YjsManager.toJSON().filter(block => block.id === 'p' || block.id === 'r').map(block => block.lastEditedBy)).toEqual(['agent-1', 'agent-1']);
    expect(requireBlock(modules, 'p').lastEditedBy).toBe('agent-1');
    expect(requireBlock(modules, 'r').lastEditedBy).toBe('agent-1');
    expect(requireBlock(modules, 'k').lastEditedAt).toBe(untouched);
    expect(requireBlock(modules, 'k').lastEditedBy).toBe('human');
    expect(applier.snapshot().childrenOf('tg')).toEqual(['k', 'p', 'r']);
    const token = applier.lastStepToken();

    expect(token).toBeDefined();
    expect(modules.YjsManager.undoStepTag(token)).toEqual(tag);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().toOutput()).toEqual(before);
    modules.YjsManager.redo();
    await settle(applier);
    expect(applier.snapshot().childrenOf('tg')).toEqual(['k', 'p', 'r']);
    expect(modules.YjsManager.undoStepTag(modules.YjsManager.topUndoToken())).toEqual(tag);
  });

  it('holds one step across a real awaited update, same-ID conversion, rich edit and title', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const before = applier.snapshot().toOutput();
    const gate = updateGate();
    let finished = false;

    RecordTool.updateGate = gate;
    const applying = apply(applier, [
      { op: 'setData', id: 'r', patch: { text: [{ text: 'Intermediate' }] } },
      { op: 'replaceType', id: 'r', type: 'header', data: { text: [{ text: 'Heading' }], level: 3 } },
      { op: 'setRichText', id: 'r', field: 'text', value: [{ text: 'Final', marks: { bold: true } }] },
      { op: 'setPageField', key: 'title', value: 'Agent title' },
    ], ['r']).then(() => { finished = true; });

    pending.push(applying);
    await Promise.race([gate.entered, applying]);
    expect(finished).toBe(false);
    expect(gate.payload).toEqual({ text: 'Intermediate', extra: 'keep' });
    expect(applier.snapshot().title).toBe('Original');
    gate.release();
    await applying;

    expect(modules.BlockManager.suppressStopCapturing).toBe(false);
    expect(applier.snapshot().get('r')).toMatchObject({
      type: 'header', data: { level: 3, text: [{ text: 'Final', marks: { bold: true } }] },
    });
    expect(applier.snapshot().title).toBe('Agent title');
    expect(requireBlock(modules, 'r').pluginsContent.textContent).toBe('Final');
    expect(requireBlock(modules, 'r').pluginsContent.querySelector('b, strong')?.textContent).toBe('Final');
    expect((await saved(modules)).blocks.find(block => block.id === 'r')?.data.text).toEqual([
      { text: 'Final', marks: { bold: true } },
    ]);
    const token = applier.lastStepToken();

    expect(token).toBeDefined();
    expect(modules.YjsManager.topUndoToken()).toBe(token);
    expect(modules.YjsManager.undoStepTag(token)).toEqual(tag);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().toOutput()).toEqual(before);
    expect(modules.YjsManager.canUndo()).toBe(false);
    modules.YjsManager.redo();
    await settle(applier);
    expect(applier.snapshot().get('r')?.type).toBe('header');
    expect(applier.snapshot().get('r')?.data.text).toEqual([{ text: 'Final', marks: { bold: true } }]);
    expect(applier.snapshot().title).toBe('Agent title');
  });

  it('rolls back only a failed batch and keeps an earlier batch from the same session', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    modules.YjsManager.setPageField('title', 'Human title');
    await tick();
    await apply(applier, [{ op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Earlier agent' }] }], ['p']);
    const earlier = applier.lastStepToken();
    const before = applier.snapshot().toOutput();

    await expect(apply(applier, [
      { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Failed batch' }] },
      { op: 'replaceType', id: 'k', type: 'not-registered', data: {} },
    ], ['p', 'k'])).rejects.toThrow();

    await settle(applier);
    expect(applier.snapshot().toOutput()).toEqual(before);
    expect(modules.YjsManager.topUndoToken()).toBe(earlier);
    expect(modules.YjsManager.undoStepTag(earlier)).toEqual(tag);
    expect(modules.BlockManager.suppressStopCapturing).toBe(false);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().get('p')?.data.text).toEqual([{ text: 'Hello' }]);
    expect(applier.snapshot().title).toBe('Human title');

    await modules.API.methods.blocks.update('p', { text: 'Later human' });
    await settle(applier);
    expect(modules.YjsManager.toJSON().find(block => block.id === 'p')?.lastEditedBy).toBe('human');
  });

  it('does not tag or claim an older human step for empty and unchanged plans', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    modules.YjsManager.setPageField('title', 'Human title');
    await tick();
    const human = modules.YjsManager.topUndoToken();

    expect(human).toBeDefined();
    await apply(applier, [], []);
    await apply(applier, [{ op: 'setPageField', key: 'title', value: 'Human title' }], []);
    expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
    expect(modules.YjsManager.topUndoToken()).toBe(human);
    expect(applier.lastStepToken()).toBeUndefined();
    expect(applier.snapshot().title).toBe('Human title');
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().title).toBe('Original');
  });

  it('leaves an older human step untagged and intact when the first edit throws', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    modules.YjsManager.setPageField('title', 'Human title');
    await tick();
    const human = modules.YjsManager.topUndoToken();

    expect(human).toBeDefined();
    await expect(apply(applier, [
      { op: 'replaceType', id: 'k', type: 'not-registered', data: {} },
    ], ['k'])).rejects.toThrow();
    await settle(applier);
    expect(applier.snapshot().title).toBe('Human title');
    expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
    expect(modules.YjsManager.topUndoToken()).toBe(human);
    expect(applier.lastStepToken()).toBeUndefined();
    expect(modules.BlockManager.suppressStopCapturing).toBe(false);
    modules.YjsManager.undo();
    await settle(applier);
    expect(applier.snapshot().title).toBe('Original');
    await modules.API.methods.blocks.update('k', { text: 'Later human' });
    await settle(applier);
    expect(modules.YjsManager.toJSON().find(block => block.id === 'k')?.lastEditedBy).toBe('human');
  });

  it('preserves its own text selection across a rich rewrite and actual tool replacement', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const { selection } = selectRecordText(modules);

    await apply(applier, [
      { op: 'setRichText', id: 'r', field: 'text', value: [{ text: 'Record', marks: { bold: true } }] },
    ], ['r']);

    expect(selection.toString()).toBe('eco');
    expect(selection.anchorOffset).toBe(1);
    expect(selection.focusOffset).toBe(4);
    expect(selection.anchorNode?.isConnected).toBe(true);
    expect(requireBlock(modules, 'r').pluginsContent.contains(selection.anchorNode)).toBe(true);
    expect(requireBlock(modules, 'r').pluginsContent.querySelector('b, strong')?.textContent).toBe('Record');
    const oldHolder = requireBlock(modules, 'r').holder;

    await apply(applier, [
      { op: 'replaceType', id: 'r', type: 'recordCopy', data: { text: [{ text: 'Record', marks: { italic: true } }] } },
    ], ['r']);

    expect(selection.toString()).toBe('eco');
    expect(selection.anchorOffset).toBe(1);
    expect(selection.focusOffset).toBe(4);
    expect(selection.anchorNode?.isConnected).toBe(true);
    expect(requireBlock(modules, 'r').pluginsContent.contains(selection.anchorNode)).toBe(true);
    expect(requireBlock(modules, 'r').name).toBe('recordCopy');
    expect(requireBlock(modules, 'r').holder).not.toBe(oldHolder);
  });

  it('does not steal a selection in an untouched block while rewriting and converting others', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const { selection, node } = selectRecordText(modules);

    await apply(applier, [
      { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Hello', marks: { bold: true } }] },
      { op: 'replaceType', id: 'k', type: 'header', data: { text: [{ text: 'K' }], level: 3 } },
    ], ['p', 'k']);

    expect(selection.anchorNode).toBe(node);
    expect(selection.focusNode).toBe(node);
    expect(selection.anchorOffset).toBe(1);
    expect(selection.focusOffset).toBe(4);
    expect(selection.toString()).toBe('eco');
    expect(node.isConnected).toBe(true);
    expect(applier.snapshot().get('p')?.data.text).toEqual([{ text: 'Hello', marks: { bold: true } }]);
    expect(applier.snapshot().get('k')?.type).toBe('header');
    expect(applier.snapshot().get('r')?.data.text).toEqual([{ text: 'Record' }]);
  });

  it('reports retryable CONFLICT and rolls back an insert before a refused conversion', async () => {
    const modules = await boot();
    const blocks = modules.API.methods.blocks;

    // Each API read creates a fresh facade.
    vi.spyOn(modules.BlocksAPI, 'methods', 'get').mockReturnValue(blocks);
    const applier = createApplier(modules);
    const seed = await saved(modules);
    const before = applier.snapshot().toOutput();
    const stored = modules.YjsManager.toJSON();
    let liveInsertAtRefusal = false;
    let storedInsertAtRefusal = false;

    vi.spyOn(modules.BlockManager, 'convert').mockImplementation(block => {
      liveInsertAtRefusal = modules.BlockManager.getBlockById('n')?.name === 'paragraph';
      storedInsertAtRefusal = modules.YjsManager.toJSON().some(stored => stored.id === 'n');

      return Promise.reject(new ConvertConflictError(block.id));
    });

    const rejection: unknown = await apply(applier, [
      { op: 'insert', parentId: null, afterId: 'p', block: {
        id: 'n', type: 'paragraph', data: { text: [{ text: 'Leading insert' }] }, children: [],
      } },
      { op: 'replaceType', id: 'p', type: 'header', data: {
        text: [{ text: 'Converted' }], level: 3,
      } },
    ], ['n', 'p']).catch((error: unknown) => error);

    expect(rejection).toMatchObject({
      error: {
        code: 'CONFLICT',
        retryable: true,
        message: 'Block «p» is being edited by someone else. Re-read the document before retrying.',
        details: { blockId: 'p' },
      },
    });
    expect(rejection).toBeInstanceOf(AgentFailure);
    expect(liveInsertAtRefusal).toBe(true);
    expect(storedInsertAtRefusal).toBe(true);
    await settle(applier);
    const output = await saved(modules);

    // Saver stamps each output with the current time.
    expect({ ...output, time: 0 }).toEqual({ ...seed, time: 0 });
    expect(applier.snapshot().toOutput()).toEqual(before);
    expect(modules.YjsManager.toJSON()).toEqual(stored);
    expect(modules.BlockManager.getBlockById('n')).toBeUndefined();
    expect(modules.BlockManager.suppressStopCapturing).toBe(false);
  });

  it('refuses a planned convert into a tool that cannot import, as blocks.convert does', async () => {
    const modules = await boot();
    const applier = createApplier(modules);
    const seed = await saved(modules);

    const rejection: unknown = await apply(applier, [
      { op: 'replaceType', id: 'p', type: 'table', data: {} },
    ], ['p']).catch((error: unknown) => error);

    expect(rejection).toMatchObject({ error: { code: 'CONVERSION_UNSUPPORTED', details: { missing: ['Table'] } } });
    expect(rejection).toBeInstanceOf(AgentFailure);
    await settle(applier);
    expect({ ...(await saved(modules)), time: 0 }).toEqual({ ...seed, time: 0 });
  });

  it('does not roll back older human work when a peer makes the failed agent step refuse undo', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    modules.YjsManager.setPageField('title', 'Human title');
    await tick();
    const human = modules.YjsManager.topUndoToken();

    expect(human).toBeDefined();
    expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
    expect(applier.snapshot().title).toBe('Human title');
    expect(modules.YjsManager.topRedoToken()).toBeUndefined();

    const gate = updateGate();

    RecordTool.updateGate = gate;
    const applying = apply(applier, [
      { op: 'remove', id: 'p', withChildren: false },
      { op: 'insert', parentId: null, afterId: null, block: {
        id: 'n', type: 'paragraph', data: { text: [] }, children: [],
      } },
      { op: 'setData', id: 'r', patch: { text: [{ text: 'Intermediate' }] } },
      { op: 'replaceType', id: 'k', type: 'not-registered', data: {} },
    ], ['p', 'n', 'r', 'k']);
    const outcome = applying.then(
      () => ({ failed: false, error: undefined }),
      (error: unknown) => ({ failed: true, error })
    );
    const peer = new DocumentStore(new YBlockSerializer());

    pending.push(applying);
    try {
      await Promise.race([gate.entered, outcome]);
      expect(gate.payload).toEqual({ text: 'Intermediate', extra: 'keep' });
      expect(modules.BlockManager.getBlockById('p')).toBeUndefined();
      expect(requireBlock(modules, 'n').name).toBe('paragraph');
      expect(applier.snapshot().get('n')?.data.text).toEqual([]);
      const own = modules.YjsManager.topUndoToken();

      expect(own).toBeDefined();
      expect(own).not.toBe(human);
      expect(modules.YjsManager.undoStepTag(own)).toBeUndefined();

      peer.applyRemoteUpdate(modules.YjsManager.encodeStateAsUpdate(peer.getStateVector()));
      expect(peer.updateBlockData('n', 'text', [{ text: 'Peer' }])).toBe(true);
      modules.YjsManager.applyRemoteUpdate(
        peer.encodeStateAsUpdate(modules.YjsManager.getStateVector()),
        peer
      );
      await vi.waitFor(() => {
        expect(modules.BlockManager.isSyncingFromYjs).toBe(false);
        expect(requireBlock(modules, 'n').pluginsContent.textContent).toBe('Peer');
      });
      expect(applier.snapshot().get('n')?.data.text).toEqual([{ text: 'Peer' }]);
      expect(modules.YjsManager.topUndoToken()).toBe(own);
      expect(applier.snapshot().title).toBe('Human title');

      gate.release();
      const rejection = await outcome;

      await settle(applier);
      expect(applier.snapshot().title).toBe('Human title');
      expect(rejection.failed).toBe(true);
      expect(rejection.error).toBeInstanceOf(Error);
      expect(modules.YjsManager.topUndoToken()).toBe(own);
      expect(modules.YjsManager.undoStepTag(own)).toEqual(tag);
      expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
      expect(modules.YjsManager.topRedoToken()).toBeUndefined();
      expect(applier.lastStepToken()).toBeUndefined();
      expect(modules.BlockManager.getBlockById('p')).toBeUndefined();
      expect(applier.snapshot().get('n')?.data.text).toEqual([{ text: 'Peer' }]);
      expect(modules.BlockManager.suppressStopCapturing).toBe(false);
      expect(modules.YjsManager.canUndo()).toBe(true);

      modules.YjsManager.undo();
      await settle(applier);
      expect(applier.snapshot().title).toBe('Original');
      expect(modules.YjsManager.topUndoToken()).toBe(own);
      expect(modules.YjsManager.topRedoToken()).toBe(human);
      expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
      expect(applier.snapshot().get('n')?.data.text).toEqual([{ text: 'Peer' }]);
      modules.YjsManager.redo();
      await settle(applier);
      expect(applier.snapshot().title).toBe('Human title');
      expect(modules.YjsManager.undoStepTag(own)).toEqual(tag);
      expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
    } finally {
      gate.release();
      await outcome;
      peer.destroy();
    }
  });

  it('reports APPLY_FAILED, not a retryable CONFLICT, when a conversion conflict cannot be rolled back', async () => {
    const modules = await boot();
    const applier = createApplier(modules);

    modules.YjsManager.setPageField('title', 'Human title');
    await tick();
    const human = modules.YjsManager.topUndoToken();
    const gate = updateGate();
    const peer = new DocumentStore(new YBlockSerializer());
    const rollback = vi.spyOn(modules.YjsManager, 'undoStep');

    RecordTool.updateGate = gate;
    const applying = apply(applier, [
      { op: 'remove', id: 'p', withChildren: false },
      { op: 'insert', parentId: null, afterId: null, block: {
        id: 'n', type: 'paragraph', data: { text: [] }, children: [],
      } },
      { op: 'setData', id: 'r', patch: { text: [{ text: 'Intermediate' }] } },
      { op: 'replaceType', id: 'k', type: 'header', data: {
        text: [{ text: 'Converted' }], level: 3,
      } },
    ], ['p', 'n', 'r', 'k']);
    const outcome = applying.then(
      () => ({ failed: false, error: undefined }),
      (error: unknown) => ({ failed: true, error })
    );

    pending.push(applying);
    try {
      await Promise.race([gate.entered, outcome]);
      if (gate.payload === undefined) {
        throw new Error('The batch did not reach the record update gate.');
      }
      const own = modules.YjsManager.topUndoToken();

      peer.applyRemoteUpdate(modules.YjsManager.encodeStateAsUpdate(peer.getStateVector()));
      const insertedChanged = peer.updateBlockData('n', 'text', [{ text: 'Peer' }]);

      modules.YjsManager.applyRemoteUpdate(
        peer.encodeStateAsUpdate(modules.YjsManager.getStateVector()),
        peer
      );
      await vi.waitFor(() => {
        if (
          modules.BlockManager.isSyncingFromYjs ||
          requireBlock(modules, 'n').pluginsContent.textContent !== 'Peer'
        ) {
          throw new Error('The inserted block has not received the peer text.');
        }
      });

      const config = Header.conversionConfig;
      let importCalls = 0;
      let importedText: string | undefined;
      let sourceChanged: boolean | undefined;

      vi.spyOn(Header, 'conversionConfig', 'get').mockReturnValue({
        ...config,
        import: (text: string) => {
          importCalls++;
          importedText = text;
          peer.applyRemoteUpdate(modules.YjsManager.encodeStateAsUpdate(peer.getStateVector()));
          sourceChanged = peer.updateBlockData('k', 'text', [{ text: 'K peer' }]);
          modules.YjsManager.applyRemoteUpdate(
            peer.encodeStateAsUpdate(modules.YjsManager.getStateVector()),
            peer
          );

          return { text };
        },
      });

      gate.release();
      const rejection = await outcome;

      await settle(applier);
      const message = rejection.error instanceof AgentFailure
        ? rejection.error.error.message : String(rejection.error);

      // Keep the state controls running on the message regression.
      expect.soft(message).not.toMatch(/nothing was changed/i);
      expect(rejection.failed).toBe(true);
      expect(rejection.error).toBeInstanceOf(AgentFailure);
      expect(rejection.error).toMatchObject({
        error: {
          code: 'APPLY_FAILED', retryable: false,
          details: { cause: { code: 'CONFLICT', details: { blockId: 'k' } } },
        },
      });
      expect(message).toMatch(/may be partly changed/i);
      expect(importCalls).toBe(1);
      expect(importedText).toBe('K');
      expect(sourceChanged).toBe(true);
      expect(insertedChanged).toBe(true);
      expect(gate.payload).toEqual({ text: 'Intermediate', extra: 'keep' });
      expect(human).toBeDefined();
      expect(own).toBeDefined();
      expect(own).not.toBe(human);
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(rollback).toHaveBeenCalledWith(own);
      expect(rollback.mock.results).toEqual([{ type: 'return', value: false }]);
      const expectedStored = [
        { id: 'n', type: 'paragraph', parent: null, content: [], data: { text: 'Peer' } },
        { id: 'tg', type: 'toggle', parent: null, content: ['k'], data: { text: 'T' } },
        { id: 'k', type: 'paragraph', parent: 'tg', content: [], data: { text: 'K peer' } },
        { id: 'r', type: 'record', parent: null, content: [], data: { text: 'Intermediate', extra: 'keep' } },
      ];
      const expectedOutput = [
        { id: 'n', type: 'paragraph', parent: null, content: [], data: { text: [{ text: 'Peer' }] } },
        { id: 'tg', type: 'toggle', parent: null, content: ['k'], data: { text: [{ text: 'T' }] } },
        { id: 'k', type: 'paragraph', parent: 'tg', content: [], data: { text: [{ text: 'K peer' }] } },
        { id: 'r', type: 'record', parent: null, content: [], data: { text: [{ text: 'Intermediate' }], extra: 'keep' } },
      ];
      const snapshot = applier.snapshot().toOutput();

      expect(snapshot.title).toBe('Human title');
      expect(snapshot.blocks.map(block => ({
        id: block.id, type: block.type, parent: block.parent ?? null,
        content: block.content ?? [], data: block.data,
      }))).toEqual(expectedOutput);
      expect(modules.YjsManager.toJSON().map(block => ({
        id: block.id, type: block.type, parent: block.parent ?? null,
        content: block.content ?? [], data: block.data,
      }))).toEqual(expectedStored);
      const live = await Promise.all(modules.BlockManager.blocks.map(async block => ({
        id: block.id, type: block.name, parent: block.parentId,
        content: [...block.contentIds], data: (await block.save())?.data,
      })));

      expect(live).toEqual(expectedStored);
      const output = await saved(modules);

      expect(output.title).toBe('Human title');
      expect(output.blocks.map(block => ({
        id: block.id, type: block.type, parent: block.parent ?? null,
        content: block.content ?? [], data: block.data,
      }))).toEqual(expectedOutput);
      expect(modules.BlockManager.getBlockById('p')).toBeUndefined();
      expect(requireBlock(modules, 'n').pluginsContent.textContent).toBe('Peer');
      expect(requireBlock(modules, 'k').pluginsContent.textContent).toBe('K peer');
      expect(requireBlock(modules, 'r').pluginsContent.textContent).toBe('Intermediate');
      expect(modules.YjsManager.topUndoToken()).toBe(own);
      expect(modules.YjsManager.undoStepTag(own)).toEqual(tag);
      expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
      expect(modules.YjsManager.topRedoToken()).toBeUndefined();
      expect(applier.lastStepToken()).toBeUndefined();
      expect(modules.BlockManager.suppressStopCapturing).toBe(false);

      modules.YjsManager.undo();
      await settle(applier);
      expect(applier.snapshot().title).toBe('Original');
      expect(modules.YjsManager.topUndoToken()).toBe(own);
      expect(modules.YjsManager.topRedoToken()).toBe(human);
      expect(applier.snapshot().get('n')?.data.text).toEqual([{ text: 'Peer' }]);
      expect(applier.snapshot().get('k')?.data.text).toEqual([{ text: 'K peer' }]);
      modules.YjsManager.redo();
      await settle(applier);
      expect(applier.snapshot().title).toBe('Human title');
      expect(modules.YjsManager.undoStepTag(own)).toEqual(tag);
      expect(modules.YjsManager.undoStepTag(human)).toBeUndefined();
      expect(applier.snapshot().get('n')?.data.text).toEqual([{ text: 'Peer' }]);
      expect(applier.snapshot().get('k')?.data.text).toEqual([{ text: 'K peer' }]);
    } finally {
      gate.release();
      await outcome;
      peer.destroy();
    }
  });

  it('inserts only the explicit Callout children beneath a real table cell and undoes them in one step', async () => {
    const modules = await boot({
      title: 'Original',
      blocks: [
        { id: 'tbl', type: 'table', data: {
          withHeadings: false, withHeadingColumn: false, stretched: false, initialColWidth: 0,
          content: [[{ blocks: ['cell'], id: 'col', rowId: 'row' }]],
        }, content: ['cell'] },
        { id: 'cell', type: 'paragraph', data: { text: 'Cell' }, parent: 'tbl' },
      ],
    });
    const applier = createApplier(modules);
    const before = applier.snapshot().toOutput();

    expect(modules.BlockManager.blocks.map(block => block.id)).toEqual(['tbl', 'cell']);
    expect(requireBlock(modules, 'cell').parentId).toBe('tbl');
    expect(requireBlock(modules, 'cell').holder.closest('[data-blok-table-cell-blocks]')).not.toBeNull();
    expect(modules.YjsManager.canUndo()).toBe(false);

    await apply(applier, [
      { op: 'insert', parentId: 'cell', afterId: null, block: {
        id: 'co', type: 'callout',
        data: { emoji: '', textColor: null, backgroundColor: null },
        children: [
          { id: 'one', type: 'paragraph', data: { text: [{ text: 'One' }] }, children: [] },
          { id: 'two', type: 'paragraph', data: { text: [{ text: 'Two' }] }, children: [] },
        ],
      } },
    ], ['cell', 'co', 'one', 'two']);
    await settle(applier);

    expect(requireBlock(modules, 'co').name).toBe('callout');
    expect(requireBlock(modules, 'one').name).toBe('paragraph');
    expect(requireBlock(modules, 'two').name).toBe('paragraph');
    expect(modules.BlockManager.blocks.map(block => block.id)).toEqual(['tbl', 'cell', 'co', 'one', 'two']);
    expect(applier.snapshot().childrenOf('co')).toEqual(['one', 'two']);
    const expectedStored = [
      { id: 'tbl', type: 'table', parent: null, content: ['cell'], data: {
        withHeadings: false, withHeadingColumn: false, stretched: false, initialColWidth: 0,
        content: [[{ blocks: ['cell'], id: 'col', rowId: 'row' }]],
      } },
      { id: 'cell', type: 'paragraph', parent: 'tbl', content: ['co'], data: { text: 'Cell' } },
      { id: 'co', type: 'callout', parent: 'cell', content: ['one', 'two'], data: {
        emoji: '', textColor: null, backgroundColor: null,
      } },
      { id: 'one', type: 'paragraph', parent: 'co', content: [], data: { text: 'One' } },
      { id: 'two', type: 'paragraph', parent: 'co', content: [], data: { text: 'Two' } },
    ];
    const live = await Promise.all(modules.BlockManager.blocks.map(async block => ({
      id: block.id, type: block.name, parent: block.parentId,
      content: [...block.contentIds], data: (await block.save())?.data,
    })));

    expect(live).toEqual(expectedStored);
    const cellHolder = requireBlock(modules, 'cell').holder;
    const calloutHolder = requireBlock(modules, 'co').holder;
    const cellHost = cellHolder.closest('[data-blok-table-cell-blocks]');

    expect(cellHost).not.toBeNull();
    expect(cellHolder.isConnected).toBe(true);
    expect(calloutHolder.isConnected).toBe(true);
    expect(cellHolder.parentElement).toBe(cellHost);
    expect(calloutHolder.parentElement).toBe(cellHost);
    expect(requireBlock(modules, 'co').holder.contains(requireBlock(modules, 'one').holder)).toBe(true);
    expect(requireBlock(modules, 'co').holder.contains(requireBlock(modules, 'two').holder)).toBe(true);
    expect(modules.YjsManager.toJSON().map(block => ({
      id: block.id, type: block.type, parent: block.parent ?? null,
      content: block.content ?? [], data: block.data,
    }))).toEqual(expectedStored);
    expect((await saved(modules)).blocks.map(block => ({
      id: block.id, type: block.type, parent: block.parent ?? null,
      content: block.content ?? [], data: block.data,
    }))).toEqual([
      { id: 'tbl', type: 'table', parent: null, content: ['cell'], data: {
        withHeadings: false, withHeadingColumn: false, stretched: false, initialColWidth: 0,
        content: [[{ blocks: ['cell'], id: 'col', rowId: 'row' }]],
      } },
      { id: 'cell', type: 'paragraph', parent: 'tbl', content: ['co'], data: { text: [{ text: 'Cell' }] } },
      { id: 'co', type: 'callout', parent: 'cell', content: ['one', 'two'], data: {
        emoji: '', textColor: null, backgroundColor: null,
      } },
      { id: 'one', type: 'paragraph', parent: 'co', content: [], data: { text: [{ text: 'One' }] } },
      { id: 'two', type: 'paragraph', parent: 'co', content: [], data: { text: [{ text: 'Two' }] } },
    ]);
    const token = applier.lastStepToken();

    expect(token).toBeDefined();
    expect(modules.YjsManager.topUndoToken()).toBe(token);
    expect(modules.YjsManager.undoStepTag(token)).toEqual(tag);
    modules.YjsManager.undo();
    await settle(applier);
    expect(modules.BlockManager.blocks.map(block => block.id)).toEqual(['tbl', 'cell']);
    expect(applier.snapshot().toOutput()).toEqual(before);
    expect(requireBlock(modules, 'cell').contentIds).toEqual([]);
    expect(modules.YjsManager.toJSON().map(block => block.id)).toEqual(['tbl', 'cell']);
    expect((await saved(modules)).blocks.map(block => block.id)).toEqual(['tbl', 'cell']);
    expect(modules.YjsManager.canUndo()).toBe(false);
    expect(modules.YjsManager.topRedoToken()).toBe(token);
  });
});
