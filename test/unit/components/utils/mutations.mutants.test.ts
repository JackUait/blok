/**
 * Mutation-hardening tests for `src/components/utils/mutations.ts`.
 *
 * Three of the live mutants (the `type === 'attributes'` guard and the
 * `type !== 'childList'` early return) can only be observed with a record whose
 * `type` disagrees with its payload — a real MutationObserver never emits one,
 * because it only fills `attributeName` for `attributes` records and
 * `addedNodes`/`removedNodes` for `childList` records. These tests therefore
 * pin the exported function boundary rather than a DOM scenario: the record is
 * built by hand, with real NodeLists.
 *
 * No equivalent survivors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { isMutationBelongsToElement } from '../../../../src/components/utils/mutations';

/**
 * Builds a real NodeList. The nodes are moved into a throwaway host, which is
 * harmless here because no fixture asks about their parent.
 * @param nodes - nodes the list should contain
 * @returns a live NodeList holding those nodes
 */
const nodeListOf = (nodes: Node[]): NodeList => {
  const host = document.createElement('div');

  nodes.forEach((node) => host.appendChild(node));

  return host.childNodes;
};

/**
 * @param overrides - fields to set on top of an empty childList record
 * @returns a MutationRecord shaped like the DOM emits
 */
const createRecord = (overrides: Partial<MutationRecord> = {}): MutationRecord => {
  return {
    addedNodes: nodeListOf([]),
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: null,
    previousSibling: null,
    removedNodes: nodeListOf([]),
    target: document.createElement('div'),
    type: 'childList',
    ...overrides,
  };
};

describe('isMutationBelongsToElement — mutation hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips a technical attribute name only on an attributes record', () => {
    const element = document.createElement('div');
    const record = createRecord({
      type: 'childList',
      attributeName: 'data-blok-empty',
      addedNodes: nodeListOf([element]),
    });

    expect(isMutationBelongsToElement(record, element)).toBe(true);
  });

  it('checks the added and removed nodes only on a childList record', () => {
    const element = document.createElement('div');
    const addedOnAttributes = createRecord({
      type: 'attributes',
      attributeName: 'class',
      addedNodes: nodeListOf([element]),
    });
    const removedOnCharacterData = createRecord({
      type: 'characterData',
      removedNodes: nodeListOf([element]),
    });

    expect(isMutationBelongsToElement(addedOnAttributes, element)).toBe(false);
    expect(isMutationBelongsToElement(removedOnCharacterData, element)).toBe(false);
  });

  it('matches when the element is one of several added nodes', () => {
    const element = document.createElement('div');
    const sibling = document.createElement('span');
    const record = createRecord({
      type: 'childList',
      addedNodes: nodeListOf([element, sibling]),
    });

    expect(isMutationBelongsToElement(record, element)).toBe(true);
  });

  it('does not match when other nodes are removed', () => {
    const element = document.createElement('div');
    const unrelated = document.createElement('span');
    const record = createRecord({
      type: 'childList',
      removedNodes: nodeListOf([unrelated]),
    });

    expect(isMutationBelongsToElement(record, element)).toBe(false);
  });

  it('ignores a container writing attributes on the holder above the element', () => {
    // Child-holder decoration law: a container may write on a child holder, and
    // the child must not see it. The holder is the element ANCESTOR, so
    // `element.contains(target)` is false and the record is not a childList one.
    const holder = document.createElement('div');
    const element = document.createElement('div');

    holder.appendChild(element);

    const indentWrite = createRecord({
      type: 'attributes',
      attributeName: 'style',
      target: holder,
    });
    const depthWrite = createRecord({
      type: 'attributes',
      attributeName: 'data-blok-depth',
      target: holder,
    });

    expect(isMutationBelongsToElement(indentWrite, element)).toBe(false);
    expect(isMutationBelongsToElement(depthWrite, element)).toBe(false);
  });
});
