import { EQUATION_SOURCE_ATTR } from '../../../shared/equation-mark';
import { PAGE_REFERENCE_ATTR } from '../../../shared/page-reference';
import { OPAQUE_TAGS } from '../../../shared/rich-text/html-to-segments';

import { resolveCaretRange } from './caret-position';
import type { CaretPosition } from './caret-position';

export interface AgentTarget {
  blockId: string;
  field?: string | null;
  start?: number | null;
  end?: number | null;
}

export type AgentPlacement =
  | { kind: 'caret'; caret: CaretPosition }
  | { kind: 'block'; blockId: string };

export interface PlacementDeps {
  resolveInputs(blockId: string): HTMLElement[];
  inputIndexFor(blockId: string, field: string): number | null;
}

export function inputIndexForField(
  field: string,
  entry: { inputFields?: string[]; richTextFields: string[] } | undefined
): number | null {
  if (entry === undefined) {
    return null;
  }

  if (entry.inputFields !== undefined) {
    const index = entry.inputFields.indexOf(field);

    return index === -1 ? null : index;
  }

  return entry.richTextFields.length === 1 && entry.richTextFields[0] === field ? 0 : null;
}

const isEmbed = (element: Element): boolean =>
  (element.localName === 'a' && element.hasAttribute(PAGE_REFERENCE_ATTR))
  || (element.localName === 'span' && element.hasAttribute(EQUATION_SOURCE_ATTR))
  || OPAQUE_TAGS.has(element.localName);

const mapContractOffset = (input: HTMLElement, units: number): { dom: number; contract: number } => {
  const walk = { left: Math.max(0, units), dom: 0, contract: 0, done: false };

  const visit = (node: Node): void => {
    if (walk.done) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;

      if (walk.left <= length) {
        walk.dom += walk.left;
        walk.contract += walk.left;
        walk.left = 0;
        walk.done = true;

        return;
      }

      walk.dom += length;
      walk.contract += length;
      walk.left -= length;

      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    if (node.localName === 'br' || isEmbed(node)) {
      if (walk.left === 0) {
        walk.done = true;

        return;
      }

      // CaretPosition counts rendered embed text, but no text for a line break.
      walk.dom += node.localName === 'br' ? 0 : node.textContent?.length ?? 0;
      walk.contract += 1;
      walk.left -= 1;

      return;
    }

    node.childNodes.forEach(visit);
  };

  input.childNodes.forEach(visit);

  return { dom: walk.dom, contract: walk.contract };
};

export function contractToDomOffset(input: HTMLElement, units: number): number {
  return mapContractOffset(input, units).dom;
}

const reachesEmbedEdge = (embed: Element, node: Node, end: boolean): boolean => {
  if (node === embed) {
    return true;
  }

  const sibling = end ? node.nextSibling : node.previousSibling;
  const parent = node.parentNode;

  return sibling === null && parent !== null && reachesEmbedEdge(embed, parent, end);
};

const isRepresentable = (input: HTMLElement, point: { dom: number; contract: number }): boolean => {
  const range = resolveCaretRange(input, point.dom);

  if (range === null) {
    return false;
  }

  if (range.startContainer === input) {
    return point.contract === 0;
  }

  const walk = { units: 0, found: false, valid: true };
  const visit = (node: Node): void => {
    if (walk.found) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      walk.found = node === range.startContainer;
      walk.units += walk.found ? range.startOffset : node.textContent?.length ?? 0;

      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    if (node.localName === 'br' || isEmbed(node)) {
      if (!node.contains(range.startContainer)) {
        walk.units += 1;

        return;
      }

      const atStart = range.startOffset === 0 && reachesEmbedEdge(node, range.startContainer, false);
      const atEnd = range.startOffset === (range.startContainer.textContent?.length ?? 0)
        && reachesEmbedEdge(node, range.startContainer, true);

      // Text length alone misses zero-text siblings at an embed's edges.
      walk.valid = atStart || atEnd;
      walk.units += atEnd && !atStart ? 1 : 0;
      walk.found = true;

      return;
    }

    node.childNodes.forEach(visit);
  };

  input.childNodes.forEach(visit);

  return walk.found && walk.valid && walk.units === point.contract;
};

export function placeAgent(target: AgentTarget, deps: PlacementDeps): AgentPlacement {
  const block: AgentPlacement = { kind: 'block', blockId: target.blockId };
  const { field, start, end } = target;

  if (typeof field !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
    return block;
  }

  const index = deps.inputIndexFor(target.blockId, field);

  if (index === null) {
    return block;
  }

  const input = deps.resolveInputs(target.blockId)[index];

  if (input === undefined || input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    return block;
  }

  const anchor = mapContractOffset(input, start);
  const head = mapContractOffset(input, end);

  // Scalar offsets lose the side of a zero-text node; reject failed round trips.
  if (!isRepresentable(input, anchor) || !isRepresentable(input, head)) {
    return block;
  }

  return {
    kind: 'caret',
    caret: {
      blockId: target.blockId,
      inputIndex: index,
      anchor: anchor.dom,
      head: head.dom,
    },
  };
}
