import { getCaretXPosition, isCaretAtLastLine } from '../../utils/caret';

export interface TitleKeyboardHost {
  isReadOnly(): boolean;
  /** Enter: text after the caret becomes a new first block. */
  split(html: string): void;
  /** ArrowDown on the last line. */
  toFirstBlock(x: number | null): void;
  undo(): void;
  redo(): void;
  /** Title text changed by a non-typing write (paste, Enter). */
  commit(): void;
}

// The title is plain text: native bold/italic/underline would add elements.
const FORMAT_KEYS = new Set(['b', 'i', 'u']);

export const bindTitleKeyboard = (title: HTMLElement, host: TitleKeyboardHost): (() => void) => {
  const onKeydown = (event: KeyboardEvent): void => {
    const letter = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    const redo = (mod && event.shiftKey && letter === 'z') || (event.ctrlKey && !event.shiftKey && letter === 'y');

    if (redo || (mod && !event.shiftKey && letter === 'z')) {
      event.preventDefault();
      if (redo) {
        host.redo();
      } else {
        host.undo();
      }

      return;
    }
    if (mod && FORMAT_KEYS.has(letter)) {
      event.preventDefault();
      // Inline-tool shortcuts listen on document and ignore defaultPrevented.
      event.stopPropagation();

      return;
    }
    if (event.isComposing || host.isReadOnly()) {
      return;
    }
    if (event.key === 'ArrowDown' && !event.shiftKey && isCaretAtLastLine(title)) {
      event.preventDefault();
      host.toFirstBlock(getCaretXPosition());

      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const range = window.getSelection()?.getRangeAt(0);

    if (range === undefined || !title.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    range.setEnd(title, title.childNodes.length);
    const rest = document.createElement('div');

    rest.append(range.extractContents());
    title.normalize();
    host.commit();
    host.split(rest.innerHTML);
  };

  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    const range = window.getSelection()?.getRangeAt(0);

    if (range === undefined || !title.contains(range.commonAncestorContainer) || host.isReadOnly()) {
      return;
    }
    const text = document.createTextNode((event.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' '));

    range.deleteContents();
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    title.normalize();
    host.commit();
  };

  title.addEventListener('keydown', onKeydown);
  title.addEventListener('paste', onPaste);

  return () => {
    title.removeEventListener('keydown', onKeydown);
    title.removeEventListener('paste', onPaste);
  };
};
