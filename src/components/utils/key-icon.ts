/**
 * Utilities for rendering keyboard shortcut keys as inline SVG icons.
 *
 * Each key token is wrapped in a minimal inline SVG that renders the Unicode
 * glyph as SVG <text>. No borders, no boxes — visually identical to plain
 * Unicode text, but each symbol is a proper SVG element.
 *
 * The result matches the compact Mac-style shortcut display:
 *   ⌘⌃L   ⌘D   ⌘⇧P   Del
 *
 * Usage:
 *   element.innerHTML = makeShortcutHtml('⌘ + B');
 */

/**
 * Canonical Unicode glyph for each key name.
 * All modifier symbols and common key names are covered.
 */
const KEY_LABEL_MAP: Record<string, string> = {
  '⌘': '⌘',
  '⇧': '⇧',
  '⌥': '⌥',
  '⌃': '⌃',
  '⌫': '⌫',
  '⏎': '⏎',
  '⎋': '⎋',
  '␡': '⌦',
  '↑': '↑',
  '↓': '↓',
  '←': '←',
  '→': '→',
  'ctrl': '⌃',
  'alt': '⌥',
  'shift': '⇧',
  'enter': '↵',
  'backspace': '⌫',
  'escape': '⎋',
  'esc': '⎋',
  'delete': '⌦',
  'del': 'Del',
  'tab': '⇥',
  'ins': 'Ins',
  'win': '⊞',
};

/**
 * Resolves a raw token string to its canonical display glyph.
 */
function resolveLabel(token: string): string {
  const trimmed = token.trim();

  return KEY_LABEL_MAP[trimmed.toLowerCase()] ?? KEY_LABEL_MAP[trimmed] ?? trimmed;
}

/**
 * Splits a shortcut segment into individual key tokens.
 * Handles concatenated modifier symbols like "⌃⌘L" → ['⌃', '⌘', 'L'].
 */
function tokenizeSegment(segment: string): string[] {
  const modifierPattern = /([⌘⇧⌥⌃⌫⏎⎋⌦↑↓←→↵⇥])|([^⌘⇧⌥⌃⌫⏎⎋⌦↑↓←→↵⇥]+)/gu;
  const tokens: string[] = [];

  for (const match of segment.matchAll(modifierPattern)) {
    const token = match[0].trim();

    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Renders a single key glyph as an inline SVG <text> element.
 * No border, no background — just the Unicode character as SVG.
 * Font size and width adapt to single-char symbols vs multi-char labels.
 */
function makeKeySvg(label: string): string {
  const isSymbol = label.length === 1;
  // Symbols (⌘, ⇧, …) are wider glyphs; short text (Del, Ins) is narrower per-char
  const fontSize = isSymbol ? 13 : 11;
  const charWidth = isSymbol ? 13 : 7.5;
  const w = Math.ceil(label.length * charWidth);
  const h = 16;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${w}" height="${h}"` +
    ` viewBox="0 0 ${w} ${h}"` +
    ` style="display:inline-block;vertical-align:middle;flex-shrink:0"` +
    ` aria-hidden="true">` +
    `<text` +
    ` x="${w / 2}"` +
    ` y="${h / 2 + 1}"` +
    ` text-anchor="middle"` +
    ` dominant-baseline="middle"` +
    ` font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif"` +
    ` font-size="${fontSize}"` +
    ` font-weight="400"` +
    ` fill="currentColor"` +
    `>${label}</text>` +
    `</svg>`
  );
}

/**
 * Converts a beautified shortcut string (e.g. "⌘ + B" or "⌃⌘L") into an
 * HTML string of inline SVG glyph elements, tightly concatenated with no
 * separator — matching the compact Mac shortcut display style.
 *
 * Accepts the output of `beautifyShortcut()` which uses " + " as separator.
 */
export function makeShortcutHtml(shortcut: string): string {
  const tokens = shortcut
    .split(' + ')
    .flatMap(tokenizeSegment);

  if (tokens.length === 0) {
    return shortcut;
  }

  const svgs = tokens.map((token) => makeKeySvg(resolveLabel(token)));

  return `<span style="display:inline-flex;align-items:center;line-height:1">${svgs.join('')}</span>`;
}

/**
 * Maps Unicode glyphs and short labels back to full English key names
 * for use in human-readable tooltip descriptions.
 */
const READABLE_KEY_MAP: Record<string, string> = {
  '⌘': 'Command',
  '⇧': 'Shift',
  '⌥': 'Option',
  '⌃': 'Control',
  '⌫': 'Backspace',
  '⌦': 'Delete',
  '⏎': 'Return',
  '↵': 'Return',
  '⎋': 'Escape',
  '⇥': 'Tab',
  '↑': 'Up',
  '↓': 'Down',
  '←': 'Left',
  '→': 'Right',
  'del': 'Delete',
  'ins': 'Insert',
  '⊞': 'Win',
};

/**
 * Converts a shortcut string (e.g. "⌃⌘L" or "⌘ + C") into a human-readable
 * description like "Control+Command+L" or "Command+C".
 *
 * Each token is expanded to its full English key name. Plain letter/number
 * tokens are uppercased. Unknown glyphs are passed through as-is.
 */
export function shortcutToReadable(shortcut: string): string {
  const tokens = shortcut
    .split(' + ')
    .flatMap(tokenizeSegment);

  if (tokens.length === 0) {
    return shortcut;
  }

  return tokens
    .map((token) => {
      const trimmed = token.trim();
      const lower = trimmed.toLowerCase();

      return READABLE_KEY_MAP[trimmed] ?? READABLE_KEY_MAP[lower] ?? trimmed.toUpperCase();
    })
    .join('+');
}

/**
 * Maps display glyphs and key names to the UI-Events key values required by
 * the aria-keyshortcuts attribute (e.g. "Meta", "Control", "ArrowUp").
 * Unlike READABLE_KEY_MAP (pretty tooltip names like "Command"), these tokens
 * are the only spec-valid values assistive technology understands.
 */
const ARIA_KEY_MAP: Record<string, string> = {
  '⌘': 'Meta',
  'cmd': 'Meta',
  'command': 'Meta',
  'win': 'Meta',
  '⊞': 'Meta',
  '⌃': 'Control',
  'ctrl': 'Control',
  'control': 'Control',
  '⌥': 'Alt',
  'alt': 'Alt',
  'option': 'Alt',
  '⇧': 'Shift',
  'shift': 'Shift',
  '⌫': 'Backspace',
  'backspace': 'Backspace',
  '⌦': 'Delete',
  'del': 'Delete',
  'delete': 'Delete',
  '⏎': 'Enter',
  '↵': 'Enter',
  'enter': 'Enter',
  'return': 'Enter',
  '⎋': 'Escape',
  'esc': 'Escape',
  'escape': 'Escape',
  '⇥': 'Tab',
  'tab': 'Tab',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  'ins': 'Insert',
  'insert': 'Insert',
};

/**
 * Converts a shortcut string (e.g. "⌃⌘L" or "⌘ + C") into a spec-valid
 * aria-keyshortcuts value like "Control+Meta+L" (ARIA requires UI-Events key
 * values — "Meta"/"Control" — not pretty names like "Command"/"CTRL").
 *
 * Use this ONLY for the aria-keyshortcuts attribute; visible labels and
 * tooltips should keep the pretty `shortcutToReadable()` version.
 */
export function shortcutToAriaKeyshortcuts(shortcut: string): string {
  const tokens = shortcut
    .split(' + ')
    .flatMap(tokenizeSegment);

  if (tokens.length === 0) {
    return shortcut;
  }

  return tokens
    .map((token) => {
      const trimmed = token.trim();
      const mapped = ARIA_KEY_MAP[trimmed] ?? ARIA_KEY_MAP[trimmed.toLowerCase()];

      if (mapped !== undefined) {
        return mapped;
      }

      return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
    })
    .join('+');
}
