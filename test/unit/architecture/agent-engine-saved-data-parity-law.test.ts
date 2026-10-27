// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { createEditorAgentSession } from '../../../src/components/modules/agent/editor-session';
import { destroy as destroyTooltip } from '../../../src/components/utils/tooltip';
import { outputBlocksToCanonicalSegments } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';
import type { OutputData } from '../../../types';
import type { AgentBatch, AgentResult, AgentSession } from '../../../types/agent';
import { openJsonSession, openStoreSession, TEST_ACTOR } from '../agent/harness';
import { stableStringify } from '../agent/parity/normalize';
import type { CorpusCommand } from '../agent/parity/corpus';
import { BLOCK_CLASSES, builtInEditorTools } from '../shared/tool-descriptions/built-in-tools';

/**
 * ARCHITECTURE LAW — one batch, one result, in every engine.
 *
 * Ask AI writes through the editor engine; MCP writes through the json and store engines.
 * A default the editor fills on load and saves (code lineNumbers, quote size...) must also be
 * filled by the planner, through the tool's ToolRuntime.normalize. Otherwise the same batch
 * saves different data, and the model reads different `blocks` rows, depending on where it ran.
 * Every built-in block tool needs a case here, or an exemption with a reason.
 */

const SEED: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'x' }] } }] };

const insert = (type: string, data?: Record<string, unknown>, extra: Record<string, unknown> = {}): CorpusCommand => ({
  name: 'block.insert', args: { id: 'n1', type, ...(data === undefined ? {} : { data }), position: 'end', ...extra },
});
const update = (data: Record<string, unknown>): CorpusCommand => ({ name: 'block.update', args: { id: 'n1', data } });

/** The minimal insert of each built-in block tool. */
const MINIMAL: Record<string, CorpusCommand[]> = {
  paragraph: [insert('paragraph')],
  header: [insert('header')],
  list: [insert('list', { text: 'a', style: 'unordered' })],
  table: [{ name: 'table.create', args: { rows: 1, cols: 1, position: 'end' } }],
  toggle: [insert('toggle')],
  callout: [insert('callout')],
  database: [{ name: 'database.create', args: { title: 'D', position: 'end' } }],
  'database-row': [
    { name: 'database.create', args: { title: 'D', position: 'end' }, ref: 'd' },
    { name: 'database.addRow', args: { id: '$d' } },
  ],
  divider: [insert('divider')],
  spacer: [insert('spacer')],
  table_of_contents: [insert('table_of_contents')],
  quote: [insert('quote')],
  code: [insert('code')],
  image: [insert('image', { url: 'https://example.com/a.png' })],
  file: [insert('file', { url: 'https://example.com/a.pdf' })],
  audio: [insert('audio', { url: 'https://example.com/a.mp3' })],
  video: [insert('video', { url: 'https://example.com/a.mp4' })],
  column_list: [insert('column_list')],
  column: [
    { name: 'block.insert', args: { id: 'cl', type: 'column_list', data: {}, position: 'end' } },
    { name: 'block.insert', args: { id: 'n1', type: 'column', parentId: 'cl' } },
  ],
  tabs: [insert('tabs')],
  tab: [
    { name: 'block.insert', args: { id: 'tb', type: 'tabs', position: 'end' } },
    { name: 'block.insert', args: { id: 'n1', type: 'tab', parentId: 'tb' } },
  ],
  embed: [{ name: 'embed.create', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', position: 'end' } }],
  bookmark: [insert('bookmark', { url: 'https://example.com' })],
  'page-link': [insert('page-link', { pageId: 'pg1' })],
};

/** Tools with no case, and why. */
const NO_CASE: Record<string, string> = {
  page: 'Only the editor can create the sub-page document a page needs, so the headless engines refuse the insert (COMMAND_UNAVAILABLE).',
  'database-comment': 'Not insertable by block.insert: database.addComment writes comments, so every engine refuses the insert.',
};

/** Writes after the insert that leave defaulted keys out, set them to null, or change what they depend on. */
const UPDATES: Record<string, CorpusCommand[]> = {
  'code update': [insert('code', { code: 'x' }), update({ code: 'y' })],
  'code null lineNumbers': [insert('code', { code: 'x', lineNumbers: false }), update({ lineNumbers: null })],
  'code null lineNumbers when on': [insert('code', { code: 'x', lineNumbers: true }), update({ lineNumbers: null })],
  'code null language': [insert('code', { code: 'x', language: 'python' }), update({ language: null })],
  'code null code': [insert('code', { code: 'x' }), update({ code: null })],
  'quote update': [insert('quote', { text: 'x' }), update({ text: 'y' })],
  'quote null size': [insert('quote', { text: 'x', size: 'large' }), update({ size: null })],
  'callout update': [insert('callout'), update({ emoji: 'x' })],
  'callout null textColor': [insert('callout', { emoji: 'x', textColor: 'red' }), update({ textColor: null })],
  'callout null emoji': [insert('callout', { emoji: 'x' }), update({ emoji: null })],
  'checklist item': [insert('list', { text: 'a', style: 'checklist' })],
  'checklist null checked': [insert('list', { text: 'a', style: 'checklist', checked: true }), update({ checked: null })],
  'list null text': [insert('list', { text: 'a', style: 'unordered' }), update({ text: null })],
  'paragraph null text': [insert('paragraph', { text: 'a' }), update({ text: null })],
  'header null text': [insert('header', { text: 'a', level: 3 }), update({ text: null })],
  'spacer null height': [insert('spacer', { height: 100 }), update({ height: null })],
  'list to checklist': [insert('list', { text: 'a', style: 'unordered' }), update({ style: 'checklist' })],
  'checklist to bulleted': [insert('list', { text: 'a', style: 'checklist', checked: true }), update({ style: 'unordered' })],
  'ordered start 1': [insert('list', { text: 'a', style: 'ordered', start: 1 })],
  'ordered start 3': [insert('list', { text: 'a', style: 'ordered', start: 3 })],
  'convert to code': [{ name: 'block.convert', args: { id: 'p', type: 'code' } }],
  'convert to quote': [{ name: 'block.convert', args: { id: 'p', type: 'quote' } }],
  'convert to checklist': [{ name: 'block.convert', args: { id: 'p', type: 'list', data: { style: 'checklist' } } }],
};

/** Keys only the editor saves, by tool, and why the planner cannot fill them. */
const EDITOR_ONLY_KEYS: Record<string, { keys: string[]; reason: string }> = {
  table: {
    keys: ['stretched', 'initialColWidth'],
    reason: 'initialColWidth is measured from layout (src/tools/table/index.ts). stretched falls back to the host\'s table config (src/tools/table/table-operations.ts), which the headless engines do not know.',
  },
};

/**
 * Updates whose saved data still differs by a key. Every other null update writes the key's
 * cleared value (load-defaults.ts CLEARED_VALUES), so every engine saves the same data.
 */
const REMOVAL_GAPS: Record<string, { keys: string[]; reason: string }> = {
  'callout null textColor': {
    keys: ['textColor'],
    reason: 'A setData null means "remove the key", so the headless engines store no textColor while the editor saves null. The callout loads both as no colour, so the clear survives reload.',
  },
};

/**
 * USER RULING 2026-10-25: a field an agent clears stays cleared, in every engine and after
 * save then reload. It never comes back as a default the user did not ask for.
 */
const CLEARS: Record<string, { type: string; key: string; cleared: unknown }> = {
  'code null lineNumbers': { type: 'code', key: 'lineNumbers', cleared: false },
  'code null lineNumbers when on': { type: 'code', key: 'lineNumbers', cleared: false },
  'code null language': { type: 'code', key: 'language', cleared: 'plain text' },
  'code null code': { type: 'code', key: 'code', cleared: '' },
  'quote null size': { type: 'quote', key: 'size', cleared: 'default' },
  'callout null textColor': { type: 'callout', key: 'textColor', cleared: null },
  'callout null emoji': { type: 'callout', key: 'emoji', cleared: '' },
  'checklist null checked': { type: 'list', key: 'checked', cleared: false },
  'list null text': { type: 'list', key: 'text', cleared: [] },
  'paragraph null text': { type: 'paragraph', key: 'text', cleared: [] },
  'header null text': { type: 'header', key: 'text', cleared: [] },
  'spacer null height': { type: 'spacer', key: 'height', cleared: 38 },
};

/**
 * Clears every engine refuses, because the field is required and has no cleared value: a page
 * link needs its page, and the base heading level and list style come from host config.
 */
const REFUSED_CLEARS: Record<string, CorpusCommand[]> = {
  'page-link null pageId': [insert('page-link', { pageId: 'pg1' }), update({ pageId: null })],
  'header null level': [insert('header', { text: 'a', level: 3 }), update({ level: null })],
  'list null style': [insert('list', { text: 'a', style: 'ordered' }), update({ style: null })],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Minted ids (10 url-safe characters) become labels in first-seen order; positions are kept. */
const canonical = (value: unknown, labels = new Map<string, string>()): unknown => {
  if (typeof value === 'string') {
    const match = /^([A-Za-z0-9_-]{10})(-filters)?$/.exec(value);

    if (match === null) {
      return value;
    }
    if (!labels.has(match[1])) {
      labels.set(match[1], `id${labels.size + 1}`);
    }

    return `${labels.get(match[1])}${match[2] ?? ''}`;
  }
  if (Array.isArray(value)) {
    return value.map(item => canonical(item, labels));
  }
  if (!isRecord(value)) {
    return value;
  }

  // A key that is an id seen before (a row's values keyed by property id) takes its label too.
  return Object.fromEntries(Object.keys(value).sort().map(key => [labels.get(key) ?? key, canonical(value[key], labels)]));
};

const withoutEditorOnly = (type: string, data: Record<string, unknown>): Record<string, unknown> => {
  const keys = EDITOR_ONLY_KEYS[type]?.keys ?? [];

  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
};

const richFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const withoutGapKeys = (data: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

const rowAttrs = (type: string, attrs: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined => {
  const kept = withoutGapKeys(withoutEditorOnly(type, attrs), keys);

  return Object.keys(kept).length === 0 ? undefined : kept;
};

const savedNew = (doc: OutputData | undefined, gapKeys: string[] = []): string => stableStringify(canonical(
  outputBlocksToCanonicalSegments(doc?.blocks ?? [], richFields, htmlToSegmentsNode)
    .map(block => ({ type: block.type, data: withoutGapKeys(withoutEditorOnly(block.type, block.data), gapKeys) }))
));

const rowsOf = (result: AgentResult, gapKeys: string[] = []): string => {
  if (!result.ok) {
    return stableStringify({ error: result.error.code });
  }

  return stableStringify(canonical((result.blocks ?? [])
    .map(row => ({
      type: row.type,
      depth: row.depth,
      attrs: row.attrs === undefined ? undefined : rowAttrs(row.type, row.attrs, gapKeys),
      data: row.data === undefined ? undefined : withoutGapKeys(withoutEditorOnly(row.type, row.data), gapKeys),
    }))));
};

const SERVICES = { names: ['linkMetadata' as const], impl: { linkMetadata: { fetch: async (url: string) => ({ url, title: 'T' }) } } };

let holder: HTMLDivElement;
let core: Core | undefined;
let editorSession: AgentSession | undefined;

const destroyCore = (instance: Core): void => {
  const modules: unknown[] = Object.values(instance.moduleInstances);

  for (const module of modules) {
    if (typeof module === 'object' && module !== null && 'markDestroyed' in module && typeof module.markDestroyed === 'function') {
      module.markDestroyed();
    }
  }
  for (const module of modules) {
    if (typeof module === 'object' && module !== null && 'destroy' in module && typeof module.destroy === 'function') {
      module.destroy();
    }
  }
  destroyTooltip();
};

const runEditor = async (commands: CorpusCommand[], data: OutputData = SEED): Promise<{ result: AgentResult; saved: OutputData | undefined }> => {
  core = new Core({ holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' }, tools: builtInEditorTools(), data });
  await core.isReady;
  const editor = core.moduleInstances;

  editorSession = createEditorAgentSession(editor, TEST_ACTOR, { services: SERVICES.impl });
  const result = await editorSession.execute({ commands } as AgentBatch);

  editor.YjsManager.flushPendingBlockWrites();
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  });

  return { result, saved: await editor.Saver.save({ dialect: 'host' }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Each engine mints row keys with a random tail; one fixed value lets the saved keys compare.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(async () => {
  try {
    await editorSession?.close();
    if (core !== undefined) {
      await core.isReady.catch(() => undefined);
      destroyCore(core);
    }
  } finally {
    holder.remove();
    core = undefined;
    editorSession = undefined;
    vi.restoreAllMocks();
  }
});

describe('agent engine saved-data parity law', () => {
  it('gives every built-in block tool a case or a reason', () => {
    const uncovered = Object.keys(BLOCK_CLASSES).filter(name => !Object.hasOwn(MINIMAL, name) && !Object.hasOwn(NO_CASE, name));

    expect(uncovered, 'Add a minimal insert to MINIMAL, or a reason to NO_CASE.').toEqual([]);
  });

  it.each(Object.entries({ ...MINIMAL, ...UPDATES }))('%s saves the same data and rows in the editor, json and store engines', async (name, commands) => {
    const gapKeys = REMOVAL_GAPS[name]?.keys ?? [];

    const json = openJsonSession(SEED, undefined, SERVICES);
    const jsonResult = await json.execute({ commands });
    const jsonSaved = json.output();

    json.close();

    const store = openStoreSession(SEED, undefined, SERVICES);
    // Corpus commands are wire input; the store session checks them like any batch.
    const storeResult = await store.execute({ commands } as AgentBatch);
    const storeSaved = store.output();

    await store.close();

    const { result: editorResult, saved: editorSaved } = await runEditor(commands);

    expect(jsonResult.ok, JSON.stringify(jsonResult)).toBe(true);
    expect(savedNew(editorSaved, gapKeys), 'editor vs json saved data').toBe(savedNew(jsonSaved, gapKeys));
    expect(savedNew(storeSaved, gapKeys), 'store vs json saved data').toBe(savedNew(jsonSaved, gapKeys));
    expect(rowsOf(editorResult, gapKeys), 'editor vs json result rows').toBe(rowsOf(jsonResult, gapKeys));
    expect(rowsOf(storeResult, gapKeys), 'store vs json result rows').toBe(rowsOf(jsonResult, gapKeys));
  }, 30_000);

  it.each(Object.entries(REFUSED_CLEARS))('%s is refused the same way in every engine', async (_name, commands) => {
    const json = openJsonSession(SEED, undefined, SERVICES);
    const jsonResult = await json.execute({ commands });
    const jsonSaved = json.output();

    json.close();

    const store = openStoreSession(SEED, undefined, SERVICES);
    const storeResult = await store.execute({ commands } as AgentBatch);
    const storeSaved = store.output();

    await store.close();

    const { result: editorResult, saved: editorSaved } = await runEditor(commands);

    expect(rowsOf(jsonResult), 'json result').toBe(stableStringify({ error: 'INVALID_ARGS' }));
    expect(rowsOf(storeResult), 'store result').toBe(rowsOf(jsonResult));
    expect(rowsOf(editorResult), 'editor result').toBe(rowsOf(jsonResult));
    expect(savedNew(jsonSaved), 'json saved').toBe(savedNew(SEED));
    expect(savedNew(storeSaved), 'store saved').toBe(savedNew(SEED));
    expect(savedNew(editorSaved), 'editor saved').toBe(savedNew(SEED));
  }, 30_000);

  it.each(Object.entries(CLEARS))('%s stays cleared in every engine and after reload', async (name, { key, cleared }) => {
    const commands = UPDATES[name];
    const valueIn = (doc: OutputData | undefined): unknown => {
      // Canonical segments: the store saves empty rich text as "", the json engine as [].
      const data = outputBlocksToCanonicalSegments(doc?.blocks ?? [], richFields, htmlToSegmentsNode).find(block => block.id === 'n1')?.data;

      if (data !== undefined && Object.hasOwn(data, key)) {
        return data[key];
      }

      // The editor loads an absent callout colour as null: both mean no colour.
      return cleared === null ? null : '<absent>';
    };
    const rowValue = (result: AgentResult): unknown => {
      const row = result.ok ? result.blocks?.find(block => block.id === 'n1') : undefined;
      const fields = row?.data ?? row?.attrs;

      return fields === undefined || !Object.hasOwn(fields, key) ? '<absent>' : fields[key];
    };

    const json = openJsonSession(SEED, undefined, SERVICES);
    const jsonResult = await json.execute({ commands });
    const jsonSaved = json.output();

    json.close();

    const store = openStoreSession(SEED, undefined, SERVICES);
    const storeResult = await store.execute({ commands } as AgentBatch);
    const storeSaved = store.output();

    await store.close();

    const { result: editorResult, saved: editorSaved } = await runEditor(commands);
    const reloaded = async (doc: OutputData | undefined): Promise<OutputData | undefined> => {
      await editorSession?.close();
      if (core !== undefined) {
        destroyCore(core);
      }

      return (await runEditor([], doc)).saved;
    };

    expect(valueIn(jsonSaved), 'json saved').toEqual(cleared);
    expect(valueIn(storeSaved), 'store saved').toEqual(cleared);
    expect(valueIn(editorSaved), 'editor saved').toEqual(cleared);
    expect(valueIn(await reloaded(jsonSaved)), 'json saved, reloaded in the editor').toEqual(cleared);
    expect(valueIn(await reloaded(storeSaved)), 'store saved, reloaded in the editor').toEqual(cleared);
    expect(valueIn(await reloaded(editorSaved)), 'editor saved, reloaded').toEqual(cleared);
    expect(rowValue(editorResult), 'editor vs json result row').toEqual(rowValue(jsonResult));
    expect(rowValue(storeResult), 'store vs json result row').toEqual(rowValue(jsonResult));
  }, 30_000);
});
