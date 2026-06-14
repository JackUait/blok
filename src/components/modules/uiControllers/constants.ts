/**
 * Keys that require caret capture on keydown before tools can intercept them.
 * When tools call event.preventDefault() on keydown, beforeinput never fires,
 * so we capture caret position for these keys in the capture phase.
 */
export const KEYS_REQUIRING_CARET_CAPTURE = new Set(['Enter', 'Backspace', 'Delete', 'Tab']);
