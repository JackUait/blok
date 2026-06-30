import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { Block } from '../../../../../src/components/block';

/**
 * Notion parity M-5: turning a TOGGLE LIST (with children) into a non-toggle
 * type must keep the children NESTED under the new block (only the collapse
 * affordance disappears) — it must NOT eject them to the document root.
 *
 * A TOGGLE HEADING converted via the same "Turn into" menu still RELEASES its
 * children to sibling level, matching the header tool's own toggle tune
 * (deliberate, locked at test/unit/tools/header.test.ts:1440).
 */

const createModuleConfig = (): ModuleConfig => ({
  config: { defaultBlock: 'paragraph' } as BlokConfig,
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

/**
 * Build a source block whose holder carries the toggle-open marker that both
 * the toggle list tool and the toggle heading render.
 */
const createToggleSource = (name: string): Block => {
  const holder = document.createElement('div');
  const inner = document.createElement('div');

  inner.setAttribute('data-blok-toggle-open', 'true');
  holder.appendChild(inner);

  return {
    id: 'src',
    name,
    holder,
    contentIds: ['c1', 'c2'],
  } as unknown as Block;
};

const createChild = (id: string): Block => ({
  id,
  parentId: 'src',
  holder: document.createElement('div'),
} as unknown as Block);

describe('BlockManager.convert — toggle children handling (Notion parity M-5)', () => {
  let blockManager: BlockManager;
  let convertSpy: ReturnType<typeof vi.fn>;
  let setBlockParentSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    blockManager = new BlockManager(createModuleConfig());

    const newBlock = { id: 'new', name: 'paragraph' } as unknown as Block;

    convertSpy = vi.fn().mockResolvedValue(newBlock);

    // Patch the private `operations` field so convert() can delegate.
    (blockManager as unknown as Record<string, unknown>).operations = {
      convert: convertSpy,
    };

    // Provide a non-null blocks store so the `blocksStore` getter does not throw;
    // convert() only forwards it to the (stubbed) operations.convert.
    (blockManager as unknown as Record<string, unknown>)._blocks = {};

    // getBlockById resolves the toggle's children.
    vi.spyOn(blockManager, 'getBlockById').mockImplementation(
      (id: string) => createChild(id)
    );

    setBlockParentSpy = vi
      .spyOn(blockManager, 'setBlockParent')
      .mockImplementation(() => undefined) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps children nested when converting a TOGGLE LIST to a paragraph', async () => {
    const source = createToggleSource('toggle');

    await blockManager.convert(source, 'paragraph');

    // Children must NOT be released to the document root.
    expect(setBlockParentSpy).not.toHaveBeenCalled();
    // The generic convert path (which re-nests children) still runs.
    expect(convertSpy).toHaveBeenCalledWith(source, 'paragraph', expect.anything(), undefined);
  });

  it('keeps children nested when converting a TOGGLE LIST to a heading', async () => {
    const source = createToggleSource('toggle');

    await blockManager.convert(source, 'header', { level: 2 });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('keeps children nested when converting a TOGGLE LIST to a bullet list', async () => {
    const source = createToggleSource('toggle');

    await blockManager.convert(source, 'list', { style: 'unordered' });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('still RELEASES children when converting a TOGGLE HEADING to a paragraph', async () => {
    const source = createToggleSource('header');

    await blockManager.convert(source, 'paragraph');

    expect(setBlockParentSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), null);
    expect(setBlockParentSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }), null);
  });

  it('does not release children when converting a TOGGLE HEADING into a TOGGLE HEADING', async () => {
    const source = createToggleSource('header');

    await blockManager.convert(source, 'header', { isToggleable: true });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });
});
