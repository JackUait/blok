import type { BlokModules } from '../../../../types-internal/blok-modules';
import { SelectionUtils as Selection } from '../../../selection/index';

/**
 * Dependencies for the click handler
 */
export interface ClickHandlerDependencies {
  Blok: BlokModules;
  nodes: {
    holder: HTMLElement;
    redactor: HTMLElement;
  };
}

/**
 * Analyzes the click context to determine what was clicked and where
 *
 * @param deps - Dependencies including Blok modules and DOM nodes
 * @param event - The click event
 * @returns Object containing analysis of the click context
 */
export const analyzeClickContext = (
  deps: ClickHandlerDependencies,
  event: MouseEvent
): {
  target: HTMLElement;
  clickedInsideOfBlok: boolean;
  clickedInsideRedactor: boolean;
  clickedInsideToolbar: boolean;
  clickedInsideInlineToolbar: boolean;
  clickedInsideBlokSurface: boolean;
  doNotProcess: boolean;
  shouldClearCurrentBlock: boolean;
} => {
  const { Blok, nodes } = deps;
  const target = event.target as HTMLElement;
  const clickedInsideOfBlok = nodes.holder.contains(target) || Selection.isAtBlok;
  const clickedInsideRedactor = nodes.redactor.contains(target);
  const clickedInsideToolbar = Blok.Toolbar.contains(target);
  const clickedInsideInlineToolbar = Blok.InlineToolbar.containsNode(target);
  const clickedInsideBlokSurface = clickedInsideOfBlok || clickedInsideToolbar;

  /**
   * Check if click is on Block Settings, Settings Toggler, or Plus Button
   * These elements have their own click handlers and should not trigger default behavior
   */
  const isClickedInsideBlockSettings = Blok.BlockSettings.contains(target);
  const isClickedInsideBlockSettingsToggler = Blok.Toolbar.nodes.settingsToggler?.contains(target) ?? false;
  const isClickedInsidePlusButton = Blok.Toolbar.nodes.plusButton?.contains(target) ?? false;
  const doNotProcess = isClickedInsideBlockSettings || isClickedInsideBlockSettingsToggler || isClickedInsidePlusButton;

  const shouldClearCurrentBlock = !clickedInsideBlokSurface || (!clickedInsideRedactor && !clickedInsideToolbar);

  return {
    target,
    clickedInsideOfBlok,
    clickedInsideRedactor,
    clickedInsideToolbar,
    clickedInsideInlineToolbar,
    clickedInsideBlokSurface,
    doNotProcess,
    shouldClearCurrentBlock,
  };
}

/**
 * Creates a document click handler
 *
 * Responsibilities:
 * - Clear current block when clicking outside editor
 * - Close BlockSettings when appropriate
 * - Move toolbar when clicking in redactor after closing settings
 * - Clear block selection
 * - Close inline toolbar
 *
 * @param deps - Dependencies including Blok modules and DOM nodes
 * @returns Event handler function for document click events
 */
export const createDocumentClickedHandler = (
  deps: ClickHandlerDependencies
): ((event: MouseEvent) => void) => {
  return (event: MouseEvent): void => {
    /**
     * Sometimes we emulate click on some UI elements, for example by Enter on Block Settings button
     * We don't need to handle such events, because they handled in other place.
     */
    if (!event.isTrusted) {
      return;
    }

    const { Blok } = deps;
    const context = analyzeClickContext(deps, event);

    /**
     * Don't clear current block when clicking on settings toggler, plus button, or inside block settings
     * These elements need the current block to function properly
     */
    if (context.shouldClearCurrentBlock && !context.doNotProcess) {
      /**
       * Clear pointer on BlockManager
       *
       * Current page might contain several instances
       * Click between instances MUST clear focus, pointers
       *
       * Note: We do NOT close the toolbar here - it should remain visible
       * so users can continue interacting with the editor even after clicking outside
       */
      Blok.BlockManager.unsetCurrentBlock();
    }

    const shouldCloseBlockSettings = Blok.BlockSettings.opened && !context.doNotProcess;
    if (shouldCloseBlockSettings) {
      Blok.BlockSettings.close();
    }

    if (shouldCloseBlockSettings && context.clickedInsideRedactor) {
      const clickedBlock = Blok.BlockManager.getBlockByChildNode(context.target);
      Blok.Toolbar.moveAndOpen(clickedBlock);
    }

    /**
     * Clear Selection if user clicked somewhere
     * But preserve selection when clicking on block settings toggler or inside block settings
     * to allow multi-block operations like conversion
     */
    if (!context.doNotProcess) {
      Blok.BlockSelection.clearSelection(event);
    }

    /**
     * Close Inline Toolbar when clicking outside of it
     * This handles clicks anywhere outside the inline toolbar,
     * including inside the editor content area or on page controls
     */
    if (Blok.InlineToolbar.opened && !context.clickedInsideInlineToolbar) {
      Blok.InlineToolbar.close();
    }
  };
}
