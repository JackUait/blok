import type { Blockquote, PhrasingContent, RootContent } from 'mdast';

/** GitHub alert markers: `> [!NOTE]`, `[!WARNING]`, etc. */
export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

export type AlertKind = typeof ALERT_KINDS[number];

const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

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
