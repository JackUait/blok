import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { History } from '@bloklabs/core';
import type { HistoryValue, HistoryValueChange } from '../../../types/api/history';

import { createPageStore, handlePageHostRequest } from '../../../scripts/dev-page-host.mjs';
import { PAGES_STORAGE_KEY, PageRegistry, type PageMap } from '../../../src/playground/page-host';
import {
  PageHostError,
  RemotePageHost,
  hostedPages,
  remotePageTool,
  wireTitle,
  type EventStreamLike,
  type TitleHistory,
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

/** The part of the editor's History that wireTitle uses, with undo driven by the test. */
const fakeHistory = (): {
  history: { track(key: string, onChange: (value: string | undefined, change: HistoryValueChange) => void): HistoryValue<string> };
  undoTo(value: string): void;
  remote(value: string): void;
  value(): string | undefined;
} => {
  let value: string | undefined;
  let callback: ((value: string | undefined, change: HistoryValueChange) => void) | undefined;

  return {
    history: {
      track(_key, onChange) {
        callback = onChange;

        return {
          get: () => value,
          set: (next) => {
            value = next;
          },
        };
      },
    },
    undoTo(next) {
      value = next;
      callback?.(next, { source: 'undo' });
    },
    remote(next) {
      value = next;
      callback?.(next, { source: 'remote' });
    },
    value: () => value,
  };
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
  it('takes the editor\'s History as it is', () => {
    // tsc fails here if the real History stops fitting what wireTitle needs.
    const narrow = (history: History): TitleHistory => history;

    expect(narrow).toBeTypeOf('function');
  });

  it('saves a typed title and paints the accepted one', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const wired = await wireTitle('plan', makeHost(store), fakeHistory().history, paint, showError);

    wired.input('Renamed', false);
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Renamed', version: 2 });
    expect(paint).toHaveBeenLastCalledWith('Renamed');
    expect(showError).not.toHaveBeenCalled();
  });

  it('rolls back to the host\'s accepted title and shows an error on a 409', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const wired = await wireTitle('plan', makeHost(store), fakeHistory().history, paint, showError);

    // Another user's save lands first; this tab still holds version 1.
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'Theirs', expectedVersion: 1 }) });
    wired.input('Mine', false);
    await settle();

    expect(paint).toHaveBeenLastCalledWith('Theirs');
    expect(showError).toHaveBeenCalledTimes(1);
    expect(store.pages.get('plan')).toMatchObject({ title: 'Theirs', version: 2 });
  });

  it('rolls back and shows an error when a save fails', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const showError = vi.fn();
    const wired = await wireTitle('plan', makeHost(store), fakeHistory().history, paint, showError);

    handlePageHostRequest({ store, user: null, method: 'POST', path: '/__faults', body: JSON.stringify({ user: 'alice', failNextSave: true }) });
    wired.input('Doomed', false);
    await settle();

    expect(paint).toHaveBeenLastCalledWith('Plan');
    expect(showError).toHaveBeenCalledTimes(1);
    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 1 });
  });

  it('writes an Undo to the host as a new version', async () => {
    const store = seedStore();
    const history = fakeHistory();
    const paint = vi.fn();
    const wired = await wireTitle('plan', makeHost(store), history.history, paint, vi.fn());

    wired.input('Renamed', false);
    await settle();
    history.undoTo('Plan');
    await settle();

    expect(store.pages.get('plan')).toMatchObject({ title: 'Plan', version: 3 });
    expect(paint).toHaveBeenLastCalledWith('Plan');
  });

  it('shows the host\'s title, not the mirror value, on a remote mirror change', async () => {
    const store = seedStore();
    const history = fakeHistory();
    const paint = vi.fn();

    await wireTitle('plan', makeHost(store), history.history, paint, vi.fn());
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/title', body: JSON.stringify({ title: 'From Bob', expectedVersion: 1 }) });
    history.remote('From Bob');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('From Bob');
  });

  it('clears the title and stops on access loss', async () => {
    const store = seedStore();
    const paint = vi.fn();
    const host = makeHost(store);

    await wireTitle('plan', host, fakeHistory().history, paint, vi.fn());
    handlePageHostRequest({ store, user: 'bob', method: 'PUT', path: '/pages/plan/acl', body: JSON.stringify({ user: 'alice', access: null }) });
    FakeEvents.opened[0].emit('plan');
    await settle();

    expect(paint).toHaveBeenLastCalledWith('');

    paint.mockClear();
    FakeEvents.opened[0].emit('plan');
    await settle();
    expect(paint).not.toHaveBeenCalled();
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
