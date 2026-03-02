/**
 * Toggle Shortcuts - Manages the collapse/expand-all keyboard shortcut (CMD+ALT+T).
 *
 * Iterates all blocks in the editor and toggles all toggle blocks:
 * - If any toggle is collapsed, expands all
 * - If all toggles are expanded, collapses all
 */

import type { API } from '../../../types';

import { Shortcuts } from '../../components/utils/shortcuts';

import { TOGGLE_ATTR, TOOL_NAME } from './constants';

const COLLAPSE_EXPAND_ALL_SHORTCUT = 'CMD+ALT+T';

/**
 * Manages the collapse/expand-all shortcut for toggle blocks.
 */
export class ToggleShortcuts {
  private readonly api: API;
  private readonly wrapper: HTMLElement;
  private registered = false;

  constructor(api: API, wrapper: HTMLElement) {
    this.api = api;
    this.wrapper = wrapper;
  }

  /**
   * Register the CMD+ALT+T shortcut on the document.
   */
  public register(): void {
    if (this.registered) {
      return;
    }

    Shortcuts.add({
      name: COLLAPSE_EXPAND_ALL_SHORTCUT,
      on: document,
      handler: (event: KeyboardEvent) => {
        if (!this.shouldHandle(event)) {
          return;
        }

        event.preventDefault();
        this.toggleAll();
      },
    });

    this.registered = true;
  }

  /**
   * Unregister the shortcut.
   */
  public unregister(): void {
    if (!this.registered) {
      return;
    }

    Shortcuts.remove(document, COLLAPSE_EXPAND_ALL_SHORTCUT);
    this.registered = false;
  }

  /**
   * Only handle the shortcut if the event target is within the editor wrapper.
   */
  private shouldHandle(event: KeyboardEvent): boolean {
    const target = event.target;

    return target instanceof HTMLElement && this.wrapper.contains(target);
  }

  /**
   * Toggle all toggle blocks.
   * If any toggle is collapsed, expand all. If all are expanded, collapse all.
   */
  private toggleAll(): void {
    const blockCount = this.api.blocks.getBlocksCount();
    const toggleBlocks: { call: (method: string) => void; isOpen: boolean }[] = [];

    for (let i = 0; i < blockCount; i++) {
      const block = this.api.blocks.getBlockByIndex(i);

      if (block === undefined || block.name !== TOOL_NAME) {
        continue;
      }

      const toggleWrapper = block.holder.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);
      const isOpen = toggleWrapper?.getAttribute(TOGGLE_ATTR.toggleOpen) === 'true';

      toggleBlocks.push({ call: (method: string) => block.call(method), isOpen });
    }

    if (toggleBlocks.length === 0) {
      return;
    }

    const anyCollapsed = toggleBlocks.some((b) => !b.isOpen);
    const method = anyCollapsed ? 'expand' : 'collapse';

    for (const block of toggleBlocks) {
      block.call(method);
    }
  }
}
