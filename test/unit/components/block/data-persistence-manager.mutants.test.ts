import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DataPersistenceManager } from '../../../../src/components/block/data-persistence-manager';
import type { InputManager } from '../../../../src/components/block/input-manager';
import type { TunesManager } from '../../../../src/components/block/tunes-manager';
import type { BlockTool } from '@/types';
import type { BlockTuneData } from '@/types/block-tunes/block-tune-data';

/**
 * Mutant-killing coverage for `DataPersistenceManager`.
 *
 * Proven-equivalent mutants (no input can distinguish them):
 *
 * - `extracted === undefined` replaced by `false` in `extractToolData`, and the
 *   body of that same guard emptied. Both make an `undefined` save() result fall
 *   through to the next guard, `typeof extracted !== "object"`. For `undefined`
 *   that guard is true, so the function returns `extracted` — still `undefined`,
 *   the same value the deleted branch returned, reached with no side effect in
 *   between. `save()` then hits its own `extractedBlock === undefined` early
 *   return either way, so no caller can see a difference.
 */
describe('DataPersistenceManager mutants', () => {
  let renderedElement: HTMLElement;
  let dropCache: () => void;
  let callToolUpdated: () => void;
  let toggleEmptyMark: () => void;

  interface ManagerOptions {
    toolSave?: (element: HTMLElement) => unknown;
    toolSetData?: (data: Record<string, unknown>) => unknown;
    element?: HTMLElement | null;
    name?: string;
    isEmpty?: boolean;
    tunes?: { [name: string]: BlockTuneData };
  }

  const createManager = (options: ManagerOptions = {}): DataPersistenceManager => {
    const element = options.element === undefined ? renderedElement : options.element;
    const tunes = options.tunes ?? {};
    const tool: Record<string, unknown> = {
      render: () => renderedElement,
      save: options.toolSave ?? ((): unknown => ({ text: 'saved' })),
    };

    if (options.toolSetData !== undefined) {
      tool.setData = options.toolSetData;
    }

    const tunesManager = { extractTunesData: (): { [name: string]: BlockTuneData } => tunes } as unknown as TunesManager;
    const inputManager = { dropCache } as unknown as InputManager;

    return new DataPersistenceManager(
      tool as unknown as BlockTool,
      () => element,
      tunesManager,
      options.name ?? 'paragraph',
      () => options.isEmpty ?? false,
      inputManager,
      callToolUpdated,
      toggleEmptyMark,
      {},
      {}
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    renderedElement = document.createElement('div');
    renderedElement.setAttribute('contenteditable', 'true');
    renderedElement.innerHTML = 'original';
    dropCache = vi.fn();
    callToolUpdated = vi.fn();
    toggleEmptyMark = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('save', () => {
    it('preserves a copy of the tunes the tunes manager returned', async () => {
      const manager = createManager({ tunes: { alignment: { align: 'left' } } });

      const result = await manager.save();

      expect(result?.tunes).toEqual({ alignment: { align: 'left' } });
      expect(manager.preservedTunes).toEqual({ alignment: { align: 'left' } });
      expect(manager.lastSavedTunes).not.toBe(result?.tunes);
    });

    it('reports the elapsed time as the difference between the two marks', async () => {
      const manager = createManager();
      let nowCalls = 0;
      const nowSpy = vi.spyOn(window.performance, 'now').mockImplementation(() => {
        nowCalls += 1;

        return nowCalls * 1000;
      });

      const result = await manager.save();

      nowSpy.mockRestore();

      // A third mark would make the clean difference 2000 and hide the mutant.
      expect(nowCalls).toBe(2);
      expect(result?.time).toBe(1000);
    });
  });

  describe('setData without a tool-provided setData', () => {
    it('writes the new text in place for a contenteditable tool', async () => {
      const manager = createManager();

      await expect(manager.setData({ text: 'replaced' })).resolves.toBe(true);
      expect(renderedElement.innerHTML).toBe('replaced');
    });

    it('refuses an in-place update for a paragraph whose new data has no text', async () => {
      const manager = createManager({ name: 'paragraph' });

      await expect(manager.setData({ level: 2 })).resolves.toBe(false);
      expect(renderedElement.innerHTML).toBe('original');
    });

    it('refuses to blank a non-paragraph tool that was handed empty data', async () => {
      const manager = createManager({ name: 'header' });

      await expect(manager.setData({})).resolves.toBe(false);
      expect(renderedElement.innerHTML).toBe('original');
    });

    it('falls back to a re-render when the element is not contenteditable', async () => {
      renderedElement.removeAttribute('contenteditable');

      const manager = createManager();

      await expect(manager.setData({ text: 'replaced' })).resolves.toBe(false);
      expect(renderedElement.innerHTML).toBe('original');
    });
  });

  describe('setData delegated to the tool', () => {
    it('warns with the tool name and the error message when the tool setData throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const manager = createManager({
        name: 'paragraph',
        toolSetData: () => {
          throw new Error('boom');
        },
      });

      await expect(manager.setData({ text: 'x' })).resolves.toBe(false);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Tool paragraph setData failed: boom'));
    });
  });

  describe('extractToolData', () => {
    it('never asks the tool to save when there is no rendered element', async () => {
      const toolSave = vi.fn((): unknown => ({ text: 'x' }));
      const manager = createManager({ element: null, toolSave });

      const result = await manager.save();

      expect(toolSave).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('drops a null save result for an empty block', async () => {
      const manager = createManager({ isEmpty: true, toolSave: () => null });

      await expect(manager.save()).resolves.toBeUndefined();
    });

    it('drops an undefined save result for an empty block', async () => {
      const manager = createManager({ isEmpty: true, toolSave: () => undefined });

      await expect(manager.save()).resolves.toBeUndefined();
    });

    it('passes a non-object save result through untouched for an empty block', async () => {
      const manager = createManager({ isEmpty: true, toolSave: () => 'plain string' });

      const result = await manager.save();

      expect(result?.data).toBe('plain string');
    });

    it('logs the tool name and the error when the tool save throws', async () => {
      const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const manager = createManager({
        name: 'paragraph',
        toolSave: () => {
          throw new Error('kaboom');
        },
      });

      const result = await manager.save();

      expect(result).toBeUndefined();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('Saving process for paragraph tool failed'),
        expect.any(Error)
      );
    });
  });

  describe('empty-field normalization', () => {
    it('leaves a non-string text field alone', async () => {
      const manager = createManager({ isEmpty: true, toolSave: () => ({ text: null, level: 3 }) });

      const result = await manager.save();

      expect(result?.data).toEqual({ text: null, level: 3 });
    });

    it('keeps text and html fields that still hold content', async () => {
      const manager = createManager({
        isEmpty: true,
        toolSave: () => ({ text: 'kept', html: '<b>bold</b>' }),
      });

      const result = await manager.save();

      expect(result?.data).toEqual({ text: 'kept', html: '<b>bold</b>' });
    });

    it('blanks text and html fields that render to nothing', async () => {
      const manager = createManager({
        isEmpty: true,
        toolSave: () => ({ text: '<br>', html: '<span></span>' }),
      });

      const result = await manager.save();

      expect(result?.data).toEqual({ text: '', html: '' });
    });
  });
});
