import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Workspace } from './workspace';
import type { WorkspaceIndex } from './storage';
import type { createPageFrame } from '@blok/sidebar';
import type * as SidebarModule from '@blok/sidebar';
type PageFrameOptions = Parameters<typeof createPageFrame>[0];
const state = vi.hoisted(() => ({ editors: [] as Array<{ holder: HTMLElement; data: unknown; configuredReadOnly(): boolean; rename(title: string): void; destroyed: boolean; flush: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>, sidebarAction: null as PageFrameOptions['onAction'] | null }));
vi.mock('@bloklabs/core/full', () => ({ allTools: {}, Blok: class {
  isReady: Promise<void>;
  data: unknown;
  destroyed = false;
  holder: HTMLElement;
  titleText = '';
  constructor(private config: { holder: HTMLElement; readOnly?: boolean; pageTitle?: { onChange(title: string, change: {source: 'user' | 'remote'}): void }; persistence?: { load(): Promise<unknown>; save(data: unknown): Promise<void> } }) {
    this.holder = config.holder;
    const redactor = document.createElement('div'); redactor.dataset.blokRedactor = ''; this.holder.append(redactor);
    state.editors.push(this);
    this.isReady = Promise.resolve(config.persistence?.load()).then(data => { this.data = data; });
  }
  width = { set: vi.fn() };
  theme = { set: vi.fn() };
  title = { get: () => this.titleText, set: (text: string) => { this.titleText = text; }, icon: { get: () => undefined } };
  toolbar = { close: vi.fn(), toggleBlockSettings: vi.fn(), toggleToolbox: vi.fn() };
  inlineToolbar = { close: vi.fn() };
  blocks = { getById: () => undefined };
  on = vi.fn();
  configuredReadOnly(): boolean { return this.config.readOnly === true; }
  rename(title: string): void { this.titleText = title; this.config.pageTitle?.onChange(title, {source: 'user'}); }
  flush = vi.fn(async () => undefined);
  saver = { flush: this.flush };
  save = async () => this.data;
  destroy = vi.fn(() => { this.destroyed = true; });
} }));
vi.mock('@blok/sidebar', async importOriginal => {
  const actual = await importOriginal<typeof SidebarModule>();
  return { ...actual, createPageFrame: (options: PageFrameOptions) => {
    state.sidebarAction = options.onAction;
    return actual.createPageFrame(options);
  } };
});
vi.mock('./page-comments', () => ({ mountPageComments: () => ({ element: document.createElement('div'), destroy: vi.fn() }) }));
vi.mock('./floating-toc', () => ({ createFloatingToc: () => ({ element: document.createElement('div'), destroy: vi.fn() }) }));
vi.mock('@blok/agent-assistant', () => ({ mountAgentAssistant: () => { const element = document.createElement('div'); const editorSlot = document.createElement('div'); element.append(editorSlot); return ({ element, editorSlot, open: vi.fn(), close: vi.fn(), destroy: vi.fn(), toggle: vi.fn() }); } }));
let workspace: Workspace;
beforeEach(async () => {
  vi.clearAllMocks();
  state.editors.length = 0;
  state.sidebarAction = null;
  localStorage.clear(); document.body.replaceChildren();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  localStorage.setItem('blok:workspace:cache-test:index', JSON.stringify({ pages: ['a','b','c','d'].map(id => ({id,title:id,parentId:null})), activeId: 'a' }));
  for (const id of ['a','b','c','d']) localStorage.setItem(`blok:workspace:cache-test:${id}`, JSON.stringify({blocks: [{id:'p',type:'paragraph',data:{text:id}}]}));
  history.replaceState(null, '', '?page=a');
  const {createWorkspace} = await import('./workspace');
  workspace = createWorkspace(() => undefined, () => undefined, {ref: {kind:'local',id:'cache-test',name:'Test'}});
  document.body.append(workspace.element); await workspace.start();
  await vi.waitFor(() => expect(document.title).toBe('a'));
});
afterEach(() => { workspace?.destroy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
function editorAt(index: number) {
  const editor = state.editors[index];
  if (!editor) throw new Error(`Missing editor ${index}`);
  return editor;
}
async function go(id: string): Promise<void> {
  history.replaceState(null, '', `?page=${id}`); workspace.onRoute();
  await vi.waitFor(() => expect(document.title).toBe(id));
}
it('reuses a rendered page on A → B → A, with only the visible editor accepting input', async () => {
  const first = editorAt(0);
  await go('b');
  expect(first.destroyed).toBe(false);
  expect(first.holder.closest('[inert]')).not.toBeNull();
  expect(first.holder.isConnected).toBe(false);
  await go('a');
  expect(state.editors).toHaveLength(2);
  expect(first.holder.isConnected).toBe(true);
  expect(first.holder.closest('[inert]')).toBeNull();
  expect(first.flush).toHaveBeenCalled();
});
it('evicts the least recent page and destroys every retained editor on workspace disposal', async () => {
  await go('b'); await go('c'); await go('a');
  expect(state.editors).toHaveLength(3);
  await go('d');
  expect(editorAt(1).destroyed).toBe(true);
  expect(editorAt(0).destroyed).toBe(false);
  workspace.destroy();
  expect(state.editors.every(editor => editor.destroyed)).toBe(true);
  workspace.onRoute();
  expect(state.editors).toHaveLength(4);
});
it('reloads a local page when another writer changed it while it was cached', async () => {
  const first = editorAt(0); await go('b');
  localStorage.setItem('blok:workspace:cache-test:a', JSON.stringify({blocks:[{id:'fresh',type:'paragraph',data:{text:'Other writer'}}]}));
  await go('a');
  expect(first.destroyed).toBe(true);
  expect(state.editors).toHaveLength(3);
  const stored = JSON.parse(localStorage.getItem('blok:workspace:cache-test:a') ?? '{}') as {blocks: Array<{id: string}>};
  expect(stored.blocks[0]?.id).toBe('fresh');
});

function requestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(body) as unknown;
}

async function startRemote(): Promise<{ index: WorkspaceIndex; writes: WorkspaceIndex[] }> {
  workspace.destroy();
  document.body.replaceChildren();
  state.editors.length = 0;
  const server = {
    index: {
      pages: ['a', 'b'].map(id => ({id, title: id, parentId: null})), activeId: 'a',
      access: {a: {level: 'full' as const}, b: {level: 'full' as const}},
    } as WorkspaceIndex,
    writes: [] as WorkspaceIndex[],
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const inputUrl = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(inputUrl, location.href);
    if (url.pathname.endsWith('/index')) {
      if (init?.method === 'PUT') {
        const body = requestBody(init.body) as WorkspaceIndex;
        server.index.pages = body.pages;
        server.writes.push(structuredClone(body));
      }
      return Response.json({...structuredClone(server.index), revision: 1});
    }
    if (url.pathname.endsWith('/duplicate')) {
      const copy = requestBody(init?.body) as WorkspaceIndex['pages'][number];
      server.index.pages.push(copy);
      if (server.index.access) server.index.access[copy.id] = {level: 'full'};
      return Response.json({});
    }
    if (url.pathname.endsWith('/teamspaces')) return Response.json({teamspaces: []});
    return Response.json({});
  }));
  history.replaceState(null, '', '?page=a');
  const {createWorkspace} = await import('./workspace');
  workspace = createWorkspace(() => undefined, () => undefined, {ref: {
    kind: 'remote', id: 'remote-cache', name: 'Remote', accountId: 'user', workspaceId: 'cache-test', server: location.origin, role: 'admin',
  }});
  document.body.append(workspace.element);
  await workspace.start();
  await vi.waitFor(() => expect(document.title).toBe('a'));
  return server;
}

it('saves a warm page title after remote duplication replaced the manifest objects', async () => {
  const server = await startRemote();
  const first = state.editors[0];
  expect(first).toBeDefined();
  await go('b');
  state.sidebarAction?.({id: 'b', type: 'duplicate'});
  await vi.waitFor(() => expect(document.title).toBe('b (copie)'));
  await go('a');
  expect(state.editors).toHaveLength(3);
  first?.rename('Changed from warm editor');
  await workspace.flush();

  expect(server.writes.at(-1)?.pages.find(page => page.id === 'a')?.title).toBe('Changed from warm editor');
});

it('persists recent local edits before caching and reuses the same editor on return', async () => {
  const first = state.editors[0];
  if (!first) throw new Error('Missing initial editor');
  first.data = {blocks: [{id: 'p', type: 'paragraph', data: {text: 'Recent edit'}}]};

  await go('b');

  const stored = JSON.parse(localStorage.getItem('blok:workspace:cache-test:a') ?? '{}') as {blocks: Array<{data: {text: string}}>};
  expect(stored.blocks[0]?.data.text).toBe('Recent edit');
  await go('a');
  expect(state.editors).toHaveLength(2);
  expect(first.destroyed).toBe(false);
  expect(first.holder.isConnected).toBe(true);
  await workspace.flush();
  expect(localStorage.getItem('blok:workspace:cache-test:a')).toContain('Recent edit');
});

it('disposes a warm remote editor when its edit access is reduced before reopening', async () => {
  const server = await startRemote();
  const first = editorAt(0);
  await go('b');
  if (!server.index.access) throw new Error('Missing access map');
  server.index.access.a = {level: 'view'};

  window.dispatchEvent(new Event('focus'));

  await vi.waitFor(() => expect(first.destroyed).toBe(true));
  await go('a');
  expect(state.editors).toHaveLength(3);
  expect(editorAt(2).configuredReadOnly()).toBe(true);
});

it('disposes a warm remote editor when its page disappears from the accessible manifest', async () => {
  const server = await startRemote();
  const first = editorAt(0);
  await go('b');
  server.index.pages = server.index.pages.filter(page => page.id !== 'a');
  if (server.index.access) delete server.index.access.a;

  window.dispatchEvent(new Event('focus'));

  await vi.waitFor(() => expect(first.destroyed).toBe(true));
  expect(first.holder.isConnected).toBe(false);
  expect(document.title).toBe('b');
  await workspace.flush();
  expect(server.index.pages.some(page => page.id === 'a')).toBe(false);
});
