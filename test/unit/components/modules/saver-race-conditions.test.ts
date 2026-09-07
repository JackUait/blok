/**
 * Tests for save race condition fixes:
 * 1. Save-during-render guard (render lock)
 * 2. Concurrent saver.save() deduplication
 * 3. Destruction guard
 * 4. Staleness of the deduplication slot when the document changes mid-save
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import type { BlokConfig, SanitizerConfig } from '../../../../types';
import type { SavedData } from '../../../../types/data-formats';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import * as utils from '../../../../src/components/utils';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlockMutationEvent } from '../../../../types/events/block';

vi.mock('../../../../src/components/utils/id-generator', () => ({
  generateBlockId: vi.fn(() => 'mock-id'),
}));

type BlockSaveResult = SavedData & { tunes?: Record<string, unknown> };

interface CreateSaverOptions {
  blocks?: Block[];
  sanitizer?: SanitizerConfig;
  stubTool?: string;
  toolSanitizeConfigs?: Record<string, SanitizerConfig>;
  pendingRender?: Promise<void> | null;
  /**
   * Wire the real event bus instead of a mock, so a BlockChanged emit reaches
   * the saver's own subscriber the way it does in the editor.
   */
  liveEvents?: boolean;
}

const createBlockMock = (options: {
  id: string;
  tool: string;
  data: SavedData['data'];
  isValid?: boolean;
  saveDelay?: number;
}): Block => {
  const savedData: BlockSaveResult = {
    id: options.id,
    tool: options.tool,
    data: options.data,
    time: 0,
  };

  const saveFn = options.saveDelay !== undefined
    ? vi.fn(() => new Promise<BlockSaveResult>((resolve) => {
      setTimeout(() => resolve(savedData), options.saveDelay);
    }))
    : vi.fn(() => Promise.resolve(savedData));

  return {
    save: saveFn,
    validate: vi.fn(() => Promise.resolve(options.isValid ?? true)),
    parentId: null,
    contentIds: [],
    name: options.tool,
    isEmpty: false,
    tool: { isDefault: options.tool === 'paragraph' },
    preservedData: undefined,
  } as unknown as Block;
};

const createSaver = (options: CreateSaverOptions = {}): { saver: Saver; eventsDispatcher: Saver['eventsDispatcher'] } => {
  const config: BlokConfig = {
    sanitizer: options.sanitizer ?? ({}),
  };

  const eventsDispatcher = (options.liveEvents === true
    ? new EventsDispatcher<BlokEventMap>()
    : {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    }) as unknown as Saver['eventsDispatcher'];

  const saver = new Saver({
    config,
    eventsDispatcher,
  });

  const stubTool = options.stubTool ?? 'stub';
  const toolConfigs: Record<string, SanitizerConfig> = {
    ...(options.toolSanitizeConfigs ?? {}),
  };

  if (!toolConfigs[stubTool]) {
    toolConfigs[stubTool] = {};
  }

  const blockTools = new Map<string, { sanitizeConfig?: SanitizerConfig }>(
    Object.entries(toolConfigs).map(([name, sanitizeConfig]) => [name, { sanitizeConfig }])
  );

  const blokState = {
    BlockManager: {
      blocks: options.blocks ?? [],
    },
    Tools: {
      blockTools,
      stubTool,
    },
    Renderer: {
      pendingRender: options.pendingRender ?? null,
      getDetectedInputFormat: vi.fn(() => 'flat'),
    },
  };

  (saver as unknown as { state: Saver['Blok'] }).state = blokState as unknown as Saver['Blok'];

  return {
    saver,
    eventsDispatcher,
  };
};

/**
 * A block whose save() snapshots the live data when it is CALLED and settles
 * only when the gate is opened — the shape of any tool with an async save().
 */
const createGatedBlock = (options: { id: string; live: { text: string } }): {
  block: Block;
  saveMock: ReturnType<typeof vi.fn>;
  openGate: () => void;
} => {
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  const saveMock = vi.fn(async (): Promise<BlockSaveResult> => {
    const snapshot = { ...options.live };

    await gate;

    return {
      id: options.id,
      tool: 'paragraph',
      data: snapshot,
      time: 0,
    };
  });

  const block = {
    id: options.id,
    save: saveMock,
    validate: vi.fn(() => Promise.resolve(true)),
    parentId: null,
    contentIds: [],
    name: 'paragraph',
    isEmpty: false,
    tool: { isDefault: true },
    preservedData: undefined,
  } as unknown as Block;

  return {
    block,
    saveMock,
    openGate,
  };
};

/**
 * Publishes the same change signal the BlockManager emits on every block
 * mutation — the event the modifications observer itself keys onSave off.
 */
const emitBlockChanged = (eventsDispatcher: Saver['eventsDispatcher'], blockId: string): void => {
  eventsDispatcher.emit(BlockChanged, {
    event: new CustomEvent('block-changed', {
      detail: { target: { id: blockId } },
    }) as unknown as BlockMutationEvent,
  });
};

/** Drains the microtask queue so every pending save continuation has run. */
const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe('Save race condition fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Fix 1: Save-during-render guard', () => {
    it('waits for pending render before reading blocks', async () => {
      const callOrder: string[] = [];

      // Create a render promise that resolves after a delay
      let resolveRender!: () => void;
      const pendingRender = new Promise<void>((resolve) => {
        resolveRender = resolve;
      });

      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
      });

      const { saver } = createSaver({
        blocks: [block],
        pendingRender,
        toolSanitizeConfigs: { paragraph: {} },
      });

      // Start save — should await pendingRender before proceeding
      const savePromise = saver.save();

      // Track that save hasn't read blocks yet
      callOrder.push('save-started');

      // Resolve the render
      resolveRender();
      callOrder.push('render-resolved');

      const result = await savePromise;
      callOrder.push('save-completed');

      expect(result).toBeDefined();
      expect(result?.blocks).toHaveLength(1);
      // save should complete after render resolves
      expect(callOrder).toEqual(['save-started', 'render-resolved', 'save-completed']);
    });

    it('proceeds immediately when no render is pending', async () => {
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
      });

      const { saver } = createSaver({
        blocks: [block],
        pendingRender: null,
        toolSanitizeConfigs: { paragraph: {} },
      });

      const result = await saver.save();

      expect(result).toBeDefined();
      expect(result?.blocks).toHaveLength(1);
    });

    it('does not return empty blocks when render is in progress', async () => {
      // Simulate the race: blocks are empty during render, but pendingRender is set
      let resolveRender!: () => void;
      const pendingRender = new Promise<void>((resolve) => {
        resolveRender = resolve;
      });

      // Start with empty blocks (as if clear() just ran)
      const { saver } = createSaver({
        blocks: [],
        pendingRender,
        toolSanitizeConfigs: { paragraph: {} },
      });

      const savePromise = saver.save();

      // Before resolving render, update blocks to simulate insertMany()
      const blokState = (saver as unknown as { Blok: { BlockManager: { blocks: Block[] } } }).Blok;
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Content restored' },
      });

      blokState.BlockManager.blocks = [block];
      resolveRender();

      const result = await savePromise;

      // Should have the restored block, not empty
      expect(result?.blocks).toHaveLength(1);
      expect(result?.blocks[0].data).toEqual({ text: 'Content restored' });
    });
  });

  describe('Fix 2: Concurrent save deduplication', () => {
    it('deduplicates concurrent save calls to a single execution while the document is unchanged', async () => {
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
        saveDelay: 10,
      });

      const { saver } = createSaver({
        blocks: [block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      // Fire two concurrent saves
      const save1 = saver.save();
      const save2 = saver.save();

      const [result1, result2] = await Promise.all([save1, save2]);

      // Both should return valid data
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // block.save() should only have been called once (deduplication)
      expect(block.save).toHaveBeenCalledTimes(1);

      // Both should return the same result
      expect(result1).toEqual(result2);
    });

    it('allows a new save after the previous one completes', async () => {
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
      });

      const { saver } = createSaver({
        blocks: [block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      const result1 = await saver.save();
      const result2 = await saver.save();

      // Each sequential call should execute independently
      expect(block.save).toHaveBeenCalledTimes(2);
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('clears pending save even when save fails', async () => {
      const error = new Error('save explosion');
      const failBlock = {
        save: vi.fn().mockRejectedValue(error),
        validate: vi.fn(),
        parentId: null,
        contentIds: [],
        name: 'paragraph',
        isEmpty: false,
        tool: { isDefault: true },
      } as unknown as Block;

      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { saver } = createSaver({
        blocks: [failBlock],
        toolSanitizeConfigs: { paragraph: {} },
      });

      // First save should fail gracefully
      const result1 = await saver.save();
      expect(result1).toBeUndefined();

      // Second save should still work (pending save was cleared)
      const goodBlock = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Recovery' },
      });

      const blokState = (saver as unknown as { Blok: { BlockManager: { blocks: Block[] } } }).Blok;

      blokState.BlockManager.blocks = [goodBlock];

      const result2 = await saver.save();
      expect(result2).toBeDefined();
      expect(result2?.blocks).toHaveLength(1);
    });
  });

  describe('Fix 4: the dedup slot goes stale when the document changes mid-save', () => {
    it('serializes the change instead of replaying the pre-change snapshot', async () => {
      const live = { text: 'before the edit' };
      const gated = createGatedBlock({
        id: 'block-1',
        live,
      });
      const { saver, eventsDispatcher } = createSaver({
        blocks: [gated.block],
        liveEvents: true,
        toolSanitizeConfigs: { paragraph: {} },
      });

      const firstSave = saver.save();

      await settle();
      expect(gated.saveMock).toHaveBeenCalledTimes(1);

      // The user edits while the first serialization is still in flight.
      live.text = 'after the edit';
      emitBlockChanged(eventsDispatcher, 'block-1');

      const secondSave = saver.save();

      await settle();

      // The follow-up must not read the model while the first save still holds it.
      expect(gated.saveMock).toHaveBeenCalledTimes(1);

      gated.openGate();

      const [firstResult, secondResult] = await Promise.all([firstSave, secondSave]);

      // The defect: the second caller was served the first caller's snapshot,
      // so the edit was never serialized and the host wrote a stale document.
      expect(secondResult?.blocks[0].data).toStrictEqual({ text: 'after the edit' });
      expect(firstResult?.blocks[0].data).toStrictEqual({ text: 'before the edit' });
      expect(gated.saveMock).toHaveBeenCalledTimes(2);
    });

    it('coalesces every caller that arrived after the change onto one follow-up save', async () => {
      const live = { text: 'v1' };
      const gated = createGatedBlock({
        id: 'block-1',
        live,
      });
      const { saver, eventsDispatcher } = createSaver({
        blocks: [gated.block],
        liveEvents: true,
        toolSanitizeConfigs: { paragraph: {} },
      });

      const firstSave = saver.save();

      await settle();

      live.text = 'v2';
      emitBlockChanged(eventsDispatcher, 'block-1');

      const stale = [saver.save(), saver.save(), saver.save()];

      await settle();
      gated.openGate();

      const [first, second, third] = await Promise.all(stale);

      expect(first?.blocks[0].data).toStrictEqual({ text: 'v2' });
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(gated.saveMock).toHaveBeenCalledTimes(2);

      await firstSave;

      // The slot is free again: the next save reads the document once more.
      const later = await saver.save();

      expect(gated.saveMock).toHaveBeenCalledTimes(3);
      expect(later?.blocks[0].data).toStrictEqual({ text: 'v2' });
    });

    it('returns undefined from a queued save when the editor is destroyed first', async () => {
      const live = { text: 'v1' };
      const gated = createGatedBlock({
        id: 'block-1',
        live,
      });
      const { saver, eventsDispatcher } = createSaver({
        blocks: [gated.block],
        liveEvents: true,
        toolSanitizeConfigs: { paragraph: {} },
      });

      const firstSave = saver.save();

      await settle();

      live.text = 'v2';
      emitBlockChanged(eventsDispatcher, 'block-1');

      const queuedSave = saver.save();

      await settle();
      saver.markDestroyed();
      gated.openGate();

      await expect(queuedSave).resolves.toBeUndefined();
      expect(gated.saveMock).toHaveBeenCalledTimes(1);

      await firstSave;
    });
  });

  describe('Fix 3: Destruction guard', () => {
    it('returns undefined after editor is destroyed', async () => {
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
      });

      const { saver } = createSaver({
        blocks: [block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      // Mark the saver as destroyed
      saver.markDestroyed();

      const result = await saver.save();

      expect(result).toBeUndefined();
      // Should NOT have called block.save()
      expect(block.save).not.toHaveBeenCalled();
    });

    it('returns undefined if destroyed during an in-flight save', async () => {
      const block = createBlockMock({
        id: 'block-1',
        tool: 'paragraph',
        data: { text: 'Hello' },
        saveDelay: 50,
      });

      const { saver } = createSaver({
        blocks: [block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      // Start a save, then destroy while it's in-flight
      const savePromise = saver.save();

      // Destroy after a tick
      await Promise.resolve();
      saver.markDestroyed();

      const result = await savePromise;

      // Should return undefined since editor was destroyed mid-save
      expect(result).toBeUndefined();
    });

    it('isDestroyed is false by default', () => {
      const { saver } = createSaver();

      expect(saver.isDestroyed).toBe(false);
    });

    it('isDestroyed is true after markDestroyed()', () => {
      const { saver } = createSaver();

      saver.markDestroyed();
      expect(saver.isDestroyed).toBe(true);
    });
  });
});
