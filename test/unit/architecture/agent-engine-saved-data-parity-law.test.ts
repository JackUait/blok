// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { createEditorAgentSession } from '../../../src/components/modules/agent/editor-session';
import { destroy as destroyTooltip } from '../../../src/components/utils/tooltip';
import { outputBlocksToCanonicalSegments } from '../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';
import type { OutputData } from '../../../types';
import type { AgentResult, AgentSession } from '../../../types/agent';
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
  'database-comment': [insert('database-comment', { text: 'hi', createdAt: 1 })],
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
  page: 'Inserting a page needs the pageBackend host service, which the headless engines refuse without (COMMAND_UNAVAILABLE).',
};

/** Writes after the insert that leave defaulted keys out, set them to null, or change what they depend on. */
const UPDATES: Record<string, CorpusCommand[]> = {
  'code update': [insert('code', { code: 'x' }), update({ code: 'y' })],
  'code null lineNumbers': [insert('code', { code: 'x', lineNumbers: false }), update({ lineNumbers: null })],
  'quote update': [insert('quote', { text: 'x' }), update({ text: 'y' })],
  'quote null size': [insert('quote', { text: 'x', size: 'large' }), update({ size: null })],
  'callout update': [insert('callout'), update({ emoji: 'x' })],
  'callout null textColor': [insert('callout', { emoji: 'x', textColor: 'red' }), update({ textColor: null })],
  'checklist item': [insert('list', { text: 'a', style: 'checklist' })],
  'checklist null checked': [insert('list', { text: 'a', style: 'checklist', checked: true }), update({ checked: null })],
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

/** Cases where one key may be null in the editor and absent headless, and why. */
const NULL_OR_ABSENT: Record<string, { keys: string[]; reason: string }> = {
  'callout null textColor': {
    keys: ['textColor'],
    reason: 'A top-level null in a setData patch means "remove the key", so the planner cannot write the null default back. The callout reads an absent colour as null, so both render the same.',
  },
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

  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], labels)]));
};

const withoutEditorOnly = (type: string, data: Record<string, unknown>): Record<string, unknown> => {
  const keys = EDITOR_ONLY_KEYS[type]?.keys ?? [];

  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
};

const richFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const withoutNulls = (data: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key, value]) => !keys.includes(key) || value !== null));

const savedNew = (doc: OutputData | undefined, nullable: string[] = []): string => stableStringify(canonical(
  outputBlocksToCanonicalSegments(doc?.blocks ?? [], richFields, htmlToSegmentsNode)
    .map(block => ({ type: block.type, data: withoutNulls(withoutEditorOnly(block.type, block.data), nullable) }))
));

const rowsOf = (result: AgentResult, nullable: string[] = []): string => {
  if (!result.ok) {
    return stableStringify({ error: result.error.code });
  }

  return stableStringify(canonical((result.blocks ?? [])
    .map(row => ({
      type: row.type,
      depth: row.depth,
      attrs: row.attrs === undefined ? undefined : withoutNulls(withoutEditorOnly(row.type, row.attrs), nullable),
      data: row.data === undefined ? undefined : withoutNulls(withoutEditorOnly(row.type, row.data), nullable),
    }))));
};

const SERVICES = { names: ['linkMetadata' as const], impl: { linkMetadata: { fetch: async () => ({ title: 'T' }) } } };

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

const runEditor = async (commands: CorpusCommand[]): Promise<{ result: AgentResult; saved: OutputData | undefined }> => {
  core = new Core({ holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' }, tools: builtInEditorTools(), data: SEED });
  await core.isReady;
  const editor = core.moduleInstances;

  editorSession = createEditorAgentSession(editor, TEST_ACTOR, { services: SERVICES.impl });
  const result = await editorSession.execute({ commands });

  editor.YjsManager.flushPendingBlockWrites();
  await vi.waitFor(() => {
    expect(editor.BlockManager.isSyncingFromYjs).toBe(false);
  });

  return { result, saved: await editor.Saver.save({ dialect: 'host' }) };
};

beforeEach(() => {
  vi.clearAllMocks();
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
    const nullable = NULL_OR_ABSENT[name]?.keys ?? [];

    const json = openJsonSession(SEED, undefined, SERVICES);
    const jsonResult = await json.execute({ commands });
    const jsonSaved = json.output();

    json.close();

    const store = openStoreSession(SEED, undefined, SERVICES);
    const storeResult = await store.execute({ commands });
    const storeSaved = store.output();

    await store.close();

    const { result: editorResult, saved: editorSaved } = await runEditor(commands);

    expect(jsonResult.ok, JSON.stringify(jsonResult)).toBe(true);
    expect(savedNew(editorSaved, nullable), 'editor vs json saved data').toBe(savedNew(jsonSaved, nullable));
    expect(savedNew(storeSaved, nullable), 'store vs json saved data').toBe(savedNew(jsonSaved, nullable));
    expect(rowsOf(editorResult, nullable), 'editor vs json result rows').toBe(rowsOf(jsonResult, nullable));
    expect(rowsOf(storeResult, nullable), 'store vs json result rows').toBe(rowsOf(jsonResult, nullable));
  }, 30_000);
});
