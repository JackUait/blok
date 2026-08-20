import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Block } from '../../../../src/components/block';
import {
  blocksBetween,
  collectCrossBlockSubRanges,
  focusEdgeForPointer,
  getEditingHost,
  hasCrossHostSelectionWithin,
  resolveCrossBlockTextSelection,
  splitRangeByEditingHost
} from '../../../../src/components/selection/cross-block-range';

type Fixture = {
  root: HTMLElement;
  hosts: HTMLElement[];
};

/**
 * Three sibling editing hosts inside one non-editable root — the shape of a
 * Blok document, where every block renders its own contenteditable.
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

describe('cross-block-range', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = buildHosts([ 'First block text', 'Second block text', 'Third block text' ]);
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    fixture.root.remove();
  });

  describe('getEditingHost', () => {
    it('resolves a text node to its contenteditable ancestor', () => {
      expect(getEditingHost(textNodeOf(fixture.hosts[0]))).toBe(fixture.hosts[0]);
    });

    it('returns null outside any editing host', () => {
      expect(getEditingHost(fixture.root)).toBeNull();
    });

    it('returns null for a missing node', () => {
      expect(getEditingHost(null)).toBeNull();
    });
  });

  describe('splitRangeByEditingHost', () => {
    it('clamps each host to its share of a spanning range', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6));

      expect(slices.map((slice) => slice.range.toString())).toStrictEqual([
        'block text',
        'Second block text',
        'Third ',
      ]);
    });

    it('marks only the fully covered hosts as whole', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6));

      expect(slices.map((slice) => slice.coversWholeInput)).toStrictEqual([ false, true, false ]);
    });

    it('returns the single host for a range inside one block', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[1], 0, fixture.hosts[1], 6));

      expect(slices).toHaveLength(1);
      expect(slices[0].input).toBe(fixture.hosts[1]);
    });

    /**
     * A drag ending at offset 0 of the next block selects the block break but
     * none of that block's characters. The host is kept with a zero-length
     * share: dropping it would make the selection resolve as single-block and
     * the break the delete has to consume would be lost.
     */
    it('keeps a host the range only touches, with a zero-length share', () => {
      const slices = splitRangeByEditingHost(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 0));

      expect(slices.map((slice) => slice.input)).toStrictEqual(fixture.hosts);
      expect(slices[2].range.toString()).toBe('');
    });
  });

  describe('resolveCrossBlockTextSelection', () => {
    const blockOf = (node: Node): Block | undefined => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      const host = element?.closest('[contenteditable="true"]');
      const index = host === null || host === undefined ? -1 : fixture.hosts.indexOf(host as HTMLElement);

      return index === -1 ? undefined : createBlockStub(`block-${index}`, null);
    };

    it('returns null when the selection is collapsed', () => {
      selectRange(rangeAcross(fixture.hosts[0], 3, fixture.hosts[0], 3));

      expect(resolveCrossBlockTextSelection(fixture.root, blockOf)).toBeNull();
    });

    it('returns null when the selection stays inside one block', () => {
      selectRange(rangeAcross(fixture.hosts[0], 0, fixture.hosts[0], 5));

      expect(resolveCrossBlockTextSelection(fixture.root, blockOf)).toBeNull();
    });

    it('reports the per-block slices of a spanning selection', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6));

      const resolved = resolveCrossBlockTextSelection(fixture.root, blockOf);

      expect(resolved?.subRanges.map((sub) => sub.range.toString())).toStrictEqual([
        'block text',
        'Second block text',
        'Third ',
      ]);
      expect(resolved?.startBlock.id).toBe('block-0');
      expect(resolved?.endBlock.id).toBe('block-2');
    });

    it('returns null when the selection lies outside the given root', () => {
      const other = buildHosts([ 'Outside one', 'Outside two' ]);

      selectRange(rangeAcross(other.hosts[0], 1, other.hosts[1], 2));

      expect(resolveCrossBlockTextSelection(fixture.root, blockOf)).toBeNull();

      other.root.remove();
    });
  });

  describe('collectCrossBlockSubRanges', () => {
    it('skips hosts whose block cannot be resolved', () => {
      const onlyFirst = (node: Node): Block | undefined => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;

        return element === fixture.hosts[0] ? createBlockStub('block-0', null) : undefined;
      };

      const subRanges = collectCrossBlockSubRanges(
        rangeAcross(fixture.hosts[0], 6, fixture.hosts[2], 6),
        fixture.root,
        onlyFirst
      );

      expect(subRanges).toHaveLength(1);
      expect(subRanges[0].block.id).toBe('block-0');
    });
  });

  describe('hasCrossHostSelectionWithin', () => {
    it('is true for a selection spanning two hosts of the root', () => {
      selectRange(rangeAcross(fixture.hosts[0], 6, fixture.hosts[1], 2));

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(true);
    });

    it('is false for a selection confined to one host', () => {
      selectRange(rangeAcross(fixture.hosts[0], 0, fixture.hosts[0], 5));

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(false);
    });

    it('is false for a collapsed selection', () => {
      selectRange(rangeAcross(fixture.hosts[0], 2, fixture.hosts[0], 2));

      expect(hasCrossHostSelectionWithin(fixture.root)).toBe(false);
    });
  });

  describe('focusEdgeForPointer', () => {
    /**
     * jsdom lays nothing out, so every box is stated outright.
     * @param top - the box's top edge
     * @param bottom - the box's bottom edge
     */
    const inputSpanning = (top: number, bottom: number): HTMLElement => {
      const input = document.createElement('div');

      input.getBoundingClientRect = (): DOMRect => new DOMRect(0, top, 200, bottom - top);

      return input;
    };

    it('snaps to the start when the pointer is above the block', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 99, true)).toStrictEqual({ input: first,
        atEnd: false });
    });

    it('snaps to the end when the pointer is below the block', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 171, false)).toStrictEqual({ input: last,
        atEnd: true });
    });

    it('ignores the drag direction whenever the pointer is outside the block', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 99, false).atEnd).toBe(false);
      expect(focusEdgeForPointer(first, last, 171, true).atEnd).toBe(true);
    });

    it('falls back to the drag direction beside the block, where no edge is nearer', () => {
      const first = inputSpanning(100, 130);
      const last = inputSpanning(140, 170);

      expect(focusEdgeForPointer(first, last, 150, true)).toStrictEqual({ input: last,
        atEnd: true });
      expect(focusEdgeForPointer(first, last, 150, false)).toStrictEqual({ input: first,
        atEnd: false });
    });
  });

  describe('blocksBetween', () => {
    /**
     * Mirrors a table cell: two lines nested under a container, with the
     * container itself sitting in the same flat list. Walking flat indices, or
     * lifting to a common ancestor, would return the CONTAINER here — and a
     * caller deleting "everything between" would delete the cell's own block.
     */
    const container = createBlockStub('table', null);
    const lineOne = createBlockStub('line-1', 'table');
    const lineTwo = createBlockStub('line-2', 'table');
    const lineThree = createBlockStub('line-3', 'table');
    const after = createBlockStub('after', null);
    const blocks = [ container, lineOne, lineTwo, lineThree, after ];

    it('returns the siblings strictly between two same-parent blocks', () => {
      expect(blocksBetween(blocks, lineOne, lineThree)).toStrictEqual([ lineTwo ]);
    });

    it('never returns the container the endpoints are nested in', () => {
      expect(blocksBetween(blocks, lineOne, lineThree)).not.toContain(container);
    });

    it('is empty for adjacent siblings', () => {
      expect(blocksBetween(blocks, lineOne, lineTwo)).toStrictEqual([]);
    });

    it('is direction-agnostic', () => {
      expect(blocksBetween(blocks, lineThree, lineOne)).toStrictEqual([ lineTwo ]);
    });

    it('is empty when the endpoints have different parents', () => {
      expect(blocksBetween(blocks, lineOne, after)).toStrictEqual([]);
    });
  });
});
