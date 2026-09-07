import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Paragraph } from '../../src/tools/paragraph';
import type { OutputData } from '../../types';

/**
 * Real-boot coverage for the `persistence.load()` leg of the boot path. The
 * defect below only exists because `init()`/`start()` have already run by the
 * time the load is awaited: the modules are live and the wrapper is already
 * mounted in the holder when the rejection lands.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('Blok boot with persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    // destroy() IS the assertion here, so this only catches a test that failed
    // before reaching it — a torn-down instance has no own fields left.
    if (editor !== undefined && typeof editor.destroy === 'function') {
      editor.destroy();
    }
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  /**
   * A rejected load leaves a complete editor mounted in the holder. The host's
   * only recovery is `destroy()` then remount, so `destroy()` has to actually
   * remove the wrapper — otherwise the retry stacks a second editor, each with
   * its own MutationObserver and document listeners.
   */
  it('destroy() empties the holder after the load rejected', async () => {
    const { Blok } = await import('../../src/blok');

    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      persistence: {
        load: async (): Promise<OutputData> => {
          throw new Error('endpoint down');
        },
        save: async (): Promise<void> => {},
      },
    }) as unknown as TestEditor;

    editor = instance;

    await expect(instance.isReady).rejects.toThrow('endpoint down');

    expect(holder?.childElementCount).toBeGreaterThan(0);

    instance.destroy();

    expect(holder?.childElementCount).toBe(0);
  }, 120_000);
});
