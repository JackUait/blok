import type { BlokModules } from '../../../../types-internal/blok-modules';
import { DATA_ATTR } from '../../../constants/data-attributes';
import { getCaretPositionFromPoint } from '../../../utils/caret/navigation';

/**
 * The input on the clicked row: the one whose box spans `y`, else the last
 * one above it, else the first.
 * @param inputs - the block's inputs
 * @param y - the click's client y
 */
const inputOnRow = (inputs: HTMLElement[], y: number): HTMLElement | undefined => {
  const spanning = inputs.find((input) => {
    const rect = input.getBoundingClientRect();

    return y >= rect.top && y <= rect.bottom;
  });

  return spanning ?? inputs.filter((input) => input.getBoundingClientRect().top <= y).at(-1) ?? inputs[0];
};

/**
 * A click in the editor's empty area beside a block's row puts the caret at
 * the end of that row's line, as in Notion (U179). The browser would drop the
 * caret there, since the point is in no input. A click outside the editor is
 * the host page's, so it is left alone.
 * @param blok - Blok modules
 * @param redactor - the editor surface
 * @param event - the click
 * @returns true when the caret was placed
 */
export const placeCaretBesideRow = (blok: BlokModules, redactor: HTMLElement, event: MouseEvent): boolean => {
  const target = event.target;

  if (
    !(target instanceof Element)
    || event.button !== 0
    || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
    || blok.ReadOnly.isEnabled
    || blok.BlockSelection.anyBlockSelected
    || !redactor.contains(target)
    || target.closest(`[${DATA_ATTR.elementContent}]`) !== null
  ) {
    return false;
  }

  const selection = window.getSelection();

  // A drag over the empty area may have selected text.
  if (selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) {
    return false;
  }

  const holder = target.closest(`[${DATA_ATTR.id}]`);
  const block = holder === null ? undefined : blok.BlockManager.getBlockByChildNode(holder);

  if (block === undefined || block.holder !== holder) {
    return false;
  }

  const input = inputOnRow(block.inputs, event.clientY);

  if (input === undefined || !input.isConnected) {
    return false;
  }

  const rect = input.getBoundingClientRect();
  // Just inside the input's right edge, on the clicked line: the nearest caret there is that line's end.
  const point = getCaretPositionFromPoint(rect.right - 1, Math.min(Math.max(event.clientY, rect.top + 1), rect.bottom - 1));

  if (point === null || !input.contains(point.node) || selection === null) {
    blok.Caret.setToInput(input, blok.Caret.positions.END);

    return true;
  }

  input.focus({ preventScroll: true });
  selection.collapse(point.node, point.offset);
  blok.BlockManager.setCurrentBlockByChildNode(input);

  return true;
};
