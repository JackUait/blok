import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BlocksAPI } from '../../../../../src/components/modules/api/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';

interface BlockManagerPrivateAccess {
  yjsSync: { isSyncingFromYjs: boolean; isMaterializing: (block: unknown) => boolean };
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
}

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/**
 * A file block whose pick (`fileName`) is still inside its async `save()` when
 * a derived write from that pick (the upload turning it into an image) starts.
 */
const createHarness = (): {
  yjs: YjsManager;
  api: BlocksAPI;
  pick: (fileName: string) => { resolveSave: () => void };
  dataOf: (id: string) => Record<string, unknown> | undefined;
} => {
  const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const yjs = new YjsManager({ config, eventsDispatcher });
  const blockManager = new BlockManager({ config, eventsDispatcher });
  const api = new BlocksAPI({ config, eventsDispatcher });

  blockManager.state = { YjsManager: yjs } as unknown as BlokModules;
  api.state = { YjsManager: yjs, BlockManager: blockManager } as unknown as BlokModules;

  const priv = blockManager as unknown as BlockManagerPrivateAccess;

  priv.yjsSync = { isSyncingFromYjs: false, isMaterializing: (): boolean => false };
  // Loaded, not edited: the block is not part of any undo step.
  yjs.transactWithoutCapture(() => {
    yjs.addBlock({ id: 'f', type: 'file', data: { url: '' } });
  });

  const block = {
    id: 'f',
    name: 'file',
    parentId: null,
    holder: document.createElement('div'),
    tool: { name: 'file' },
    save: vi.fn(),
  };

  const pick = (fileName: string): { resolveSave: () => void } => {
    let release = (): void => {};

    block.save.mockReturnValue(new Promise((resolve) => {
      release = (): void => resolve({ data: { url: '', fileName } });
    }));
    priv.blockDidMutated(BlockChangedMutationType, block, { index: 0 });

    return { resolveSave: release };
  };

  const dataOf = (id: string): Record<string, unknown> | undefined =>
    yjs.toJSON().find((candidate) => candidate.id === id)?.data;

  return { yjs, api, pick, dataOf };
};

describe('a derived write started while the edit it comes from is still saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('joins the step of that edit once it lands, so one undo takes back both', async () => {
    const { yjs, api, pick, dataOf } = createHarness();
    const { resolveSave } = pick('pic.png');

    api.methods.transactWithoutCapture(() => {
      yjs.addBlock({ id: 'img', type: 'image', data: { url: 'https://cdn/pic.png' } });
    }, { derivedFrom: 'f', from: ['fileName'] });
    resolveSave();
    await drainMicrotasks();
    expect(dataOf('img')?.url).toBe('https://cdn/pic.png');
    expect(dataOf('f')?.fileName).toBe('pic.png');

    yjs.undo();

    expect(dataOf('img')).toBeUndefined();
    expect(dataOf('f')).toEqual({ url: '' });
    yjs.redo();
    expect(dataOf('img')?.url).toBe('https://cdn/pic.png');
    expect(dataOf('f')?.fileName).toBe('pic.png');
  });

  it('runs at once when nothing of that block is saving', () => {
    const { yjs, api, dataOf } = createHarness();

    api.methods.transactWithoutCapture(() => {
      yjs.addBlock({ id: 'img', type: 'image', data: { url: 'https://cdn/pic.png' } });
    }, { derivedFrom: 'f', from: ['fileName'] });

    expect(dataOf('img')?.url).toBe('https://cdn/pic.png');
  });
});
