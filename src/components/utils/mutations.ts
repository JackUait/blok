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
 * spotlight (utils/reveal-block.ts), the placeholder attributes
 * (utils/placeholder.ts; set on the editable host, which tools save by its
 * innerHTML) and the toolbox's combobox attributes.
 */
const isTechnicalMutation = (mutationRecord: MutationRecord): boolean => {
  if (mutationRecord.type === 'attributes' && (
    mutationRecord.attributeName === 'data-blok-empty'
    || mutationRecord.attributeName === 'data-blok-toggle-open'
    || mutationRecord.attributeName === DATA_ATTR.spotlight
    || mutationRecord.attributeName === DATA_ATTR.placeholderActive
    || mutationRecord.attributeName === 'data-blok-placeholder-visible'
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
 * The records of one batch for each watched element they belong to, by the
 * same rule as {@link isMutationBelongsToElement}: the target and all its
 * ancestors, plus a node a childList record added or removed.
 *
 * Each node's watched ancestors are found once per batch and reused, so a
 * batch costs one step per record plus one per distinct node.
 * @param mutations - one MutationObserver batch
 * @param watched - the elements anyone will look up; others are skipped
 */
export const groupMutationsByElement = (mutations: MutationRecord[], watched: ReadonlySet<Node>): Map<Node, MutationRecord[]> => {
  const byElement = new Map<Node, MutationRecord[]>();
  const none: Node[] = [];
  const watchedAbove = new Map<Node, Node[]>();
  const add = (node: Node, mutationRecord: MutationRecord): void => {
    const list = byElement.get(node);

    if (list === undefined) {
      byElement.set(node, [mutationRecord]);
    } else if (list[list.length - 1] !== mutationRecord) {
      list.push(mutationRecord);
    }
  };
  const watchedAtOrAbove = (node: Node | null): Node[] => {
    if (node === null) {
      return none;
    }

    const cached = watchedAbove.get(node);

    if (cached !== undefined) {
      return cached;
    }

    const above = watchedAtOrAbove(node.parentNode);
    const found = watched.has(node) ? [node, ...above] : above;

    watchedAbove.set(node, found);

    return found;
  };
  const addIfWatched = (nodes: NodeList, mutationRecord: MutationRecord): void => {
    for (const node of nodes) {
      if (watched.has(node)) {
        add(node, mutationRecord);
      }
    }
  };

  for (const mutationRecord of mutations) {
    if (isTechnicalMutation(mutationRecord)) {
      continue;
    }

    for (const element of watchedAtOrAbove(mutationRecord.target)) {
      add(element, mutationRecord);
    }

    if (mutationRecord.type === 'childList') {
      addIfWatched(mutationRecord.addedNodes, mutationRecord);
      addIfWatched(mutationRecord.removedNodes, mutationRecord);
    }
  }

  return byElement;
};
