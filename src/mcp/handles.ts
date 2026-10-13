import { randomBytes } from 'node:crypto';

import { surfaceError } from './errors';

export interface HandleRegistryOptions<S> {
  idleMs: number;
  maxPerPrincipal: number;
  onExpire(session: S): Promise<void>;
  now?: () => number;
  newHandle?: () => string;
}

interface Entry<S> {
  principal: string;
  documentId: string;
  session: S;
  lastUsed: number;
  busy: number;
  queue: Promise<unknown>;
}

const unknownHandle = (): Error =>
  surfaceError('UNKNOWN_HANDLE', 'No open document has this handle. It may have expired; call blok_open again.');

export class HandleRegistry<S> {
  private readonly entries = new Map<string, Entry<S>>();
  private closed = false;
  private readonly now: () => number;
  private readonly newHandle: () => string;

  public constructor(private readonly options: HandleRegistryOptions<S>) {
    this.now = options.now ?? Date.now;
    this.newHandle = options.newHandle ?? ((): string => randomBytes(16).toString('base64url'));
  }

  /** Throws when add would refuse, so callers can refuse before opening anything. */
  public assertRoom(principal: string): void {
    if (this.closed) {
      throw surfaceError('SOURCE_UNAVAILABLE', 'The server is shutting down.');
    }
    if (this.count(principal) >= this.options.maxPerPrincipal) {
      throw surfaceError('HANDLE_LIMIT', `You already have ${this.options.maxPerPrincipal} open documents. Close one with blok_close.`);
    }
  }

  public add(principal: string, documentId: string, session: S): string {
    // Checked again here: concurrent opens can pass assertRoom together.
    this.assertRoom(principal);
    const handle = this.newHandle();

    this.entries.set(handle, { principal, documentId, session, lastUsed: this.now(), busy: 0, queue: Promise.resolve() });

    return handle;
  }

  public use<T>(
    handle: string,
    principal: string,
    fn: (session: S, documentId: string) => Promise<T>,
  ): Promise<T> {
    const entry = this.entries.get(handle);

    if (entry === undefined || entry.principal !== principal) {
      return Promise.reject(unknownHandle());
    }
    entry.busy += 1;
    entry.lastUsed = this.now();
    const run = entry.queue.then(() => fn(entry.session, entry.documentId)).finally(() => {
      // Refresh idle time before the caller sees completion.
      entry.busy -= 1;
      entry.lastUsed = this.now();
    });

    entry.queue = run.catch(() => undefined);

    return run;
  }

  public async remove(handle: string, principal: string): Promise<S> {
    const entry = this.entries.get(handle);

    if (entry === undefined || entry.principal !== principal) {
      throw unknownHandle();
    }
    // Reject new calls before awaiting the accepted tail.
    this.entries.delete(handle);
    await entry.queue;

    return entry.session;
  }

  public async sweep(): Promise<number> {
    const cutoff = this.now() - this.options.idleMs;
    const expired = { count: 0 };
    const failures: unknown[] = [];

    for (const [handle, entry] of [...this.entries]) {
      // Earlier expirations can yield to use, remove, or closeAll.
      if (this.entries.get(handle) !== entry || entry.busy !== 0 || entry.lastUsed >= cutoff) {
        continue;
      }
      this.entries.delete(handle);
      expired.count += 1;
      await this.options.onExpire(entry.session).catch((thrown: unknown) => {
        failures.push(thrown);
      });
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, `${failures.length} idle handles failed to close.`);
    }

    return expired.count;
  }

  public async closeAll(close: (session: S) => Promise<void>): Promise<void> {
    const all = [...this.entries.values()];

    this.closed = true;
    this.entries.clear();
    await Promise.allSettled(all.map(async (entry) => {
      await entry.queue;
      await close(entry.session);
    }));
  }

  public count(principal: string): number {
    return [...this.entries.values()].filter((entry) => entry.principal === principal).length;
  }
}
