/**
 * Physical gaps between a media figure and its tool root, for the block toolbar
 * (`BlockTool.getContentOffset`). Undefined when the figure fills the root.
 */
export const figureInsets = (root: Element, figure: Element): { left: number; right: number } | undefined => {
  const rootRect = root.getBoundingClientRect();
  const figureRect = figure.getBoundingClientRect();
  const left = Math.max(0, figureRect.left - rootRect.left);
  const right = Math.max(0, rootRect.right - figureRect.right);

  return left > 0 || right > 0 ? { left, right } : undefined;
};
