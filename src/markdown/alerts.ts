import type { Blockquote, PhrasingContent, RootContent } from '../../types/data-formats/markdown-tree';

/**
 * GitHub alert markers: `> [!NOTE]`, `[!WARNING]`, etc. `[!CALLOUT]` is Blok's
 * own: the export writes it for a callout no GitHub kind matches, so the
 * default callout comes back unchanged. GitHub shows it as a plain quote.
 */
export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution', 'callout'] as const;

export type AlertKind = typeof ALERT_KINDS[number];

/** Case-sensitive, as GitHub reads it: `[!note]` stays a quote. */
export const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|CALLOUT)\]\s*/;

/** The callout an alert becomes. */
export const ALERT_STYLE: Record<AlertKind, { emoji: string; backgroundColor: string | null }> = {
  note: { emoji: 'ℹ️', backgroundColor: 'blue' },
  tip: { emoji: '💡', backgroundColor: 'green' },
  important: { emoji: '❗', backgroundColor: 'purple' },
  warning: { emoji: '⚠️', backgroundColor: 'orange' },
  caution: { emoji: '🛑', backgroundColor: 'red' },
  // The callout tool's defaults: DEFAULT_EMOJI and no background.
  callout: { emoji: '💡', backgroundColor: null },
};

/**
 * The alert a callout exports as: the kind whose style it has, else `callout`.
 * @param emoji - the callout's emoji
 * @param backgroundColor - its background preset, or null
 */
export const alertKindFor = (emoji: string, backgroundColor: string | null): AlertKind =>
  ALERT_KINDS.find((kind) => ALERT_STYLE[kind].emoji === emoji && ALERT_STYLE[kind].backgroundColor === backgroundColor) ?? 'callout';

/**
 * Detect a GitHub alert blockquote (`> [!NOTE]` on the first line) and return
 * the alert kind plus the blockquote children with the marker text stripped.
 * Shared by the preview renderer and the block importer.
 */
export function matchAlert(node: Blockquote): { kind: AlertKind; children: RootContent[] } | null {
  const [first] = node.children;
  if (first === undefined || first.type !== 'paragraph') {
    return null;
  }
  const [firstInline] = first.children;
  if (firstInline === undefined || firstInline.type !== 'text') {
    return null;
  }
  const match = ALERT_MARKER.exec(firstInline.value);
  if (match === null) {
    return null;
  }
  const kind = match[1].toLowerCase();
  if (!ALERT_KINDS.includes(kind as AlertKind)) {
    return null;
  }

  // Strip the marker from the first text node; drop the node if it then becomes
  // empty (the marker sat on its own line followed by a hard break).
  const strippedValue = firstInline.value.slice(match[0].length).replace(/^\n+/, '');
  // Only the break right after the marker goes; later breaks are content.
  const rest = first.children.slice(1);
  const restInline: PhrasingContent[] = strippedValue === ''
    ? rest.slice(rest[0]?.type === 'break' ? 1 : 0)
    : [{ ...firstInline, value: strippedValue }, ...rest];

  const children: RootContent[] = restInline.length > 0
    ? [{ ...first, children: restInline }, ...node.children.slice(1)]
    : node.children.slice(1);

  return { kind: kind as AlertKind, children };
}
