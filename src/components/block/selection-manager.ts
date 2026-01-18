import { DATA_ATTR } from '../constants';
import type { BlokEventMap } from '../events';
import { FakeCursorAboutToBeToggled, FakeCursorHaveBeenSet } from '../events';
import { SelectionUtils } from '../selection';
import type { EventsDispatcher } from '../utils/events';

import type { StyleManager } from './style-manager';

/**
 * Manages block selection logic including fake cursor behavior.
 * Handles selection state, content styling, and fake cursor coordination.
 */
export class SelectionManager {
  /**
   * @param holder - Block's holder element
   * @param getContentElement - Getter for the content element
   * @param getStretched - Getter for stretched state
   * @param blokEventBus - Common blok event bus for fake cursor coordination
   * @param styleManager - StyleManager for content styling
   */
  constructor(
    private readonly holder: HTMLDivElement,
    private readonly getContentElement: () => HTMLElement | null,
    private readonly getStretched: () => boolean,
    private readonly blokEventBus: EventsDispatcher<BlokEventMap> | null,
    private readonly styleManager: StyleManager
  ) {}

  /**
   * Set selected state
   * @param state - true to select, false to remove selection
   */
  public set selected(state: boolean) {
    // Toggle data attribute
    if (state) {
      this.holder.setAttribute(DATA_ATTR.selected, 'true');
    } else {
      this.holder.removeAttribute(DATA_ATTR.selected);
    }

    // Update content element styling via StyleManager
    this.handleFakeCursor(state);

    // Handle fake cursor add/remove
    const fakeCursorWillBeAdded = state && SelectionUtils.isRangeInsideContainer(this.holder);
    const fakeCursorWillBeRemoved = !state && SelectionUtils.isFakeCursorInsideContainer(this.holder);

    if (!fakeCursorWillBeAdded && !fakeCursorWillBeRemoved) {
      return;
    }

    // Emit mutex event
    this.blokEventBus?.emit(FakeCursorAboutToBeToggled, { state });

    if (fakeCursorWillBeAdded) {
      SelectionUtils.addFakeCursor();
    }

    if (fakeCursorWillBeRemoved) {
      SelectionUtils.removeFakeCursor(this.holder);
    }

    this.blokEventBus?.emit(FakeCursorHaveBeenSet, { state });
  }

  /**
   * Get selected state
   */
  public get selected(): boolean {
    return this.holder.getAttribute(DATA_ATTR.selected) === 'true';
  }

  /**
   * Handle fake cursor state and content styling
   * @param state - selection state
   */
  private handleFakeCursor(state: boolean): void {
    const contentElement = this.getContentElement();
    const stretched = this.getStretched();

    if (contentElement) {
      this.styleManager.updateContentState(state, stretched);
    }
  }
}
