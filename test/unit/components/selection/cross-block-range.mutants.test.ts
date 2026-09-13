import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../src/components/block';
import {
  applySpanningSelection,
  blocksBetween,
  caretPointFromCoords,
  collectCrossBlockSubRanges,
  focusEdgeForPointer,
  getEditingHost,
  hasCrossHostSelectionWithin,
  hasEditableContent,
  pointAtInputBoundary,
  resolveCrossBlockTextSelection,
  splitRangeByEditingHost
} from '../../../../src/components/selection/cross-block-range';

type Fixture = {
  root: HTMLElement;
  hosts: HTMLElement[];
};

/**
 * Three sibling editing hosts inside one non-editable root, each wrapped the
 * way a block wraps its own contenteditable.
 * @param texts - text content for each host
 */
const buildHosts = (texts: string[]): Fixture => {
  const root = document.createElement('div');

  const hosts = texts.map((text) => {
    const wrapper = document.createElement('div');
    const host = document.createElement('div');

    host.setAttribute('contenteditable', 'true');
    host.textContent = text;
    wrapper.appendChild(host);
    root.appendChild(wrapper);

    return host;
  });

  document.body.appendChild(root);

  return { root,
    hosts };
};

const textNodeOf = (host: HTMLElement): Text => {
  const node = host.firstChild;

  if (!(node instanceof Text)) {
    throw new Error('Host has no text node');
  }

  return node;
};

const rangeAcross = (from: HTMLElement, fromOffset: number, to: HTMLElement, toOffset: number): Range => {
  const range = document.createRange();

  range.setStart(textNodeOf(from), fromOffset);
  range.setEnd(textNodeOf(to), toOffset);

  return range;
};

const selectRange = (range: Range): void => {
  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const createBlockStub = (id: string, parentId: string | null): Block => {
  return {
    id,
    parentId,
    name: 'paragraph',
  } as unknown as Block;
};

/**
 * Resolves any node to a block keyed by which fixture host owns it.
 * @param fixture - the hosts to key by
 */
const blockOfFactory = (fixture: Fixture) => (node: Node): Block | undefined => {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const host = element?.closest('[contenteditable="true"]') ?? null;
  const index = host === null ? -1 : fixture.hosts.indexOf(host as HTMLElement);

  return index === -1 ? undefined : createBlockStub(`block-${index}`, null);
};

/**
 * A box stated outright: jsdom lays nothing out, so every rect is zero.
 * @param top - the box's top edge
 * @param bottom - the box's bottom edge
 */
const inputSpanning = (top: number, bottom: number): HTMLElement => {
  const input = document.createElement('div');

  input.getBoundingClientRect = (): DOMRect => new DOMRect(0, top, 200, bottom - top);

  return input;
};

describe('cross-block-range (mutants)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = buildHosts([ 'First block text', 'Second block text', 'Third block text' ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    fixture.root.remove();
    document.querySelectorAll('[data-extra-fixture]').forEach((node) => node.remove());
  });

  describe('getEditingHost', () => {
    it('returns null for undefined as well as for null', () => {
      expect(getEditingHost(undefined)).toBeNull();
      expect(getEditingHost(null)).toBeNull();
    });

    it('resolves an element node through itself, not through its parent', () => {
      expect(getEditingHost(fixture.hosts[1])).toBe(fixture.hosts[1]);
    });

    it('resolves a text node through its parent element', () => {
      const inner = document.createElement('span');

      inner.textContent = 'deep';
      fixture.hosts[0].appendChild(inner);

      expect(getEditingHost(textNodeOf(inner))).toBe(fixture.hosts[0]);
    });

    it('skips a mutation-free decoration and reports the real host above it', () => {
      const marker = document.createElement('span');

      marker.setAttribute('contenteditable', 'true');
      marker.setAttribute('data-blok-mutation-free', 'true');
      marker.textContent = '1.';
      fixture.hosts[0].appendChild(marker);

      expect(getEditingHost(marker)).toBe(fixture.hosts[0]);
    });

    it('returns null when the nearest editable ancestor is not an HTML element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      svg.setAttribute('contenteditable', 'true');
      fixture.root.appendChild(svg);

      expect(svg instanceof HTMLElement).toBe(false);
      expect(getEditingHost(svg)).toBeNull();
    });

    it('returns null for a detached text node with no parent element', () => {
      expect(getEditingHost(document.createTextNode('orphan'))).toBeNull();
    });
  });

  describe('hasEditableContent', () => {
    it('is true for a subtree containing an editing host', () => {
      expect(hasEditableContent(fixture.root)).toBe(true);
    });

    it('is false for a subtree with no editing host', () => {
      const empty = document.createElement('div');

      expect(hasEditableContent(empty)).toBe(false);
    });

    it('is false when the only editable descendant is a mutation-free decoration', () => {
      const wrapper = document.createElement('div');
      const marker = document.createElement('span');

      marker.setAttribute('contenteditable', 'true');
      marker.setAttribute('data-blok-mutation-free', 'true');
      wrapper.appendChild(marker);

      expect(hasEditableContent(wrapper)).toBe(false);
    });

    it('does not count the root itself as its own editable content', () => {
      expect(hasEditableContent(fixture.hosts[0])).toBe(false);
    });
  });

  describe('splitRangeByEditingHost', () => {
    it('returns nothing when the range has no element scope to search', () => {
      const orphan = document.createTextNode('detached');
      const range = document.createRange();

      range.setStart(orphan, 0);
      range.setEnd(orphan, 4);

      expect(splitRangeByEditingHost(range)).toStrictEqual([]);
    });

    it('derives the scope from the common ancestor when it is already an element', () => {
      const range = document.createRange();

      range.selectNodeContents(fixture.root);

      expect(splitRangeByEditingHost(range).map((slice) => slice.input)).toStrictEqual(fixture.hosts);
    });

    it('lists the range-owning host first when it is an ancestor of the scope', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[2], 0, fixture.hosts[2], 5));

      expect(slices.map((slice) => slice.input)).toStrictEqual([ fixture.hosts[2] ]);
    });

    it('never lists a host twice when it is both the owner and inside the scope', () => {
      const range = rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1);

      const inputs = splitRangeByEditingHost(range, fixture.root).map((slice) => slice.input);

      expect(inputs).toStrictEqual([ fixture.hosts[0], fixture.hosts[1] ]);
    });

    it('drops hosts the range does not intersect at all', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 1, fixture.hosts[0], 5), fixture.root);

      expect(slices.map((slice) => slice.input)).toStrictEqual([ fixture.hosts[0] ]);
    });

    it('drops a host whose share would be an empty range in the same text node', () => {
      const range = document.createRange();

      range.setStart(textNodeOf(fixture.hosts[1]), 3);
      range.setEnd(textNodeOf(fixture.hosts[1]), 3);

      expect(splitRangeByEditingHost(range, fixture.root)).toStrictEqual([]);
    });

    it('clamps the first host to the range start and the last to the range end', () => {
      const range = rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6);
      const slices = splitRangeByEditingHost(range, fixture.root);

      expect(slices[0].range.startContainer).toBe(textNodeOf(fixture.hosts[0]));
      expect(slices[0].range.startOffset).toBe(6);
      expect(slices[0].range.endContainer).toBe(fixture.hosts[0]);
      expect(slices[0].range.endOffset).toBe(1);
      expect(slices[2].range.startContainer).toBe(fixture.hosts[2]);
      expect(slices[2].range.startOffset).toBe(0);
      expect(slices[2].range.endContainer).toBe(textNodeOf(fixture.hosts[2]));
      expect(slices[2].range.endOffset).toBe(6);
    });

    it('leaves the middle host at its own whole contents', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6), fixture.root);

      expect(slices[1].range.startContainer).toBe(fixture.hosts[1]);
      expect(slices[1].range.startOffset).toBe(0);
      expect(slices[1].range.endContainer).toBe(fixture.hosts[1]);
      expect(slices[1].range.endOffset).toBe(1);
    });

    it('counts a host as wholly covered when the range starts at the host boundary itself', () => {
      const range = document.createRange();

      range.setStart(fixture.hosts[0], 0);
      range.setEnd(textNodeOf(fixture.hosts[1]), 3);

      const slices = splitRangeByEditingHost(range, fixture.root);

      expect(slices[0].coversWholeInput).toBe(true);
      expect(slices[0].range.toString()).toBe('First block text');
    });

    it('counts a host as partial when the range starts inside its text node at offset 0', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 0, fixture.hosts[1], 3), fixture.root);

      expect(slices[0].coversWholeInput).toBe(false);
      expect(slices[0].range.toString()).toBe('First block text');
    });

    it('counts a host as partial when the range starts one character in', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 3), fixture.root);

      expect(slices[0].coversWholeInput).toBe(false);
    });

    it('counts a host as wholly covered when the range ends at the host boundary itself', () => {
      const range = document.createRange();

      range.setStart(textNodeOf(fixture.hosts[0]), 3);
      range.setEnd(fixture.hosts[1], fixture.hosts[1].childNodes.length);

      const slices = splitRangeByEditingHost(range, fixture.root);

      expect(slices[1].coversWholeInput).toBe(true);
      expect(slices[1].range.toString()).toBe('Second block text');
    });

    it('counts a host as partial when the range ends inside its text node at its full length', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 3, fixture.hosts[1], 17), fixture.root);

      expect(slices[1].coversWholeInput).toBe(false);
      expect(slices[1].range.toString()).toBe('Second block text');
    });

    it('counts a host as partial when the range ends one character short', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 3, fixture.hosts[1], 16), fixture.root);

      expect(slices[1].coversWholeInput).toBe(false);
      expect(slices[1].range.toString()).toBe('Second block tex');
    });

    it('keeps a touched trailing host as a zero-length share spanning the block break', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 0), fixture.root);

      expect(slices).toHaveLength(3);
      expect(slices[2].range.startContainer).toBe(fixture.hosts[2]);
      expect(slices[2].range.startOffset).toBe(0);
      expect(slices[2].range.endContainer).toBe(textNodeOf(fixture.hosts[2]));
      expect(slices[2].range.endOffset).toBe(0);
      expect(slices[2].coversWholeInput).toBe(false);
    });

    it('does not mutate the range it was given', () => {
      const range = rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6);

      splitRangeByEditingHost(range, fixture.root);

      expect(range.startContainer).toBe(textNodeOf(fixture.hosts[0]));
      expect(range.startOffset).toBe(6);
      expect(range.endContainer).toBe(textNodeOf(fixture.hosts[2]));
      expect(range.endOffset).toBe(6);
    });

    it('derives the scope from a detached common ancestor element, not from its absent parent', () => {
      const detached = document.createElement('div');
      const host = document.createElement('div');

      host.setAttribute('contenteditable', 'true');
      host.textContent = 'floating text';
      detached.appendChild(host);

      const range = document.createRange();

      range.selectNodeContents(detached);

      expect(detached.parentElement).toBeNull();

      const slices = splitRangeByEditingHost(range);

      expect(slices.map((slice) => slice.input)).toStrictEqual([ host ]);
      expect(slices[0].range.toString()).toBe('floating text');
    });

    it('searches the given root rather than the range ancestor', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[1], 1, fixture.hosts[1], 4), fixture.root);

      expect(slices.map((slice) => slice.input)).toStrictEqual([ fixture.hosts[1] ]);
    });
  });

  describe('collectCrossBlockSubRanges', () => {
    it('carries every field of each host share through untouched', () => {
      const range = rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6);
      const subRanges = collectCrossBlockSubRanges(range, fixture.root, blockOfFactory(fixture));
      const hostShares = splitRangeByEditingHost(range, fixture.root);

      expect(subRanges).toHaveLength(3);
      expect(subRanges.map((sub) => sub.input)).toStrictEqual(fixture.hosts);
      expect(subRanges.map((sub) => sub.block.id)).toStrictEqual([ 'block-0', 'block-1', 'block-2' ]);
      expect(subRanges.map((sub) => sub.coversWholeInput)).toStrictEqual(
        hostShares.map((share) => share.coversWholeInput)
      );
      expect(subRanges.map((sub) => sub.range.toString())).toStrictEqual(
        hostShares.map((share) => share.range.toString())
      );
    });

    it('resolves the block from the host element, not from the range container', () => {
      const seen: Node[] = [];
      const blockOf = (node: Node): Block | undefined => {
        seen.push(node);

        return createBlockStub('any', null);
      };

      collectCrossBlockSubRanges(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1), fixture.root, blockOf);

      expect(seen).toStrictEqual([ fixture.hosts[0], fixture.hosts[1] ]);
    });

    it('keeps the resolvable hosts in order when a middle one has no block', () => {
      const blockOf = (node: Node): Block | undefined => {
        return node === fixture.hosts[1] ? undefined : createBlockStub(`b-${fixture.hosts.indexOf(node as HTMLElement)}`, null);
      };

      const subRanges = collectCrossBlockSubRanges(
        rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6),
        fixture.root,
        blockOf
      );

      expect(subRanges.map((sub) => sub.block.id)).toStrictEqual([ 'b-0', 'b-2' ]);
    });

    it('is empty when no host resolves to a block', () => {
      const subRanges = collectCrossBlockSubRanges(
        rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6),
        fixture.root,
        () => undefined
      );

      expect(subRanges).toStrictEqual([]);
    });
  });

  describe('resolveCrossBlockTextSelection', () => {
    it('returns null when there is no range at all', () => {
      window.getSelection()?.removeAllRanges();

      expect(resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture))).toBeNull();
    });

    it('returns null when the window has no selection', () => {
      const view = fixture.root.ownerDocument.defaultView;

      if (view === null) {
        throw new Error('No default view');
      }

      vi.spyOn(view, 'getSelection').mockReturnValue(null);

      expect(resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture))).toBeNull();
    });

    it('returns null when one endpoint is outside any editing host', () => {
      const loose = document.createElement('div');

      loose.textContent = 'not editable';
      loose.setAttribute('data-extra-fixture', 'true');
      document.body.appendChild(loose);

      const range = document.createRange();

      range.setStart(textNodeOf(fixture.hosts[0]), 1);
      range.setEnd(textNodeOf(loose), 3);
      selectRange(range);

      expect(resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture))).toBeNull();
    });

    it('returns null when both endpoints share one editing host', () => {
      selectRange(rangeAcross(fixture.hosts[1], 1, fixture.hosts[1], 5));

      expect(resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture))).toBeNull();
    });

    it('returns null when the hosts resolve to the same block', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1));

      const shared = createBlockStub('only', null);
      const sameBlock = (): Block => shared;

      expect(resolveCrossBlockTextSelection(fixture.root, sameBlock)).toBeNull();
    });

    it('returns null when a host resolves to no block', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1));

      const onlyFirst = (node: Node): Block | undefined => {
        return node === fixture.hosts[0] ? createBlockStub('block-0', null) : undefined;
      };

      expect(resolveCrossBlockTextSelection(fixture.root, onlyFirst)).toBeNull();
    });

    it('returns null when only one host share survives block resolution', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1));

      const perHost = blockOfFactory(fixture);
      let seen = 0;
      const blockOf = (node: Node): Block | undefined => {
        seen += 1;

        return seen > 2 && node === fixture.hosts[1] ? undefined : perHost(node);
      };

      expect(resolveCrossBlockTextSelection(fixture.root, blockOf)).toBeNull();
    });

    it('returns the live spanning range itself, not a copy', () => {
      const range = rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6);

      selectRange(range);

      const selected = window.getSelection()?.getRangeAt(0);
      const resolved = resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture));

      expect(resolved?.range).toBe(selected);
    });

    it('names the start and end blocks from the range endpoints, not from DOM order of hosts', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[1], 2));

      const resolved = resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture));

      expect(resolved?.startBlock.id).toBe('block-0');
      expect(resolved?.endBlock.id).toBe('block-1');
      expect(resolved?.subRanges).toHaveLength(2);
    });

    it('returns null when the selection is collapsed inside one host', () => {
      selectRange(rangeAcross(fixture.hosts[0], 3, fixture.hosts[0], 3));

      expect(resolveCrossBlockTextSelection(fixture.root, blockOfFactory(fixture))).toBeNull();
    });

    it('returns null when the root document has no window to read a selection from', () => {
      const detachedDoc = document.implementation.createHTMLDocument('detached');
      const root = detachedDoc.createElement('div');

      detachedDoc.body.appendChild(root);

      expect(detachedDoc.defaultView).toBeNull();
      expect(resolveCrossBlockTextSelection(root, () => undefined)).toBeNull();
    });

    /**
     * Two editable descendants inside ONE editing host still make one host, so
     * the selection is not cross-block however many shares it splits into.
     */
    it('returns null when both endpoints sit in one host that has nested editable children', () => {
      const outer = document.createElement('div');

      outer.setAttribute('contenteditable', 'true');
      [ 'inner one', 'inner two' ].forEach((text) => {
        const inner = document.createElement('div');

        inner.setAttribute('contenteditable', 'true');
        inner.textContent = text;
        outer.appendChild(inner);
      });
      fixture.root.appendChild(outer);

      const range = document.createRange();

      range.setStart(outer, 0);
      range.setEnd(outer, 2);
      selectRange(range);

      let issued = 0;
      const freshBlockPerCall = (): Block => {
        issued += 1;

        return createBlockStub(`block-${issued}`, null);
      };

      expect(getEditingHost(range.startContainer)).toBe(outer);
      expect(getEditingHost(range.endContainer)).toBe(outer);
      expect(resolveCrossBlockTextSelection(fixture.root, freshBlockPerCall)).toBeNull();
    });

    it('returns null when the start host has no block even though two other shares resolve', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6));

      const exceptFirst = (node: Node): Block | undefined => {
        return node === fixture.hosts[0] ? undefined : createBlockStub(`b-${fixture.hosts.indexOf(node as HTMLElement)}`, null);
      };

      expect(collectCrossBlockSubRanges(
        rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6),
        fixture.root,
        exceptFirst
      )).toHaveLength(2);
      expect(resolveCrossBlockTextSelection(fixture.root, exceptFirst)).toBeNull();
    });

    it('returns null when the end host has no block even though two other shares resolve', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6));

      const exceptLast = (node: Node): Block | undefined => {
        return node === fixture.hosts[2] ? undefined : createBlockStub(`b-${fixture.hosts.indexOf(node as HTMLElement)}`, null);
      };

      expect(collectCrossBlockSubRanges(
        rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6),
        fixture.root,
        exceptLast
      )).toHaveLength(2);
      expect(resolveCrossBlockTextSelection(fixture.root, exceptLast)).toBeNull();
    });

    it('returns null when only the end host lies outside the root', () => {
      const other = buildHosts([ 'Outside one' ]);

      other.root.setAttribute('data-extra-fixture', 'true');

      const range = document.createRange();

      range.setStart(textNodeOf(fixture.hosts[0]), 1);
      range.setEnd(textNodeOf(other.hosts[0]), 3);
      selectRange(range);

      const blockOf = (node: Node): Block | undefined => {
        return node === fixture.hosts[0] ? createBlockStub('a', null) : createBlockStub('b', null);
      };

      expect(resolveCrossBlockTextSelection(fixture.root, blockOf)).toBeNull();
    });
  });

  describe('hasCrossHostSelectionWithin', () => {
    it('is false when the window has no selection', () => {
      const view = fixture.root.ownerDocument.defaultView;

      if (view === null) {
        throw new Error('No default view');
      }

      vi.spyOn(view, 'getSelection').mockReturnValue(null);

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(false);
    });

    it('is false when there is no range', () => {
      window.getSelection()?.removeAllRanges();

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(false);
    });

    it('is false when one endpoint sits outside any editing host', () => {
      const loose = document.createElement('div');

      loose.textContent = 'plain';
      loose.setAttribute('data-extra-fixture', 'true');
      document.body.appendChild(loose);

      const range = document.createRange();

      range.setStart(textNodeOf(fixture.hosts[0]), 1);
      range.setEnd(textNodeOf(loose), 3);
      selectRange(range);

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(false);
    });

    it('is false when the spanning selection lies outside the tested subtree', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1));

      const unrelated = document.createElement('div');

      unrelated.setAttribute('data-extra-fixture', 'true');
      document.body.appendChild(unrelated);

      expect(hasCrossHostSelectionWithin(unrelated)).toBe(false);
    });

    it('is false when only one of the two hosts is inside the subtree', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[1], 1));

      const firstWrapper = fixture.hosts[0].parentElement;

      if (firstWrapper === null) {
        throw new Error('No wrapper');
      }

      expect(firstWrapper.contains(fixture.hosts[0])).toBe(true);
      expect(hasCrossHostSelectionWithin(firstWrapper)).toBe(false);
    });

    it('is false when the subtree document has no window to read a selection from', () => {
      const detachedDoc = document.implementation.createHTMLDocument('detached');
      const root = detachedDoc.createElement('div');

      detachedDoc.body.appendChild(root);

      expect(detachedDoc.defaultView).toBeNull();
      expect(hasCrossHostSelectionWithin(root)).toBe(false);
    });

    it('is true for a selection spanning two hosts of the subtree', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 2));

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(true);
    });
  });

  describe('applySpanningSelection', () => {
    it('returns null when the anchor node belongs to no document', () => {
      expect(applySpanningSelection(
        { node: document,
          offset: 0 },
        { node: textNodeOf(fixture.hosts[0]),
          offset: 1 }
      )).toBeNull();
    });

    it('returns null when the anchor offset cannot form a boundary point', () => {
      expect(applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 999 },
        { node: textNodeOf(fixture.hosts[1]),
          offset: 1 }
      )).toBeNull();
    });

    it('leaves the existing selection untouched when the anchor is unusable', () => {
      selectRange(rangeAcross(fixture.hosts[0], 1, fixture.hosts[0], 4));

      applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 999 },
        { node: textNodeOf(fixture.hosts[1]),
          offset: 1 }
      );

      expect(window.getSelection()?.toString()).toBe('irs');
    });

    it('spans anchor to focus when the gesture runs forwards', () => {
      const range = applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 6 },
        { node: textNodeOf(fixture.hosts[2]),
          offset: 5 }
      );

      expect(range?.startContainer).toBe(textNodeOf(fixture.hosts[0]));
      expect(range?.startOffset).toBe(6);
      expect(range?.endContainer).toBe(textNodeOf(fixture.hosts[2]));
      expect(range?.endOffset).toBe(5);
    });

    it('flips the endpoints when the gesture runs backwards', () => {
      const range = applySpanningSelection(
        { node: textNodeOf(fixture.hosts[2]),
          offset: 5 },
        { node: textNodeOf(fixture.hosts[0]),
          offset: 6 }
      );

      expect(range?.startContainer).toBe(textNodeOf(fixture.hosts[0]));
      expect(range?.startOffset).toBe(6);
      expect(range?.endContainer).toBe(textNodeOf(fixture.hosts[2]));
      expect(range?.endOffset).toBe(5);
    });

    it('treats a focus at the very same point as forwards, giving a collapsed range', () => {
      const range = applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 4 },
        { node: textNodeOf(fixture.hosts[0]),
          offset: 4 }
      );

      expect(range?.collapsed).toBe(true);
      expect(range?.startContainer).toBe(textNodeOf(fixture.hosts[0]));
      expect(range?.startOffset).toBe(4);
    });

    it('treats a focus one character earlier in the same node as backwards', () => {
      const range = applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 4 },
        { node: textNodeOf(fixture.hosts[0]),
          offset: 3 }
      );

      expect(range?.startOffset).toBe(3);
      expect(range?.endOffset).toBe(4);
    });

    it('replaces whatever the document already had selected', () => {
      selectRange(rangeAcross(fixture.hosts[2], 0, fixture.hosts[2], 5));

      const applied = applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 6 },
        { node: textNodeOf(fixture.hosts[1]),
          offset: 6 }
      );

      const selection = window.getSelection();

      expect(selection?.rangeCount).toBe(1);
      expect(selection?.getRangeAt(0).startContainer).toBe(applied?.startContainer);
      expect(selection?.getRangeAt(0).startOffset).toBe(6);
      expect(selection?.getRangeAt(0).endContainer).toBe(textNodeOf(fixture.hosts[1]));
      expect(selection?.getRangeAt(0).endOffset).toBe(6);
    });

    it('returns null without hit-testing the focus when the anchor point is unusable', () => {
      const foreignDoc = document.implementation.createHTMLDocument('foreign');
      const foreignText = foreignDoc.createTextNode('elsewhere');

      foreignDoc.body.appendChild(foreignText);

      expect(applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 999 },
        { node: foreignText,
          offset: 1 }
      )).toBeNull();
    });

    it('returns null when the document has no selection object', () => {
      const view = fixture.root.ownerDocument.defaultView;

      if (view === null) {
        throw new Error('No default view');
      }

      vi.spyOn(view, 'getSelection').mockReturnValue(null);

      expect(applySpanningSelection(
        { node: textNodeOf(fixture.hosts[0]),
          offset: 1 },
        { node: textNodeOf(fixture.hosts[1]),
          offset: 1 }
      )).toBeNull();
    });
  });

  describe('caretPointFromCoords', () => {
    type CaretDoc = Document & {
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    const asCaretDoc = (doc: Document): CaretDoc => doc;

    // lib.dom declares both hit-test methods as required, so the intersection
    // above cannot be deleted from. This view drops Document to make the
    // afterEach teardown expressible without a non-null assertion.
    type CaretDocOverrides = {
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    afterEach(() => {
      const doc = document as unknown as CaretDocOverrides;

      delete doc.caretPositionFromPoint;
      delete doc.caretRangeFromPoint;
    });

    it('returns null when the document hit-tests with neither API', () => {
      expect(caretPointFromCoords(10, 20, document)).toBeNull();
    });

    it('reads the offset node and offset from the standard API', () => {
      const text = textNodeOf(fixture.hosts[1]);

      asCaretDoc(document).caretPositionFromPoint = (): CaretPosition => ({
        offsetNode: text,
        offset: 7,
      } as unknown as CaretPosition);

      expect(caretPointFromCoords(10, 20, document)).toStrictEqual({ node: text,
        offset: 7 });
    });

    it('passes the viewport coordinates straight through to the hit test', () => {
      const seen: number[][] = [];

      asCaretDoc(document).caretPositionFromPoint = (x: number, y: number): CaretPosition => {
        seen.push([ x, y ]);

        return { offsetNode: textNodeOf(fixture.hosts[0]),
          offset: 0 } as unknown as CaretPosition;
      };

      caretPointFromCoords(31, 47, document);

      expect(seen).toStrictEqual([ [ 31, 47 ] ]);
    });

    it('falls back to the legacy API when the standard one hit-tests nothing', () => {
      const range = rangeAcross(fixture.hosts[2], 4, fixture.hosts[2], 9);

      asCaretDoc(document).caretPositionFromPoint = (): null => null;
      asCaretDoc(document).caretRangeFromPoint = (): Range => range;

      expect(caretPointFromCoords(10, 20, document)).toStrictEqual({
        node: textNodeOf(fixture.hosts[2]),
        offset: 4,
      });
    });

    it('falls back when the standard API returns a position with no node', () => {
      const range = rangeAcross(fixture.hosts[2], 2, fixture.hosts[2], 9);

      asCaretDoc(document).caretPositionFromPoint = (): CaretPosition => ({
        offsetNode: null,
        offset: 3,
      } as unknown as CaretPosition);
      asCaretDoc(document).caretRangeFromPoint = (): Range => range;

      expect(caretPointFromCoords(10, 20, document)).toStrictEqual({
        node: textNodeOf(fixture.hosts[2]),
        offset: 2,
      });
    });

    it('returns null when the legacy API also hit-tests nothing', () => {
      asCaretDoc(document).caretRangeFromPoint = (): null => null;

      expect(caretPointFromCoords(10, 20, document)).toBeNull();
    });

    it('uses the legacy range start, never its end', () => {
      const range = rangeAcross(fixture.hosts[1], 3, fixture.hosts[1], 11);

      asCaretDoc(document).caretRangeFromPoint = (): Range => range;

      expect(caretPointFromCoords(10, 20, document)?.offset).toBe(3);
    });

    it('prefers the standard API when both are available', () => {
      const text = textNodeOf(fixture.hosts[0]);
      let legacyCalls = 0;

      asCaretDoc(document).caretPositionFromPoint = (): CaretPosition => ({
        offsetNode: text,
        offset: 2,
      } as unknown as CaretPosition);
      asCaretDoc(document).caretRangeFromPoint = (): Range => {
        legacyCalls += 1;

        return rangeAcross(fixture.hosts[2], 1, fixture.hosts[2], 2);
      };

      expect(caretPointFromCoords(10, 20, document)).toStrictEqual({ node: text,
        offset: 2 });
      expect(legacyCalls).toBe(0);
    });

    it('ignores a non-callable hit-test property', () => {
      const doc = asCaretDoc(document) as unknown as Record<string, unknown>;

      doc.caretPositionFromPoint = 'not a function';

      expect(caretPointFromCoords(10, 20, document)).toBeNull();
    });
  });

  describe('pointAtInputBoundary', () => {
    it('collapses to the host start when the end is not wanted', () => {
      expect(pointAtInputBoundary(fixture.hosts[1], false)).toStrictEqual({
        node: fixture.hosts[1],
        offset: 0,
      });
    });

    it('collapses to the host end when the end is wanted', () => {
      expect(pointAtInputBoundary(fixture.hosts[1], true)).toStrictEqual({
        node: fixture.hosts[1],
        offset: 1,
      });
    });

    it('reports the container itself, not its text node', () => {
      const point = pointAtInputBoundary(fixture.hosts[0], true);

      expect(point.node).toBe(fixture.hosts[0]);
      expect(point.node).not.toBe(textNodeOf(fixture.hosts[0]));
    });

    it('reports offset 0 at both ends of an empty host', () => {
      const empty = document.createElement('div');

      empty.setAttribute('contenteditable', 'true');
      empty.setAttribute('data-extra-fixture', 'true');
      document.body.appendChild(empty);

      expect(pointAtInputBoundary(empty, true)).toStrictEqual({ node: empty,
        offset: 0 });
      expect(pointAtInputBoundary(empty, false)).toStrictEqual({ node: empty,
        offset: 0 });
    });

    it('counts every child when the host holds several', () => {
      const host = document.createElement('div');

      host.setAttribute('data-extra-fixture', 'true');
      host.append(document.createTextNode('a'), document.createElement('br'), document.createTextNode('b'));
      document.body.appendChild(host);

      expect(pointAtInputBoundary(host, true).offset).toBe(3);
    });
  });

  describe('focusEdgeForPointer', () => {
    it('snaps to the first host start strictly above its top edge', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 99, true)).toStrictEqual({ input: first,
        atEnd: false });
    });

    it('uses the drag direction when the pointer is exactly on the first top edge', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 100, true)).toStrictEqual({ input: last,
        atEnd: true });
    });

    it('snaps to the last host end strictly below its bottom edge', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 171, false)).toStrictEqual({ input: last,
        atEnd: true });
    });

    it('uses the drag direction when the pointer is exactly on the last bottom edge', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 170, false)).toStrictEqual({ input: first,
        atEnd: false });
    });

    it('reads the top from the first host and the bottom from the last', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 135, true)).toStrictEqual({ input: last,
        atEnd: true });
      expect(focusEdgeForPointer(first, last, 135, false)).toStrictEqual({ input: first,
        atEnd: false });
    });

    it('prefers the nearer geometric edge over the drag direction', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 99, false).atEnd).toBe(false);
      expect(focusEdgeForPointer(first, last, 171, true).atEnd).toBe(true);
    });

    it('handles a single-host block where first and last are the same element', () => {
      const only = inputSpanning(50, 80);

      expect(focusEdgeForPointer(only, only, 40, false)).toStrictEqual({ input: only,
        atEnd: false });
      expect(focusEdgeForPointer(only, only, 90, false)).toStrictEqual({ input: only,
        atEnd: true });
    });
  });

  describe('blocksBetween', () => {
    const container = createBlockStub('table', null);
    const lineOne = createBlockStub('line-1', 'table');
    const lineTwo = createBlockStub('line-2', 'table');
    const lineThree = createBlockStub('line-3', 'table');
    const lineFour = createBlockStub('line-4', 'table');
    const after = createBlockStub('after', null);
    const blocks = [ container, lineOne, lineTwo, lineThree, lineFour, after ];

    it('excludes both endpoints and returns everything in between', () => {
      expect(blocksBetween(blocks, lineOne, lineFour)).toStrictEqual([ lineTwo, lineThree ]);
    });

    it('returns the same list whichever endpoint comes first', () => {
      expect(blocksBetween(blocks, lineFour, lineOne)).toStrictEqual([ lineTwo, lineThree ]);
    });

    it('is empty for one block against itself', () => {
      expect(blocksBetween(blocks, lineTwo, lineTwo)).toStrictEqual([]);
    });

    it('is empty when an endpoint is absent from the list', () => {
      const stranger = createBlockStub('stranger', 'table');

      expect(blocksBetween(blocks, stranger, lineTwo)).toStrictEqual([]);
      expect(blocksBetween(blocks, lineTwo, stranger)).toStrictEqual([]);
    });

    it('is empty when the endpoints sit under different parents', () => {
      expect(blocksBetween(blocks, lineOne, after)).toStrictEqual([]);
    });

    it('works for root-level siblings too, ignoring nested blocks between them', () => {
      expect(blocksBetween(blocks, container, after)).toStrictEqual([]);
    });

    it('counts positions among siblings, not positions in the flat list', () => {
      const rootA = createBlockStub('root-a', null);
      const child = createBlockStub('child', 'root-a');
      const rootB = createBlockStub('root-b', null);
      const rootC = createBlockStub('root-c', null);
      const flat = [ rootA, child, rootB, rootC ];

      expect(blocksBetween(flat, rootA, rootC)).toStrictEqual([ rootB ]);
    });
  });
});
