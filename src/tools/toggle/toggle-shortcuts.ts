/**
 * Toggle Shortcuts - Manages keyboard shortcuts for toggle blocks.
 *
 * CMD+ALT+T: Collapse/expand all toggle blocks on the page.
 * CMD+SHIFT+[: Collapse/expand the toggle block that currently has focus
 *   (or its parent toggle if the focused block is a child).
 * CMD+ALT+SHIFT+T: Collapse/expand all descendant toggles of the current toggle.
 *   Falls back to page-wide CMD+ALT+T behavior when cursor is not inside any toggle.
 */

import type { API, BlockAPI } from '../../../types';

import { Shortcuts } from '../../components/utils/shortcuts';

import { TOGGLE_ATTR, TOOL_NAME } from './constants';

const COLLAPSE_EXPAND_ALL_SHORTCUT = 'CMD+ALT+T';
const COLLAPSE_EXPAND_CURRENT_SHORTCUT = 'CMD+SHIFT+[';
const COLLAPSE_EXPAND_SCOPED_SHORTCUT = 'CMD+ALT+SHIFT+T';

/**
 * Manages the collapse/expand shortcuts for toggle blocks.
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
   * Register all toggle shortcuts on the document.
   * Pre-clears any stale registrations to handle cases where a previous editor
   * instance was not fully destroyed (e.g. Storybook story switching).
   */
  public register(): void {
    if (this.registered) {
      return;
    }

    Shortcuts.remove(document, COLLAPSE_EXPAND_ALL_SHORTCUT);
    Shortcuts.remove(document, COLLAPSE_EXPAND_CURRENT_SHORTCUT);
    Shortcuts.remove(document, COLLAPSE_EXPAND_SCOPED_SHORTCUT);

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

    Shortcuts.add({
      name: COLLAPSE_EXPAND_CURRENT_SHORTCUT,
      on: document,
      handler: (event: KeyboardEvent) => {
        if (!this.shouldHandle(event)) {
          return;
        }

        event.preventDefault();
        this.toggleCurrent();
      },
    });

    Shortcuts.add({
      name: COLLAPSE_EXPAND_SCOPED_SHORTCUT,
      on: document,
      handler: (event: KeyboardEvent) => {
        if (!this.shouldHandle(event)) {
          return;
        }

        event.preventDefault();
        this.toggleScoped();
      },
    });

    this.registered = true;
  }

  /**
   * Unregister all shortcuts.
   */
  public unregister(): void {
    if (!this.registered) {
      return;
    }

    Shortcuts.remove(document, COLLAPSE_EXPAND_ALL_SHORTCUT);
    Shortcuts.remove(document, COLLAPSE_EXPAND_CURRENT_SHORTCUT);
    Shortcuts.remove(document, COLLAPSE_EXPAND_SCOPED_SHORTCUT);
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
   * Toggle all collapsible blocks (toggle blocks and toggle headings).
   * If any is collapsed, expand all. If all are expanded, collapse all.
   */
  private toggleAll(): void {
    const toggleBlocks = this.collectAllToggleBlocks();

    if (toggleBlocks.length === 0) {
      return;
    }

    const anyCollapsed = toggleBlocks.some((b) => !b.isOpen);
    const method = anyCollapsed ? 'expand' : 'collapse';

    for (const block of toggleBlocks) {
      block.call(method);
    }
  }

  /**
   * Toggle the current block if it is a toggle, or its nearest toggle ancestor
   * if the current block is a child inside a toggle.
   * Does nothing if neither applies.
   */
  private toggleCurrent(): void {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();
    const currentBlock = this.api.blocks.getBlockByIndex(currentIndex);

    if (currentBlock === undefined) {
      return;
    }

    const targetBlock = this.findToggleBlockForCurrent(currentBlock);

    if (targetBlock === undefined) {
      return;
    }

    const toggleWrapper = targetBlock.holder.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);

    if (toggleWrapper === null) {
      return;
    }

    const isOpen = toggleWrapper.getAttribute(TOGGLE_ATTR.toggleOpen) === 'true';

    targetBlock.call(isOpen ? 'collapse' : 'expand');
  }

  /**
   * Toggle all descendant toggles of the root toggle ancestor for the current block.
   * If the current block is not inside any toggle, falls back to page-wide toggleAll().
   */
  private toggleScoped(): void {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();
    const currentBlock = this.api.blocks.getBlockByIndex(currentIndex);

    if (currentBlock === undefined) {
      return;
    }

    const rootToggle = this.findRootToggleAncestor(currentBlock);

    if (rootToggle === undefined) {
      this.toggleAll();
      return;
    }

    const descendants = this.collectDescendantToggleBlocks(rootToggle.id);

    if (descendants.length === 0) {
      return;
    }

    const anyCollapsed = descendants.some((b) => !b.isOpen);
    const method = anyCollapsed ? 'expand' : 'collapse';

    for (const block of descendants) {
      block.call(method);
    }
  }

  /**
   * Returns the toggle block to act on for the current block:
   * - If the current block itself is a toggle, return it.
   * - If it has a parentId pointing to a toggle block, return the parent.
   * - Otherwise return undefined.
   */
  private findToggleBlockForCurrent(block: BlockAPI): BlockAPI | undefined {
    if (this.isToggleBlock(block)) {
      return block;
    }

    if (block.parentId !== null) {
      const parent = this.api.blocks.getById(block.parentId);

      if (parent !== null && this.isToggleBlock(parent)) {
        return parent;
      }
    }

    return undefined;
  }

  /**
   * Walks up the parentId chain to find the root-level toggle ancestor of the
   * given block. Returns the root toggle if found, or undefined if the block is
   * not inside any toggle.
   */
  private findRootToggleAncestor(block: BlockAPI): BlockAPI | undefined {
    if (this.isToggleBlock(block) && block.parentId === null) {
      return block;
    }

    return this.walkToRootToggle(block.parentId, undefined);
  }

  private walkToRootToggle(parentId: string | null, best: BlockAPI | undefined): BlockAPI | undefined {
    if (parentId === null) {
      return best;
    }

    const parent = this.api.blocks.getById(parentId);

    if (parent === null) {
      return best;
    }

    return this.walkToRootToggle(parent.parentId, this.isToggleBlock(parent) ? parent : best);
  }

  /**
   * Recursively collects all descendant toggle blocks of the given parent id.
   * Returns items with call/isOpen so they can be expanded or collapsed.
   */
  private collectDescendantToggleBlocks(parentId: string): { call: (method: string) => void; isOpen: boolean }[] {
    const children = this.api.blocks.getChildren(parentId);
    const result: { call: (method: string) => void; isOpen: boolean }[] = [];

    for (const child of children) {
      const info = this.isToggleBlock(child) ? this.extractToggleBlockInfo(child) : null;

      if (info !== null) {
        result.push(info);
      }

      result.push(...this.collectDescendantToggleBlocks(child.id));
    }

    return result;
  }

  private extractToggleBlockInfo(child: BlockAPI): { call: (method: string) => void; isOpen: boolean } | null {
    const toggleWrapper = child.holder.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);

    if (toggleWrapper === null) {
      return null;
    }

    const isOpen = toggleWrapper.getAttribute(TOGGLE_ATTR.toggleOpen) === 'true';

    return { call: (method: string) => child.call(method), isOpen };
  }

  /**
   * Collect all toggle-capable blocks across the entire document.
   */
  private collectAllToggleBlocks(): { call: (method: string) => void; isOpen: boolean }[] {
    const blockCount = this.api.blocks.getBlocksCount();
    const toggleBlocks: { call: (method: string) => void; isOpen: boolean }[] = [];

    for (const i of Array.from({ length: blockCount }, (_, idx) => idx)) {
      const block = this.api.blocks.getBlockByIndex(i);

      if (block === undefined) {
        continue;
      }

      const toggleWrapper = block.holder.querySelector(`[${TOGGLE_ATTR.toggleOpen}]`);

      if (toggleWrapper === null) {
        continue;
      }

      const isOpen = toggleWrapper.getAttribute(TOGGLE_ATTR.toggleOpen) === 'true';

      toggleBlocks.push({ call: (method: string) => block.call(method), isOpen });
    }

    return toggleBlocks;
  }

  /**
   * Returns true if the given block is a toggle block (by tool name).
   */
  private isToggleBlock(block: BlockAPI): boolean {
    return block.name === TOOL_NAME;
  }
}
