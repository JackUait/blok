import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputBlockData } from '../../../../types';
import type { RichText } from '../../../../types/rich-text';
import type { PageConfig } from '../../../../src/tools/page/types';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import type { Block } from '../../../../src/components/block';
import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import {
  BLOCK_CLASSES,
  builtInEditorTools,
} from './built-in-tools';

// Candidate indices need the live-slot guard recorded in preparation.json.
interface Binding {
  selector: string;
  field?: string;
  ownerId?: string;
  targetId?: string;
  scope?: 'nested' | 'host';
}

interface Sample {
  state: string;
  data: Record<string, unknown>;
  inputs: Binding[];
  children?: OutputBlockData[];
}

interface ObservedInput {
  rawIndex: number;
  field?: string;
  ownerId: string;
  kind: 'owned-text' | 'foreign' | 'nested' | 'host' | 'native' | 'nondata';
}

interface Observation {
  state: string;
  inputs: ObservedInput[];
}

interface PageHost {
  titles: Record<string, string>;
  writes: Array<{ pageId: string; title: string }>;
}

const canonicalText: RichText = [{ text: 'Rich ', marks: { bold: true } }, { text: 'text' }];

const paragraphs: OutputBlockData[] = [
  { id: 'p1', type: 'paragraph', parent: 'b', data: { text: 'First child' } },
  { id: 'p2', type: 'paragraph', parent: 'b', data: { text: 'Second child' } },
];
const childInputs: Binding[] = [
  { ownerId: 'p1', selector: '[data-blok-tool="paragraph"]', field: 'text' },
  { ownerId: 'p2', selector: '[data-blok-tool="paragraph"]', field: 'text' },
];
const codeData = { code: 'const value = 1;', language: 'plain text', filename: 'a.ts' };
const databaseData = {
  title: 'Tasks',
  schema: [
    { id: 'name', name: 'Name', type: 'title', position: 'a0' },
    {
      id: 'status', name: 'Status', type: 'select', position: 'a1',
      config: { options: [{ id: 'todo', label: 'Todo', position: 'a0' }] },
    },
  ],
  views: [
    {
      id: 'board', name: 'Board', type: 'board', position: 'a0', groupBy: 'status',
      sorts: [], filters: [], visibleProperties: ['name', 'status'],
    },
    {
      id: 'list', name: 'List', type: 'list', position: 'a1',
      sorts: [], filters: [], visibleProperties: ['name', 'status'],
    },
  ],
  activeViewId: 'board',
};
const databaseRows: OutputBlockData[] = [
  {
    id: 'r1', type: 'database-row', parent: 'b',
    data: { title: 'First row', properties: { name: 'First row', status: 'todo' }, position: 'a0', pageId: 'row-page' },
  },
  {
    id: 'r2', type: 'database-row', parent: 'b',
    data: { title: 'Second row', properties: { name: 'Second row', status: 'todo' }, position: 'a1' },
  },
];
const embedData = {
  service: 'youtube',
  source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
  caption: 'Embed caption',
};
const columns: OutputBlockData[] = [
  { id: 'c1', type: 'column', parent: 'b', content: ['p1'], data: {} },
  { id: 'p1', type: 'paragraph', parent: 'c1', data: { text: 'First child' } },
  { id: 'c2', type: 'column', parent: 'b', content: ['p2'], data: {} },
  { id: 'p2', type: 'paragraph', parent: 'c2', data: { text: 'Second child' } },
];
const tabs: OutputBlockData[] = [
  { id: 't1', type: 'tab', parent: 'b', content: ['p1'], data: { title: 'First' } },
  { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'First child' } },
  { id: 't2', type: 'tab', parent: 'b', content: ['p2'], data: { title: 'Second' } },
  { id: 'p2', type: 'paragraph', parent: 't2', data: { text: 'Second child' } },
];

const samples: Record<keyof typeof BLOCK_CLASSES, Sample[]> = {
  paragraph: [{
    state: 'text', data: { text: 'Paragraph' },
    inputs: [{ selector: '[data-blok-tool="paragraph"]', field: 'text' }],
  }],
  header: [
    {
      state: 'plain heading', data: { text: 'Heading', level: 2 },
      inputs: [{ selector: '[data-blok-tool="header"]', field: 'text' }],
    },
    ...[true, false].map(open => ({
      state: open ? 'toggle open' : 'toggle closed',
      data: { text: 'Heading', level: 2, isToggleable: true },
      children: paragraphs,
      inputs: [{ selector: '[data-blok-tool="header"]', field: 'text' }, ...childInputs],
    })),
  ],
  list: ['unordered', 'ordered', 'checklist'].map(style => ({
    state: style, data: { text: 'List item', style, checked: false },
    inputs: [{
      selector: style === 'checklist'
        ? '[data-blok-testid="list-checklist-content"]'
        : '[data-blok-testid="list-content-container"]',
      field: 'text',
    }],
  })),
  table: [{
    state: 'two referenced cells',
    data: { content: [[{ blocks: ['p1'] }, { blocks: ['p2'] }]] },
    children: paragraphs, inputs: childInputs,
  }],
  toggle: [true, false].map(open => ({
    state: open ? 'toggle open' : 'toggle closed', data: { text: 'Toggle' },
    children: paragraphs,
    inputs: [{ selector: '[data-blok-toggle-content]', field: 'text' }, ...childInputs],
  })),
  callout: [{ state: 'two body blocks', data: { emoji: '' }, children: paragraphs, inputs: childInputs }],
  database: [
    {
      state: 'board', data: databaseData,
      inputs: [{ selector: '[data-blok-database-title]', field: 'title' }],
    },
    {
      state: 'column rename', data: databaseData,
      inputs: [
        { selector: '[data-blok-database-title]', field: 'title' },
        { selector: '[data-blok-database-column-title-input]', field: 'schema', scope: 'nested' },
      ],
    },
    {
      state: 'view rename', data: databaseData,
      inputs: [
        { selector: '[data-blok-database-title]', field: 'title' },
        { selector: '[data-blok-database-tab-rename-input]', field: 'views', scope: 'nested' },
      ],
    },
    {
      state: 'card rename', data: databaseData, children: databaseRows,
      inputs: [
        { selector: '[data-blok-database-title]', field: 'title' },
        { selector: '[data-row-id="r1"] [data-blok-database-card-title-input]', field: 'title', targetId: 'r1' },
      ],
    },
  ],
  'database-row': [{ state: 'metadata only', data: { properties: { name: 'Row' }, position: 'a0' }, inputs: [] }],
  divider: [{ state: 'rule', data: {}, inputs: [] }],
  spacer: [{ state: 'gap', data: { height: 32 }, inputs: [] }],
  table_of_contents: [{ state: 'empty outline', data: {}, inputs: [] }],
  quote: [{
    state: 'text', data: { text: 'Quote' },
    inputs: [{ selector: '[data-blok-tool="quote"]', field: 'text' }],
  }],
  code: [
    { state: 'resting', data: codeData, inputs: [{ selector: '[data-blok-testid="code-content"]', field: 'code' }] },
    {
      state: 'filename editing', data: codeData,
      inputs: [
        { selector: '[data-blok-testid="code-filename-input"]', field: 'filename' },
        { selector: '[data-blok-testid="code-content"]', field: 'code' },
      ],
    },
  ],
  image: [
    ...[true, false].map(captionVisible => ({
      state: captionVisible ? 'caption on' : 'caption off',
      data: { url: 'https://example.com/a.png', caption: 'Image caption', captionVisible },
      // image/index.ts:1306-1324 mounts the editable row even when CSS hides it.
      inputs: [{ selector: '[role="textbox"]', field: 'caption' }],
    })),
    { state: 'empty link form', data: { url: '' }, inputs: [{ selector: '[data-blok-media-empty-state] input[type="url"]' }] },
  ],
  file: [
    ...[true, false].map(captionVisible => ({
      state: captionVisible ? 'caption on' : 'caption off',
      data: { url: 'https://example.com/a.pdf', fileName: 'a.pdf', caption: 'File caption', captionVisible },
      inputs: [
        { selector: '[data-role="file-name"]', field: 'fileName' },
        ...(captionVisible ? [{ selector: '[data-role="file-caption"]', field: 'caption' }] : []),
      ],
    })),
    { state: 'empty link form', data: { url: '' }, inputs: [{ selector: '[data-blok-media-empty-state] input[type="url"]' }] },
  ],
  audio: [
    ...[true, false].map(captionVisible => ({
      state: captionVisible ? 'caption on' : 'caption off',
      data: { url: 'https://example.com/a.mp3', title: 'Track', artist: 'Artist', caption: 'Audio caption', captionVisible },
      inputs: [
        { selector: '[data-role="audio-title"]', field: 'title' },
        { selector: '[data-role="audio-artist"]', field: 'artist' },
        ...(captionVisible ? [{ selector: '[data-role="audio-caption"]', field: 'caption' }] : []),
      ],
    })),
    {
      state: 'caption unset and empty', data: { url: 'https://example.com/a.mp3', title: '', artist: '' },
      inputs: [
        { selector: '[data-role="audio-title"]', field: 'title' },
        { selector: '[data-role="audio-artist"]', field: 'artist' },
      ],
    },
    { state: 'empty link form', data: { url: '' }, inputs: [{ selector: '[data-blok-media-empty-state] input[type="url"]' }] },
  ],
  video: [
    ...[true, false].map(captionVisible => ({
      state: captionVisible ? 'caption on' : 'caption off',
      data: { url: 'https://example.com/a.mp4', caption: 'Video caption', captionVisible },
      // video/index.ts:816-828 keeps the row mounted in editable mode.
      inputs: [{ selector: '[data-role="video-caption"]', field: 'caption' }],
    })),
    { state: 'empty link form', data: { url: '' }, inputs: [{ selector: '[data-blok-media-empty-state] input[type="url"]' }] },
  ],
  column_list: [{ state: 'two populated columns', data: {}, children: columns, inputs: childInputs }],
  column: [{ state: 'two body blocks', data: {}, children: paragraphs, inputs: childInputs }],
  tabs: [
    { state: 'active and inactive panels', data: {}, children: tabs, inputs: childInputs },
    {
      state: 'inline tab rename', data: {}, children: tabs,
      inputs: [
        { selector: '[data-blok-tabs-rename-input]', field: 'title', targetId: 't1' },
        ...childInputs,
      ],
    },
  ],
  tab: [{ state: 'two body blocks', data: { title: 'Tab' }, children: paragraphs, inputs: childInputs }],
  embed: [
    ...[true, false].map(captionVisible => ({
      state: captionVisible ? 'caption on' : 'caption off', data: { ...embedData, captionVisible },
      inputs: captionVisible ? [{ selector: '[data-role="embed-caption"]', field: 'caption' }] : [],
    })),
    { state: 'empty URL form', data: {}, inputs: [{ selector: '[data-role="embed-url-input"]' }] },
  ],
  bookmark: [{
    state: 'resolved card', data: { url: 'https://example.com/article', title: 'Article', description: 'Summary' },
    inputs: [],
  }],
  page: [
    { state: 'existing page pointer', data: { pageId: 'existing-page' }, inputs: [] },
    {
      state: 'configured host rename', data: { pageId: 'existing-page', textColor: 'red' },
      inputs: [{ selector: '[data-blok-testid="page-rename-input"]', field: 'title', targetId: 'existing-page', scope: 'host' }],
    },
  ],
  'page-link': [{ state: 'existing page pointer', data: { pageId: 'existing-page' }, inputs: [] }],
};

(['paragraph', 'header', 'list', 'quote', 'toggle'] as const).forEach(name => {
  const initial = samples[name][0];
  if (initial === undefined) throw new Error(`Missing ${name} text fixture.`);
  samples[name].push({
    ...initial,
    state: 'canonical rich text',
    data: { ...initial.data, text: canonicalText },
  });
  if (name === 'header' || name === 'toggle') {
    for (const state of samples[name].filter(sample => sample.state.startsWith('toggle '))) {
      samples[name].push({
        ...state,
        state: `rich ${state.state}`,
        data: { ...state.data, text: canonicalText },
      });
    }
  }
});

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

const destroyCore = async (core: Core): Promise<void> => {
  const modules: unknown[] = Object.values(core.moduleInstances);
  const pending: Array<void | Promise<void>> = [];

  // All modules must be marked before a destroy hook can call another module.
  modules.filter(hasMarkDestroyed).forEach(instance => instance.markDestroyed());
  for (const instance of modules) {
    if (hasDestroy(instance)) pending.push(instance.destroy());
    if (hasListeners(instance)) instance.listeners.removeAll();
  }
  destroyTooltip();
  await Promise.all(pending);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireBlock = (instance: Core, id: string): Block => {
  const block = instance.moduleInstances.BlockManager.getBlockById(id);
  if (block === undefined) throw new Error(`Missing block ${id}.`);
  return block;
};

const requireElement = (block: Block, selector: string): HTMLElement => {
  const element = block.holder.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing ${block.name} input: ${selector}`);
  return element;
};

const clickPageRename = (): void => {
  const rename = document.querySelector('[data-blok-item-name="page-rename"]');
  if (!(rename instanceof HTMLElement)) throw new Error('Missing page Rename menu item.');
  rename.click();
};

const descriptionFor = (name: string) => {
  const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];
  if (describeTool === undefined) throw new Error(`Missing description for ${name}.`);
  return describeTool({});
};

const clickMenuTitle = async (title: string): Promise<void> => {
  const item = await vi.waitFor(() => {
    const match = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find(element => element.querySelector('[data-blok-testid="popover-item-title"]')?.textContent === title);
    if (match === undefined) throw new Error(`Missing menu item ${title}.`);
    return match;
  });
  item.click();
};

const isUncommittedUrl = (input: HTMLElement): boolean =>
  input instanceof HTMLInputElement && input.type === 'url' && (
    // media-empty-state.ts:280,443-449,530-549: input previews; submit calls onUrl.
    input.closest('[data-blok-media-empty-state]') !== null ||
    // link/embed/index.ts:688-689,787-813: input previews; submit resolves the URL.
    input.getAttribute('data-role') === 'embed-url-input'
  );

describe('Task02/28 inputFields scratch candidate', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;
  let contentEditableDescriptor: PropertyDescriptor | undefined;

  const close = async (): Promise<void> => {
    const instance = core;
    core = undefined;
    if (instance !== undefined) await destroyCore(instance);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    contentEditableDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');
    // Blok discovers inputs by attribute; jsdom does not reflect this property.
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
      configurable: true,
      get(this: HTMLElement): string {
        return this.getAttribute('contenteditable') ?? 'inherit';
      },
      set(this: HTMLElement, value: string): void {
        this.setAttribute('contenteditable', value);
      },
    });
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      await close();
    } finally {
      holder?.remove();
      holder = undefined;
      vi.restoreAllMocks();
      if (contentEditableDescriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'contentEditable');
      } else {
        Object.defineProperty(HTMLElement.prototype, 'contentEditable', contentEditableDescriptor);
      }
    }
  });

  const boot = async (name: string, sample: Sample, readOnly = false): Promise<{
    instance: Core; block: Block; pageHost?: PageHost;
  }> => {
    if (holder === undefined) throw new Error('Missing fixture holder.');
    const children = structuredClone(sample.children ?? []);
    const content = children.filter(child => child.parent === 'b')
      .flatMap(child => child.id === undefined ? [] : [child.id]);
    const tools = builtInEditorTools();
    let pageHost: PageHost | undefined;
    if (sample.state === 'configured host rename') {
      const host: PageHost = {
        titles: { 'existing-page': 'Existing page', 'other-page': 'Other page' }, writes: [],
      };
      const config: PageConfig = {
        resolve: pageId => ({ title: host.titles[pageId] }),
        rename: (pageId, title) => {
          host.titles[pageId] = title;
          host.writes.push({ pageId, title });
        },
      };
      tools.page = { class: BLOCK_CLASSES.page, config: { ...config } };
      pageHost = host;
    }
    const instance = new Core({
      holder, tools, tabSync: false, readOnly, dataModel: 'hierarchical',
      i18n: { locale: 'en' },
      data: { blocks: [{ id: 'b', type: name, data: structuredClone(sample.data), content }, ...children] },
    });
    core = instance;
    await instance.isReady;

    const block = instance.moduleInstances.BlockManager.getBlockById('b');
    if (block === undefined) throw new Error(`Missing rendered ${name} block.`);

    if (!readOnly) {
      if (sample.state === 'filename editing') requireElement(block, '[data-blok-testid="code-filename"]').click();
      if (sample.state === 'column rename') requireElement(block, '[data-blok-database-column-title]').click();
      if (sample.state === 'view rename') {
        const tab = requireElement(block, '[data-blok-database-tab][data-view-id="board"]');
        tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await clickMenuTitle(instance.moduleInstances.I18n.t('tools.database.renameView'));
      }
      if (sample.state === 'card rename') {
        const button = await vi.waitFor(() => requireElement(block, '[data-blok-database-edit-card][data-row-id="r1"]'));
        button.click();
      }
      if (sample.state === 'inline tab rename') {
        const pill = await vi.waitFor(() => requireElement(block, '[data-blok-tabs-pill][data-tab-id="t1"]'));
        pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await clickMenuTitle(instance.moduleInstances.I18n.t('tools.tabs.rename'));
      }
      if (sample.state === 'configured host rename') {
        await vi.waitFor(() => {
          if (requireElement(block, '[data-blok-testid="page-title"]').textContent !== 'Existing page') throw new Error('Page metadata is not ready.');
        });
        await instance.moduleInstances.BlockSettings.open(block);
        clickPageRename();
      }
      if (sample.state === 'empty link form') {
        requireElement(block, '[data-blok-media-empty-state] [data-tab="embed"]').click();
      }
      if (['toggle open', 'toggle closed', 'rich toggle open', 'rich toggle closed'].includes(sample.state)) {
        instance.moduleInstances.ViewStateAPI.methods.set('b', 'open', sample.state.endsWith('open'));
      }
    }
    return { instance, block, pageHost };
  };

  it('covers all 25 registered built-in block tools', () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(BLOCK_CLASSES).sort());
    expect(Object.keys(BLOCK_CLASSES)).toHaveLength(25);
  });

  it.each(Object.entries(samples))('%s: checks raw caret slots and stable own-text mapping across states', async (name, states) => {
    const observed: Observation[] = [];

    for (const sample of states) {
      try {
        const { instance, block } = await boot(name, sample);
        const expected = sample.inputs.map(binding => {
          const ownerId = binding.ownerId ?? 'b';
          const owner = instance.moduleInstances.BlockManager.getBlockById(ownerId);
          if (owner === undefined) throw new Error(`Missing input owner ${ownerId}.`);
          return { binding, ownerId, element: requireElement(owner, binding.selector) };
        });

        // Block.inputs is also collaboration's index space; never replace it with a selector.
        await vi.waitFor(() => {
          expect(block.inputs, `${name}: ${sample.state} raw caret order`)
            .toEqual(expected.map(entry => entry.element));
        });

        const inputs = block.inputs.map((input, rawIndex): ObservedInput => {
          const entry = expected[rawIndex];
          if (entry === undefined) throw new Error(`Unmapped ${name} input ${rawIndex}.`);
          const { binding } = entry;
          const ownerId = binding.targetId ?? entry.ownerId;
          if (binding.field === undefined) {
            if (!isUncommittedUrl(input)) throw new Error(`Unsupported nondata exclusion: ${name} input ${rawIndex}.`);
            return { rawIndex, ownerId, kind: 'nondata' };
          }
          if (binding.scope === 'host' || binding.scope === 'nested') {
            return { rawIndex, field: binding.field, ownerId, kind: binding.scope };
          }
          if (ownerId !== 'b') return { rawIndex, field: binding.field, ownerId, kind: 'foreign' };
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            return { rawIndex, field: binding.field, ownerId, kind: 'native' };
          }
          const value = sample.data[binding.field];
          if (typeof value !== 'string' && !isRichText(value)) {
            throw new Error(`${name}: ${sample.state} input ${rawIndex} is not a top-level plain/rich-text field.`);
          }
          return { rawIndex, field: binding.field, ownerId, kind: 'owned-text' };
        });
        observed.push({ state: sample.state, inputs });
      } finally {
        await close();
      }
    }

    // Pre-submit URL forms are not shorter resident-field states.
    const resident = observed.filter(state => !state.inputs.some(input => input.kind === 'nondata'));
    const longest = resident.reduce<ObservedInput[]>(
      (result, state) => state.inputs.length > result.length ? state.inputs : result, [],
    );
    const optionalTrailing = name === 'audio' || name === 'file';
    const stableFields: string[] = [];
    for (const candidate of longest) {
      if (candidate.kind !== 'owned-text' || candidate.field === undefined) break;
      const stable = resident.every(state => {
        const slot = state.inputs[candidate.rawIndex];
        if (slot === undefined) return optionalTrailing && candidate.rawIndex >= state.inputs.length;
        return slot.kind === 'owned-text' && slot.field === candidate.field && slot.ownerId === 'b';
      });
      if (!stable) break;
      stableFields.push(candidate.field);
    }

    // Multi-input discovery retains nested, foreign and native data controls.
    const multiData = observed.some(state => state.inputs.filter(input => input.kind !== 'nondata').length > 1);
    const noOwnedText = longest.length > 0 &&
      !resident.some(state => state.inputs.some(input => input.kind === 'owned-text'));
    if (!multiData && !noOwnedText) return;

    const description = descriptionFor(name);
    // [] is intentional: absence could infer a rich-field slot that moved.
    expect(description.inputFields, `${name}: maximal stable raw-slot prefix`)
      .toEqual(stableFields);

    resident.forEach(state => {
      const present = state.inputs.filter(input => input.rawIndex < stableFields.length);
      if (stableFields.length > 0) {
        const actual = present.map(input => input.field);
        if (optionalTrailing) {
          expect(description.inputFields?.slice(0, present.length), `${name}: ${state.state} present prefix`)
            .toEqual(actual);
        } else {
          expect(description.inputFields, `${name}: ${state.state} complete supported prefix`)
            .toEqual(actual);
        }
      }
      const checkInput = (input: ObservedInput): void => {
        const diagnostic = `${name}: ${state.state} raw ${input.rawIndex} -> ${input.ownerId}.${input.field ?? '(nondata)'}`;
        if (input.rawIndex < stableFields.length) {
          expect(description.inputFields?.[input.rawIndex], diagnostic).toBe(input.field);
          expect(input.kind, diagnostic).toBe('owned-text');
          expect(input.ownerId, diagnostic).toBe('b');
          const properties = description.data.properties;
          if (!isRecord(properties)) throw new Error(`Missing data properties for ${name}.`);
          expect(Object.keys(properties)).toContain(input.field);
        } else {
          expect(description.inputFields?.[input.rawIndex], diagnostic).toBeUndefined();
        }
      };
      for (const input of state.inputs) checkInput(input);
    });
    // A declared optional suffix stays a candidate; absent slots need the 03 live guard.
    resident.forEach(state => {
      for (const [rawIndex, field] of stableFields.entries()) {
        if (state.inputs[rawIndex] === undefined) {
          expect(optionalTrailing, `${name}: ${state.state} missing ${field} at raw ${rawIndex}`).toBe(true);
          expect(state.inputs.length).toBeLessThanOrEqual(rawIndex);
        }
      }
    });
  }, 60_000);

  it.each(Object.entries(samples))('%s: read-only rendered data exposes no editable caret inputs', async (name, states) => {
    const sample = states[0];
    if (sample === undefined) throw new Error(`Missing ${name} fixture.`);
    const { block } = await boot(name, sample, true);
    expect(block.inputs).toEqual([]);
  }, 60_000);

  const plainTextCases = Object.entries(samples).flatMap(([name, states]) => {
    const sample = states[0];
    if (sample === undefined) throw new Error(`Missing ${name} fixture.`);
    return sample.inputs.flatMap(binding =>
      binding.ownerId === undefined && binding.field !== undefined && binding.field !== 'text' &&
      typeof sample.data[binding.field] === 'string'
        ? [{ name, sample, binding }]
        : [],
    );
  });

  it.each(plainTextCases)('$name: $binding.field plain-text input writes the named saved field', async ({ name, sample, binding }) => {
    const { block } = await boot(name, sample);
    const field = binding.field;
    if (field === undefined) throw new Error('Missing saved field.');
    const before = await block.data;
    const input = requireElement(block, binding.selector);
    const value = `Changed ${field}`;
    if (input instanceof HTMLInputElement) input.value = value;
    else input.textContent = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));

    const saved = await block.data;
    expect(saved[field]).toBe(value);
    expect({ ...saved, [field]: before[field] }).toEqual(before);
  }, 60_000);

  const richTextCases = Object.entries(samples).flatMap(([name, states]) =>
    states.filter(sample => isRichText(sample.data.text)).map(sample => ({ name, sample })),
  );

  it.each(richTextCases)('$name: $sample.state edits canonical segment text without writing siblings', async ({ name, sample }) => {
    const { instance, block } = await boot(name, sample);
    const binding = sample.inputs.find(input => input.field === 'text' && input.ownerId === undefined);
    if (binding === undefined) throw new Error(`Missing own rich-text binding for ${name}.`);
    const input = requireElement(block, binding.selector);
    const initialText = input.textContent;
    const initialBold = input.querySelector('strong, b')?.textContent;
    const before = await block.data;
    const children = await Promise.all((sample.children ?? []).flatMap(child =>
      child.id === undefined ? [] : [requireBlock(instance, child.id).data.then(data => ({ id: child.id, data }))],
    ));
    input.innerHTML = 'Changed <b>rich</b>';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));

    const saved = await instance.moduleInstances.SaverAPI.methods.save();
    const savedBlock = saved.blocks.find(entry => entry.id === 'b');
    if (savedBlock === undefined) throw new Error(`Missing saved ${name} block.`);
    expect(savedBlock.data.text).toEqual([{ text: 'Changed ' }, { text: 'rich', marks: { bold: true } }]);
    expect({ ...await block.data, text: before.text }).toEqual(before);
    for (const child of children) {
      if (child.id === undefined) throw new Error('Missing rich-text child id.');
      expect(await requireBlock(instance, child.id).data).toEqual(child.data);
    }
    expect(initialText).toBe('Rich text');
    expect(initialBold).toBe('Rich ');
    expect(block.inputs[0]).toBe(input);
  }, 60_000);

  it('filename editing writes filename, not code, and intentionally uses an empty map', async () => {
    const sample = samples.code.find(state => state.state === 'filename editing');
    if (sample === undefined) throw new Error('Missing filename-editing fixture.');
    const { block } = await boot('code', sample);
    const before = await block.data;
    const input = requireElement(block, '[data-blok-testid="code-filename-input"]');
    const code = requireElement(block, '[data-blok-testid="code-content"]');
    const editingInputs = block.inputs;
    if (!(input instanceof HTMLInputElement)) throw new Error('Filename is not a native input.');
    input.value = 'renamed.ts';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const saved = await block.data;
    expect(saved.filename).toBe('renamed.ts');
    expect({ ...saved, filename: before.filename }).toEqual(before);
    expect(editingInputs).toEqual([input, code]);
    expect(descriptionFor('code').inputFields).toEqual([]);
  }, 60_000);

  it('a database column rename writes the selected schema option, not the database title', async () => {
    const sample = samples.database.find(state => state.state === 'column rename');
    if (sample === undefined) throw new Error('Missing column-rename fixture.');
    const { block } = await boot('database', sample);
    const before = await block.data;
    const input = requireElement(block, '[data-blok-database-column-title-input]');
    const editingInputs = block.inputs;
    if (!(input instanceof HTMLInputElement)) throw new Error('Column rename is not a native input.');
    input.value = 'In progress';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const saved = await block.data;
    expect(saved.schema).toEqual([
      databaseData.schema[0],
      {
        id: 'status', name: 'Status', type: 'select', position: 'a1',
        config: { options: [{ id: 'todo', label: 'In progress', position: 'a0' }] },
      },
    ]);
    expect({ ...saved, schema: before.schema }).toEqual(before);
    expect(editingInputs).toEqual([requireElement(block, '[data-blok-database-title]'), input]);
    expect(descriptionFor('database').inputFields).toEqual(['title']);
    expect(descriptionFor('database').inputFields?.[1]).toBeUndefined();
  }, 60_000);

  it('view rename writes the selected view name, not a top-level database text field', async () => {
    const sample = samples.database.find(state => state.state === 'view rename');
    if (sample === undefined) throw new Error('Missing view-rename fixture.');
    const { block } = await boot('database', sample);
    const before = await block.data;
    if (!Array.isArray(before.views)) throw new Error('Missing database views.');
    const input = requireElement(block, '[data-blok-database-tab-rename-input]');
    if (!(input instanceof HTMLInputElement)) throw new Error('View rename is not a native input.');
    const editingInputs = block.inputs;
    input.value = 'Planning';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const saved = await block.data;
    if (!Array.isArray(saved.views)) throw new Error('Missing renamed database views.');
    const renamed = saved.views.find((view: unknown) => isRecord(view) && view.id === 'board');
    expect(isRecord(renamed) ? renamed.name : undefined).toBe('Planning');
    expect(saved).toEqual({
      ...before,
      views: before.views.map((view: unknown) => isRecord(view) && view.id === 'board' ? { ...view, name: 'Planning' } : view),
    });
    expect(editingInputs).toEqual([requireElement(block, '[data-blok-database-title]'), input]);
    expect(descriptionFor('database').inputFields).toEqual(['title']);
    expect(descriptionFor('database').inputFields?.[1]).toBeUndefined();
  }, 60_000);

  it('card rename writes the row title and title-property mirror, not the database title', async () => {
    const sample = samples.database.find(state => state.state === 'card rename');
    if (sample === undefined) throw new Error('Missing card-rename fixture.');
    const { instance, block } = await boot('database', sample);
    const row = requireBlock(instance, 'r1');
    const other = requireBlock(instance, 'r2');
    const before = await block.data;
    const rowBefore = await row.data;
    const otherBefore = await other.data;
    if (!isRecord(rowBefore.properties)) throw new Error('Missing row properties.');
    const input = requireElement(block, '[data-row-id="r1"] [data-blok-database-card-title-input]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Card rename is not a native input.');
    const editingInputs = block.inputs;
    input.value = 'Renamed row';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const saved = await row.data;
    expect(saved.title).toBe('Renamed row');
    expect(isRecord(saved.properties) ? saved.properties.name : undefined).toBe('Renamed row');
    expect(saved).toEqual({ ...rowBefore, title: 'Renamed row', properties: { ...rowBefore.properties, name: 'Renamed row' } });
    expect(await block.data).toEqual(before);
    expect(await other.data).toEqual(otherBefore);
    expect(editingInputs).toEqual([requireElement(block, '[data-blok-database-title]'), input]);
    expect(row.inputs).toEqual([]);
    expect(descriptionFor('database').inputFields).toEqual(['title']);
    expect(descriptionFor('database').inputFields?.[1]).toBeUndefined();
  }, 60_000);

  it('tabs inline rename writes the named child tab and leaves the parent and other children alone', async () => {
    const sample = samples.tabs.find(state => state.state === 'inline tab rename');
    if (sample === undefined) throw new Error('Missing tab-rename fixture.');
    const { instance, block } = await boot('tabs', sample);
    const target = requireBlock(instance, 't1');
    const before = await target.data;
    const parentBefore = await block.data;
    const unrelated = await Promise.all(['t2', 'p1', 'p2'].map(async id => ({ id, data: await requireBlock(instance, id).data })));
    const input = requireElement(block, '[data-blok-tabs-rename-input]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Tab rename is not a native input.');
    const editingInputs = block.inputs;
    input.value = 'Renamed tab';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(async () => expect((await target.data).title).toBe('Renamed tab'));
    expect(await target.data).toEqual({ ...before, title: 'Renamed tab' });
    expect(await block.data).toEqual(parentBefore);
    for (const entry of unrelated) expect(await requireBlock(instance, entry.id).data).toEqual(entry.data);
    expect(editingInputs).toEqual([
      input,
      requireElement(requireBlock(instance, 'p1'), '[data-blok-tool="paragraph"]'),
      requireElement(requireBlock(instance, 'p2'), '[data-blok-tool="paragraph"]'),
    ]);
    expect(descriptionFor('tabs').inputFields).toEqual([]);
    expect(descriptionFor('tab').inputFields).toEqual([]);
  }, 60_000);

  it('configured page rename changes host metadata and leaves the saved pointer unchanged', async () => {
    const sample = samples.page.find(state => state.state === 'configured host rename');
    if (sample === undefined) throw new Error('Missing host-rename fixture.');
    const { block, pageHost } = await boot('page', sample);
    if (pageHost === undefined) throw new Error('Missing configured page host.');
    const before = await block.data;
    const input = requireElement(block, '[data-blok-testid="page-rename-input"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Page rename is not a native input.');
    const editingInputs = block.inputs;
    input.value = 'Renamed page';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(pageHost.titles['existing-page']).toBe('Renamed page'));
    expect(await block.data).toEqual(before);
    expect(pageHost.titles['other-page']).toBe('Other page');
    expect(pageHost.writes).toEqual([{ pageId: 'existing-page', title: 'Renamed page' }]);
    expect(editingInputs).toEqual([input]);
    expect(descriptionFor('page').inputFields).toEqual([]);
  }, 60_000);
});
