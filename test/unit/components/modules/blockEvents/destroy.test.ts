import { describe, expect, it, vi } from 'vitest';

import { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * BlockEvents.destroy() is what Blok.destroy() duck-types and calls on every
 * module (see blok.ts). The emoji trigger's picker element otherwise stays
 * resident in document.body forever (close() only hides it — see
 * emojiTrigger.ts's destroy()), so an editor that never wires this through
 * would leak a hidden, id-bearing node on every destroy.
 */
describe('BlockEvents — destroy', () => {
  const createBlockEvents = (): BlockEvents => new BlockEvents({
    config: {},
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as BlockEvents['eventsDispatcher'],
  });

  it('tears down the emoji trigger once one has been constructed', () => {
    const blockEvents = createBlockEvents();

    blockEvents.state = {} as BlokModules;

    const destroySpy = vi.spyOn(blockEvents.emojiTrigger, 'destroy');

    blockEvents.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the emoji trigger was never used', () => {
    const blockEvents = createBlockEvents();

    expect(() => blockEvents.destroy()).not.toThrow();
  });
});
