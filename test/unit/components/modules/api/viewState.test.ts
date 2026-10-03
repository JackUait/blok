import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { ViewStateAPI } from '../../../../../src/components/modules/api/viewState';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import { Header } from '../../../../../src/tools/header';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, BlokConfig, OutputData } from '../../../../../types';

const createViewStateApi = (
  config: BlokConfig,
  recordId: () => string = () => config.data?.id ?? 'minted'
): ViewStateAPI => {
  const moduleConfig: ModuleConfig = {
    config,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };
  const api = new ViewStateAPI(moduleConfig);

  api.state = {
    Saver: { getDocumentRecordId: recordId },
    BlockManager: { isCreatedHere: (id: string) => id === 'mine' },
  } as unknown as BlokModules;

  return api;
};

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  history: API['history'];
  viewState: API['viewState'];
}

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

const editors: TestEditor[] = [];

const createRealEditor = async (config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({ holder, tools: { paragraph: Paragraph }, ...config }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

describe('ViewStateAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    [{ documentId: 'doc-1' }, 'doc-1'],
    [{ collaboration: { doc: 'room-1' }, server: '/s' }, 'room-1'],
    [{ data: { id: 'rec-1', blocks: [] } }, 'rec-1'],
  ])('scopes storage to the document (%#), with or without tab sync', (config, scope) => {
    const api = createViewStateApi({ ...config, tabSync: false });

    api.methods.set('b1', 'open', true);

    expect(localStorage.getItem(`blok:view:${scope}:b1:open`)).not.toBeNull();
    api.destroy();
  });

  it('round-trips a value and reports changes', () => {
    const api = createViewStateApi({ documentId: 'doc-1' });
    const listener = vi.fn();

    api.methods.onChange('b1', 'open', listener);
    api.methods.set('b1', 'open', true);

    expect(api.methods.get('b1', 'open')).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
    api.destroy();
  });

  it('follows the document id when the host renders another document', () => {
    const current = { id: 'rec-1' };
    const api = createViewStateApi({}, () => current.id);

    api.methods.set('b1', 'open', true);
    current.id = 'rec-2';

    expect(api.methods.get('b1', 'open')).toBeUndefined();
    api.methods.set('b1', 'open', false);
    expect(localStorage.getItem('blok:view:rec-2:b1:open')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('blok:view:rec-1:b1:open') ?? 'null')).toMatchObject({ v: true });
    api.destroy();
  });

  it('asks BlockManager whether a block was created here', () => {
    const api = createViewStateApi({ documentId: 'doc-1' });

    expect(api.methods.isCreatedHere('mine')).toBe(true);
    expect(api.methods.isCreatedHere('other')).toBe(false);
    api.destroy();
  });

  it('stops hearing other tabs after destroy', () => {
    const api = createViewStateApi({ documentId: 'doc-1' });
    const listener = vi.fn();

    api.methods.onChange('b1', 'open', listener);
    api.destroy();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'blok:view:doc-1:b1:open',
      newValue: JSON.stringify({ v: true, t: Date.now() }),
    }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports a block inserted after render as created here, and a rendered one as not', async () => {
    const editor = await createRealEditor({ data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] } });
    const inserted = editor.blocks.insert('paragraph', { text: 'y' });

    expect(editor.viewState.isCreatedHere(inserted.id)).toBe(true);
    expect(editor.viewState.isCreatedHere('loaded')).toBe(false);
  });

  it('keeps a loaded block not-created-here when an update re-composes it', async () => {
    const editor = await createRealEditor({ data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] } });

    await editor.blocks.update('loaded', { text: 'changed' });

    expect(editor.viewState.isCreatedHere('loaded')).toBe(false);
  });

  it('reports a block brought back by redo as not created here', async () => {
    const editor = await createRealEditor({ data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] } });
    const inserted = editor.blocks.insert('paragraph', { text: 'y' });

    editor.history.undo();
    await settle();
    editor.history.redo();
    await settle();

    expect(editor.blocks.getById(inserted.id)).not.toBeNull();
    expect(editor.viewState.isCreatedHere(inserted.id)).toBe(false);
  });

  it('reports a saved block converted here as created here', async () => {
    const editor = await createRealEditor({
      tools: { paragraph: Paragraph, header: Header },
      data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] },
    });

    const converted = await editor.blocks.convert('loaded', 'header');

    expect(editor.viewState.isCreatedHere(converted.id)).toBe(true);
    expect(converted.id).toBe('loaded');
  });

  it('reports a converted block as not created here after undo and redo', async () => {
    const editor = await createRealEditor({
      tools: { paragraph: Paragraph, header: Header },
      data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] },
    });

    await editor.blocks.convert('loaded', 'header');
    editor.history.undo();
    await settle();

    expect(editor.viewState.isCreatedHere('loaded')).toBe(false);
    expect(editor.blocks.getById('loaded')?.name).toBe('paragraph');

    editor.history.redo();
    await settle();

    expect(editor.viewState.isCreatedHere('loaded')).toBe(false);
    expect(editor.blocks.getById('loaded')?.name).toBe('header');
  });

  it('reports blocks inserted in bulk as created here', async () => {
    const editor = await createRealEditor({ data: { blocks: [{ id: 'loaded', type: 'paragraph', data: { text: 'x' } }] } });

    editor.blocks.insertMany([{ id: 'bulk', type: 'paragraph', data: { text: 'y' } }]);

    expect(editor.viewState.isCreatedHere('bulk')).toBe(true);
  });

  it('is reachable on the editor instance', async () => {
    const editor = await createRealEditor();

    expect(typeof editor.viewState.get).toBe('function');
  });
});
