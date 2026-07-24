import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Renderer } from '../../../../src/components/modules/renderer';
import type { OutputBlockData } from '../../../../types';

/**
 * `config.migrations` used to run at composeBlock time — AFTER the renderer had
 * already analyzed the document's format. With `dataModel: 'auto'` that ordering
 * is a trap: a host rule that upgrades a legacy shape leaves the analysis still
 * reporting `legacy`, so the save path collapses the document back to the old
 * nested Editor.js shape and quietly undoes the migration.
 *
 * Host data rules must therefore run BEFORE format analysis, so `'auto'`
 * inspects post-migration blocks.
 */

type RendererBlok = Renderer['Blok'];
type ComposeBlockArgs = Parameters<RendererBlok['BlockManager']['composeBlock']>[0];

const createRenderer = (config: Renderer['config']): {
  renderer: Renderer;
  composed: ComposeBlockArgs[];
} => {
  const composed: ComposeBlockArgs[] = [];

  const renderer = new Renderer({
    config,
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as Renderer['eventsDispatcher'],
  });

  renderer.state = {
    BlockManager: {
      insert: vi.fn(),
      insertMany: vi.fn(),
      composeBlock: vi.fn((options: ComposeBlockArgs) => {
        composed.push(options);

        return { id: options.id, tool: options.tool };
      }),
    },
    Tools: {
      available: new Map<string, unknown>([['list', {}], ['myCard', {}], ['paragraph', {}]]),
      unavailable: new Map(),
      blockTools: new Map(),
      stubTool: 'stub-tool',
    },
    API: { methods: {} },
    UI: {
      nodes: {
        redactor: document.createElement('div'),
        wrapper: document.createElement('div'),
      },
    },
  } as unknown as RendererBlok;

  return { renderer, composed };
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 0 });

      return 0;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config.migrations run before format analysis', () => {
  it('detects the POST-migration format when a host rule upgrades a legacy shape', async () => {
    const legacy: OutputBlockData[] = [
      {
        id: 'l1',
        type: 'list',
        data: { style: 'unordered', items: [{ content: 'one', items: [] }] },
      },
    ];

    const { renderer } = createRenderer({
      dataModel: 'auto',
      migrations: {
        // The host already upgraded this tool's storage to Blok's flat shape.
        list: () => ({ text: 'one', style: 'unordered' }),
      },
    });

    await renderer.render(legacy);

    // Pre-fix this reported 'legacy', and `dataModel: 'auto'` would collapse the
    // document back to nested `items[]` on save.
    expect(renderer.getDetectedInputFormat()).toBe('flat');
  });

  it('hands the migrated data to composeBlock', async () => {
    const { renderer, composed } = createRenderer({
      migrations: {
        myCard: (data) => ({ ...data, title: (data as { name?: string }).name }),
      },
    });

    await renderer.render([{ id: 'c1', type: 'myCard', data: { name: 'Old' } }]);

    expect(composed[0].data).toEqual({ name: 'Old', title: 'Old' });
  });

  it('leaves the document untouched when no migrations are configured', async () => {
    const { renderer, composed } = createRenderer({});

    await renderer.render([{ id: 'c1', type: 'myCard', data: { name: 'Old' } }]);

    expect(composed[0].data).toEqual({ name: 'Old' });
  });
});
