import { DATA_ATTR } from '../constants/data-attributes';

export type TextDirection = 'ltr' | 'rtl';

interface PortalDirectionOptions {
  /**
   * Editor direction already resolved from configuration. When present, this
   * wins over the source element (locale direction can be explicitly
   * overridden by consumers).
   */
  direction?: TextDirection;

  /**
   * Live element that owns the detached UI root.
   */
  source?: Element | null;

  /**
   * Called after a runtime flip re-reads the portal's direction, so the
   * portal can re-place itself on the new side.
   */
  onResync?: () => void;
}

const isTextDirection = (value: string | null | undefined): value is TextDirection =>
  value === 'ltr' || value === 'rtl';

const resolveSemanticDirection = (element: Element | null): TextDirection | undefined => {
  if (element === null) {
    return undefined;
  }

  const semanticDirection = element.getAttribute('dir');

  return isTextDirection(semanticDirection)
    ? semanticDirection
    : resolveSemanticDirection(element.parentElement);
};

/**
 * Reads the effective direction of an editor-owned element.
 *
 * Computed style is authoritative because it includes the editor's configured
 * direction override. The `dir` walk is a fallback for detached DOM and test
 * environments that do not fully resolve inherited presentation hints.
 */
const resolveSourceDirection = (source: Element | null | undefined): TextDirection | undefined => {
  if (source === null || source === undefined) {
    return undefined;
  }

  // Menus speak the editor's UI language. A block may carry its own `dir`
  // (an English paragraph in an RTL editor), so read the editor root instead.
  const owner = source.closest(`[${DATA_ATTR.editor}]`) ?? source;
  const computedDirection = window.getComputedStyle(owner).direction;

  if (isTextDirection(computedDirection)) {
    return computedDirection;
  }

  return resolveSemanticDirection(owner);
};

/**
 * Portals synced from a live source, so a runtime direction flip can re-read
 * them. Closed (disconnected) portals are dropped on every sync, which keeps
 * this bounded by the portals open at once.
 */
const syncedPortals = new Map<HTMLElement, { source: Element; onResync?: () => void }>();

const rememberPortal = (target: HTMLElement, options: PortalDirectionOptions): void => {
  syncedPortals.forEach((_entry, portal) => {
    if (portal !== target && !portal.isConnected) {
      syncedPortals.delete(portal);
    }
  });

  if (options.direction === undefined && options.source !== null && options.source !== undefined) {
    syncedPortals.set(target, { source: options.source, onResync: options.onResync });
  } else {
    syncedPortals.delete(target);
  }
};

/**
 * Carries an editor's effective direction onto a root that is detached from
 * the editor ancestry (body portal, CSS Top Layer, or reset nested popover).
 *
 * Both forms are intentional:
 * - `dir` supplies semantic base direction to descendants and assistive tech;
 * - inline `direction: … !important` beats Blok's isolation reset, whose
 *   author-level `direction: initial !important` would otherwise force LTR.
 *
 * The helper is safe to call for every open. If no owner can be resolved it
 * leaves the target untouched rather than guessing from the host document.
 */
export const syncPortalDirection = (
  target: HTMLElement,
  options: PortalDirectionOptions = {}
): TextDirection | undefined => {
  rememberPortal(target, options);

  const resolvedDirection = options.direction ?? resolveSourceDirection(options.source);

  if (resolvedDirection === undefined) {
    return undefined;
  }

  target.setAttribute('dir', resolvedDirection);
  target.style.setProperty('direction', resolvedDirection, 'important');

  return resolvedDirection;
};

/**
 * True when `source` belongs to an editor nested inside `root` (a database
 * page body). That editor resyncs its own portals when its direction changes.
 */
const isInNestedEditor = (source: Element, root: Element): boolean => {
  const owner = source.closest(`[${DATA_ATTR.editor}]`);

  return owner !== null && owner !== root && root.contains(owner);
};

/**
 * Re-reads the direction of every open portal whose source lives in `root`.
 * Called when an editor flips direction at runtime; portals of other editors
 * are left alone. A portal that registered `onResync` re-places itself, but
 * only when its direction changed: re-placing closes submenus, and the i18n
 * API re-applies the same direction on every locale or message update.
 */
export const resyncPortalDirections = (root: Element): void => {
  syncedPortals.forEach(({ source, onResync }, portal) => {
    if (!portal.isConnected || !source.isConnected || !root.contains(source) || isInNestedEditor(source, root)) {
      return;
    }

    const previous = portal.getAttribute('dir');
    const next = syncPortalDirection(portal, { source, onResync });

    if (next !== undefined && next !== previous) {
      onResync?.();
    }
  });
};
