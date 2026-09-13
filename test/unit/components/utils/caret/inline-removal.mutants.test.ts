/**
 * Tests for src/components/utils/caret/inline-removal.ts.
 *
 * jsdom does not implement `isContentEditable` (it reads back as null), so the
 * property is defined explicitly on every host whose editability matters.
 * MutationObserver records are delivered asynchronously, so observer tests wait
 * for a macrotask before asserting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureInlineRemovalObserver,
  findNbspAfterEmptyInline,
  isElementVisuallyEmpty,
  whitespaceFollowingRemovedEmptyInline,
} from '../../../../../src/components/utils/caret/inline-removal';

const NBSP = ' ';

/**
 * Waits until queued MutationObserver records have been delivered.
 */
const flushMutations = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

/**
 * Marks an element as contenteditable for both jsdom and the module.
 * @param element - element to mark
 * @param editable - value `isContentEditable` should report
 */
const setEditable = (element: HTMLElement, editable: boolean): void => {
  if (editable) {
    element.setAttribute('contenteditable', 'true');
  }
  Object.defineProperty(element, 'isContentEditable', {
    value: editable,
    configurable: true,
  });
};

/**
 * Mounts a contenteditable host in the document body.
 * @param html - inner HTML for the host
 */
const mountHost = (html = ''): HTMLElement => {
  const host = document.createElement('div');

  setEditable(host, true);
  host.innerHTML = html;
  document.body.appendChild(host);

  return host;
};

/**
 * Returns the child node at an index, failing loudly when it is missing.
 * @param parent - node to read from
 * @param index - child index
 */
const childAt = (parent: Node, index: number): Node => {
  const node = parent.childNodes[index];

  if (node === undefined) {
    throw new Error(`No child at index ${index}`);
  }

  return node;
};

/**
 * Returns the child text node at an index, failing loudly otherwise.
 * @param parent - node to read from
 * @param index - child index
 */
const textAt = (parent: Node, index: number): Text => {
  const node = childAt(parent, index);

  if (!(node instanceof Text)) {
    throw new Error(`Child at ${index} is not a text node`);
  }

  return node;
};

/**
 * Returns the document selection, failing loudly when there is none.
 */
const requireSelection = (): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('Environment has no selection');
  }

  return selection;
};

/**
 * Collapses the document selection at (node, offset).
 * @param node - container to place the caret in
 * @param offset - offset inside the container
 */
const placeCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = requireSelection();

  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Replaces window.getSelection with a stub reporting the given focus point.
 * @param focusNode - node the selection focuses
 * @param focusOffset - offset the selection reports
 */
const stubSelection = (focusNode: Node | null, focusOffset: number): void => {
  const fake = {
    focusNode,
    focusOffset,
  };

  vi.spyOn(window, 'getSelection').mockReturnValue(fake as unknown as Selection);
};

/**
 * Builds an HTML document with the given readyState, none of which the module
 * has observed yet.
 * @param readyState - value `doc.readyState` should report
 */
const makeDocument = (readyState: DocumentReadyState): Document => {
  const doc = document.implementation.createHTMLDocument('test');

  Object.defineProperty(doc, 'readyState', {
    value: readyState,
    configurable: true,
  });

  return doc;
};

/**
 * Mounts an empty inline followed by a whitespace text node in a document.
 * @param doc - document to build in
 * @param parent - element to append the host to
 */
const mountInlineFixture = (doc: Document, parent: Element): { host: HTMLElement; tail: Text } => {
  const host = doc.createElement('div');

  setEditable(host, true);
  host.innerHTML = `<i></i>${NBSP}tail`;
  parent.appendChild(host);

  return {
    host,
    tail: textAt(host, 1),
  };
};

/**
 * Removes the empty inline from a fixture host.
 * @param host - host built by mountInlineFixture
 */
const removeInline = (host: HTMLElement): void => {
  host.removeChild(childAt(host, 0));
};

/**
 * Replaces a document's body with a fresh empty one.
 * @param doc - document to swap the body of
 */
const swapBody = (doc: Document): void => {
  doc.documentElement.removeChild(doc.body);
  doc.documentElement.appendChild(doc.createElement('body'));
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  requireSelection().removeAllRanges();
});

describe('isElementVisuallyEmpty', () => {
  it('reports a non-HTML element as not empty', () => {
    const foreign = document.createElementNS('urn:example:test', 'foo');

    expect(isElementVisuallyEmpty(foreign)).toBe(false);
  });

  it('reports a self-closing tag as not empty', () => {
    expect(isElementVisuallyEmpty(document.createElement('br'))).toBe(false);
    expect(isElementVisuallyEmpty(document.createElement('img'))).toBe(false);
  });

  it('reports a native input as not empty', () => {
    expect(isElementVisuallyEmpty(document.createElement('textarea'))).toBe(false);
  });

  it('reports an element with no child nodes as empty', () => {
    expect(isElementVisuallyEmpty(document.createElement('span'))).toBe(true);
  });

  it('reports an element holding a non-breaking space as not empty', () => {
    const span = document.createElement('span');

    span.textContent = NBSP;

    expect(isElementVisuallyEmpty(span)).toBe(false);
  });

  it('reports an element holding a non-breaking space among children as not empty', () => {
    const span = document.createElement('span');

    span.innerHTML = `<em>${NBSP}</em>`;

    expect(isElementVisuallyEmpty(span)).toBe(false);
  });

  it('reports an element mixing a non-breaking space with plain spaces as not empty', () => {
    const span = document.createElement('span');

    span.textContent = ` ${NBSP} `;

    expect(isElementVisuallyEmpty(span)).toBe(false);
  });

  it('reports an element holding visible text as not empty', () => {
    const span = document.createElement('span');

    span.textContent = 'x';

    expect(isElementVisuallyEmpty(span)).toBe(false);
  });

  it('reports an element holding only collapsed whitespace as empty', () => {
    const span = document.createElement('span');

    span.textContent = ' \t\n';

    expect(isElementVisuallyEmpty(span)).toBe(true);
  });

  it('reports an element whose children are all empty as empty', () => {
    const span = document.createElement('span');

    span.innerHTML = '<em></em><i> </i>';

    expect(isElementVisuallyEmpty(span)).toBe(true);
  });

  it('reports an element with a non-empty child as not empty', () => {
    const span = document.createElement('span');

    span.innerHTML = '<em><br></em>';

    expect(isElementVisuallyEmpty(span)).toBe(false);
  });
});

describe('inline removal observer', () => {
  it('tracks the text node following a removed empty inline element', async () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const inline = childAt(host, 0);
    const tail = textAt(host, 1);

    host.removeChild(inline);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(true);
  });

  it('tracks a plain space as well as a non-breaking space', async () => {
    const host = mountHost('<i></i> tail');
    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(true);
  });

  it('ignores a following text node that does not start with whitespace', async () => {
    const host = mountHost('<i></i>tail');
    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a removed text node', async () => {
    const host = mountHost(`removed${NBSP}tail`);

    host.innerHTML = '';
    host.appendChild(document.createTextNode(`${NBSP}tail`));
    const tail = textAt(host, 0);

    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a removed element that was not visually empty', async () => {
    const host = mountHost(`<i>text</i>${NBSP}tail`);
    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a removal whose next sibling is an element', async () => {
    const host = mountHost(`<i></i><b>${NBSP}tail</b>`);
    const bold = childAt(host, 1);
    const tail = textAt(bold, 0);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a removal with no next sibling', async () => {
    const host = mountHost(`${NBSP}lead<i></i>`);
    const lead = textAt(host, 0);

    host.removeChild(childAt(host, 1));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(lead)).toBe(false);
  });

  it('ignores a following text node that got detached before delivery', async () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    host.removeChild(tail);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a following text node whose parent is not editable', async () => {
    const host = mountHost(`<i></i>${NBSP}tail`);

    setEditable(host, false);
    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });


  it('does not track a text node that is merely the sibling of a removed non-empty element', async () => {
    const host = mountHost(`<i></i><b>${NBSP}tail</b>`);
    const bold = childAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(bold as unknown as Text)).toBe(false);
  });

  it('ignores a detached text node even when its parent is editable', async () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const tail = textAt(host, 1);
    const detached = document.createElement('div');

    setEditable(detached, true);

    host.removeChild(childAt(host, 0));
    detached.appendChild(tail);
    await flushMutations();

    expect(tail.isConnected).toBe(false);
    expect(tail.parentElement).toBe(detached);
    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('ignores a following text node whose parent does not report editability', async () => {
    const host = document.createElement('div');

    host.innerHTML = `<i></i>${NBSP}tail`;
    document.body.appendChild(host);
    const tail = textAt(host, 1);

    expect(host.isContentEditable).toBeFalsy();

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('never treats a non-element removed node as visually empty', () => {
    const text = document.createTextNode('');

    expect(isElementVisuallyEmpty(text as unknown as Element)).toBe(false);
  });
});

describe('ensureInlineRemovalObserver', () => {
  it('starts observing a document that is still loading once it is parsed', async () => {
    const doc = document.implementation.createHTMLDocument('loading');

    expect(doc.readyState).toBe('loading');

    ensureInlineRemovalObserver(doc);

    const host = doc.createElement('div');

    setEditable(host, true);
    host.innerHTML = `<i></i>${NBSP}tail`;
    doc.body.appendChild(host);

    doc.dispatchEvent(new Event('DOMContentLoaded'));

    const tail = textAt(host, 1);

    host.removeChild(childAt(host, 0));
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(true);
  });


  it('does not observe a loading document before it is parsed', async () => {
    const doc = makeDocument('loading');

    ensureInlineRemovalObserver(doc);

    const { host, tail } = mountInlineFixture(doc, doc.body);

    removeInline(host);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('stops listening after the first DOMContentLoaded', async () => {
    const doc = makeDocument('loading');

    ensureInlineRemovalObserver(doc);
    doc.dispatchEvent(new Event('DOMContentLoaded'));
    swapBody(doc);
    doc.dispatchEvent(new Event('DOMContentLoaded'));

    const { host, tail } = mountInlineFixture(doc, doc.body);

    removeInline(host);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
  });

  it('observes a ready document immediately and only once', async () => {
    const doc = makeDocument('complete');

    ensureInlineRemovalObserver(doc);

    const first = mountInlineFixture(doc, doc.body);

    removeInline(first.host);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(first.tail)).toBe(true);

    swapBody(doc);
    ensureInlineRemovalObserver(doc);

    const second = mountInlineFixture(doc, doc.body);

    removeInline(second.host);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(second.tail)).toBe(false);
  });

  it('does nothing for a document without a body', () => {
    const doc = document.implementation.createDocument(null, 'root', null);

    Object.defineProperty(doc, 'readyState', {
      value: 'complete',
      configurable: true,
    });

    expect(doc.body).toBeNull();
    expect(() => ensureInlineRemovalObserver(doc)).not.toThrow();
  });
});

describe('findNbspAfterEmptyInline', () => {
  it('returns null when there is no caret', () => {
    const host = mountHost(`<i></i>${NBSP}tail`);

    requireSelection().removeAllRanges();

    // With no caret the containment check alone already rejects: contains(null)
    // is false, so the null check and the containment check agree here.
    expect(host.contains(null)).toBe(false);
    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('returns null when the caret sits outside the root', () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const outside = mountHost('outside');

    placeCaret(textAt(outside, 0), 7);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('returns null when the caret is not at the end of its text node', () => {
    const host = mountHost(`ab<i></i>${NBSP}tail`);

    placeCaret(textAt(host, 0), 1);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('finds the whitespace node when the caret sits exactly at the end of its text node', () => {
    const host = mountHost(`ab<i></i>${NBSP}tail`);
    const tail = textAt(host, 2);

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)).toEqual({
      node: tail,
      offset: 0,
    });
    expect(findNbspAfterEmptyInline(host)?.node).toBe(tail);
  });

  it('returns null when no text node follows the caret', () => {
    const host = mountHost('ab');

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('returns null when the next text node does not start with whitespace', () => {
    const host = mountHost('ab<i></i>tail');

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('skips empty text nodes before the whitespace node', () => {
    const host = mountHost('ab<i></i>');

    host.appendChild(document.createTextNode(''));
    host.appendChild(document.createTextNode(`${NBSP}tail`));
    const tail = textAt(host, 3);

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)?.node).toBe(tail);
  });

  it('returns null when nothing empty sits between the caret and an untracked whitespace node', () => {
    const host = mountHost('');

    host.appendChild(document.createTextNode('ab'));
    host.appendChild(document.createTextNode(' tail'));

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('returns a tracked whitespace node with no empty element between, and forgets it afterwards', () => {
    const host = mountHost('');

    host.appendChild(document.createTextNode('ab'));
    const tail = document.createTextNode(' tail');

    host.appendChild(tail);
    whitespaceFollowingRemovedEmptyInline.add(tail);

    placeCaret(textAt(host, 0), 2);

    expect(findNbspAfterEmptyInline(host)?.node).toBe(tail);
    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(false);
    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('keeps searching past a whitespace node when the caret is an element', () => {
    const host = mountHost(`<i></i>${NBSP}tail`);

    placeCaret(host, 0);

    expect(findNbspAfterEmptyInline(host)?.node).toBe(textAt(host, 1));
  });

  it('returns null when the caret point cannot start a range', () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const inline = childAt(host, 0);

    stubSelection(inline, 5);

    expect(findNbspAfterEmptyInline(host)).toBeNull();
  });

  it('observes the root document so later inline removals are tracked', async () => {
    const doc = makeDocument('complete');
    const { host, tail } = mountInlineFixture(doc, doc.body);

    expect(findNbspAfterEmptyInline(host)).toBeNull();

    removeInline(host);
    await flushMutations();

    expect(whitespaceFollowingRemovedEmptyInline.has(tail)).toBe(true);
  });

  it('does not walk out of the root when the caret is elsewhere', () => {
    const root = mountHost('');
    const elsewhere = mountHost(`ab<i></i>${NBSP}tail`);

    placeCaret(textAt(elsewhere, 0), 2);

    expect(findNbspAfterEmptyInline(root)).toBeNull();
    expect(findNbspAfterEmptyInline(elsewhere)?.node).toBe(textAt(elsewhere, 2));
  });

  it('returns null when the caret point cannot start a range even for a tracked node', () => {
    const host = mountHost(`<i></i>${NBSP}tail`);
    const tail = textAt(host, 1);

    whitespaceFollowingRemovedEmptyInline.add(tail);
    stubSelection(childAt(host, 0), 5);

    expect(findNbspAfterEmptyInline(host)).toBeNull();

    whitespaceFollowingRemovedEmptyInline.delete(tail);
  });
});
