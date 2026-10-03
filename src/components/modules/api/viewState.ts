import type { ViewState } from '../../../../types/api';
import { Module } from '../../__module';
import { createViewStateStore, type ViewStateStore } from '../../utils/view-state-store';

/**
 * API module for personal per-browser block state.
 */
export class ViewStateAPI extends Module {
  private store: ViewStateStore | null = null;
  private currentScope: string | null = null;

  public get methods(): ViewState {
    return {
      get: (blockId, key) => this.resolveStore().get(blockId, key),
      set: (blockId, key, value) => this.resolveStore().set(blockId, key, value),
      onChange: (blockId, key, listener) => this.resolveStore().subscribe(blockId, key, listener),
      isCreatedHere: (blockId) => this.Blok.BlockManager.isCreatedHere(blockId),
    };
  }

  public destroy(): void {
    this.store?.destroy();
    this.store = null;
  }

  /**
   * Lazy: before render, `config.data` and the Saver's id are not the loaded
   * document yet. Re-read on every call because `render(otherDoc)` swaps the id.
   */
  private resolveStore(): ViewStateStore {
    const scope = this.config.documentId
      ?? this.config.collaboration?.doc
      ?? this.Blok.Saver.getDocumentRecordId();

    if (this.store === null) {
      this.store = createViewStateStore({ scope });
      this.currentScope = scope;
    } else if (scope !== this.currentScope) {
      this.store.setScope(scope);
      this.currentScope = scope;
    }

    return this.store;
  }
}
