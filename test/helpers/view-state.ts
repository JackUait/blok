import type { OutputBlockData } from '../../types';
import type { ViewState } from '../../types/api';
import { createViewStateStore } from '../../src/components/utils/view-state-store';

/**
 * A memory-only `api.viewState` for tool unit tests. Nothing is created here,
 * so toggles start collapsed unless a test opens them.
 */
export const createMemoryViewState = (): ViewState => {
  const store = createViewStateStore({ scope: null, storage: null });

  return {
    get: (blockId, key) => store.get(blockId, key),
    set: (blockId, key, value) => store.set(blockId, key, value),
    onChange: (blockId, key, listener) => store.subscribe(blockId, key, listener),
    isCreatedHere: () => false,
  };
};

/**
 * Store every fixture toggle's open state as if this browser left it so, since
 * a loaded toggle no longer reads `isOpen` from its data. Load the document
 * with `data.id` equal to `documentId`: that id is the storage scope.
 * Writes false too, so a value left by an earlier test never leaks in.
 * @param documentId - the `data.id` the editor loads with
 * @param blocks - fixture blocks; toggles marked `isOpen: true` start open
 */
export const storeToggleOpenState = (documentId: string, blocks: OutputBlockData[]): void => {
  blocks
    .filter(block => block.type === 'toggle' && block.id !== undefined)
    .forEach((block) => {
      localStorage.setItem(
        `blok:view:${documentId}:${block.id}:open`,
        JSON.stringify({ v: block.data.isOpen === true, t: Date.now() })
      );
    });
};
