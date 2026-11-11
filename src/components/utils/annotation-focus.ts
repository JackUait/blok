import { ANNOTATION_ATTR } from '../../shared/annotation-mark';

/**
 * A reader opens a hint from the keyboard, so in read-only mode each one is a
 * focusable button. In edit mode it is plain text inside the editable field.
 * The sanitizer drops both attributes, so they never reach saved data.
 * @param root - the tool's rendered element
 * @param readOnly - whether the block is read-only
 */
export const syncAnnotationFocus = (root: Element, readOnly: boolean): void => {
  for (const hint of Array.from(root.querySelectorAll(`span[${ANNOTATION_ATTR}]`))) {
    if (readOnly) {
      hint.setAttribute('tabindex', '0');
      hint.setAttribute('role', 'button');
    } else if (hint.hasAttribute('tabindex')) {
      // Guarded: an unconditional write would dirty the block on every render.
      hint.removeAttribute('tabindex');
      hint.removeAttribute('role');
    }
  }
};
