import { DATA_ATTR } from '../constants/data-attributes';

/**
 * UI attributes the open toolbox writes on the block's editable text (see
 * Toolbox.applyComboboxRoles). They never reach saved data, so they are not a
 * block change. Keep in sync with what the toolbox writes.
 */
const TOOLBOX_COMBOBOX_ATTRIBUTES = new Set([
  DATA_ATTR.slashSearch,
  'role',
  'aria-expanded',
  'aria-autocomplete',
  'aria-haspopup',
  'aria-label',
  'aria-controls',
  'aria-activedescendant',
]);

const isToolboxComboboxWrite = ({ type, attributeName, target }: MutationRecord): boolean => {
  return type === 'attributes'
    && attributeName !== null
    && TOOLBOX_COMBOBOX_ATTRIBUTES.has(attributeName)
    && target instanceof Element
    && target.closest('[contenteditable="true"]') !== null;
};

/**
 * Own technical mutations: data-blok-empty, data-blok-toggle-open, the Show
 * spotlight (utils/reveal-block.ts) and the toolbox's combobox attributes.
 */
const isTechnicalMutation = (mutationRecord: MutationRecord): boolean => {
  if (mutationRecord.type === 'attributes' && (
    mutationRecord.attributeName === 'data-blok-empty'
    || mutationRecord.attributeName === 'data-blok-toggle-open'
    || mutationRecord.attributeName === DATA_ATTR.spotlight
  )) {
    return true;
  }

  return isToolboxComboboxWrite(mutationRecord);
};

/**
 * Check if passed mutation belongs to a passed element
 * @param mutationRecord - mutation to check
 * @param element - element that is expected to contain mutation
 */
export const isMutationBelongsToElement = (mutationRecord: MutationRecord, element: Element): boolean => {
  const { type, target, addedNodes, removedNodes } = mutationRecord;

  if (isTechnicalMutation(mutationRecord)) {
    return false;
  }

  /**
   * Covers all types of mutations happened to the element or it's descendants with the only one exception - removing/adding the element itself;
   */
  if (element.contains(target)) {
    return true;
  }

  /**
   * In case of removing/adding the element itself, mutation type will be 'childList' and 'removedNodes'/'addedNodes' will contain the element.
   */
  if (type !== 'childList') {
    return false;
  }

  const elementAddedItself = Array.from(addedNodes).some(node => node === element);

  if (elementAddedItself) {
    return true;
  }

  const elementRemovedItself = Array.from(removedNodes).some(node => node === element);

  return elementRemovedItself;
};

/**
 * The records of one batch for every element they belong to, by the same rule
 * as {@link isMutationBelongsToElement}: the target and all its ancestors, plus
 * a node a childList record added or removed. One pass over the batch instead
 * of one per block.
 * @param mutations - one MutationObserver batch
 */
export const groupMutationsByElement = (mutations: MutationRecord[]): Map<Node, MutationRecord[]> => {
  const byElement = new Map<Node, MutationRecord[]>();
  const add = (node: Node, mutationRecord: MutationRecord): void => {
    const list = byElement.get(node);

    if (list === undefined) {
      byElement.set(node, [mutationRecord]);
    } else if (list[list.length - 1] !== mutationRecord) {
      list.push(mutationRecord);
    }
  };
  const addWithAncestors = (node: Node | null, mutationRecord: MutationRecord): void => {
    if (node === null) {
      return;
    }

    add(node, mutationRecord);
    addWithAncestors(node.parentNode, mutationRecord);
  };

  for (const mutationRecord of mutations) {
    if (isTechnicalMutation(mutationRecord)) {
      continue;
    }

    const { type, target, addedNodes, removedNodes } = mutationRecord;

    addWithAncestors(target, mutationRecord);

    if (type === 'childList') {
      Array.from(addedNodes).forEach(node => add(node, mutationRecord));
      Array.from(removedNodes).forEach(node => add(node, mutationRecord));
    }
  }

  return byElement;
};
