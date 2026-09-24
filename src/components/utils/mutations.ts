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
 * Check if passed mutation belongs to a passed element
 * @param mutationRecord - mutation to check
 * @param element - element that is expected to contain mutation
 */
export const isMutationBelongsToElement = (mutationRecord: MutationRecord, element: Element): boolean => {
  const { type, target, addedNodes, removedNodes } = mutationRecord;

  /**
   * Skip own technical mutations, for example, data-blok-empty or data-blok-toggle-open attribute changes
   */
  if (mutationRecord.type === 'attributes' && (mutationRecord.attributeName === 'data-blok-empty' || mutationRecord.attributeName === 'data-blok-toggle-open')) {
    return false;
  }

  if (isToolboxComboboxWrite(mutationRecord)) {
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
