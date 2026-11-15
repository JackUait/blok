/**
 * Decide what a page's sidebar icon becomes when the editor reports one.
 *
 * The editor is the source of truth for the icon — it lives in the document
 * (`OutputData.icon`) — and the index is a mirror. But on a remote page the
 * document arrives *after* the editor is ready, so reading the icon at load
 * time yields nothing. Writing that nothing into the mirror erased the icon:
 * the sidebar lost it on every visit, and it came back a moment later when the
 * document landed, which is the flash.
 *
 * So the load-time read may only ever ADOPT an icon, never clear one. Clearing
 * is reserved for a real change — the user removing it — which arrives through
 * `onIconChange`.
 */
export function nextPageIcon(
  current: string | undefined,
  incoming: string | undefined,
  options: { adoptOnly: boolean },
): string | undefined {
  if (options.adoptOnly && incoming === undefined) return current;
  return incoming;
}
