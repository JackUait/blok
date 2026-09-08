import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { NotifierOptions, NotifierPosition } from '../../../../src/components/utils/notifier/types';

/**
 * Mutation-coverage tests for `src/components/utils/notifier.ts`.
 *
 * Equivalence proofs for the mutants left alive, all six on the L88 guard
 * `typeof candidate === 'object' && candidate !== null && 'show' in candidate
 * && typeof candidate.show === 'function'`:
 *
 * The only value ever passed to that guard is the fulfilment value of
 * `import('./notifier/index')`, which the language guarantees is a Module
 * Namespace exotic object: an ordinary object, never null, never a function or
 * a primitive. So for every reachable candidate the first two conjuncts are
 * already true, and the third is implied by the fourth - a missing `show`
 * reads back as `undefined`, whose typeof is not 'function'. Each mutant only
 * short-circuits one of those already-settled conjuncts:
 *
 * - `typeof candidate === 'object'` and `candidate !== null` replaced by `true`
 *   (two mutants): both are true for every namespace object.
 * - `typeof candidate === 'object' && candidate !== null` replaced by `true`,
 *   and the same span with `&&` swapped for `||`: the pair evaluates to true
 *   either way, so the surviving expression is the original one.
 * - `... && 'show' in candidate` replaced by `true` (whole three-conjunct
 *   prefix): leaves `typeof candidate.show === 'function'`, which answers the
 *   same for an object with no `show` as the dropped membership test did.
 * - the same three-conjunct prefix with its second `&&` swapped for `||`, i.e.
 *   `(typeof candidate === 'object' && candidate !== null) || 'show' in
 *   candidate`: the parenthesised pair is already true, so the whole prefix is
 *   true and the fourth conjunct decides, exactly as before.
 *
 * Feeding the guard a function, a primitive or null would separate them, but no
 * such value can reach it - a dynamic import cannot resolve to one.
 */

const hoisted = vi.hoisted(() => {
  // The key stays present so vitest's mocked-module proxy never throws on the
  // `.show` read; only its value varies per test.
  const moduleExports: { show: unknown } = { show: undefined };

  return {
    moduleExports,
    setShow: (value: unknown): void => {
      moduleExports.show = value;
    },
  };
});

vi.mock('../../../../src/components/utils/notifier/index', () => hoisted.moduleExports);

const { moduleExports, setShow } = hoisted;

const isShowMock = (value: unknown): value is Mock<(options: NotifierOptions, position?: NotifierPosition) => void> =>
  typeof value === 'function' && 'mock' in value;

/** Reads back the mocked `show` as a spy, so calls can be asserted on. */
const showSpy = (): Mock<(options: NotifierOptions, position?: NotifierPosition) => void> => {
  const value: unknown = moduleExports.show;

  if (!isShowMock(value)) {
    throw new Error('the notifier module mock does not currently expose a spy');
  }

  return value;
};


const message: NotifierOptions = { message: 'saved' };

beforeEach(() => {
  vi.clearAllMocks();
  setShow(vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Notifier mutants - module shape guard', () => {
  it('forwards the notification to a module that exposes a show function', async () => {
    const { Notifier } = await import('../../../../src/components/utils/notifier');

    new Notifier().show(message);

    await vi.waitFor(() => {
      expect(showSpy()).toHaveBeenCalledWith(message, 'bottom-center');
    }, { timeout: 5000 });
  });

  it('passes the configured position through to the loaded module', async () => {
    const { Notifier } = await import('../../../../src/components/utils/notifier');

    new Notifier('top-right').show(message);

    await vi.waitFor(() => {
      expect(showSpy()).toHaveBeenCalledWith(message, 'top-right');
    }, { timeout: 5000 });
  });

  it('rejects a module whose show export is not callable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    setShow('not a function');

    const { Notifier } = await import('../../../../src/components/utils/notifier');

    new Notifier().show(message);

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledTimes(1);
    }, { timeout: 5000 });

    expect(consoleError.mock.calls[0][0]).toBe('[Blok] Failed to display notification. Reason:');
    expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(String(consoleError.mock.calls[0][1])).toContain('notifier module does not expose a "show" method.');
  });

  it('loads the module once and reuses it for later notifications', async () => {
    const { Notifier } = await import('../../../../src/components/utils/notifier');
    const notifier = new Notifier();

    notifier.show(message);

    await vi.waitFor(() => {
      expect(showSpy()).toHaveBeenCalledTimes(1);
    }, { timeout: 5000 });

    notifier.show({ message: 'second' });

    await vi.waitFor(() => {
      expect(showSpy()).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });

    expect(showSpy().mock.calls[1][0]).toEqual({ message: 'second' });
  });
});
