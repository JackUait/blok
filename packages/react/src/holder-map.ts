/**
 * Module-level WeakMap associating editor instances with their detached holder divs.
 * WeakMap ensures no memory leaks — when the editor is garbage collected, the holder reference is released.
 */
const holders = new WeakMap<WeakKey, HTMLDivElement>();

export function setHolder(editor: WeakKey, holder: HTMLDivElement): void {
  holders.set(editor, holder);
}

export function getHolder(editor: WeakKey): HTMLDivElement | undefined {
  return holders.get(editor);
}

export function removeHolder(editor: WeakKey): void {
  holders.delete(editor);
}
