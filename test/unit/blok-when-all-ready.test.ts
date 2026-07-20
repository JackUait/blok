import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BlokModules } from '../../src/types-internal/blok-modules';

// Mock VERSION global variable
declare global {

  var VERSION: string;
}

// Define VERSION before importing blok
(global as { VERSION?: string }).VERSION = '2.31.0-test';

// Mock dependencies
vi.mock('../../src/components/utils/tooltip', () => ({
  destroy: vi.fn(),
}));

// Mock Core class — each instance gets a manually-resolvable deferred isReady
// so tests control exactly when every instance settles.
vi.mock('../../src/components/core', () => {
  const coreDeferreds: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  const createModuleInstances = (): Partial<BlokModules> => ({
    API: {
      methods: {
        blocks: {
          clear: vi.fn(),
          render: vi.fn(),
        } as unknown as BlokModules['API']['methods']['blocks'],
        caret: {
          focus: vi.fn(),
        } as unknown as BlokModules['API']['methods']['caret'],
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
        saver: {
          save: vi.fn(),
        },
      } as unknown as BlokModules['API']['methods'],
    } as unknown as BlokModules['API'],
    EventsAPI: {
      methods: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
    } as unknown as BlokModules['EventsAPI'],
  });

  /**
   * Core stub whose isReady is a per-instance deferred, settled by tests
   * through the exported coreDeferreds array.
   */
  class MockCore {
    public configuration: Record<string, unknown> = {};
    public moduleInstances: Partial<BlokModules>;
    public isReady: Promise<void>;

    /**
     * Registers a manually-controllable deferred for this instance.
     */
    constructor() {
      this.moduleInstances = createModuleInstances();

      let resolve!: () => void;
      let reject!: (error: Error) => void;

      this.isReady = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      coreDeferreds.push({ resolve, reject });
    }
  }

  return {
    Core: MockCore,
    coreDeferreds,
  };
});


// Mock polyfills
vi.mock('../../src/components/polyfills', () => ({}));

// Import Blok after mocks are set up
import { Blok } from '../../src/blok';

type CoreDeferred = { resolve: () => void; reject: (error: Error) => void };

/**
 * Flushes the microtask queue a few times so promise chains settle.
 * @param times - number of microtask turns to await
 */
const flushMicrotasks = async (times = 10): Promise<void> => {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
};

/**
 * Reports whether the given promise has settled (resolved or rejected)
 * after draining the microtask queue.
 * @param promise - promise under observation
 */
const hasSettled = async (promise: Promise<unknown>): Promise<boolean> => {
  let settled = false;

  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );

  await flushMicrotasks();

  return settled;
};

describe('Blok.whenAllReady', () => {
  let coreDeferreds: CoreDeferred[];

  beforeEach(async () => {
    vi.clearAllMocks();

    const coreModule = await import('../../src/components/core') as unknown as {
      coreDeferreds: CoreDeferred[];
    };

    coreDeferreds = coreModule.coreDeferreds;
  });

  afterEach(async () => {
    // Drain the module-level registry: settle every constructed instance so
    // the pending counter never leaks between tests.
    coreDeferreds.forEach((deferred) => deferred.resolve());
    coreDeferreds.length = 0;
    await flushMicrotasks();

    vi.restoreAllMocks();
  });

  it('resolves immediately when no instances are booting', async () => {
    await expect(Blok.whenAllReady()).resolves.toBeUndefined();
  });

  it('stays pending until every constructed instance settles', async () => {
    const first = new Blok();
    const second = new Blok();

    const aggregate = Blok.whenAllReady();

    expect(await hasSettled(aggregate)).toBe(false);

    coreDeferreds[0].resolve();
    await flushMicrotasks();

    expect(await hasSettled(aggregate)).toBe(false);

    coreDeferreds[1].resolve();
    await flushMicrotasks();

    expect(await hasSettled(aggregate)).toBe(true);

    await first.isReady;
    await second.isReady;
  });

  it('an instance whose isReady rejects still settles the aggregate', async () => {
    const blok = new Blok();

    // Keep the test output clean — the aggregate must absorb the failure.
    blok.isReady.catch(() => {});

    const aggregate = Blok.whenAllReady();

    coreDeferreds[0].reject(new Error('boot failed'));
    await flushMicrotasks();

    await expect(aggregate).resolves.toBeUndefined();
  });

  it('an instance constructed while waiting extends the wait', async () => {
    const first = new Blok();

    const aggregate = Blok.whenAllReady();

    // A second instance appears while the aggregate is already awaited.
    const second = new Blok();

    coreDeferreds[0].resolve();
    await flushMicrotasks();

    expect(await hasSettled(aggregate)).toBe(false);

    coreDeferreds[1].resolve();
    await flushMicrotasks();

    expect(await hasSettled(aggregate)).toBe(true);

    await first.isReady;
    await second.isReady;
  });

  it('an instance constructed in the settle turn of the last pending instance keeps the aggregate pending', async () => {
    const first = new Blok();

    const aggregate = Blok.whenAllReady();

    // Construct the next instance inside a continuation of the settling
    // instance's isReady — it runs after the registry's settle callback but
    // before the deferred waiter-release microtask, so the release re-check
    // must see the new pending instance and keep the aggregate waiting.
    let second: Blok | null = null;

    void first.isReady.then(() => {
      second = new Blok();
    });

    coreDeferreds[0].resolve();
    await flushMicrotasks();

    expect(second).not.toBeNull();
    expect(await hasSettled(aggregate)).toBe(false);

    coreDeferreds[1].resolve();
    await flushMicrotasks();

    expect(await hasSettled(aggregate)).toBe(true);

    await first.isReady;
    await (second as unknown as Blok).isReady;
  });

  it('destroy() before ready still settles', async () => {
    const blok = new Blok();

    blok.destroy();

    const aggregate = Blok.whenAllReady();

    coreDeferreds[0].resolve();
    await flushMicrotasks();

    await expect(aggregate).resolves.toBeUndefined();
  });

  it('resolves only after each instance\'s onReady has fired', async () => {
    const order: string[] = [];
    const onReady = vi.fn(() => {
      order.push('onReady');
    });

    const blok = new Blok({
      holder: 'blok',
      onReady,
    });

    const aggregate = Blok.whenAllReady().then(() => {
      order.push('whenAllReady');
    });

    coreDeferreds[0].resolve();

    await aggregate;

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['onReady', 'whenAllReady']);

    await blok.isReady;
  });
});
