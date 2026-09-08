import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlockEventBinder } from '../../../../../src/components/modules/blockManager/event-binder';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import type {
  BlockEventBinderDependencies,
  ModuleListeners,
} from '../../../../../src/components/modules/blockManager/event-binder';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/blockManager/event-binder.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type Handlers = Map<string, ((event: Event) => void)[]>;

type Harness = {
  binder: BlockEventBinder;
  handlers: Handlers;
  keyup: Mock<(event: KeyboardEvent) => void>;
  input: Mock<(event: InputEvent) => void>;
  bind: () => void;
};

const makeBlock = (): Block => {
  const holder = document.createElement('div');
  const block: Pick<Block, 'holder' | 'on'> = { holder,
    on: vi.fn() };

  return block as Block;
};

const setup = (): Harness => {
  const handlers: Handlers = new Map();
  const keydown = vi.fn<(event: KeyboardEvent) => void>();
  const keyup = vi.fn<(event: KeyboardEvent) => void>();
  const input = vi.fn<(event: InputEvent) => void>();
  const handleCommandX = vi.fn<(event: ClipboardEvent) => void>();

  const blockEvents: Pick<BlockEvents, 'keydown' | 'keyup' | 'input' | 'handleCommandX'> = {
    keydown,
    keyup,
    input,
    handleCommandX,
  };

  const listeners: ModuleListeners = {
    on: (_element: EventTarget, eventType: string, handler: (event: Event) => void): void => {
      const forType = handlers.get(eventType) ?? [];

      forType.push(handler);
      handlers.set(eventType, forType);
    },
    clearAll: (): void => undefined,
  };

  const dependencies: BlockEventBinderDependencies = {
    blockEvents: blockEvents as BlockEvents,
    listeners,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    getBlockIndex: (): number => 0,
    onBlockMutated: (_type, block) => block,
  };

  const binder = new BlockEventBinder(dependencies);

  return {
    binder,
    handlers,
    keyup,
    input,
    bind: (): void => binder.bindBlockEvents(makeBlock()),
  };
};

const fire = (handlers: Handlers, eventType: string, event: Event): void => {
  for (const handler of handlers.get(eventType) ?? []) {
    handler(event);
  }
};

describe('BlockEventBinder block listeners', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('runs the keyup pipeline for a keyboard event', () => {
    const harness = setup();

    harness.bind();

    const event = new KeyboardEvent('keyup', { key: 'a' });

    fire(harness.handlers, 'keyup', event);

    expect(harness.keyup.mock.calls).toStrictEqual([[event]]);
  });

  it('ignores a keyup that is not a keyboard event', () => {
    const harness = setup();

    harness.bind();

    fire(harness.handlers, 'keyup', new Event('keyup'));

    expect(harness.keyup.mock.calls).toStrictEqual([]);
  });

  it('ignores an input event that is not an InputEvent', () => {
    const harness = setup();

    harness.bind();

    fire(harness.handlers, 'input', new Event('input'));

    expect(harness.input.mock.calls).toStrictEqual([]);
  });

  it('runs the input pipeline once for an event that bubbles through nested blocks', () => {
    const harness = setup();

    harness.bind();
    harness.bind();

    const event = new InputEvent('input', { data: 'a' });

    fire(harness.handlers, 'input', event);

    expect(harness.handlers.get('input')).toHaveLength(2);
    expect(harness.input.mock.calls).toStrictEqual([[event]]);
  });
});
