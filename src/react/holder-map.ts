/**
 * Module-level WeakMap associating editor instances with their detached holder divs.
 * WeakMap ensures no memory leaks — when the editor is garbage collected, the holder reference is released.
 */
const holders = new WeakMap<object, HTMLDivElement>();

export function setHolder(editor: object, holder: HTMLDivElement): void {
  holders.set(editor, holder);
}

export function getHolder(editor: object): HTMLDivElement | undefined {
  return holders.get(editor);
}

export function removeHolder(editor: object): void {
  holders.delete(editor);
}
