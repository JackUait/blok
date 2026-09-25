/**
 * Translate between rich-text HTML and a PLAINTEXT field (a code block's
 * `code`), so content keeps its lines and characters when it crosses over.
 */

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TR', 'UL',
]);

/**
 * HTML → plain text: <br> and block ends become "\n", tags drop, entities decode.
 * @param html - rich-text HTML
 */
export const htmlToPlainText = (html: string): string => {
  // A <template> parse is inert: a detached div would fire img onerror.
  const template = document.createElement('template');

  template.innerHTML = html;

  const parts: string[] = [];
  // A block edge owes a "\n" before the next text, unless one is already there.
  const state = { pendingBreak: false };

  const emit = (text: string): void => {
    if (text === '') {
      return;
    }

    if (state.pendingBreak && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }

    state.pendingBreak = false;
    parts.push(text);
  };

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        emit((child.textContent ?? '').replace(/\u00A0/g, ' '));
        continue;
      }

      if (!(child instanceof Element)) {
        continue;
      }

      if (child.tagName === 'BR') {
        state.pendingBreak = false;
        parts.push('\n');
        continue;
      }

      const isBlock = BLOCK_TAGS.has(child.tagName);

      state.pendingBreak = state.pendingBreak || isBlock;
      walk(child);
      state.pendingBreak = state.pendingBreak || isBlock;
    }
  };

  walk(template.content);

  return parts.join('');
};

/**
 * Plain text → HTML: escape `&`, `<`, `>` and turn "\n" into <br>.
 * @param text - plain text
 */
export const plainTextToHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n?|\n/g, '<br>');
};
