/**
 * List block-operation mutants the existing suite did not notice.
 *
 * One survives on purpose: the `if (result.contentElement)` guard in
 * `rerenderListItem`. `buildListItem` returns
 * `contentElement: contentElement ?? itemContent` (src/tools/list/dom-builder.ts),
 * and `itemContent` is whatever `buildChecklistContent` or
 * `buildStandardContent` returned - both are declared `=> HTMLElement` and both
 * start from `document.createElement`, so the field is never null and never
 * falsy. Forcing the guard true changes nothing.
 */
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeListItemData,
  rerenderListItem,
  saveListItem,
  setListItemData,
  type RerenderContext,
} from '../../../../src/tools/list/block-operations';
import type { ListItemData, ListItemStyle } from '../../../../src/tools/list/types';

/**
 * A list item wrapper shaped the way the tool renders one.
 * @param innerHTML - the content element markup
 * @param style - the list style, which decides the content test id
 */
const makeElement = (innerHTML: string, style: ListItemStyle = 'unordered'): HTMLElement => {
  const wrapper = document.createElement('div');
  const content = document.createElement('div');

  content.setAttribute(
    'data-blok-testid',
    style === 'checklist' ? 'list-checklist-content' : 'list-content-container'
  );
  content.innerHTML = innerHTML;
  wrapper.appendChild(content);

  return wrapper;
};

/**
 * The content element of a wrapper built by `makeElement`.
 * @param wrapper - the list item wrapper
 */
const contentOf = (wrapper: HTMLElement): HTMLElement => {
  const content = wrapper.firstElementChild;

  if (!(content instanceof HTMLElement)) {
    throw new Error('wrapper has no content element');
  }

  return content;
};

/**
 * A rerender context wired to a mounted element, plus its spies.
 * @param data - the item data to render
 */
const makeRerenderContext = (data: ListItemData): {
  context: RerenderContext;
  setupItemPlaceholder: Mock<(element: HTMLElement) => void>;
  onCheckboxChange: Mock<(checked: boolean, content: HTMLElement | null) => void>;
} => {
  const element = makeElement('Old', data.style);
  const parent = document.createElement('div');

  parent.appendChild(element);

  const setupItemPlaceholder: Mock<(element: HTMLElement) => void> = vi.fn();
  const onCheckboxChange: Mock<(checked: boolean, content: HTMLElement | null) => void> = vi.fn();

  return {
    context: {
      data,
      readOnly: false,
      placeholder: 'List item',
      itemColor: undefined,
      itemSize: undefined,
      element,
      setupItemPlaceholder,
      onCheckboxChange,
      keydownHandler: undefined,
    },
    setupItemPlaceholder,
    onCheckboxChange,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveListItem', () => {
  it('reads nothing at all when there is no element', () => {
    const data: ListItemData = {
      text: 'stored',
      style: 'unordered',
    };
    const getContentElement: Mock<() => HTMLElement | null> = vi.fn(() => contentOf(makeElement('live')));

    const result = saveListItem(data, null, getContentElement);

    // Not merely equal: an item with no element is not serialized at all, so
    // the stored object comes back untouched and the DOM is never consulted.
    expect(result).toBe(data);
    expect(getContentElement).not.toHaveBeenCalled();
  });

  it('omits checked entirely for a style that has no checkbox', () => {
    const element = makeElement('text');
    const data: ListItemData = {
      text: '',
      style: 'unordered',
      checked: true,
    };

    const result = saveListItem(data, element, () => contentOf(element));

    // The key must be absent, not present and false - a bullet item carrying a
    // checked flag round-trips as a checklist-shaped payload.
    expect(Object.hasOwn(result, 'checked')).toBe(false);
  });

  it('omits start entirely when the item never had one', () => {
    const element = makeElement('text');
    const data: ListItemData = {
      text: '',
      style: 'ordered',
    };

    const result = saveListItem(data, element, () => contentOf(element));

    expect(Object.hasOwn(result, 'start')).toBe(false);
  });
});

describe('setListItemData', () => {
  it('leaves the content alone when the payload carries no text', () => {
    const element = makeElement('Original');
    const content = contentOf(element);
    const currentData: ListItemData = {
      text: 'Original',
      style: 'unordered',
    };
    // Undo can replay a payload with no `text` key at all, which is why the
    // runtime checks the type rather than trusting the declared shape.
    const newData = { style: 'unordered' } as ListItemData;

    setListItemData(currentData, newData, element, () => content, {
      adjustDepthTo: vi.fn(),
      updateMarkerForDepth: vi.fn(),
      updateCheckboxState: vi.fn(),
    });

    expect(content.innerHTML).toBe('Original');
  });

  it('unchecks a checklist item whose payload dropped the checked flag', () => {
    const element = makeElement('Task', 'checklist');
    const currentData: ListItemData = {
      text: 'Task',
      style: 'checklist',
      checked: true,
    };
    const newData: ListItemData = {
      text: 'Task',
      style: 'checklist',
    };
    const updateCheckboxState: Mock<(checked: boolean) => void> = vi.fn();

    setListItemData(currentData, newData, element, () => contentOf(element), {
      adjustDepthTo: vi.fn(),
      updateMarkerForDepth: vi.fn(),
      updateCheckboxState,
    });

    // A missing flag means unchecked. Defaulting the other way ticks a box the
    // undo step never ticked.
    expect(updateCheckboxState).toHaveBeenCalledWith(false);
  });
});

describe('mergeListItemData', () => {
  it('joins the merged text into a single text node', () => {
    const element = makeElement('Original');
    const content = contentOf(element);
    const contextData: ListItemData = {
      text: 'Original',
      style: 'unordered',
    };
    const parseHTML = (html: string): DocumentFragment => {
      const fragment = document.createDocumentFragment();

      fragment.appendChild(document.createTextNode(html));

      return fragment;
    };

    mergeListItemData(
      {
        data: contextData,
        element,
        getContentElement: () => content,
        parseHTML,
      },
      { text: ' Added', style: 'unordered' }
    );

    // Two adjacent text nodes split the caret coordinate space of a merged
    // item, so the merge has to leave exactly one.
    expect(content.childNodes.length).toBe(1);
  });
});

describe('rerenderListItem', () => {
  it('paints the checked state onto the content when the checkbox changes', () => {
    const { context } = makeRerenderContext({
      text: 'Task',
      style: 'checklist',
      checked: false,
    });

    const wrapper = rerenderListItem(context);

    if (wrapper === null) {
      throw new Error('rerender produced no wrapper');
    }

    const checkbox = wrapper.querySelector('input[type="checkbox"]');
    const content = wrapper.querySelector('[data-blok-testid="list-checklist-content"]');

    if (!(checkbox instanceof HTMLInputElement) || !(content instanceof HTMLElement)) {
      throw new Error('rerender produced no checklist controls');
    }

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // The tick is not the state: the content element carries it, and that is
    // what the checked styling and every reader keys off.
    expect(content.getAttribute('data-checked')).toBe('true');
  });
});
