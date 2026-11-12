import { ownClone } from './own-element';
import { parseUntrustedHtml } from './inert-html';

/**
 * How much of one block's own content a range covers. `from` and `to` are
 * offsets in the block's own text: no tool chrome, no nested blocks.
 */
export type BlockCut =
  | { kind: 'whole' }
  | { kind: 'none' }
  | { kind: 'part'; from: number; to: number; text: string; html: string };

/**
 * The text a fragment shows as the block's own content.
 * @param fragment - content cloned out of a block holder
 */
const ownTextOf = (fragment: DocumentFragment): string => {
  const wrapper = document.createElement('div');

  wrapper.appendChild(fragment);

  return ownClone(wrapper).textContent ?? '';
};

/**
 * Child indexes from `root` down to `node`.
 * @param root - an ancestor of `node`
 * @param node - the node to locate
 */
const pathOf = (root: Node, node: Node): number[] => {
  const parent = node.parentNode;

  if (node === root || parent === null) {
    return [];
  }

  return [...pathOf(root, parent), Array.prototype.indexOf.call(parent.childNodes, node)];
};

const nodeAt = (root: Node, path: number[]): Node => path.reduce<Node>((node, index) => node.childNodes[index] ?? node, root);

/**
 * The block's own markup with everything outside `part` deleted. Partly
 * covered elements stay, so a heading keeps its tag around the kept text.
 * @param holder - the block holder
 * @param part - a range inside `holder`
 */
const trimmedOwnHtml = (holder: HTMLElement, part: Range): string => {
  const clone = holder.cloneNode(true) as HTMLElement;
  const edit = document.createRange();

  // The tail goes first: deleting it leaves the start's path valid.
  edit.selectNodeContents(clone);
  edit.setStart(nodeAt(clone, pathOf(holder, part.endContainer)), part.endOffset);
  edit.deleteContents();
  edit.selectNodeContents(clone);
  edit.setEnd(nodeAt(clone, pathOf(holder, part.startContainer)), part.startOffset);
  edit.deleteContents();

  return ownClone(clone).innerHTML;
};

/**
 * Measure a block against a selection range.
 * @param holder - the block holder
 * @param range - the page selection
 */
export const cutBlockToRange = (holder: HTMLElement, range: Range): BlockCut => {
  if (!range.intersectsNode(holder)) {
    return { kind: 'none' };
  }

  const all = document.createRange();

  all.selectNodeContents(holder);

  const part = all.cloneRange();

  if (range.compareBoundaryPoints(Range.START_TO_START, all) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, all) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }

  const text = ownTextOf(all.cloneContents());
  const selected = ownTextOf(part.cloneContents());

  if (selected.length === text.length) {
    return { kind: 'whole' };
  }
  if (selected.length === 0) {
    return { kind: 'none' };
  }

  const before = all.cloneRange();

  before.setEnd(part.startContainer, part.startOffset);

  const from = ownTextOf(before.cloneContents()).length;

  return { kind: 'part', from, to: from + selected.length, text, html: trimmedOwnHtml(holder, part) };
};

const textNodesOf = (node: Node): Node[] => node.nodeType === Node.TEXT_NODE
  ? [node]
  : Array.from(node.childNodes).flatMap(textNodesOf);

/**
 * Keep only the characters `from` to `to` of some saved inline markup, with
 * the marks around them.
 * @param html - saved inline markup
 * @param from - first kept character
 * @param to - character after the last kept one
 */
export const sliceHtmlByText = (html: string, from: number, to: number): string => {
  const root = parseUntrustedHtml(html);
  const owner = root.ownerDocument;
  const slice = owner.createRange();

  slice.selectNodeContents(root);
  textNodesOf(root).reduce((seen, node) => {
    const length = node.textContent?.length ?? 0;

    if (from >= seen && from < seen + length) {
      slice.setStart(node, from - seen);
    }
    if (to > seen && to <= seen + length) {
      slice.setEnd(node, to - seen);
    }

    return seen + length;
  }, 0);

  const out = owner.createElement('div');

  out.appendChild(slice.cloneContents());

  return out.innerHTML;
};
