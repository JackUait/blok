/**
 * Cmd/Ctrl+Alt+T opens and closes every database group on the page
 * (notion.com/releases/2022-08-11). One document listener serves every
 * database of every editor; it lives while at least one database does.
 */
export interface GroupToggleTarget {
  /** Whether the active view draws groups. */
  hasGroups: () => boolean;
  /** Whether any of its groups is open. */
  anyExpanded: () => boolean;
  setAllCollapsed: (collapsed: boolean) => void;
}

const targets = new Set<GroupToggleTarget>();

/** `code`, not `key`: on a Mac, Alt+T types "†". */
const isToggleAllKey = (event: KeyboardEvent): boolean =>
  event.code === 'KeyT' && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey;

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isToggleAllKey(event) || event.defaultPrevented) return;
  const grouped = [...targets].filter((target) => target.hasGroups());

  if (grouped.length === 0) return;
  event.preventDefault();
  const collapse = grouped.some((target) => target.anyExpanded());

  for (const target of grouped) {
    target.setAllCollapsed(collapse);
  }
};

/** Returns the unregister function. */
export const registerGroupToggle = (target: GroupToggleTarget): (() => void) => {
  if (targets.size === 0) {
    document.addEventListener('keydown', handleKeydown);
  }
  targets.add(target);

  return () => {
    targets.delete(target);
    if (targets.size === 0) {
      document.removeEventListener('keydown', handleKeydown);
    }
  };
};
