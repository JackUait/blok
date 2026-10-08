import type { OutputBlockData } from '../../types';
import type { History } from '../../types/api/history';
import type { Title, TitleChange } from '../../types/api/title';
import type { PageInfo } from '../../types/tools/page';
import type { PageRecord, PageRegistry } from './page-host';
import { isUnrecordedSet } from './page-title-wiring';

/**
 * The playground's client for the reference page host (scripts/dev-page-host.mjs),
 * opened with `?host=remote`. Titles, icons, versions and access come from the
 * host; the local registry keeps only the tree and page bodies.
 */

/** The host's record, as docs/maintainers/page-host-integration.md names it. */
export interface HostPageRecord {
  pageId: string;
  title: string;
  /** An emoji. */
  icon?: string;
  version: number;
}

export class PageHostError extends Error {
  constructor(public readonly status: number, public readonly current?: HostPageRecord) {
    super(`page host answered ${status}`);
  }
}

/** The part of EventSource the host uses. */
export interface EventStreamLike {
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemotePageHostOptions {
  baseUrl: string;
  /** Sent as `X-Dev-User`. The reference host trusts it; a real host would not. */
  user: string;
  fetch?: Fetch;
  openEvents?(url: string): EventStreamLike;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toRecord = (value: unknown): HostPageRecord | null => {
  if (!isObject(value) || typeof value.pageId !== 'string' || typeof value.title !== 'string' || typeof value.version !== 'number') {
    return null;
  }

  return {
    pageId: value.pageId,
    title: value.title,
    ...(typeof value.icon === 'string' && { icon: value.icon }),
    version: value.version,
  };
};

const toInfo = (record: HostPageRecord): PageInfo => ({
  title: record.title,
  ...(record.icon !== undefined && { icon: { type: 'emoji' as const, value: record.icon } }),
});

const isAllowed = (info: PageInfo | null | undefined): info is PageInfo => info !== null && info !== undefined && info.access !== 'none';

const openEventSource = (url: string): EventStreamLike => {
  const source = new EventSource(url);
  const stream: EventStreamLike = { onmessage: null, close: () => source.close() };

  source.onmessage = (event) => stream.onmessage?.({ data: String(event.data) });

  return stream;
};

/**
 * Implements the host side of the page contract: `loadPage`, compare-and-swap
 * `saveTitle`, `subscribe` (host events plus this tab) and `notify`, and the
 * page tool's `resolve`, where the latest request for a page wins.
 */
export class RemotePageHost {
  private readonly listeners = new Map<string, Set<() => void>>();

  private readonly verdictListeners = new Set<(pageId: string) => void>();

  private readonly issued = new Map<string, number>();

  private readonly answers = new Map<string, { seq: number; info: PageInfo | null | undefined }>();

  private stream: EventStreamLike | null = null;

  constructor(private readonly options: RemotePageHostOptions) {}

  public async loadPage(pageId: string): Promise<HostPageRecord> {
    const seq = this.nextSeq(pageId);
    const { record, info } = await this.read(pageId);

    this.settle(pageId, seq, info);
    if (record === undefined) {
      throw new PageHostError(info === null ? 404 : 403);
    }

    return record;
  }

  public async saveTitle(pageId: string, title: string, expectedVersion: number): Promise<HostPageRecord> {
    const seq = this.nextSeq(pageId);
    const response = await this.request(`/pages/${encodeURIComponent(pageId)}/title`, {
      method: 'PUT',
      body: JSON.stringify({ title, expectedVersion }),
    });
    const record = toRecord(await response.json().catch(() => null));

    if (response.status === 200 && record !== null) {
      this.settle(pageId, seq, toInfo(record));

      return record;
    }

    throw new PageHostError(response.status, response.status === 409 && record !== null ? record : undefined);
  }

  public async create(pageId: string): Promise<void> {
    const response = await this.request('/pages', { method: 'POST', body: JSON.stringify({ pageId }) });

    if (!response.ok) {
      throw new PageHostError(response.status);
    }
  }

  /** Page metadata for the page tool. A network failure is `undefined`: unresolved. */
  public async resolve(pageId: string): Promise<PageInfo | null | undefined> {
    const seq = this.nextSeq(pageId);

    try {
      return this.settle(pageId, seq, (await this.read(pageId)).info);
    } catch {
      return this.settle(pageId, seq, undefined);
    }
  }

  /** The answer of the latest request for the page that has answered. */
  public verdict(pageId: string): PageInfo | null | undefined {
    return this.answers.get(pageId)?.info;
  }

  /** Hears when a page's verdict changes. */
  public onVerdict(listener: (pageId: string) => void): () => void {
    this.verdictListeners.add(listener);

    return () => this.verdictListeners.delete(listener);
  }

  public subscribe(pageId: string, notify: () => void): () => void {
    const set = this.listeners.get(pageId) ?? new Set();

    set.add(notify);
    this.listeners.set(pageId, set);
    this.openStream();

    return () => {
      set.delete(notify);
    };
  }

  /** Tells this tab's subscribers of `pageId`; the host tells other tabs. */
  public notify(pageId: string): void {
    [...this.listeners.get(pageId) ?? []].forEach((listener) => listener());
  }

  public close(): void {
    this.stream?.close();
    this.stream = null;
  }

  private openStream(): void {
    if (this.stream !== null) {
      return;
    }
    // EventSource cannot send headers, so the user rides in the query.
    this.stream = (this.options.openEvents ?? openEventSource)(`${this.options.baseUrl}/events?user=${encodeURIComponent(this.options.user)}`);
    this.stream.onmessage = (event) => {
      try {
        const message: unknown = JSON.parse(event.data);

        if (isObject(message) && typeof message.pageId === 'string') {
          this.notify(message.pageId);
        }
      } catch {
        // Not an invalidation.
      }
    };
  }

  private nextSeq(pageId: string): number {
    const seq = (this.issued.get(pageId) ?? 0) + 1;

    this.issued.set(pageId, seq);

    return seq;
  }

  /** Keeps an answer only if no later request has answered; returns the answer that stands. */
  private settle(pageId: string, seq: number, info: PageInfo | null | undefined): PageInfo | null | undefined {
    const last = this.answers.get(pageId);

    if (last !== undefined && last.seq > seq) {
      return last.info;
    }
    this.answers.set(pageId, { seq, info });
    if (JSON.stringify(last?.info) !== JSON.stringify(info)) {
      [...this.verdictListeners].forEach((listener) => listener(pageId));
    }

    return info;
  }

  private async read(pageId: string): Promise<{ record?: HostPageRecord; info: PageInfo | null }> {
    const response = await this.request(`/pages/${encodeURIComponent(pageId)}`);

    if (response.status === 404) {
      return { info: null };
    }

    const body: unknown = await response.json();

    if (response.status !== 200) {
      throw new PageHostError(response.status);
    }
    if (isObject(body) && body.access === 'none') {
      return { info: { access: 'none' } };
    }

    const record = toRecord(body);

    if (record === null) {
      throw new PageHostError(response.status);
    }

    return { record, info: toInfo(record) };
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return (this.options.fetch ?? fetch)(`${this.options.baseUrl}${path}`, {
      ...init,
      // An access answer must never come from a cache. It also stops Chrome
      // queueing same-URL GETs behind each other, which lets a denial overtake.
      cache: 'no-store',
      headers: {
        'x-dev-user': this.options.user,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
      },
    });
  }
}

/** What `wireTitle` needs from the editor: its built-in title. */
export interface WiredTitleEditor {
  title: Pick<Title, 'get' | 'set'>;
}

/** What `remotePagePlayground().wire` needs from the editor. */
export interface HostedPageEditor extends WiredTitleEditor {
  history: Pick<History, 'clear'>;
}

/** What `wireTitle` needs from the host. */
export type TitleHost = Pick<RemotePageHost, 'loadPage' | 'saveTitle' | 'subscribe' | 'notify'>;

/**
 * The `wireTitle` sample from docs/maintainers/page-host-integration.md, so
 * the sample is compiled and run against a real host. Divergences from the
 * doc: `editor` is narrowed to `WiredTitleEditor`, and `host` to `TitleHost`.
 */
export async function wireTitle(
  pageId: string,
  host: TitleHost,
  editor: WiredTitleEditor,
  paint: (title: string) => void,
  showError: () => void
): Promise<{ change: (title: string, change: TitleChange) => void; stop: () => void }> {
  /* eslint-disable no-restricted-syntax, max-depth -- the doc's sample, kept
     line for line so the two can be compared; change both together. */
  let accepted = await host.loadPage(pageId);
  let displayed = accepted.title;
  let latestWrite = 0;
  let latestRead = 0;
  let pending = 0;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  editor.title.set(accepted.title, { record: false });
  paint(accepted.title);

  function showAccepted(): void {
    if (stopped) return;
    displayed = accepted.title;
    editor.title.set(displayed, { record: false });
    paint(displayed);
    host.notify(pageId);
  }

  function changeTitle(next: string): void {
    if (stopped || next === displayed) return;
    const ticket = ++latestWrite;

    displayed = next;
    paint(next);
    host.notify(pageId);
    pending += 1;
    queue = queue.then(async () => {
      try {
        if (stopped) return;
        const saved = await host.saveTitle(pageId, next, accepted.version);

        if (saved.version > accepted.version) accepted = saved;
        if (ticket === latestWrite) showAccepted();
      } catch {
        try {
          const current = await host.loadPage(pageId);

          if (current.version > accepted.version) accepted = current;
          // A rejected earlier request must not replace a later local edit.
          if (ticket === latestWrite && !stopped) {
            showAccepted();
            showError();
          }
        } catch {
          if (!stopped) {
            stop();
            paint('');
            host.notify(pageId);
            showError();
          }
        }
      } finally {
        pending -= 1;
      }
    });
  }

  function refreshFromHost(): void {
    const order = ++latestRead;

    void host.loadPage(pageId).then((record) => {
      if (stopped || order !== latestRead) return;
      const newer = record.version > accepted.version;
      if (newer) accepted = record;
      if (pending === 0 && (newer || editor.title.get() !== accepted.title || displayed !== accepted.title)) {
        showAccepted();
      }
    }).catch(() => {
      if (stopped || order !== latestRead) return;
      stop();
      paint('');
      host.notify(pageId);
    });
  }

  const unsubscribe = host.subscribe(pageId, refreshFromHost);

  function stop(): void {
    stopped = true;
    latestRead += 1;
    unsubscribe();
  }

  return {
    // Call it from pageTitle.onChange.
    change: (title, { source, record }) => {
      // Our own record:false write: the value came from the host.
      if (source === 'api' && record === false) return;
      if (source === 'remote') {
        refreshFromHost();
        return;
      }
      changeTitle(title);
    },
    stop,
  };
  /* eslint-enable no-restricted-syntax, max-depth */
}

/**
 * The local registry with host metadata laid over it. Reads of a page's title
 * and icon come from the host's latest verdict (nothing while unknown or
 * denied); every write goes to the real registry, so a host title never lands
 * in local storage. Page titles and icons are not written locally at all.
 */
export const hostedPages = (
  local: PageRegistry,
  host: RemotePageHost
): { pages: PageRegistry; display(pageId: string, title: string | undefined): void } => {
  const shown = new Map<string, string>();
  const tracked = new Set<string>();

  // The tree and breadcrumbs read every page: each one read is kept fresh.
  const track = (pageId: string): void => {
    if (tracked.has(pageId)) {
      return;
    }
    tracked.add(pageId);
    host.subscribe(pageId, () => void host.resolve(pageId));
    void host.resolve(pageId);
  };

  const overlay = <T extends PageRecord>(pageId: string, page: T): T => {
    track(pageId);

    const verdict = host.verdict(pageId);
    const { icon: _localIcon, ...rest } = page;

    if (!isAllowed(verdict)) {
      return { ...rest, title: '' } as T;
    }

    const icon = verdict.icon?.type === 'emoji' ? verdict.icon.value : undefined;

    return { ...rest, title: shown.get(pageId) ?? verdict.title ?? '', ...(icon !== undefined && { icon }) } as T;
  };

  const overrides = new Map<PropertyKey, unknown>([
    ['get', (pageId: string) => {
      const page = local.get(pageId);

      return page === undefined ? undefined : overlay(pageId, page);
    }],
    ['trail', (pageId: string) => local.trail(pageId).map((page) => overlay(page.id, page))],
    ['trashedIn', (pageId: string) => {
      const page = local.trashedIn(pageId);

      return page === null ? null : overlay(page.id, page);
    }],
    ['setTitle', (pageId: string | null, title: string) => {
      if (pageId === null) {
        local.setTitle(null, title);
      }
    }],
    ['setIcon', (pageId: string | null, icon: string | undefined) => {
      if (pageId === null) {
        local.setIcon(null, icon);
      }
    }],
  ]);

  const pages = new Proxy(local, {
    get(target, key) {
      if (overrides.has(key)) {
        return overrides.get(key);
      }

      const value: unknown = Reflect.get(target, key, target);
      // Bound to the real registry: its own `this.get` must read local records.
      const bound: unknown = typeof value === 'function' ? value.bind(target) : value;

      return bound;
    },
  });

  return {
    pages,
    display: (pageId, title) => {
      if (title === undefined) {
        shown.delete(pageId);
      } else {
        shown.set(pageId, title);
      }
    },
  };
};

/** The page tool's host callbacks in remote mode. */
export const remotePageTool = ({ host, local, parentId }: { host: RemotePageHost; local: PageRegistry; parentId: string | null }): {
  resolve(pageId: string): Promise<PageInfo | null | undefined>;
  subscribe(pageId: string, onChange: () => void): () => void;
  create(init: { pageId: string }): Promise<void>;
  preview(pageId: string): OutputBlockData[] | undefined;
} => ({
  resolve: (pageId) => host.resolve(pageId),
  subscribe: (pageId, onChange) => host.subscribe(pageId, onChange),
  create: async ({ pageId }) => {
    local.create(pageId, parentId);
    await host.create(pageId);
  },
  // The body is local, but only a page the host allows may show it.
  preview: (pageId) => (isAllowed(host.verdict(pageId)) ? local.get(pageId)?.blocks : undefined),
});

const ERROR_TESTID = 'page-host-error';

const WIRED_ATTRIBUTE = 'data-page-host-wired';

const showSaveError = (): void => {
  const existing = document.querySelector(`[data-blok-testid="${ERROR_TESTID}"]`);
  const alert = existing instanceof HTMLElement ? existing : document.createElement('div');

  alert.setAttribute('role', 'alert');
  alert.setAttribute('data-blok-testid', ERROR_TESTID);
  alert.style.cssText = 'position:fixed;inset-inline:0;bottom:24px;margin:auto;width:max-content;max-width:calc(100% - 32px);padding:8px 12px;border-radius:8px;background:#2f2f2f;color:#fff;font:14px/1.4 system-ui;z-index:2147483647';
  alert.textContent = 'The title was not saved. Showing the saved title.';
  if (!alert.isConnected) {
    document.body.append(alert);
  }
};

/**
 * Everything index.html needs for `?host=remote`: the overlaid registry, the
 * page tool's callbacks, and title wiring for the open page.
 */
export const remotePagePlayground = (options: {
  baseUrl: string;
  user: string;
  local: PageRegistry;
  rerender(): void;
  fetch?: Fetch;
  openEvents?(url: string): EventStreamLike;
}): {
  host: RemotePageHost;
  pages: PageRegistry;
  pageTool(parentId: string | null): ReturnType<typeof remotePageTool>;
  wire(pageId: string | null, editor: HostedPageEditor): Promise<void>;
  /** Call it from pageTitle.onChange, with the page id the editor was built for. */
  titleChanged(pageId: string | null, title: string, change: TitleChange): void;
} => {
  const { baseUrl, user, fetch, openEvents } = options;
  const host = new RemotePageHost({ baseUrl, user, fetch, openEvents });
  const hosted = hostedPages(options.local, host);
  const wiring: {
    current: { pageId: string; change(title: string, change: TitleChange): void; stop(): void } | null;
    // A page being wired, and the latest title typed into it before the host answered.
    early: { pageId: string; typed?: string } | null;
    generation: number;
  } = { current: null, early: null, generation: 0 };

  host.onVerdict(() => options.rerender());

  return {
    host,
    pages: hosted.pages,
    pageTool: (parentId) => remotePageTool({ host, local: options.local, parentId }),
    titleChanged: (pageId, title, change) => {
      // Checked first: wireTitle's own first write fires before `current` is set.
      if (pageId === null || isUnrecordedSet(change)) {
        return;
      }
      if (wiring.current?.pageId === pageId) {
        wiring.current.change(title, change);
      } else if (wiring.early?.pageId === pageId && change.source !== 'remote') {
        wiring.early.typed = title;
      }
    },
    wire: async (pageId, editor) => {
      wiring.generation += 1;

      const mine = wiring.generation;

      if (wiring.current !== null) {
        wiring.current.stop();
        hosted.display(wiring.current.pageId, undefined);
        wiring.current = null;
        document.documentElement.removeAttribute(WIRED_ATTRIBUTE);
      }
      wiring.early = pageId === null ? null : { pageId };
      if (pageId === null) {
        return;
      }

      const paint = (title: string): void => {
        hosted.display(pageId, title);
        // Guarded: a record:false write during typing would cut the user's undo step.
        if (editor.title.get() !== title) {
          editor.title.set(title, { record: false });
        }
        options.rerender();
      };
      const wired = await wireTitle(pageId, host, editor, paint, showSaveError).catch(() => null);

      if (wired === null || mine !== wiring.generation) {
        wired?.stop();

        return;
      }

      const typed = wiring.early?.typed;

      wiring.early = null;
      wiring.current = { pageId, change: wired.change, stop: wired.stop };
      // Tests wait on it.
      document.documentElement.setAttribute(WIRED_ATTRIBUTE, pageId);
      if (typed !== undefined) {
        // Steps typed before the host answered undo to titles the host never had, like the empty boot
        // title, and an undo is saved. A record:false write does not cancel them all (measured).
        editor.history.clear();
        // Back on screen as one undo step over the host title, saved through change.
        if (typed !== editor.title.get()) {
          editor.title.set(typed);
        }
      }
    },
  };
};
