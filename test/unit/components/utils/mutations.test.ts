import { describe, expect, it } from 'vitest';

import { isMutationBelongsToElement } from '../../../../src/components/utils/mutations';

const toNodeList = (nodes: Node[]): NodeList => nodes as unknown as NodeList;

const createMutation = (overrides: Partial<MutationRecord> = {}): MutationRecord => {
  const defaultTarget = document.createElement('div');

  return {
    addedNodes: toNodeList([]),
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    oldValue: null,
    previousSibling: null,
    removedNodes: toNodeList([]),
    target: defaultTarget,
    type: 'childList',
    ...overrides,
  };
};

describe('isMutationBelongsToElement', () => {
  it('ignores internal data-blok-empty attribute updates', () => {
    const element = document.createElement('div');
    const mutation = createMutation({
      type: 'attributes',
      attributeName: 'data-blok-empty',
      target: element,
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(false);
  });

  it('returns true when mutation affects the element or its descendants', () => {
    const element = document.createElement('div');
    const child = document.createElement('span');

    element.appendChild(child);

    const mutation = createMutation({
      type: 'attributes',
      attributeName: 'class',
      target: child,
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(true);
  });

  it('returns false for mutations outside of the element tree when not a childList change', () => {
    const element = document.createElement('div');
    const otherElement = document.createElement('div');
    const mutation = createMutation({
      type: 'attributes',
      attributeName: 'data-blok-test',
      target: otherElement,
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(false);
  });

  it('returns true when the element itself is added', () => {
    const element = document.createElement('div');
    const parent = document.createElement('div');

    const mutation = createMutation({
      type: 'childList',
      target: parent,
      addedNodes: toNodeList([ element ]),
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(true);
  });

  it('returns true when the element itself is removed', () => {
    const element = document.createElement('div');
    const parent = document.createElement('div');

    const mutation = createMutation({
      type: 'childList',
      target: parent,
      removedNodes: toNodeList([ element ]),
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(true);
  });

  it('returns false when childList mutation does not reference the element', () => {
    const element = document.createElement('div');
    const parent = document.createElement('div');
    const unrelatedChild = document.createElement('span');

    const mutation = createMutation({
      type: 'childList',
      target: parent,
      addedNodes: toNodeList([ unrelatedChild ]),
      removedNodes: toNodeList([]),
    });

    expect(isMutationBelongsToElement(mutation, element)).toBe(false);
  });
});
