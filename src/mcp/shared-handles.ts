import { surfaceError } from './errors';
import { handleLimit, type HandleRegistry, type HandleTable, newHandleId, shuttingDown, unknownHandle } from './handles';
import type { BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore } from './options';
import type { HandleSession } from './session';

// Above the slowest stored call (a 30 s endpoint load); a longer wait is better told to retry.
export const LEASE_WAIT_MS = 30_000;

export interface SharedHandlesOptions {
  /** This process's live handles: they hold sockets, so they never go into the store. */
  local: HandleRegistry<HandleSession>;
  store: BlokMcpHandleStore;
  idleMs: number;
  maxPerPrincipal: number;
  /** This server's stored contract. A record from another one answers VERSION_SKEW. */
  contractRevision: string;
  restore(record: BlokMcpHandleRecord): Promise<HandleSession>;
  newHandle?: () => string;
  leaseWaitMs?: number;
}

const STORE_DOWN = 'The handle store is unavailable. Retry shortly.';

// stdout carries the protocol, so the log goes to stderr.
const storeFailed = (thrown: unknown): Error => {
  console.error('blok-mcp: the handle store failed', thrown);

  return surfaceError('SOURCE_UNAVAILABLE', STORE_DOWN);
};

const viaStore = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (thrown) {
    throw storeFailed(thrown);
  }
};

const CLOSED: Pick<HandleSession, 'close'> = { close: () => Promise.resolve({ unsavedBatches: 0, hostRecordLags: false }) };

/**
 * Stored handles in a host's store, so any process sharing it serves any call. Per call:
 * acquire the lease, rebuild the session from the record, run (the source save happens here),
 * save the record if it changed, release. A record that cannot be saved after the source save
 * is dropped: the answer stands, and the next call answers UNKNOWN_HANDLE.
 * Calls on one handle keep their arrival order inside this process; across processes the lease
 * runs them one at a time. Shutdown waits for this process's calls and never touches the store.
 */
export class SharedHandles implements HandleTable {
  private closed = false;
  private readonly turns = new Map<string, Promise<unknown>>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly newHandle: () => string;

  public constructor(private readonly options: SharedHandlesOptions) {
    this.newHandle = options.newHandle ?? newHandleId;
  }

  public async assertRoom(principal: string): Promise<void> {
    if (this.closed) {
      throw shuttingDown();
    }
    const stored = await viaStore(() => this.options.store.count(principal, this.options.idleMs));

    if (stored + this.options.local.count(principal) >= this.options.maxPerPrincipal) {
      throw handleLimit(this.options.maxPerPrincipal);
    }
  }

  public async add(principal: string, documentId: string, session: HandleSession): Promise<string> {
    if (session.snapshot === undefined) {
      await this.assertRoom(principal);

      return this.options.local.add(principal, documentId, session);
    }
    if (this.closed) {
      throw shuttingDown();
    }
    const handle = this.newHandle();
    const room = this.options.maxPerPrincipal - this.options.local.count(principal);
    const record = session.snapshot();

    if (!await viaStore(() => this.options.store.tryAdd(handle, record, room, this.options.idleMs))) {
      throw handleLimit(this.options.maxPerPrincipal);
    }

    return handle;
  }

  public use<T>(handle: string, principal: string, fn: (session: HandleSession, documentId: string) => Promise<T>): Promise<T> {
    if (this.options.local.has(handle)) {
      return this.options.local.use(handle, principal, fn);
    }

    return this.leased(handle, principal, async (lease) => {
      const record = lease.record;

      if (record.contractRevision !== this.options.contractRevision) {
        throw surfaceError('VERSION_SKEW', 'This handle was opened on a server with another tool contract. Call blok_open again.');
      }
      const session = await this.options.restore(record);
      const before = JSON.stringify(session.snapshot?.());

      try {
        return await fn(session, record.documentId);
      } finally {
        await this.keep(handle, lease, session, before);
      }
    });
  }

  public peek(handle: string, principal: string, fn: (documentId: string) => Promise<void>): Promise<void> {
    if (this.options.local.has(handle)) {
      return this.options.local.peek(handle, principal, fn);
    }

    return this.leased(handle, principal, (lease) => fn(lease.record.documentId));
  }

  public async remove(handle: string, principal: string): Promise<Pick<HandleSession, 'close'>> {
    if (this.options.local.has(handle)) {
      return this.options.local.remove(handle, principal);
    }
    await this.leased(handle, principal, () => viaStore(() => this.options.store.remove(handle)));

    return CLOSED;
  }

  /** Waits for this process's calls; the store and its handles stay for the other processes. */
  public async closeAll(close: (session: HandleSession) => Promise<void>): Promise<void> {
    this.closed = true;
    await Promise.all([this.options.local.closeAll(close), Promise.allSettled([...this.inFlight])]);
  }

  /** Runs fn under the handle's lease, after this process's earlier calls on it, for its owner only. */
  private leased<T>(handle: string, principal: string, fn: (lease: BlokMcpHandleLease) => Promise<T>): Promise<T> {
    const run = (this.turns.get(handle) ?? Promise.resolve()).then(async () => {
      const lease = await viaStore(() => this.options.store.acquire(handle, this.options.idleMs, this.options.leaseWaitMs ?? LEASE_WAIT_MS));

      if (lease === 'unknown') {
        throw unknownHandle();
      }
      if (lease === 'busy') {
        throw surfaceError('SOURCE_UNAVAILABLE', 'Another call is using this handle. Retry shortly.');
      }
      try {
        // Checked here, not by the store: a store bug must not hand one user's handle to another.
        if (lease.record.v !== 1 || lease.record.principal !== principal) {
          throw unknownHandle();
        }

        return await fn(lease);
      } finally {
        await lease.release().catch((thrown: unknown) => console.error('blok-mcp: releasing a handle lease failed', thrown));
      }
    });
    const turn = run.catch(() => undefined);

    this.turns.set(handle, turn);
    this.inFlight.add(turn);
    void turn.finally(() => {
      this.inFlight.delete(turn);
      if (this.turns.get(handle) === turn) {
        this.turns.delete(handle);
      }
    });

    return run;
  }

  private async keep(handle: string, lease: BlokMcpHandleLease, session: HandleSession, before: string): Promise<void> {
    const after = session.snapshot?.();

    if (after === undefined || JSON.stringify(after) === before) {
      return;
    }
    try {
      await lease.save(after);
    } catch (thrown) {
      // The source already has the work; a record left behind would save with an old version.
      console.error('blok-mcp: saving a handle to the handle store failed, so the handle is closed', thrown);
      await this.options.store.remove(handle).catch((removing: unknown) => console.error('blok-mcp: removing a handle from the handle store failed', removing));
    }
  }
}
