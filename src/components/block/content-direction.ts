import { firstStrongDirection } from '../../shared/text-direction';
import { DATA_ATTR } from '../constants/data-attributes';

/**
 * Text fields, editable or not: read-only tools keep `contenteditable="false"`
 * on the same element, so the stamp survives read-only.
 */
const FIELD_SELECTOR = '[contenteditable]';

/**
 * First strong letter in one field. Skips nested blocks, `dir` islands (a
 * pinned or isolated run) and non-editable widgets inside the field.
 * @param field - text field to walk
 * @param holder - the block's own holder
 */
const fieldDirection = (field: HTMLElement, holder: HTMLElement): 'ltr' | 'rtl' | null => {
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return NodeFilter.FILTER_ACCEPT;
      }

      const element = node as Element;
      const skip = (element !== holder && element.hasAttribute(DATA_ATTR.element))
        || element.hasAttribute('dir')
        || element.getAttribute('contenteditable') === 'false';

      return skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });

  // eslint-disable-next-line no-restricted-syntax -- TreeWalker requires iteration with nextNode()
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const direction = firstStrongDirection((node as Text).data);

    if (direction !== null) {
      return direction;
    }
  }

  return null;
};

/**
 * Direction of the block's own text: its fields in document order, minus the
 * fields of nested blocks and fields the tool pinned with its own `dir`.
 * @param toolRoot - element the tool rendered
 * @param holder - the block's holder
 */
const ownTextDirection = (toolRoot: HTMLElement, holder: HTMLElement): 'ltr' | 'rtl' | null => {
  const nested = Array.from(toolRoot.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  const fields = toolRoot.matches(FIELD_SELECTOR) ? [toolRoot, ...nested] : nested;

  for (const field of fields) {
    const pinned = field.closest('[dir]');

    if (field.closest(`[${DATA_ATTR.element}]`) !== holder || (pinned !== null && toolRoot.contains(pinned))) {
      continue;
    }

    const direction = fieldDirection(field, holder);

    if (direction !== null) {
      return direction;
    }
  }

  return null;
};

/**
 * Stamps `dir` on the block's content element from its own text, or removes
 * it when the text has no strong letter so the block follows the editor.
 *
 * The content element is an ancestor of the tool root and sits inside any
 * parent's mutation-free child slot, so this write is never an edit (see the
 * child-holder decoration law). Writes only on change: a same-value
 * setAttribute still queues a mutation record and a style recalc.
 * @param contentElement - the block's `[data-blok-element-content]`
 * @param toolRoot - element the tool rendered
 * @param holder - the block's holder
 */
export const syncContentDirection = (
  contentElement: HTMLElement,
  toolRoot: HTMLElement,
  holder: HTMLElement
): void => {
  const direction = ownTextDirection(toolRoot, holder);

  if (direction === null) {
    if (contentElement.hasAttribute('dir')) {
      contentElement.removeAttribute('dir');
    }

    return;
  }

  if (contentElement.getAttribute('dir') !== direction) {
    contentElement.setAttribute('dir', direction);
  }
};
