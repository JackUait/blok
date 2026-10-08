import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title, TitleChange } from '../../../types/api/title';

import { createPageStore, handlePageHostRequest } from '../../../scripts/dev-page-host.mjs';
import { PAGES_STORAGE_KEY, PageRegistry, type PageMap } from '../../../src/playground/page-host';
import {
  PageHostError,
  RemotePageHost,
  hostedPages,
  remotePagePlayground,
  remotePageTool,
  wireTitle,
  type EventStreamLike,
  type WiredTitleEditor,
} from '../../../src/playground/remote-page-host';

type Store = ReturnType<typeof createPageStore>;

const BASE = 'http://host.test';

const seedStore = (): Store => createPageStore([
  { pageId: 'plan', title: 'Plan', icon: '📘', acl: { alice: 'write', bob: 'write' } },
]);

/** A `fetch` answered by the reference host's own handler, with no socket. */
const hostFetch = (store: Store, hold?: (path: string, user: string | null) => Promise<void> | undefined) =>
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const user = new Headers(init?.headers).get('x-dev-user');
    // Answered at arrival: a held answer is stale, like a slow network makes it.
    const answer = handlePageHostRequest({
      store,
      user,
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    await hold?.(url.pathname, user);

    return new Response(answer.body ?? null, { status: answer.status });
  };

class FakeEvents implements EventStreamLike {
  public static opened: FakeEvents[] = [];

  public onmessage: ((event: { data: string }) => void) | null = null;

  public closed = false;

  constructor(public readonly url: string) {
    FakeEvents.opened.push(this);
  }

  public emit(pageId: string): void {
    this.onmessage?.({ data: JSON.stringify({ pageId }) });
  }

  public close(): void {
    this.closed = true;
  }
}

const deferred = (): { promise: Promise<void>; release: () => void } => {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const makeHost = (store: Store, user = 'alice', hold?: Parameters<typeof hostFetch>[1]): RemotePageHost => new RemotePageHost({
  baseUrl: BASE,
  user,
  fetch: hostFetch(store, hold),
  openEvents: (url) => new FakeEvents(url),
});

/** The editor's built-in title as wireTitle sees it, with user input driven by the test. */
const fakeTitle = (): {
  editor: WiredTitleEditor;
  sets: Array<{ value: string; record: boolean }>;
  listen(onChange: (title: string, change: TitleChange) => void): void;
  type(value: string): void;
  undoTo(value: string): void;
  remote(value: string): void;
  value(): string;
} => {
  let value = '';
  let callback: ((title: string, change: TitleChange) => void) | undefined;
  const sets: Array<{ value: string; record: boolean }> = [];
  const fire = (next: string, change: TitleChange): void => {
    value = next;
    callback?.(next, change);
  };

  return {
    editor: {
      title: {
        get: () => value,
        // Like core: an equal value writes nothing and fires nothing.
        set: (next, options) => {
          sets.push({ value: next, record: options?.record !== false });
          if (next !== value) {
            fire(next, options?.record === false ? { source: 'api', record: false } : { source: 'api' });
          }
        },
      },
    },
    sets,
    listen(onChange) {
      callback = onChange;
    },
    type: (next) => fire(next, { source: 'user' }),
    undoTo: (next) => fire(next, { source: 'undo' }),
    remote: (next) => fire(next, { source: 'remote' }),
    value: () => value,
  };
};

/** wireTitle with the editor's onChange routed to it, as the playground does. */
const wireTo = async (
  store: Store,
  title = fakeTitle(),
  paint: (value: string) => void = vi.fn(),
  showError: () => void = vi.fn(),
  host: RemotePageHost = makeHost(store)
): Promise<{ title: ReturnType<typeof fakeTitle>; wired: Awaited<ReturnType<typeof wireTitle>> }> => {
  const wired = await wireTitle('plan', host, title.editor, paint, showError);

  title.listen((value, change) => wired.change(value, change));

  return { title, wired };
};

beforeEach(() => {
  vi.clearAllMocks();
  FakeEvents.opened = [];
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RemotePageHost', () => {
  it('never lets the browser cache or queue a host answer', async () => {
    const store = seedStore();
    const seen: Array<RequestCache | undefined> = [];
    const answer = hostFetch(store);
    const host = new RemotePageHost({
      baseUrl: BASE,
      user: 'alice',
      fetch: (input, init) => {
        seen.push(init?.cache);

        return answer(input, init);
      },
      openEvents: (url) => new FakeEvents(url),
    });

    await host.resolve('plan');
    await host.loadPage('plan');
    await host.saveTitle('plan', 'x', 1);

    expect(seen).toEqual(['no-store', 'no-store', 'no-store']);
  });

  it('loads a readable record', async () => {
    await expect(makeHost(seedStore()).loadPage('plan')).resolves.toEqual({ pageId: 'plan', title: 'Plan', icon: '📘', version: 1 });
  });

  it('rejects loadPage on a denied or missing page', async () => {
    await expect(makeHost(seedStore(), 'carol').loadPage('plan')).rejects.toMatchObject({ status: 403 });
    await expect(makeHost(seedStore()).loadPage('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('saves a title with compare-and-swap and rejects a stale version with 409', async () => {
    const host = makeHost(seedStore());

    await expect(host.saveTitle('plan', 'New', 1)).resolves.toMatchObject({ title: 'New', version: 2 });

    const stale = host.saveTitle('plan', 'Older', 1);

    await expect(stale).rejects.toBeInstanceOf(PageHostError);
    await expect(stale).rejects.toMatchObject({ status: 409 });
  });

  it('resolves page info: allowed, denied, missing, and unresolved on a network error', async () => {
    const store = seedStore();

    await expect(makeHost(store).resolve('plan')).resolves.toEqual({ title: 'Plan', icon: { type: 'emoji', value: '📘' } });
    await expect(makeHost(store, 'carol').resolve('plan')).resolves.toEqual({ access: 'none' });
    await expect(makeHost(store).resolve('nope')).resolves.toBeNull();

    const offline = new RemotePageHost({
      baseUrl: BASE,
      user: 'alice',
      fetch: () => Promise.reject(new Error('offline')),
      openEvents: (url) => new FakeEvents(url),
    });

    await expect(offline.resolve('plan')).resolves.toBeUndefined();
  });

  it('lets the latest request win: a late allowed answer does not undo a later denial', async () => {
    const store = seedStore();
    const first = deferred();
    let calls = 0;
    const host = makeHost(store, 'bob', () => {
      calls += 1;

      return calls === 1 ? first.promise : undefined;
    });

    const stale = host.resolve('plan');

    await settle();
    handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'bob', access: null }) });

    await expect(host.resolve('plan')).resolves.toEqual({ access: 'none' });

    first.release();

    await expect(stale).resolves.toEqual({ access: 'none' });
    expect(host.verdict('plan')).toEqual({ access: 'none' });
  });

  it('lets a later allowed answer replace an earlier denial', async () => {
    const store = seedStore();
    const host = makeHost(store, 'bob');

    handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'bob', access: null }) });
    await host.resolve('plan');
    handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'bob', access: 'read' }) });

    await expect(host.resolve('plan')).resolves.toMatchObject({ title: 'Plan' });
  });

  it('tells a verdict listener when a page\'s verdict changes', async () => {
    const host = makeHost(seedStore());
    const listener = vi.fn();

    host.onVerdict(listener);
    await host.resolve('plan');
    await host.resolve('plan');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('plan');
  });

  it('notifies a page\'s subscribers from the event stream and from this tab, one stream per host', () => {
    const host = makeHost(seedStore());
    const plan = vi.fn();
    const other = vi.fn();

    const stop = host.subscribe('plan', plan);

    host.subscribe('other', other);

    expect(FakeEvents.opened).toHaveLength(1);
    expect(FakeEvents.opened[0].url).toBe(`${BASE}/events?user=alice`);

    FakeEvents.opened[0].emit('plan');
    host.notify('plan');

    expect(plan).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();

    stop();
    FakeEvents.opened[0].emit('plan');
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('creates a page on the host, idempotently', async () => {
    const store = seedStore();
    const host = makeHost(store, 'carol');

    await host.create('fresh');
    await host.create('fresh');

    expect(store.pages.get('fresh')).toMatchObject({ pageId: 'fresh', version: 1, acl: { carol: 'write' } });
  });
});

describe('wireTitle', () => {
  it('takes the editor\'s built-in title as it is', () => {
    // tsc fails here if the real Title stops fitting what wireTitle needs.
    const narrow = (title: Title): WiredTitleEditor['title'] => title;

    expect(narrow).toBeTypeOf('function');
  });

  it('shows the host title in the editor at once, with no undo step', async () => {
    const { title } = await wireTo(seedStore());

    expect(title.value()).toBe('Plan');
    expect(title.sets).toEqual([{ value: 'Plan', record: false }]);
  });

  it('saves a typed title and paints the accepted one', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const { title } = await wireTo(store, fakeTitle(), paint, showError);

    title.type('Renamed');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Renamed', version: 2 });
    expect(paint).toHaveBeenLastCalledWith('Renamed');
    expect(showError).not.toHaveBeenCalled();
  });

  it('rolls back to the host\'s accepted title and shows an error on a 409', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const { title } = await wireTo(store, fakeTitle(), paint, showError);

    // Another user's save lands first; this tab still holds version 1.
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'Theirs', expectedVersion: 1 }) });
    title.type('Mine');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('Theirs');
    expect(title.value()).toBe('Theirs');
    expect(title.sets.at(-1)).toEqual({ value: 'Theirs', record: false });
    expect(showError).toHaveBeenCalledTimes(1);
    expect(store.pages.get('plan')).toMatchObject({ title: 'Theirs', version: 2 });
  });

  it('rolls back and shows an error when a save fails', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const { title } = await wireTo(store, fakeTitle(), paint, showError);

    handlePageHostRequest({ store, user: null, method: 'POST', path: '/__faults', body: JSON.stringify({ user: 'alice', failNextSave: true }) });
    title.type('Doomed');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('Plan');
    expect(title.value()).toBe('Plan');
    expect(showError).toHaveBeenCalledTimes(1);
    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 1 });
  });

  it('writes an Undo to the host as a new version', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const { title } = await wireTo(store, fakeTitle(), paint);

    title.type('Renamed');
    await settle();
    title.undoTo('Plan');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 3 });
    expect(paint).toHaveBeenLastCalledWith('Plan');
  });

  it('sends rapid edits in order, each on the latest accepted version', async () => {
    const store = seedStore();
    const { title } = await wireTo(store);

    title.type('R');
    title.type('Re');
    title.type('Ren');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Ren', version: 4 });
    expect(title.value()).toBe('Ren');
  });

  it('shows only the latest write\'s verdict: an older answer never overwrites newer typing', async () => {
    const store = seedStore();
    const first = deferred();
    let saves = 0;
    const host = makeHost(store, 'alice', (path) => {
      if (path.endsWith('/title')) {
        saves += 1;

        return saves === 1 ? first.promise : undefined;
      }

      return undefined;
    });
    const { title } = await wireTo(store, fakeTitle(), vi.fn(), vi.fn(), host);

    title.type('Re');
    await settle();
    title.type('Ren');
    const before = title.sets.length;

    first.release();
    await settle();

    // The answer for 'Re' came back while 'Ren' was queued: no record:false write of 'Re'.
    expect(title.sets.slice(before).some((set) => set.value === 'Re')).toBe(false);
    expect(title.value()).toBe('Ren');
    expect(store.pages.get('plan')).toMatchObject({ title: 'Ren', version: 3 });
  });

  it('holds a host refresh while saves are in flight', async () => {
    const store = seedStore();
    const save = deferred();
    const host = makeHost(store, 'alice', (path, user) => (path.endsWith('/title') && user === 'alice' ? save.promise : undefined));
    const { title } = await wireTo(store, fakeTitle(), vi.fn(), vi.fn(), host);

    title.type('Mine');
    await settle();
    FakeEvents.opened[0].emit('plan');
    await settle();

    // The refresh read the host's old 'Plan' while 'Mine' was in flight; it must not show it.
    expect(title.value()).toBe('Mine');

    save.release();
    await settle();

    expect(title.value()).toBe('Mine');
    expect(store.pages.get('plan')).toMatchObject({ title: 'Mine', version: 2 });
  });

  it('lets only the latest host read decide what the title shows', async () => {
    const store = seedStore();
    const firstRead = deferred();
    let reads = 0;
    const host = makeHost(store, 'alice', (path) => {
      if (path === '/pages/plan') {
        reads += 1;

        // Read 1 is the load in wireTitle; read 2 is the first refresh.
        return reads === 2 ? firstRead.promise : undefined;
      }

      return undefined;
    });
    const { title } = await wireTo(store, fakeTitle(), vi.fn(), vi.fn(), host);

    FakeEvents.opened[0].emit('plan');
    await settle();
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'Newer', expectedVersion: 1 }) });
    FakeEvents.opened[0].emit('plan');
    await settle();
    firstRead.release();
    await settle();

    expect(title.value()).toBe('Newer');
  });

  it('shows the host\'s title, not the mirror value, on a remote change, and never saves it', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const host = makeHost(store);
    const save = vi.spyOn(host, 'saveTitle');
    const { title } = await wireTo(store, fakeTitle(), paint, vi.fn(), host);

    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'From Bob', expectedVersion: 1 }) });
    title.remote('A stale mirror');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('From Bob');
    expect(title.value()).toBe('From Bob');
    expect(save).not.toHaveBeenCalled();
  });

  it('does not save its own record:false write back to the host', async () => {
    const store = seedStore();
    const host = makeHost(store);
    const save = vi.spyOn(host, 'saveTitle');
    const { title } = await wireTo(store, fakeTitle(), vi.fn(), vi.fn(), host);

    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'From Bob', expectedVersion: 1 }) });
    FakeEvents.opened[0].emit('plan');
    await settle();

    expect(title.value()).toBe('From Bob');
    expect(title.sets.at(-1)).toEqual({ value: 'From Bob', record: false });
    expect(save).not.toHaveBeenCalled();
  });

  it('clears the title and stops on access loss', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const { title } = await wireTo(store, fakeTitle(), paint);

    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'alice', access: null }) });
    FakeEvents.opened[0].emit('plan');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('');

    paint.mockClear();
    FakeEvents.opened[0].emit('plan');
    title.type('After the loss');
    await settle();
    expect(paint).not.toHaveBeenCalled();
    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 1 });
  });

  it('clears the title, stops and reports when a failed save cannot reload the page', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const save = deferred();
    const host = makeHost(store, 'alice', (path) => (path.endsWith('/title') ? save.promise : undefined));
    const { title } = await wireTo(store, fakeTitle(), paint, showError, host);

    handlePageHostRequest({ store, user: null, method: 'POST', path: '/__faults', body: JSON.stringify({ user: 'alice', failNextSave: true }) });
    title.type('Doomed');
    // The save's own notify refreshes first, while access still holds; then access goes.
    await settle();
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'alice', access: null }) });
    save.release();
    await settle();

    expect(paint).toHaveBeenLastCalledWith('');
    expect(showError).toHaveBeenCalledTimes(1);

    paint.mockClear();
    FakeEvents.opened[0].emit('plan');
    await settle();
    expect(paint).not.toHaveBeenCalled();
  });
});

describe('remotePagePlayground', () => {
  const localSeed = (): PageMap => ({
    plan: { title: 'Local plan', parentId: null, blocks: [] },
    other: { title: 'Other', parentId: null, blocks: [] },
  });

  const playground = (store: Store, hold?: Parameters<typeof hostFetch>[1]): ReturnType<typeof remotePagePlayground> => remotePagePlayground({
    baseUrl: BASE,
    user: 'alice',
    local: new PageRegistry(localSeed()),
    rerender: vi.fn(),
    fetch: hostFetch(store, hold),
    openEvents: (url) => new FakeEvents(url),
  });

  /** A fake title whose onChange goes through the playground, as buildConfig wires it. */
  const editorFor = (remote: ReturnType<typeof remotePagePlayground>, pageId: string | null): ReturnType<typeof fakeTitle> => {
    const title = fakeTitle();

    title.listen((value, change) => remote.titleChanged(pageId, value, change));

    return title;
  };

  afterEach(() => {
    document.documentElement.removeAttribute('data-page-host-wired');
    document.body.replaceChildren();
  });

  it('marks the page wired once the host answered, and routes typing to the host', async () => {
    const store = seedStore();
    const remote = playground(store);
    const title = editorFor(remote, 'plan');

    await remote.wire('plan', title.editor);

    expect(document.documentElement.getAttribute('data-page-host-wired')).toBe('plan');
    expect(title.value()).toBe('Plan');

    title.type('Renamed');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Renamed', version: 2 });
    expect(remote.pages.get('plan')?.title).toBe('Renamed');
  });

  it('saves a title typed before the host answered, once, and keeps it on screen', async () => {
    const store = seedStore();
    const load = deferred();
    const remote = playground(store, (path) => (path === '/pages/plan' ? load.promise : undefined));
    const title = editorFor(remote, 'plan');
    const wiring = remote.wire('plan', title.editor);

    title.type('Typed early');
    load.release();
    await wiring;
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Typed early', version: 2 });
    expect(title.value()).toBe('Typed early');
    // The host title goes in first with no undo step, then the typed one as a step: undo returns to the host's.
    expect(title.sets).toEqual([
      { value: 'Plan', record: false },
      { value: 'Typed early', record: true },
      { value: 'Typed early', record: false },
    ]);
  });

  it('drops a title typed before the host answered when another page is wired first', async () => {
    const store = seedStore();
    const load = deferred();
    const remote = playground(store, (path) => (path === '/pages/plan' ? load.promise : undefined));
    const first = editorFor(remote, 'plan');
    const wiring = remote.wire('plan', first.editor);

    first.type('Typed early');
    await remote.wire(null, editorFor(remote, null).editor);
    load.release();
    await wiring;
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 1 });
    expect(document.documentElement.getAttribute('data-page-host-wired')).toBeNull();
  });

  it('ignores a late change from an editor whose page is no longer wired', async () => {
    const store = seedStore();
    const remote = playground(store);
    const first = editorFor(remote, 'plan');

    await remote.wire('plan', first.editor);
    await remote.wire(null, editorFor(remote, null).editor);

    first.undoTo('Late undo');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 1 });
  });

  it('clears the editor\'s title when access is lost', async () => {
    const store = seedStore();
    const remote = playground(store);
    const title = editorFor(remote, 'plan');

    await remote.wire('plan', title.editor);
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'alice', access: null }) });
    FakeEvents.opened.forEach((events) => events.emit('plan'));
    await settle();

    expect(title.value()).toBe('');
    expect(title.sets.at(-1)).toEqual({ value: '', record: false });
  });
});

describe('hostedPages', () => {
  const localSeed = (): PageMap => ({
    plan: { title: 'Local plan', icon: '🗒️', parentId: null, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Body' } }] },
    child: { title: 'Local child', parentId: 'plan', blocks: [] },
  });

  it('shows host titles and icons, and nothing until the host answers', async () => {
    const host = makeHost(seedStore());
    const { pages } = hostedPages(new PageRegistry(localSeed()), host);

    expect(pages.get('plan')).toMatchObject({ title: '', parentId: null });
    expect(pages.get('plan')?.icon).toBeUndefined();

    await host.resolve('plan');

    expect(pages.get('plan')).toMatchObject({ title: 'Plan', icon: '📘', blocks: [{ id: 'p1' }] });
    expect(pages.trail('plan').map((page) => page.title)).toEqual(['Plan']);
  });

  it('shows no title or icon for a denied page, even after an allowed one', async () => {
    const store = seedStore();
    const host = makeHost(store, 'bob');
    const { pages } = hostedPages(new PageRegistry(localSeed()), host);

    await host.resolve('plan');
    handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'bob', access: null }) });
    await host.resolve('plan');

    expect(pages.get('plan')?.title).toBe('');
    expect(pages.get('plan')?.icon).toBeUndefined();
    expect(pages.trashedIn('plan')).toBeNull();
  });

  it('never writes a host title into local storage, nor blanks the local one', async () => {
    const store = seedStore();
    const host = makeHost(store);
    const local = new PageRegistry(localSeed());
    const { pages } = hostedPages(local, host);

    await host.resolve('plan');
    pages.setBlocks('plan', []);
    pages.trash('plan');
    pages.setTitle('plan', 'Typed');
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'alice', access: null }) });
    await host.resolve('plan');
    pages.untrash('plan');

    const stored = localStorage.getItem(PAGES_STORAGE_KEY) ?? '';

    expect(stored).not.toContain('"Plan"');
    expect(stored).not.toContain('Typed');
    expect(local.get('plan')?.title).toBe('Local plan');
  });

  it('shows a title this tab is painting over the last host answer', async () => {
    const host = makeHost(seedStore());
    const hosted = hostedPages(new PageRegistry(localSeed()), host);

    await host.resolve('plan');
    hosted.display('plan', 'Typing…');
    expect(hosted.pages.get('plan')?.title).toBe('Typing…');
    hosted.display('plan', undefined);
    expect(hosted.pages.get('plan')?.title).toBe('Plan');
  });

  it('keeps the root document local', () => {
    const local = new PageRegistry(localSeed());
    const { pages } = hostedPages(local, makeHost(seedStore()));

    pages.setTitle(null, 'Root renamed');

    expect(pages.root().title).toBe('Root renamed');
  });
});

describe('remotePageTool', () => {
  it('previews a page only while the host allows it', async () => {
    const store = seedStore();
    const host = makeHost(store, 'bob');
    const local = new PageRegistry({ plan: { title: 'Local', parentId: null, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Secret body' } }] } });
    const tool = remotePageTool({ host, local, parentId: null });

    expect(tool.preview('plan')).toBeUndefined();
    await tool.resolve('plan');
    expect(tool.preview('plan')).toEqual([{ id: 'p1', type: 'paragraph', data: { text: 'Secret body' } }]);

    handlePageHostRequest({ store, user: 'alice', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'bob', access: null }) });
    await tool.resolve('plan');
    expect(tool.preview('plan')).toBeUndefined();
  });

  it('creates the page on the host and in the local tree', async () => {
    const store = seedStore();
    const host = makeHost(store, 'carol');
    const local = new PageRegistry({});
    const tool = remotePageTool({ host, local, parentId: 'plan' });

    await tool.create({ pageId: 'fresh' });

    expect(local.get('fresh')).toMatchObject({ parentId: 'plan' });
    expect(store.pages.get('fresh')).toMatchObject({ acl: { carol: 'write' } });
  });
});
