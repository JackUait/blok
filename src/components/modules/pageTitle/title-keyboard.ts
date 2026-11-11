import { getCaretXPosition, isCaretAtLastLine } from '../../utils/caret';
import { historyKeyOf } from '../../utils/history-keys';
import { BLOK_MIME_TYPE } from '../paste/constants';

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

// Blok's own text/plain is Markdown ("## Head"), so a Blok copy pastes its blocks' text instead.
const blokClipboardText = (json: string): string | null => {
  try {
    const entries: unknown = JSON.parse(json);

    if (!Array.isArray(entries)) {
      return null;
    }
    // A template parses without running scripts or loading images.
    const parser = document.createElement('template');

    return entries.flatMap((entry: { data?: { text?: unknown } }) => {
      const html = entry?.data?.text;

      if (typeof html !== 'string') {
        return [];
      }
      parser.innerHTML = html;
      const text = (parser.content.textContent ?? '').trim();

      return text === '' ? [] : [text];
    }).join(' ');
  } catch {
    return null;
  }
};

export const bindTitleKeyboard = (title: HTMLElement, host: TitleKeyboardHost): (() => void) => {
  const onKeydown = (event: KeyboardEvent): void => {
    const letter = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    const history = historyKeyOf(event, letter);

    if (history !== null) {
      // A blocked key is cancelled too: the browser's own undo would rewind the title behind Yjs.
      event.preventDefault();
      if (history === 'redo') {
        host.redo();
      } else if (history === 'undo') {
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
    const blok = event.clipboardData?.getData(BLOK_MIME_TYPE) ?? '';
    const pasted = (blok === '' ? null : blokClipboardText(blok)) ?? event.clipboardData?.getData('text/plain') ?? '';
    const text = document.createTextNode(pasted.replace(/\s*\n\s*/g, ' '));

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
