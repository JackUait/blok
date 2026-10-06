import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { Paragraph } from '../../../src/tools';
import type { BlokConfig } from '../../../types';

/**
 * A document render clears, then fills through `fromJSON`. `fromJSON` deletes
 * from Yjs every block not in the batch, in a `load` transaction BlockManager
 * never mirrors. A block that arrives from another tab between the clear and
 * the fill then stays in BlockManager but not in Yjs. Messages arrive as
 * tasks, so the two must stay in one task: an await that yields a task
 * between them reopens that ghost.
 */
describe('render law — the clear and the fromJSON fill run in the same task', () => {
  const cores: Core[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cores.splice(0).forEach((core) => {
      Object.values(core.moduleInstances).forEach((module) => {
        if (typeof (module as { destroy?: unknown }).destroy === 'function') {
          (module as { destroy: () => void }).destroy();
        }
      });
    });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const editor = async (): Promise<Core> => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const core = new Core({
      holder,
      logLevel: 'ERROR',
      tools: { paragraph: Paragraph },
      data: { blocks: [ { id: 'a', type: 'paragraph', data: { text: 'a' } } ] },
    } as BlokConfig);

    cores.push(core);
    await core.isReady;

    return core;
  };

  /** Records whether a task ran between the last clear and each fill. */
  const watch = (core: Core): { fills: boolean[] } => {
    const { BlockManager, YjsManager } = core.moduleInstances;
    const clear = BlockManager.clear.bind(BlockManager);
    const fromJSON = YjsManager.fromJSON.bind(YjsManager);
    const state = { taskRan: false, fills: [] as boolean[] };

    vi.spyOn(BlockManager, 'clear').mockImplementation((...args) => {
      state.taskRan = false;
      setTimeout(() => {
        state.taskRan = true;
      }, 0);

      return clear(...args);
    });
    vi.spyOn(YjsManager, 'fromJSON').mockImplementation((...args) => {
      state.fills.push(state.taskRan);
      fromJSON(...args);
    });

    return state;
  };

  it('blocks.render', async () => {
    const core = await editor();
    const state = watch(core);

    await core.moduleInstances.API.methods.blocks.render({ blocks: [ { id: 'x', type: 'paragraph', data: { text: 'x' } } ] });

    expect(state.fills).toEqual([ false ]);
  });

  it('blocks.importMarkdown', async () => {
    const core = await editor();
    const state = watch(core);

    await core.moduleInstances.API.methods.blocks.importMarkdown('one\n\ntwo');

    expect(state.fills).toEqual([ false ]);
  });
});
