import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToggleSpringLoader } from '../../../../../../src/components/modules/drag/utils/ToggleSpringLoader';

import type { Block } from '../../../../../../src/components/block';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/drag/utils/ToggleSpringLoader.ts
 *
 * PROVEN EQUIVALENT — ConditionalExpression at line 41, `if (this.currentBlock)`
 * inside the spring-load timer forced to true.
 * The class keeps the invariant "a pending timer implies a current block":
 * every statement that nulls `currentBlock` either runs inside `clearTimer`,
 * which clears the pending timer in the same call, or runs after `clearTimer`
 * has already been called (update line 32, cancel line 58), or runs inside the
 * timer callback itself once it has already fired (line 47). So the guard is
 * true on every firing and the forced-true version takes the same branch.
 *
 * PROVEN EQUIVALENT — ConditionalExpression at line 62,
 * `if (this.timerId !== null)` in clearTimer forced to true.
 * The body it guards is `clearTimeout(this.timerId); this.timerId = null`. When
 * timerId is already null the body becomes `clearTimeout(null)`, which is a
 * documented no-op for both the platform timers and the fake timers this suite
 * installs, followed by re-assigning null over null. Neither statement can be
 * observed, so the guard only saves the call.
 */

const SPRING_LOADING_ATTR = 'data-blok-spring-loading';
const SPRING_LOADED_ATTR = 'data-blok-spring-loaded';

type BlockStub = {
  block: Block;
  holder: HTMLElement;
  call: Mock<(methodName: string, params?: Record<string, unknown>) => void>;
};

const makeBlock = (toggleOpen?: string): BlockStub => {
  const holder = document.createElement('div');

  if (toggleOpen !== undefined) {
    const toggle = document.createElement('div');

    toggle.setAttribute('data-blok-toggle-open', toggleOpen);
    holder.appendChild(toggle);
  }

  const call: BlockStub['call'] = vi.fn();
  const stub: Pick<Block, 'holder' | 'call'> = { holder,
    call };

  return { block: stub as Block,
    holder,
    call };
};

describe('ToggleSpringLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('marks a hovered closed toggle as spring loading', () => {
    const target = makeBlock('false');

    new ToggleSpringLoader().update(target.block);

    expect(target.holder.getAttribute(SPRING_LOADING_ATTR)).toBe('');
  });

  it('expands the toggle after the hover delay and flags it as loaded', () => {
    const target = makeBlock('false');

    new ToggleSpringLoader().update(target.block);

    vi.advanceTimersByTime(500);

    expect(target.call.mock.calls).toStrictEqual([['expand']]);
    expect(target.holder.hasAttribute(SPRING_LOADING_ATTR)).toBe(false);
    expect(target.holder.getAttribute(SPRING_LOADED_ATTR)).toBe('');

    vi.advanceTimersByTime(700);

    expect(target.holder.hasAttribute(SPRING_LOADED_ATTR)).toBe(false);
  });

  it('ignores an open toggle and a plain block', () => {
    const open = makeBlock('true');
    const plain = makeBlock();
    const loader = new ToggleSpringLoader();

    loader.update(open.block);
    loader.update(plain.block);

    vi.advanceTimersByTime(500);

    expect(open.holder.hasAttribute(SPRING_LOADING_ATTR)).toBe(false);
    expect(plain.holder.hasAttribute(SPRING_LOADING_ATTR)).toBe(false);
    expect(open.call.mock.calls).toStrictEqual([]);
  });

  it('drops the pending expansion when the pointer leaves', () => {
    const target = makeBlock('false');
    const loader = new ToggleSpringLoader();

    loader.update(target.block);
    loader.update(null);

    vi.advanceTimersByTime(500);

    expect(target.holder.hasAttribute(SPRING_LOADING_ATTR)).toBe(false);
    expect(target.call.mock.calls).toStrictEqual([]);
  });

  it('drops the pending expansion on cancel', () => {
    const target = makeBlock('false');
    const loader = new ToggleSpringLoader();

    loader.update(target.block);
    loader.cancel();
    loader.cancel();

    vi.advanceTimersByTime(500);

    expect(target.holder.hasAttribute(SPRING_LOADING_ATTR)).toBe(false);
    expect(target.call.mock.calls).toStrictEqual([]);
  });
});
